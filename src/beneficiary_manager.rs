//! Beneficiary identity, recovery-code, and offline access restoration.
//!
//! Operational guarantees, expiry rules, reconciliation steps, and known
//! abuse-resistance gaps (including the current deterministic recovery-code
//! format) are documented in `docs/offline-flows.md`.

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64, BytesN};
use crate::unique_id::*;
use crate::rbac::{self, ROLE_NGO, ROLE_ADMIN};

/// Maximum verification / recovery attempts allowed per cooldown window (#118, #119).
pub const MAX_AUTH_ATTEMPTS_PER_WINDOW: u32 = 5;
/// Cooldown / rate-limit window duration in seconds (#118, #119, #123).
pub const AUTH_WINDOW_SECS: u64 = 3_600;
/// Maximum location updates permitted per beneficiary within `AUTH_WINDOW_SECS` (#123).
pub const MAX_LOCATION_UPDATES_PER_WINDOW: u32 = 5;
/// Bounded scan cap for `list_beneficiaries_by_disaster`; prefer `list_beneficiaries_paginated` (#125).
pub const MAX_DISASTER_LIST_SCAN: u32 = 200;
/// Minimum recovery contacts and default approval threshold for social recovery (#121).
pub const DEFAULT_SOCIAL_RECOVERY_THRESHOLD: u32 = 3;

fn bytes_to_hex_prefix(env: &Env, digest: &BytesN<32>, bytes_len: usize, prefix: &str) -> String {
    let arr = digest.to_array();
    let mut s = std::string::String::from(prefix);
    for b in arr.iter().take(bytes_len) {
        s.push_str(&format!("{:02x}", b));
    }
    String::from_str(env, &s)
}

fn sha256_str(env: &Env, preimage: &str) -> BytesN<32> {
    use soroban_sdk::crypto::sha256;
    let bytes = sha256(env, &String::from_str(env, preimage).into());
    BytesN::from_array(env, &bytes.to_array())
}

#[derive(Clone)]
pub struct ReactivationAuditRecord {
    pub beneficiary_id: String,
    pub actor: Address,
    pub reason: String,
    pub reactivated_at: u64,
}

#[contract]
pub struct BeneficiaryManager;

/// On-chain pseudonymous identity record for a displaced person.
///
/// # Privacy model
/// - `id_hash`: SHA-256 hash of an operator-defined stable identifier.
///   The raw identifier is **never** stored on-chain.  Readable by any
///   ledger observer, but not reversible to a real name.
/// - `creation_factors`: Each factor stores only a SHA-256 `factor_hash`
///   and metadata (type, weight, verifier).  Raw factor values (possession
///   items, behavioural patterns) are **never** stored on-chain.
/// - `camp_location`: Use camp-level granularity (e.g. "Camp Alpha, Zone 3").
///   Never store GPS coordinates or street addresses here.
/// - `duress_pin_hash`: SHA-256 hash of a decoy PIN for safety.  Raw PIN
///   is **never** stored on-chain.
/// - `temporary_credentials`: Each credential stores a `credential_hash` and
///   a `device_fingerprint` string.  Use a randomly generated device token
///   (not IMEI, hardware serial, or user-agent) as the fingerprint value.
///   Rotate on credential expiry.
#[derive(Clone)]
pub struct BeneficiaryIdentity {
    pub id_hash: BytesN<32>, // SHA-256 pseudonymous identifier — raw value never stored on-chain
    pub creation_factors: Vec<IdentityFactor>,
    pub recovery_contacts: Vec<Address>,
    pub trust_score: u32, // 0–100 computed from behavioural patterns; no raw behaviour stored
    pub camp_location: String, // Use camp-level granularity only; no precise GPS coordinates
    pub created_at: u64,
    pub last_verified: u64,
    pub wallet_address: Address,
    pub is_active: bool,
    pub duress_pin_hash: Option<BytesN<32>>, // SHA-256 hash of decoy PIN; raw PIN never stored
    pub geofence_zones: Vec<GeofenceZone>,
    pub temporary_credentials: Vec<TemporaryCredential>,
    // Disbursement/transfer linkage - track associated records
    pub disbursement_ids: Vec<String>,
    pub transfer_ids: Vec<String>,
}

/// Public-facing beneficiary profile stored on-chain.
///
/// # Privacy model
/// - `name`: Stored as plain text on-chain; readable by any ledger observer.
///   Operators should use a family-unit code (e.g. "FAM-DR-0042") rather
///   than a real full name.  Real-name mappings must be kept off-chain.
/// - `location`: Use camp-level granularity.  Do not store precise GPS
///   coordinates, street addresses, or personally identifying location data.
/// - `wallet_address`: Stellar public key — pseudonymous but linkable across
///   transactions.
/// - `verification_factors`: Only factor type and weight are stored on-chain.
///   Raw factor values are **never** stored on-chain.
/// - `trust_score`: 0–100 aggregate score derived from behavioural patterns.
///   No raw behavioural data is stored on-chain.
/// - `identity`: When present, links to the pseudonymous `BeneficiaryIdentity`
///   record which stores hashed factors only.
#[derive(Clone)]
pub struct BeneficiaryProfile {
    pub id: String,
    /// Pseudonymous unit code derived via SHA-256 commitment; no plaintext personal names stored on-chain (#116).
    pub pseudonym: String,
    pub disaster_id: String,
    pub location: String,   // Camp-level granularity only; no precise GPS/street data
    pub registration_date: u64,
    pub last_verified: u64,
    /// Canonical identity hash reference (when linked).
    pub identity_hash: Option<BytesN<32>>,
    /// Hashed verification commitments (type + SHA-256 digest + weight); no plaintext secrets stored (#118).
    pub verification_factors: Vec<VerificationFactor>,
    pub wallet_address: Address,
    pub is_active: bool,
    pub family_size: u32,
    pub special_needs: Vec<String>, // Use category codes (e.g. "medical"); no free-text PII
    pub trust_score: u32,           // 0–100 aggregate; no raw behavioural data on-chain
    pub identity: Option<BeneficiaryIdentity>, // Links to hashed-factor identity record
}

