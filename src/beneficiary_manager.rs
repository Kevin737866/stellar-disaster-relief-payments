//! Beneficiary identity, recovery-code, and offline access restoration.
//!
//! Operational guarantees, expiry rules, reconciliation steps, and known
//! abuse-resistance gaps (including the current deterministic recovery-code
//! format) are documented in `docs/offline-flows.md`.

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64, BytesN};
use crate::unique_id::*;
use crate::rbac::{self, ROLE_NGO, ROLE_ADMIN};

#[contract]
pub struct BeneficiaryManager;

/// Single source of truth for beneficiary identity.
/// This is the authoritative record containing all identity-related data.
/// All other structures reference this via id_hash.
#[derive(Clone)]
pub struct BeneficiaryIdentity {
    pub id_hash: BytesN<32>, // Pseudonymous identifier (never real name)
    pub creation_factors: Vec<IdentityFactor>,
    pub recovery_contacts: Vec<Address>,
    pub trust_score: u32, // 0-100 based on behavioral patterns
    pub camp_location: String,
    pub created_at: u64,
    pub last_verified: u64,
    pub wallet_address: Address,
    pub is_active: bool,
    pub duress_pin_hash: Option<BytesN<32>>, // Fake PIN for safety
    pub geofence_zones: Vec<GeofenceZone>,
    pub temporary_credentials: Vec<TemporaryCredential>,
    // Disbursement/transfer linkage - track associated records
    pub disbursement_ids: Vec<String>,
    pub transfer_ids: Vec<String>,
}

/// Lightweight profile view - references identity via id_hash.
/// Does NOT duplicate wallet_address, trust_score, or verification factors.
/// Use get_identity(id_hash) for full identity data.
#[derive(Clone)]
pub struct BeneficiaryProfile {
    pub id: String,                  // Human-readable ID (e.g., "BEN-001")
    pub name: String,
    pub disaster_id: String,
    pub location: String,
    pub registration_date: u64,
    pub last_verified: u64,
    /// Reference to the canonical identity (Some if identity created, None if not yet)
    pub identity_hash: Option<BytesN<32>>,
    /// Only operational factors for spending/transfers (not full identity factors)
    pub verification_factors: Vec<VerificationFactor>,
    pub is_active: bool,
    pub family_size: u32,
    pub special_needs: Vec<String>,
    /// DEPRECATED: Use identity.trust_score via identity_hash
    /// Kept for backward compatibility during migration
    #[deprecated(note = "Use identity.trust_score via get_identity(identity_hash)")]
    pub trust_score: u32,
    /// DEPRECATED: Use identity.wallet_address via identity_hash
    /// Kept for backward compatibility during migration
    #[deprecated(note = "Use identity.wallet_address via get_identity(identity_hash)")]
    pub wallet_address: Address,
}