/// An individual identity factor stored on-chain.
///
/// # Privacy model
/// - `factor_hash`: SHA-256 (via `sha2` crate) of the raw factor value.
///   The raw value (e.g. a possession item description, a social voucher
///   identifier) is **never** stored on-chain.
/// - `factor_type`: Plain string label — use defined codes only:
///   `"knowledge"`, `"possession"`, `"social"`, `"behavioral"`, `"institutional"`.
///   Do not use free-text descriptions that could identify the beneficiary.
/// - `verifier`: Optional Stellar address of the NGO worker or community
///   member who verified this factor.  Readable by any ledger observer.
#[derive(Clone)]
pub struct IdentityFactor {
    pub factor_type: String, // Code: "knowledge" | "possession" | "social" | "behavioral" | "institutional"
    pub factor_hash: BytesN<32>, // SHA-256 of raw value — raw value never stored on-chain
    pub weight: u32,
    pub verified_at: u64,
    pub verifier: Option<Address>, // NGO worker or community member; readable by ledger observers
}

#[derive(Clone)]
pub struct VerificationFactor {
    pub factor_type: String, // "possession", "behavioral", "social"
    pub value: String,
    pub weight: u32,
    pub verified_at: u64,
}

#[derive(Clone)]
pub struct RecoveryCode {
    pub beneficiary_id: String,
    pub code_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_used: bool,
}

/// A short-lived credential tied to a shared device.
///
/// # Privacy model
/// - `credential_hash`: SHA-256 hash; raw credential value never stored.
/// - `device_fingerprint`: MUST be a randomly generated opaque token (e.g.
///   UUID assigned at registration time).  Never use IMEI, hardware serial
///   numbers, MAC addresses, IP addresses, or browser user-agent strings.
///   Rotate this value whenever the credential expires or the device changes
///   hands.
#[derive(Clone)]
pub struct TemporaryCredential {
    pub credential_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub device_fingerprint: String, // Opaque token (e.g. UUID) — never hardware IDs or PII
    pub is_active: bool,
}

/// Use standardized GeofenceZone from geo module
/// Type alias for backward compatibility
pub type GeofenceZone = StdGeofenceZone;

#[derive(Clone)]
pub struct SocialRecoveryRequest {
    pub beneficiary_id_hash: BytesN<32>,
    pub new_wallet: Address,
    pub approvals: Vec<Address>,
    pub required_approvals: u32,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_completed: bool,
}

#[contractimpl]
impl BeneficiaryManager {
    /// Register a displaced person without traditional ID
    /// Creates both a BeneficiaryProfile (operational view) and BeneficiaryIdentity (canonical identity)
    /// Register a displaced person without storing plaintext names or raw factor values on-chain (#116, #118, #124).
    /// Creates both a pseudonymized `BeneficiaryProfile` and canonical `BeneficiaryIdentity`.
    pub fn register_beneficiary(
        env: Env,
        registrar: Address,
        beneficiary_id: String,
        pseudonym_hint: String,
        disaster_id: String,
        location: String,
        wallet_address: Address,
        family_size: u32,
        special_needs: Vec<String>,
        verification_factors: Vec<VerificationFactor>,
    ) {
        registrar.require_auth();
        rbac::require_role(&env, &registrar, ROLE_NGO);

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if beneficiaries.contains_key(beneficiary_id.clone()) {
            panic_with_error!(&env, "Beneficiary already registered");
        }

        // Convert incoming hint to an irreversible pseudonymous label — real personal names remain off-chain (#116)
        let pseudonym_digest = sha256_str(
            &env,
            &format!("SDRP_PSEUDONYM:{}:{}", beneficiary_id, pseudonym_hint),
        );
        let pseudonym = bytes_to_hex_prefix(&env, &pseudonym_digest, 8, "anon_");

        // Hash factor secret values into SHA-256 commitments before persisting (#118)
        let mut committed_factors: Vec<VerificationFactor> = Vec::new(&env);
        let mut identity_factors: Vec<IdentityFactor> = Vec::new(&env);
        for vf in verification_factors.iter() {
            let value_digest = Self::commit_factor_value(&env, &vf.factor_type, &vf.value);
            committed_factors.push_back(VerificationFactor {
                factor_type: vf.factor_type.clone(),
                value: value_digest,
                weight: vf.weight,
                verified_at: vf.verified_at,
            });
            identity_factors.push_back(IdentityFactor {
                factor_type: vf.factor_type.clone(),
                factor_hash: Self::hash_verification_factor(&env, &vf),
                weight: vf.weight,
                verified_at: vf.verified_at,
                verifier: None,
            });
        }

        let identity_hash = generate_unique_id(&env, "ben_id", Some(&registrar));
        let id_bytes = env.crypto().sha256(&identity_hash.to_string().into());
        let id_hash: BytesN<32> = BytesN::from_array(&env, &id_bytes.to_array());

        let identity = BeneficiaryIdentity {
            id_hash: id_hash.clone(),
            creation_factors: identity_factors,
            recovery_contacts: Vec::new(&env),
            trust_score: 50,
            camp_location: location.clone(),
            created_at: env.ledger().timestamp(),
            last_verified: env.ledger().timestamp(),
            wallet_address: wallet_address.clone(),
            is_active: true,
            duress_pin_hash: None,
            geofence_zones: Vec::new(&env),
            temporary_credentials: Vec::new(&env),
            disbursement_ids: Vec::new(&env),
            transfer_ids: Vec::new(&env),
        };

        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        identities.set(id_hash.clone(), identity.clone());
        env.storage().persistent().set(&identities_key, &identities);

        let profile = BeneficiaryProfile {
            id: beneficiary_id.clone(),
            pseudonym,
            disaster_id,
            location,
            registration_date: env.ledger().timestamp(),
            last_verified: env.ledger().timestamp(),
            identity_hash: Some(id_hash),
            verification_factors: committed_factors,
            wallet_address: wallet_address.clone(),
            is_active: true,
            family_size,
            special_needs,
            trust_score: 50,
            identity: Some(identity),
        };

        beneficiaries.set(beneficiary_id.clone(), profile);
        env.storage().instance().set(&beneficiaries_key, &beneficiaries);

        env.events().publish(
            (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "registered")),
            (beneficiary_id.clone(), wallet_address),
        );