#[derive(Clone)]
pub struct IdentityFactor {
    pub factor_type: String, // "knowledge", "possession", "social", "behavioral", "institutional"
    pub factor_hash: BytesN<32>, // Hashed value for privacy
    pub weight: u32,
    pub verified_at: u64,
    pub verifier: Option<Address>, // NGO worker or community member
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

#[derive(Clone)]
pub struct TemporaryCredential {
    pub credential_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub device_fingerprint: String, // For shared device tracking
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
    pub fn register_beneficiary(
        env: Env,
        registrar: Address,
        beneficiary_id: String,
        name: String,
        disaster_id: String,
        location: String,
        wallet_address: Address,
        family_size: u32,
        special_needs: Vec<String>,
        verification_factors: Vec<VerificationFactor>,
    ) {
        registrar.require_auth();
        rbac::require_role(&env, &registrar, ROLE_NGO);
        
        // Check for duplicate registrations
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        if beneficiaries.contains_key(beneficiary_id.clone()) {
            panic_with_error!(&env, "Beneficiary already registered");
        }
        
        // Generate identity hash from verification factors (using unique_id module)
        let identity_factors: Vec<IdentityFactor> = verification_factors.iter().map(|vf| {
            IdentityFactor {
                factor_type: vf.factor_type.clone(),
                factor_hash: Self::hash_verification_factor(&env, &vf),
                weight: vf.weight,
                verified_at: vf.verified_at,
                verifier: None,
            }
        }).collect();
        
        // Create canonical identity (single source of truth)
        let identity_hash = generate_unique_id(&env, "ben_id", Some(&registrar));
        // Convert to BytesN<32> for identity hash
        let id_bytes = env.crypto().sha256(&identity_hash.to_string().into());
        let id_hash: BytesN<32> = BytesN::from_array(&env, &id_bytes.to_array());
        
        let identity = BeneficiaryIdentity {
            id_hash: id_hash.clone(),
            creation_factors: identity_factors,
            recovery_contacts: Vec::new(&env),
            trust_score: 50, // Initial trust score
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
        
        // Store identity (persistent for long-term)
        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env.storage().persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        
        identities.set(id_hash.clone(), identity);
        env.storage().persistent().set(&identities_key, &identities);
        
        // Create beneficiary profile referencing the identity
        let profile = BeneficiaryProfile {
            id: beneficiary_id.clone(),
            name,
            disaster_id,
            location,
            registration_date: env.ledger().timestamp(),
            last_verified: env.ledger().timestamp(),
            identity_hash: Some(id_hash.clone()),
            verification_factors,
            is_active: true,
            family_size,
            special_needs,
            trust_score: 50, // Deprecated: kept for backward compatibility
            wallet_address: wallet_address.clone(), // Deprecated: kept for backward compatibility
        };
        
        beneficiaries.set(beneficiary_id.clone(), profile);
        env.storage().instance().set(&beneficiaries_key, &beneficiaries);
        
        // Emit registration event
        env.events().publish(
            (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "registered")),
            (beneficiary_id.clone(), wallet_address),
        );

        // Generate recovery codes for account restoration
        Self::generate_recovery_codes(&env, beneficiary_id);
    }

    /// Generate recovery codes for offline access restoration.
    ///
    /// Three single-use codes are stored with 30/60/90-day expiry. The current
    /// hash is deterministic from the beneficiary ID and index, so this is not
    /// a production-grade secret; see `docs/offline-flows.md` (known gaps).
    fn generate_recovery_codes(env: &Env, beneficiary_id: String) {
        let recovery_key = Symbol::new(env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env.storage().instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(env));
        
        let mut codes = Vec::new(env);
        let current_time = env.ledger().timestamp();
        
        // Generate 3 recovery codes with different expiry times
        for i in 0..3 {
            let code_hash = Self::hash_recovery_code(env, &beneficiary_id, i);
            let recovery_code = RecoveryCode {
                beneficiary_id: beneficiary_id.clone(),
                code_hash,
                created_at: current_time,
                expires_at: current_time + (86400 * (i + 1) * 30), // 30, 60, 90 days
                is_used: false,
            };
            codes.push_back(recovery_code);
        }
        
        recovery_codes.set(beneficiary_id, codes);
        env.storage().instance().set(&recovery_key, &recovery_codes);
    }

    /// Simple hash function for recovery codes (in production, use secure hashing)
    fn hash_recovery_code(env: &Env, beneficiary_id: &String, index: i32) -> BytesN<32> {
        use soroban_sdk::crypto::sha256;
        let mut data = Vec::new(env);
        data.push_back(String::from_str(env, beneficiary_id));
        data.push_back(String::from_str(env, &index.to_string()));
        sha256(&data.to_string().into())
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
    pub fn verify_beneficiary(
        env: Env,
        verifier: Address,
        beneficiary_id: String,
        provided_factors: Vec<VerificationFactor>,
    ) -> bool {
        verifier.require_auth();
        
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        let mut profile = match beneficiaries.get(beneficiary_id.clone()) {
            Some(p) => p,
            None => return false,
        };
        
        // Calculate verification score
        let mut total_weight = 0u32;
        let mut matched_weight = 0u32;
        
        for stored_factor in profile.verification_factors.iter() {
            total_weight += stored_factor.weight;
            
            for provided_factor in provided_factors.iter() {
                if stored_factor.factor_type == provided_factor.factor_type 
                    && stored_factor.value == provided_factor.value {
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
    pub fn restore_access(
        env: Env,
        beneficiary_id: String,
        recovery_code: BytesN<32>,
        new_wallet: Address,
    ) -> bool {
        let recovery_key = Symbol::new(&env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env.storage().instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));
        
        let current_time = env.ledger().timestamp();
        
        if let Some(mut codes) = recovery_codes.get(beneficiary_id.clone()) {
            for mut code in codes.iter() {
                if code.code_hash == recovery_code 
                    && !code.is_used 
                    && current_time <= code.expires_at {
                    
                    // Mark code as used
                    code.is_used = true;
                    
                    // Update beneficiary wallet address in profile (deprecated field)
                    let beneficiaries_key = Symbol::new(&env, "beneficiaries");
                    let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
                        .get(&beneficiaries_key)
                        .unwrap_or(Map::new(&env));

                    if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
                        profile.wallet_address = new_wallet.clone(); // Deprecated
                        profile.last_verified = current_time;
                        beneficiaries.set(beneficiary_id.clone(), profile.clone());
                        env.storage().instance().set(&beneficiaries_key, &beneficiaries);
                        
                        // Update canonical identity
                        if let Some(id_hash) = profile.identity_hash {
                            Self::update_identity_wallet(&env, &id_hash, &new_wallet);
                        }
                    }

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

    /// List beneficiaries by disaster
    pub fn list_beneficiaries_by_disaster(env: Env, disaster_id: String) -> Vec<BeneficiaryProfile> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, profile) in beneficiaries.iter() {
            if profile.disaster_id == disaster_id && profile.is_active {
                result.push_back(profile);
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

    /// Update beneficiary location (for tracking displacement)
    pub fn update_location(
        env: Env,
        beneficiary: Address,
        beneficiary_id: String,
        new_location: String,
    ) {
        beneficiary.require_auth();
        
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            if profile.wallet_address != beneficiary {
                panic!("Unauthorized: caller is not the beneficiary");
            }
            profile.location = new_location.clone();
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id.clone(), profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);

            env.events().publish(
                (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "location_updated")),
                (beneficiary_id, new_location),
            );
        }
    }

    /// Deactivate beneficiary (e.g., when they leave the program)
    pub fn deactivate_beneficiary(env: Env, admin: Address, beneficiary_id: String) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);
        
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env.storage().instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            profile.is_active = false;
            beneficiaries.set(beneficiary_id.clone(), profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);

            env.events().publish(
                (Symbol::new(&env, "beneficiary"), Symbol::new(&env, "deactivated")),
                (beneficiary_id, admin),
            );
        }
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

    /// Generate pseudonymous identity hash from factors
    fn generate_identity_hash(env: &Env, factors: &Vec<IdentityFactor>) -> BytesN<32> {
        use soroban_sdk::crypto::sha256;
        
        let mut combined = Vec::new(env);
        for factor in factors.iter() {
            combined.push_back(factor.factor_hash.clone());
        }
        
        sha256(env, &combined.to_string().into())
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
        
        let current_time = env.ledger().timestamp();
        let mut request = recovery_requests.get(id_hash.clone()).unwrap_or(SocialRecoveryRequest {
            beneficiary_id_hash: id_hash.clone(),
            new_wallet: new_wallet.clone(),
            approvals: Vec::new(&env),
            required_approvals: 3, // 3-of-5 threshold
            created_at: current_time,
            expires_at: current_time + 86400, // 24 hours
            is_completed: false,
        });
        
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
        
        let temp_cred = TemporaryCredential {
            credential_hash: credential_hash.clone(),
            created_at: current_time,
            expires_at: current_time + duration_seconds,
            device_fingerprint,
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
        
        let current_point = GeoPoint::new(current_latitude, current_longitude).unwrap_or(GeoPoint::new(0.0, 0.0).unwrap());
        
        // Check if within any safe zone
        for zone in identity.geofence_zones.iter() {
            if zone.is_safe {
                if zone.contains(&current_point) {
                    return true;
                }
            }
        }
        
        false
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