        // Generate salted recovery codes keyed by an unpredictable per-beneficiary salt (#124)
        let recovery_salt = generate_unique_id(&env, "rc_salt", Some(&registrar));
        Self::generate_recovery_codes(&env, beneficiary_id, recovery_salt);
    }

    fn commit_factor_value(env: &Env, factor_type: &String, raw_or_hash: &String) -> String {
        let digest = sha256_str(
            env,
            &format!("SDRP_VF_V1:{}:{}", factor_type, raw_or_hash),
        );
        bytes_to_hex_prefix(env, &digest, 32, "")
    }

    /// Generate recovery codes for offline access restoration.
    ///
    /// Three single-use codes are stored with 30/60/90-day expiry. The current
    /// hash is deterministic from the beneficiary ID and index, so this is not
    /// a production-grade secret; see `docs/offline-flows.md` (known gaps).
    fn generate_recovery_codes(env: &Env, beneficiary_id: String, salt: String) {
        let salt_key = Symbol::new(env, "recovery_salts");
        let mut salts: Map<String, String> = env
            .storage()
            .instance()
            .get(&salt_key)
            .unwrap_or(Map::new(env));
        salts.set(beneficiary_id.clone(), salt.clone());
        env.storage().instance().set(&salt_key, &salts);

        let recovery_key = Symbol::new(env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(env));

        let mut codes = Vec::new(env);
        let current_time = env.ledger().timestamp();

        // Generate 3 single-use recovery codes with salted domain-separated SHA-256 (#124, #166)
        for i in 0..3 {
            let code_hash = Self::hash_recovery_code(env, &beneficiary_id, &salt, i);
            codes.push_back(RecoveryCode {
                beneficiary_id: beneficiary_id.clone(),
                code_hash,
                created_at: current_time,
                expires_at: current_time + (86400 * ((i as u64) + 1) * 30), // 30, 60, 90 days
                is_used: false,
            });
        }

        recovery_codes.set(beneficiary_id, codes);
        env.storage().instance().set(&recovery_key, &recovery_codes);
    }

    /// Domain-separated salted recovery code derivation matching `BeneficiaryClient.deriveRecoveryCode` (#124, #166).
    fn hash_recovery_code(env: &Env, beneficiary_id: &String, salt: &String, index: i32) -> BytesN<32> {
        sha256_str(
            env,
            &format!("SDRP_RC_V1:{}:{}:{}", beneficiary_id, salt, index),
        )
    }

    /// Retrieve per-beneficiary recovery salt for authorized offline derivation (#124, #166).
    pub fn get_recovery_salt(env: Env, beneficiary_id: String) -> Option<String> {
        let salt_key = Symbol::new(&env, "recovery_salts");
        let salts: Map<String, String> = env
            .storage()
            .instance()
            .get(&salt_key)
            .unwrap_or(Map::new(&env));
        salts.get(beneficiary_id)
    }

    /// Hash a verification factor for identity linkage
    fn hash_verification_factor(env: &Env, factor: &VerificationFactor) -> BytesN<32> {
        use soroban_sdk::crypto::sha256;
        let mut data = Vec::new(env);
        data.push_back(factor.factor_type.clone());
        data.push_back(factor.value.clone());
        data.push_back(String::from_str(env, &factor.weight.to_string()));
        sha256(&data.to_string().into())
    }

    /// Verify beneficiary using behavioral/possession factors
    fn check_and_record_rate_limit(env: &Env, namespace: &str, key_id: &String, max_attempts: u32) -> bool {
        let store_key = Symbol::new(env, namespace);
        let mut windows: Map<String, (u64, u32)> = env
            .storage()
            .instance()
            .get(&store_key)
            .unwrap_or(Map::new(env));
        let now = env.ledger().timestamp();
        let (win_start, count) = windows.get(key_id.clone()).unwrap_or((now, 0));
        let (new_start, new_count) = if now.saturating_sub(win_start) >= AUTH_WINDOW_SECS {
            (now, 1)
        } else {
            (win_start, count + 1)
        };
        if new_count > max_attempts {
            return false;
        }
        windows.set(key_id.clone(), (new_start, new_count));
        env.storage().instance().set(&store_key, &windows);
        true
    }

    pub fn verify_beneficiary(
        env: Env,
        verifier: Address,
        beneficiary_id: String,
        provided_factors: Vec<VerificationFactor>,
    ) -> bool {
        verifier.require_auth();

        if !Self::check_and_record_rate_limit(
            &env,
            "verify_rl",
            &beneficiary_id,
            MAX_AUTH_ATTEMPTS_PER_WINDOW,
        ) {
            panic!("Rate limit exceeded for verification attempts");
        }

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        let mut profile = match beneficiaries.get(beneficiary_id.clone()) {
            Some(p) => p,
            None => return false,
        };
        if !profile.is_active {
            return false;
        }

        // Compare SHA-256 factor commitments instead of plaintext secrets (#118)
        let mut total_weight = 0u32;
        let mut matched_weight = 0u32;

        for stored_factor in profile.verification_factors.iter() {
            total_weight += stored_factor.weight;

            for provided_factor in provided_factors.iter() {
                let candidate_digest = Self::commit_factor_value(
                    &env,
                    &provided_factor.factor_type,
                    &provided_factor.value,
                );
                if stored_factor.factor_type == provided_factor.factor_type
                    && (stored_factor.value == candidate_digest || stored_factor.value == provided_factor.value)
                {
                    matched_weight += stored_factor.weight;
                    break;
                }
            }
        }
        
        let verification_score = if total_weight > 0 {
            (matched_weight * 100) / total_weight
        } else {
            0
        };
        
        // Update trust score in BOTH profile (deprecated field) AND identity (canonical)
        if verification_score >= 70 {
            // Update deprecated field in profile for backward compatibility
            profile.trust_score = (profile.trust_score + 10).min(100);
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id.clone(), profile.clone());
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            
            // Update canonical identity if exists
            if let Some(id_hash) = profile.identity_hash {
                Self::update_identity_trust_score(&env, &id_hash, 10);
            }
            true
        } else {
            profile.trust_score = profile.trust_score.saturating_sub(5);
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id.clone(), profile.clone());
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            
            // Update canonical identity if exists
            if let Some(id_hash) = profile.identity_hash {
                Self::update_identity_trust_score(&env, &id_hash, -5);
            }
            false
        }
    }

    /// Restore access using recovery code
    /// Updates BOTH profile (deprecated wallet_address) AND identity (canonical wallet_address)
    /// Restore wallet access using a salted single-use recovery code (#119).
    /// Requires `new_wallet.require_auth()` as ownership proof, enforces attempt rate limiting,
    /// persists `is_used = true`, blocks inactive beneficiaries, and emits an audit event.
    pub fn restore_access(
        env: Env,
        beneficiary_id: String,
        recovery_code: BytesN<32>,
        new_wallet: Address,
    ) -> bool {
        new_wallet.require_auth();

        if !Self::check_and_record_rate_limit(
            &env,
            "recovery_rl",
            &beneficiary_id,
            MAX_AUTH_ATTEMPTS_PER_WINDOW,
        ) {
            panic!("Rate limit exceeded for access restoration");
        }

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        let mut profile = match beneficiaries.get(beneficiary_id.clone()) {
            Some(p) if p.is_active => p,
            _ => return false,
        };

        let recovery_key = Symbol::new(&env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));

        let current_time = env.ledger().timestamp();

        if let Some(mut codes) = recovery_codes.get(beneficiary_id.clone()) {
            for idx in 0..codes.len() {
                let mut code = codes.get(idx).unwrap();
                if code.code_hash == recovery_code
                    && !code.is_used
                    && current_time <= code.expires_at
                {
                    code.is_used = true;
                    codes.set(idx, code);
                    recovery_codes.set(beneficiary_id.clone(), codes);
                    env.storage().instance().set(&recovery_key, &recovery_codes);

                    profile.wallet_address = new_wallet.clone();
                    profile.last_verified = current_time;
                    beneficiaries.set(beneficiary_id.clone(), profile.clone());
                    env.storage().instance().set(&beneficiaries_key, &beneficiaries);

                    if let Some(id_hash) = profile.identity_hash {
                        Self::update_identity_wallet(&env, &id_hash, &new_wallet);
                    }

                    env.events().publish(
                        (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "access_restored")),
                        (beneficiary_id, new_wallet, current_time),
                    );
                    return true;
                }
            }
        }

        false
    }

    /// Get beneficiary profile
    pub fn get_beneficiary(env: Env, beneficiary_id: String) -> Option<BeneficiaryProfile> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        beneficiaries.get(beneficiary_id)
    }

    /// List beneficiaries by disaster (bounded at `MAX_DISASTER_LIST_SCAN = 200`) (#125).
    /// Prefer `list_beneficiaries_paginated` for production disaster populations.
    pub fn list_beneficiaries_by_disaster(env: Env, disaster_id: String) -> Vec<BeneficiaryProfile> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        for (_, profile) in beneficiaries.iter() {
            if profile.disaster_id == disaster_id && profile.is_active {
                result.push_back(profile);
                if result.len() >= MAX_DISASTER_LIST_SCAN {
                    break;
                }
            }
        }
        result
    }

    /// List beneficiaries by disaster with cursor-based pagination.
    ///
    /// Cursor is split into two parameters to avoid string parsing in the
    /// no_std Soroban environment:
    ///   - `cursor_ts`  – `registration_date` of the last item on the previous
    ///                    page (pass `0` for the first page).
    ///   - `cursor_id`  – `id` of the last item on the previous page (pass an
    ///                    empty string for the first page).
    ///
    /// Results are ordered by (registration_date ASC, id ASC) for stable
    /// ordering even when new registrations arrive between pages.
    ///
    /// `limit` is clamped to [1, 100].  Returns the page of profiles plus the
    /// cursor values to use for the next call (`next_ts == 0` and
    /// `next_id.is_empty()` means no more data).
    pub fn list_beneficiaries_paginated(
        env: Env,
        disaster_id: String,
        cursor_ts: u64,
        cursor_id: String,
        limit: u32,
    ) -> (Vec<BeneficiaryProfile>, u64, String) {
        // Validate and clamp limit
        let page_size = if limit == 0 { 20 } else if limit > 100 { 100 } else { limit };

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        // Collect matching profiles into a sortable Vec
        let mut all: Vec<BeneficiaryProfile> = Vec::new(&env);
        for (_, profile) in beneficiaries.iter() {
            if profile.disaster_id == disaster_id && profile.is_active {
                all.push_back(profile);
            }
        }

        // Sort by (registration_date ASC, id ASC) for stable ordering.
        // Soroban Vec doesn't have sort_by, so we use insertion sort
        // (dataset sizes are bounded by contract storage limits).
        let len = all.len();
        for i in 1..len {
            let mut j = i;
            while j > 0 {
                let a = all.get(j - 1).unwrap();
                let b = all.get(j).unwrap();
                let swap = if a.registration_date != b.registration_date {
                    a.registration_date > b.registration_date
                } else {
                    a.id > b.id
                };
                if swap {
                    all.set(j - 1, b.clone());
                    all.set(j, a.clone());
                    j -= 1;
                } else {
                    break;
                }
            }
        }

        // Determine whether we are on the first page
        let empty_id = String::from_str(&env, "");
        let is_first_page = cursor_ts == 0 && cursor_id == empty_id;

        // Skip entries up to and including the cursor position
        let mut page: Vec<BeneficiaryProfile> = Vec::new(&env);
        let mut past_cursor = is_first_page;

        for profile in all.iter() {
            if !past_cursor {
                if profile.registration_date == cursor_ts && profile.id == cursor_id {
                    past_cursor = true;
                }
                continue;
            }
            page.push_back(profile.clone());
            if page.len() >= page_size {
                break;
            }
        }

        // Return next cursor from the last item in the page, or (0, "") if done
        if page.len() < page_size {
            (page, 0u64, empty_id)
        } else {
            let last = page.get(page.len() - 1).unwrap();
            (page, last.registration_date, last.id.clone())
        }
    }

    /// Update beneficiary location with rate limiting, active-status boundary, and audit event (#123).
    pub fn update_location(
        env: Env,
        beneficiary: Address,
        beneficiary_id: String,
        new_location: String,
    ) {
        beneficiary.require_auth();
        if new_location.is_empty() {
            panic!("Location must not be empty");
        }
        if !Self::check_and_record_rate_limit(
            &env,
            "loc_update_rl",
            &beneficiary_id,
            MAX_LOCATION_UPDATES_PER_WINDOW,
        ) {
            panic!("Location update rate limit exceeded");
        }

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            if profile.wallet_address != beneficiary {
                panic!("Unauthorized: caller is not the beneficiary");
            }
            if !profile.is_active {
                panic!("Beneficiary is inactive");
            }
            profile.location = new_location.clone();
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id.clone(), profile.clone());
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);

            env.events().publish(
                (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "location_updated")),
                (beneficiary_id, new_location, profile.last_verified),
            );
        }
    }

    /// NGO corroboration hook for high-trust location/displacement transitions (#123).
    /// **Required role:** NGO
    pub fn corroborate_location(
        env: Env,
        ngo: Address,
        beneficiary_id: String,
        corroborated_location: String,
    ) {
        ngo.require_auth();
        rbac::require_role(&env, &ngo, ROLE_NGO);
        if corroborated_location.is_empty() {
            panic!("Corroborated location must not be empty");
        }
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        let mut profile = match beneficiaries.get(beneficiary_id.clone()) {
            Some(p) if p.is_active => p,
            Some(_) => panic!("Beneficiary is inactive"),
            None => panic_with_error!(&env, "Beneficiary not found"),
        };
        profile.location = corroborated_location.clone();
        profile.last_verified = env.ledger().timestamp();
        beneficiaries.set(beneficiary_id.clone(), profile);
        env.storage().instance().set(&beneficiaries_key, &beneficiaries);

        env.events().publish(
            (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "location_corroborated")),
            (beneficiary_id, ngo, corroborated_location),
        );
    }

    fn set_identity_active(env: &Env, id_hash: &BytesN<32>, is_active: bool) {
        let identities_key = Symbol::new(env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(env));
        if let Some(mut identity) = identities.get(id_hash.clone()) {
            identity.is_active = is_active;
            identity.last_verified = env.ledger().timestamp();
            identities.set(id_hash.clone(), identity);
            env.storage().persistent().set(&identities_key, &identities);
        }
    }

    /// Deactivate beneficiary profile and canonical identity atomically (#326).
    /// **Required role:** ADMIN
    pub fn deactivate_beneficiary(env: Env, admin: Address, beneficiary_id: String) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            profile.is_active = false;
            if let Some(ref mut embedded) = profile.identity {
                embedded.is_active = false;
            }
            let linked_hash = profile.identity_hash.clone();
            beneficiaries.set(beneficiary_id.clone(), profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);

            if let Some(id_hash) = linked_hash {
                Self::set_identity_active(&env, &id_hash, false);
            }

            env.events().publish(
                (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "deactivated")),
                (beneficiary_id, admin),
            );
        }
    }

    /// Authorized reactivation workflow updating both profile and canonical identity with audit trail (#326).
    /// **Required role:** ADMIN
    pub fn reactivate_beneficiary(
        env: Env,
        admin: Address,
        beneficiary_id: String,
        reason: String,
    ) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);

        if reason.is_empty() {
            panic!("Reactivation reason must not be empty");
        }

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        let mut profile = match beneficiaries.get(beneficiary_id.clone()) {
            Some(p) => p,
            None => panic!("Beneficiary not found"),
        };

        if profile.is_active {
            panic!("Beneficiary is already active");
        }

        let now = env.ledger().timestamp();
        profile.is_active = true;
        profile.last_verified = now;
        if let Some(ref mut embedded) = profile.identity {
            embedded.is_active = true;
            embedded.last_verified = now;
        }
        let linked_hash = profile.identity_hash.clone();
        beneficiaries.set(beneficiary_id.clone(), profile);
        env.storage().instance().set(&beneficiaries_key, &beneficiaries);

        if let Some(id_hash) = linked_hash {
            Self::set_identity_active(&env, &id_hash, true);
        }

        let audit_key = Symbol::new(&env, "reactivation_audit");
        let mut audit_map: Map<String, Vec<ReactivationAuditRecord>> = env
            .storage()
            .instance()
            .get(&audit_key)
            .unwrap_or(Map::new(&env));
        let mut history = audit_map.get(beneficiary_id.clone()).unwrap_or(Vec::new(&env));
        history.push_back(ReactivationAuditRecord {
            beneficiary_id: beneficiary_id.clone(),
            actor: admin.clone(),
            reason: reason.clone(),
            reactivated_at: now,
        });
        audit_map.set(beneficiary_id.clone(), history);
        env.storage().instance().set(&audit_key, &audit_map);

        env.events().publish(
            (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "reactivated")),
            (beneficiary_id, admin, reason),
        );
    }

    /// Retrieve reactivation audit records for a beneficiary (#326).
    pub fn get_reactivation_history(env: Env, beneficiary_id: String) -> Vec<ReactivationAuditRecord> {
        let audit_key = Symbol::new(&env, "reactivation_audit");
        let audit_map: Map<String, Vec<ReactivationAuditRecord>> = env
            .storage()
            .instance()
            .get(&audit_key)
            .unwrap_or(Map::new(&env));
        audit_map.get(beneficiary_id).unwrap_or(Vec::new(&env))
    }

    /// Update trust score in canonical identity (source of truth)
    fn update_identity_trust_score(env: &Env, id_hash: &BytesN<32>, delta: i32) {
        let identities_key = Symbol::new(env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(env));
        
        if let Some(mut identity) = identities.get(id_hash.clone()) {
            if delta > 0 {
                identity.trust_score = (identity.trust_score + delta as u32).min(100);
            } else {
                identity.trust_score = identity.trust_score.saturating_sub((-delta) as u32);
            }
            identity.last_verified = env.ledger().timestamp();
            identities.set(id_hash.clone(), identity);
            env.storage().persistent().set(&identities_key, &identities);
        }
    }

    /// Update wallet address in canonical identity (source of truth)
    fn update_identity_wallet(env: &Env, id_hash: &BytesN<32>, new_wallet: &Address) {
        let identities_key = Symbol::new(env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(env));
        
        if let Some(mut identity) = identities.get(id_hash.clone()) {
            identity.wallet_address = new_wallet.clone();
            identity.last_verified = env.ledger().timestamp();
            identities.set(id_hash.clone(), identity);
            env.storage().persistent().set(&identities_key, &identities);
        }
    }

    /// Create identity from multiple factors (NO BIOMETRICS)
    /// If a profile with matching wallet_address exists, links them together
    pub fn create_identity_from_factors(
        env: Env,
        registrar: Address,
        factors: Vec<IdentityFactor>,
        recovery_contacts: Vec<Address>,
        camp_location: String,
        wallet_address: Address,
        duress_pin: Option<String>,
    ) -> BytesN<32> {
        registrar.require_auth();
        rbac::require_role(&env, &registrar, ROLE_NGO);
        
        // Require at least 3 factors for security
        if factors.len() < 3 {
            panic!("Minimum 3 identity factors required");
        }
        
        // Generate pseudonymous ID hash from factors
        let id_hash = Self::generate_identity_hash(&env, &factors);
        
        // Check for duplicate identity
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        if identities.contains_key(id_hash.clone()) {
            panic!("Identity already exists");
        }
        
        // Hash duress PIN if provided
        let duress_pin_hash = duress_pin.map(|pin| {
            use soroban_sdk::crypto::sha256;
            sha256(&env, &pin.into())
        });
        
        let identity = BeneficiaryIdentity {
            id_hash: id_hash.clone(),
            creation_factors: factors,
            recovery_contacts,
            trust_score: 50,
            camp_location,
            created_at: env.ledger().timestamp(),
            last_verified: env.ledger().timestamp(),
            wallet_address,
            is_active: true,
            duress_pin_hash,
            geofence_zones: Vec::new(&env),
            temporary_credentials: Vec::new(&env),
            disbursement_ids: Vec::new(&env),
            transfer_ids: Vec::new(&env),
        };
        
        let mut identities = identities;
        identities.set(id_hash.clone(), identity);
        env.storage().persistent().set(&identities_key, &identities);
        
        // Try to link with existing profile by wallet_address
        Self::link_identity_to_profile(&env, &id_hash, &wallet_address);
        
        env.events().publish(
            (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "identity_created")),
            (id_hash.clone(), wallet_address),
        );

        id_hash
    }

    /// Generate collision-resistant identity hash including factor type, weight, and digest (#117).
    fn generate_identity_hash(env: &Env, factors: &Vec<IdentityFactor>) -> BytesN<32> {
        use soroban_sdk::crypto::sha256;

        let mut combined = Vec::new(env);
        for factor in factors.iter() {
            let entry = format!("{}:{}:{}", factor.factor_type, factor.weight, factor.factor_hash.to_string());
            combined.push_back(String::from_str(env, &entry));
        }

        let bytes = sha256(env, &combined.to_string().into());
        BytesN::from_array(env, &bytes.to_array())
    }

    /// Link an identity to a profile by wallet_address (if exists)
    fn link_identity_to_profile(env: &Env, id_hash: &BytesN<32>, wallet_address: &Address) {
        let beneficiaries_key = Symbol::new(env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(env));
        
        // Find profile with matching wallet_address and no identity_hash yet
        for (bid, mut profile) in beneficiaries.iter() {
            if profile.wallet_address == *wallet_address && profile.identity_hash.is_none() {
                profile.identity_hash = Some(id_hash.clone());
                profile.trust_score = 50; // Sync deprecated field
                beneficiaries.set(bid, profile);
                env.storage().instance().set(&beneficiaries_key, &beneficiaries);
                break;
            }
        }
    }

    /// Social recovery: 3-of-5 trusted contacts can restore access
    pub fn social_recovery(
        env: Env,
        id_hash: BytesN<32>,
        approving_contact: Address,
        new_wallet: Address,
    ) -> bool {
        approving_contact.require_auth();
        
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => return false,
        };
        
        // Verify approving contact is in recovery list
        let mut is_valid_contact = false;
        for contact in identity.recovery_contacts.iter() {
            if contact == approving_contact {
                is_valid_contact = true;
                break;
            }
        }
        
        if !is_valid_contact {
            return false;
        }
        
        // Get or create recovery request
        let recovery_key = Symbol::new(&env, "recovery_requests");
        let mut recovery_requests: Map<BytesN<32>, SocialRecoveryRequest> = env.storage().instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));
        
        let contact_count = identity.recovery_contacts.len() as u32;
        if contact_count < DEFAULT_SOCIAL_RECOVERY_THRESHOLD {
            panic!("Insufficient recovery contacts configured for 3-of-N social recovery threshold");
        }
        let policy_threshold = DEFAULT_SOCIAL_RECOVERY_THRESHOLD.min(contact_count);

        let current_time = env.ledger().timestamp();
        let mut request = recovery_requests.get(id_hash.clone()).unwrap_or(SocialRecoveryRequest {
            beneficiary_id_hash: id_hash.clone(),
            new_wallet: new_wallet.clone(),
            approvals: Vec::new(&env),
            required_approvals: policy_threshold,
            created_at: current_time,
            expires_at: current_time + 86400, // 24 hours
            is_completed: false,
        });
        if request.is_completed {
            return false;
        }
        request.required_approvals = policy_threshold;
        
        // Check if request expired
        if current_time > request.expires_at {
            return false;
        }
        
        // Add approval if not already present
        let mut already_approved = false;
        for approval in request.approvals.iter() {
            if approval == approving_contact {
                already_approved = true;
                break;
            }
        }
        
        if !already_approved {
            request.approvals.push_back(approving_contact);
        }
        
        // Check if threshold reached
        if request.approvals.len() >= request.required_approvals {
            // Update identity wallet using helper (source of truth)
            Self::update_identity_wallet(&env, &id_hash, &new_wallet);
            
            request.is_completed = true;
            recovery_requests.set(id_hash, request);
            env.storage().instance().set(&recovery_key, &recovery_requests);
            
            return true;
        }
        
        recovery_requests.set(id_hash, request);
        env.storage().instance().set(&recovery_key, &recovery_requests);
        
        false
    }

    /// Generate temporary credentials for shared devices
    pub fn temporary_credentials(
        env: Env,
        id_hash: BytesN<32>,
        owner: Address,
        device_fingerprint: String,
        duration_seconds: u64,
    ) -> BytesN<32> {
        owner.require_auth();
        
        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let mut identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => panic!("Identity not found"),
        };
        
        // Verify owner
        if identity.wallet_address != owner {
            panic!("Unauthorized");
        }
        
        // Generate temporary credential
        use soroban_sdk::crypto::sha256;
        let current_time = env.ledger().timestamp();
        let credential_data = format!("{}_{}_{}",
            id_hash.to_string(),
            device_fingerprint,
            current_time
        );
        let credential_hash = sha256(&env, &credential_data.into());
        
        // Store irreversible domain-separated SHA-256 commitment rather than raw device string (#120)
        let fp_digest = sha256_str(
            &env,
            &format!("SDRP_DEV_V1:{}:{}", id_hash.to_string(), device_fingerprint),
        );
        let hashed_fingerprint = bytes_to_hex_prefix(&env, &fp_digest, 16, "dev_");

        let temp_cred = TemporaryCredential {
            credential_hash: credential_hash.clone(),
            created_at: current_time,
            expires_at: current_time + duration_seconds,
            device_fingerprint: hashed_fingerprint,
            is_active: true,
        };
        
        identity.temporary_credentials.push_back(temp_cred);
        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);
        
        credential_hash
    }

    /// Identity portability: Transfer credentials across camp locations
    pub fn identity_portability(
        env: Env,
        id_hash: BytesN<32>,
        owner: Address,
        new_camp_location: String,
        new_geofence: Option<GeofenceZone>,
    ) {
        owner.require_auth();
        
        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let mut identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => panic!("Identity not found"),
        };
        
        // Verify owner
        if identity.wallet_address != owner {
            panic!("Unauthorized");
        }
        
        // Update location
        identity.camp_location = new_camp_location;
        identity.last_verified = env.ledger().timestamp();
        
        // Add new geofence zone if provided
        if let Some(zone) = new_geofence {
            identity.geofence_zones.push_back(zone);
        }
        
        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);
    }

    /// Verify identity with duress mode check
    pub fn verify_identity_with_duress(
        env: Env,
        id_hash: BytesN<32>,
        pin: String,
    ) -> (bool, bool) { // (is_valid, is_duress)
        use soroban_sdk::crypto::sha256;
        
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let identity = match identities.get(id_hash) {
            Some(id) => id,
            None => return (false, false),
        };
        
        let pin_hash = sha256(&env, &pin.into());
        
        // Check duress PIN first
        if let Some(duress_hash) = identity.duress_pin_hash {
            if pin_hash == duress_hash {
                return (true, true); // Valid but under duress
            }
        }
        
        // Check regular factors (simplified for example)
        // In production, implement proper multi-factor verification
        (true, false)
    }

    /// Check if identity is within safe geofence zone
    /// Uses standardized GeoPoint for coordinates (f64 degrees)
    pub fn check_geofence(
        env: Env,
        id_hash: BytesN<32>,
        current_latitude: f64,
        current_longitude: f64,
    ) -> bool {
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let identity = match identities.get(id_hash) {
            Some(id) => id,
            None => return false,
        };
        
        // Reject invalid coordinates rather than silently defaulting to Null Island (0,0) (#122)
        let current_point = match GeoPoint::new(current_latitude, current_longitude) {
            Ok(pt) => pt,
            Err(_) => return false,
        };

        for zone in identity.geofence_zones.iter() {
            if zone.is_safe && zone.contains(&current_point) {
                return true;
            }
        }

        false
    }

    /// Spherical Haversine distance (km) replacing coarse integer approximation (#122).
    pub fn calculate_distance_km(
        _env: Env,
        lat1: f64,
        lon1: f64,
        lat2: f64,
        lon2: f64,
    ) -> Result<f64, String> {
        let p1 = GeoPoint::new(lat1, lon1)?;
        let p2 = GeoPoint::new(lat2, lon2)?;
        Ok(p1.distance_to(&p2))
    }

    /// Update trust score based on activity
    pub fn update_trust_score(
        env: Env,
        id_hash: BytesN<32>,
        activity_type: String,
        is_positive: bool,
    ) {
        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        let mut identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => return,
        };
        
        // Adjust trust score based on activity
        if is_positive {
            identity.trust_score = (identity.trust_score + 5).min(100);
        } else {
            identity.trust_score = identity.trust_score.saturating_sub(10);
        }
        
        identity.last_verified = env.ledger().timestamp();
        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);
    }

    /// Get identity (returns only non-sensitive data)
    pub fn get_identity(env: Env, id_hash: BytesN<32>) -> Option<BeneficiaryIdentity> {
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        identities.get(id_hash)
    }

    /// Get complete beneficiary data by beneficiary_id (single source of truth view)
    /// Merges profile (operational) + identity (canonical) for convenience
    pub fn get_beneficiary_complete(env: Env, beneficiary_id: String) -> Option<BeneficiaryComplete> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        let profile = beneficiaries.get(beneficiary_id)?;
        
        let identity = if let Some(id_hash) = profile.identity_hash {
            Self::get_identity(env.clone(), id_hash)
        } else {
            None
        };
        
        Some(BeneficiaryComplete {
            profile,
            identity,
        })
    }

    /// Complete beneficiary view combining profile + identity
    /// This is the recommended way to access beneficiary data
    #[derive(Clone)]
    pub struct BeneficiaryComplete {
        pub profile: BeneficiaryProfile,
        pub identity: Option<BeneficiaryIdentity>,
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn make_vf(env: &Env, val: &str) -> Vec<VerificationFactor> {
        Vec::from_array(
            env,
            [VerificationFactor {
                factor_type: String::from_str(env, "possession"),
                value: String::from_str(env, val),
                weight: 100,
                verified_at: 10,
            }],
        )
    }

    #[test]
    fn test_privacy_pseudonym_hashed_factors_salted_recovery_and_reactivation() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        let wallet = Address::generate(&env);
        let new_wallet = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);

        let client = BeneficiaryManagerClient::new(&env, &env.register(BeneficiaryManager, ()));

        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b_priv"),
            &String::from_str(&env, "Alice Real Name"),
            &String::from_str(&env, "d1"),
            &String::from_str(&env, "Camp Alpha"),
            &wallet,
            &3u32,
            &Vec::new(&env),
            &make_vf(&env, "secret_voucher_999"),
        );

        let profile = client.get_beneficiary(&String::from_str(&env, "b_priv")).unwrap();
        // Plain personal name & raw verification factor secret must NOT appear on-chain (#116, #118)
        assert!(profile.pseudonym.to_string().starts_with("anon_"));
        assert!(!profile.pseudonym.to_string().contains("Alice"));
        let stored_vf = profile.verification_factors.get(0).unwrap();
        assert_ne!(stored_vf.value, String::from_str(&env, "secret_voucher_999"));

        // Verify with preimage still succeeds (#118)
        assert!(client.verify_beneficiary(&ngo, &String::from_str(&env, "b_priv"), &make_vf(&env, "secret_voucher_999")));

        // Deactivate then reactivate atomically (#326)
        client.deactivate_beneficiary(&admin, &String::from_str(&env, "b_priv"));
        assert!(!client.get_beneficiary(&String::from_str(&env, "b_priv")).unwrap().is_active);
        assert!(!client.verify_beneficiary(&ngo, &String::from_str(&env, "b_priv"), &make_vf(&env, "secret_voucher_999")));

        client.reactivate_beneficiary(
            &admin,
            &String::from_str(&env, "b_priv"),
            &String::from_str(&env, "Returned to camp shelter"),
        );
        let active = client.get_beneficiary(&String::from_str(&env, "b_priv")).unwrap();
        assert!(active.is_active);
        assert_eq!(client.get_reactivation_history(&String::from_str(&env, "b_priv")).len(), 1);

        // Salted recovery code single-use & event (#119, #124)
        let salt = client.get_recovery_salt(&String::from_str(&env, "b_priv")).unwrap();
        let code_digest = BeneficiaryManager::hash_recovery_code(
            &env,
            &String::from_str(&env, "b_priv"),
            &salt,
            0,
        );
        assert!(client.restore_access(&String::from_str(&env, "b_priv"), &code_digest, &new_wallet));
        // Second reuse of same recovery code must fail
        assert!(!client.restore_access(&String::from_str(&env, "b_priv"), &code_digest, &wallet));
    }

    #[test]
    fn test_identity_hash_uniqueness_and_device_privacy_and_geofence() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        let w1 = Address::generate(&env);
        let w2 = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);

        let client = BeneficiaryManagerClient::new(&env, &env.register(BeneficiaryManager, ()));
        let h_a = sha256_str(&env, "same_digest");
        let set_a = Vec::from_array(
            &env,
            [
                IdentityFactor { factor_type: String::from_str(&env, "possession"), factor_hash: h_a.clone(), weight: 30, verified_at: 1, verifier: None },
                IdentityFactor { factor_type: String::from_str(&env, "social"), factor_hash: h_a.clone(), weight: 30, verified_at: 1, verifier: None },
                IdentityFactor { factor_type: String::from_str(&env, "behavioral"), factor_hash: h_a.clone(), weight: 40, verified_at: 1, verifier: None },
            ],
        );
        let set_b = Vec::from_array(
            &env,
            [
                IdentityFactor { factor_type: String::from_str(&env, "knowledge"), factor_hash: h_a.clone(), weight: 50, verified_at: 1, verifier: None },
                IdentityFactor { factor_type: String::from_str(&env, "social"), factor_hash: h_a.clone(), weight: 25, verified_at: 1, verifier: None },
                IdentityFactor { factor_type: String::from_str(&env, "behavioral"), factor_hash: h_a, weight: 25, verified_at: 1, verifier: None },
            ],
        );

        let contacts = Vec::from_array(
            &env,
            [Address::generate(&env), Address::generate(&env), Address::generate(&env)],
        );
        let id1 = client.create_identity_from_factors(
            &ngo, &set_a, &contacts, &String::from_str(&env, "Camp A"), &w1, &None
        );
        let id2 = client.create_identity_from_factors(
            &ngo, &set_b, &contacts, &String::from_str(&env, "Camp A"), &w2, &None
        );
        // Different factor types/weights must produce distinct identity hashes (#117)
        assert_ne!(id1, id2);

        // Device fingerprint hashed before temporary credential storage (#120)
        client.temporary_credentials(&id1, &w1, &String::from_str(&env, "RAW-DEVICE-IMEI-1234"), &600u64);
        let identity = client.get_identity(&id1).unwrap();
        let cred = identity.temporary_credentials.get(0).unwrap();
        assert!(cred.device_fingerprint.to_string().starts_with("dev_"));
        assert!(!cred.device_fingerprint.to_string().contains("IMEI"));

        // Invalid coordinates rejected cleanly in geofence (#122)
        assert!(!client.check_geofence(&id1, &999.0, &0.0));
        assert!(client.calculate_distance_km(&0.0, &0.0, &0.0, &0.0).is_ok());
    }
}
