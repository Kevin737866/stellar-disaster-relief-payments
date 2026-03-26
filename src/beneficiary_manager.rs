use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Map, String, Symbol, Vec,
};

#[contract]
pub struct BeneficiaryManager;

#[contracttype]
#[derive(Clone)]
pub struct VerificationFactor {
    pub factor_type: String,
    pub value: String,
    pub weight: u32,
    pub verified_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct IdentityFactor {
    pub factor_type: String,
    pub factor_hash: BytesN<32>,
    pub weight: u32,
    pub verified_at: u64,
    pub verifier: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct TemporaryCredential {
    pub credential_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub device_fingerprint: String,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct GeofenceZone {
    pub zone_name: String,
    pub latitude_e6: i64,
    pub longitude_e6: i64,
    pub radius_e6: i64,
    pub is_safe: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct BeneficiaryIdentity {
    pub id_hash: BytesN<32>,
    pub creation_factors: Vec<IdentityFactor>,
    pub recovery_contacts: Vec<Address>,
    pub trust_score: u32,
    pub camp_location: String,
    pub created_at: u64,
    pub last_verified: u64,
    pub wallet_address: Address,
    pub is_active: bool,
    pub duress_pin_hash: Option<BytesN<32>>,
    pub geofence_zones: Vec<GeofenceZone>,
    pub temporary_credentials: Vec<TemporaryCredential>,
}

#[contracttype]
#[derive(Clone)]
pub struct BeneficiaryProfile {
    pub id: String,
    pub name: String,
    pub disaster_id: String,
    pub location: String,
    pub registration_date: u64,
    pub last_verified: u64,
    pub verification_factors: Vec<VerificationFactor>,
    pub wallet_address: Address,
    pub is_active: bool,
    pub family_size: u32,
    pub special_needs: Vec<String>,
    pub trust_score: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct RecoveryCode {
    pub beneficiary_id: String,
    pub code_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_used: bool,
}

#[contracttype]
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
    #[allow(clippy::too_many_arguments)]
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

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if beneficiaries.contains_key(beneficiary_id.clone()) {
            panic!("beneficiary exists");
        }

        let now = env.ledger().timestamp();
        let profile = BeneficiaryProfile {
            id: beneficiary_id.clone(),
            name,
            disaster_id,
            location,
            registration_date: now,
            last_verified: now,
            verification_factors,
            wallet_address,
            is_active: true,
            family_size,
            special_needs,
            trust_score: 50,
        };

        beneficiaries.set(beneficiary_id.clone(), profile);
        env.storage().instance().set(&beneficiaries_key, &beneficiaries);

        Self::generate_recovery_codes(&env, beneficiary_id);
    }

    pub fn verify_beneficiary(
        env: Env,
        verifier: Address,
        beneficiary_id: String,
        provided_factors: Vec<VerificationFactor>,
    ) -> bool {
        verifier.require_auth();

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

        let mut total_weight = 0u32;
        let mut matched_weight = 0u32;

        for stored in profile.verification_factors.iter() {
            total_weight += stored.weight;
            for provided in provided_factors.iter() {
                if stored.factor_type == provided.factor_type && stored.value == provided.value {
                    matched_weight += stored.weight;
                    break;
                }
            }
        }

        let score = if total_weight == 0 {
            0
        } else {
            (matched_weight * 100) / total_weight
        };

        if score >= 70 {
            profile.trust_score = (profile.trust_score + 10).min(100);
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            true
        } else {
            profile.trust_score = profile.trust_score.saturating_sub(5);
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            false
        }
    }

    pub fn restore_access(
        env: Env,
        beneficiary_id: String,
        recovery_code: BytesN<32>,
        new_wallet: Address,
    ) -> bool {
        let recovery_key = Symbol::new(&env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        let mut codes = match recovery_codes.get(beneficiary_id.clone()) {
            Some(c) => c,
            None => return false,
        };

        let mut valid_idx: Option<u32> = None;
        for (idx, code) in codes.iter().enumerate() {
            if code.code_hash == recovery_code && !code.is_used && now <= code.expires_at {
                valid_idx = Some(idx as u32);
                break;
            }
        }

        let idx = match valid_idx {
            Some(v) => v,
            None => return false,
        };

        if let Some(mut code) = codes.get(idx) {
            code.is_used = true;
            codes.set(idx, code);
        }
        recovery_codes.set(beneficiary_id.clone(), codes);
        env.storage().instance().set(&recovery_key, &recovery_codes);

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            profile.wallet_address = new_wallet;
            profile.last_verified = now;
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            true
        } else {
            false
        }
    }

    pub fn get_beneficiary(env: Env, beneficiary_id: String) -> Option<BeneficiaryProfile> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));
        beneficiaries.get(beneficiary_id)
    }

    pub fn list_beneficiaries_by_disaster(env: Env, disaster_id: String) -> Vec<BeneficiaryProfile> {
        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, profile) in beneficiaries.iter() {
            if profile.disaster_id == disaster_id && profile.is_active {
                out.push_back(profile);
            }
        }
        out
    }

    pub fn update_location(env: Env, beneficiary: Address, beneficiary_id: String, new_location: String) {
        beneficiary.require_auth();

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            profile.location = new_location;
            profile.last_verified = env.ledger().timestamp();
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
        }
    }

    pub fn deactivate_beneficiary(env: Env, admin: Address, beneficiary_id: String) {
        admin.require_auth();

        let beneficiaries_key = Symbol::new(&env, "beneficiaries");
        let mut beneficiaries: Map<String, BeneficiaryProfile> = env
            .storage()
            .instance()
            .get(&beneficiaries_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut profile) = beneficiaries.get(beneficiary_id.clone()) {
            profile.is_active = false;
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
        }
    }

    #[allow(clippy::too_many_arguments)]
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

        if factors.len() < 3 {
            panic!("Minimum 3 identity factors required");
        }

        let id_hash = Self::generate_identity_hash(&env, &factors, env.ledger().timestamp());

        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        if identities.contains_key(id_hash.clone()) {
            panic!("Identity already exists");
        }

        let duress_pin_hash = duress_pin.map(|pin| Self::pseudo_hash(&env, pin));

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
        };

        identities.set(id_hash.clone(), identity);
        env.storage().persistent().set(&identities_key, &identities);

        id_hash
    }

    pub fn social_recovery(
        env: Env,
        id_hash: BytesN<32>,
        approving_contact: Address,
        new_wallet: Address,
    ) -> bool {
        approving_contact.require_auth();

        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => return false,
        };

        let mut valid_contact = false;
        for contact in identity.recovery_contacts.iter() {
            if contact == approving_contact {
                valid_contact = true;
                break;
            }
        }
        if !valid_contact {
            return false;
        }

        let recovery_key = Symbol::new(&env, "recovery_requests");
        let mut requests: Map<BytesN<32>, SocialRecoveryRequest> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        let mut request = requests.get(id_hash.clone()).unwrap_or(SocialRecoveryRequest {
            beneficiary_id_hash: id_hash.clone(),
            new_wallet: new_wallet.clone(),
            approvals: Vec::new(&env),
            required_approvals: 3,
            created_at: now,
            expires_at: now + 86_400,
            is_completed: false,
        });

        if now > request.expires_at || request.is_completed {
            return false;
        }

        let mut exists = false;
        for approval in request.approvals.iter() {
            if approval == approving_contact {
                exists = true;
                break;
            }
        }
        if !exists {
            request.approvals.push_back(approving_contact);
        }

        if request.approvals.len() >= request.required_approvals {
            let mut updated = identity;
            updated.wallet_address = new_wallet;
            updated.last_verified = now;
            identities.set(id_hash.clone(), updated);
            env.storage().persistent().set(&identities_key, &identities);
            request.is_completed = true;
        }

        requests.set(id_hash, request.clone());
        env.storage().instance().set(&recovery_key, &requests);

        request.is_completed
    }

    pub fn temporary_credentials(
        env: Env,
        id_hash: BytesN<32>,
        owner: Address,
        device_fingerprint: String,
        duration_seconds: u64,
    ) -> BytesN<32> {
        owner.require_auth();

        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let mut identity = identities
            .get(id_hash.clone())
            .unwrap_or_else(|| panic!("Identity not found"));

        if identity.wallet_address != owner {
            panic!("Unauthorized");
        }

        let now = env.ledger().timestamp();
        let credential_hash = Self::generate_identity_hash(
            &env,
            &identity.creation_factors,
            now + (device_fingerprint.len() as u64),
        );

        let temp = TemporaryCredential {
            credential_hash: credential_hash.clone(),
            created_at: now,
            expires_at: now + duration_seconds,
            device_fingerprint,
            is_active: true,
        };

        identity.temporary_credentials.push_back(temp);
        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);

        credential_hash
    }

    pub fn identity_portability(
        env: Env,
        id_hash: BytesN<32>,
        owner: Address,
        new_camp_location: String,
        new_geofence: Option<GeofenceZone>,
    ) {
        owner.require_auth();

        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let mut identity = identities
            .get(id_hash.clone())
            .unwrap_or_else(|| panic!("Identity not found"));

        if identity.wallet_address != owner {
            panic!("Unauthorized");
        }

        identity.camp_location = new_camp_location;
        identity.last_verified = env.ledger().timestamp();

        if let Some(zone) = new_geofence {
            identity.geofence_zones.push_back(zone);
        }

        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);
    }

    pub fn verify_identity_with_duress(
        env: Env,
        id_hash: BytesN<32>,
        pin: String,
    ) -> (bool, bool) {
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let identity = match identities.get(id_hash) {
            Some(id) => id,
            None => return (false, false),
        };

        let pin_hash = Self::pseudo_hash(&env, pin);
        if let Some(duress_hash) = identity.duress_pin_hash {
            if duress_hash == pin_hash {
                return (true, true);
            }
        }

        (true, false)
    }

    pub fn check_geofence(
        env: Env,
        id_hash: BytesN<32>,
        current_latitude_e6: i64,
        current_longitude_e6: i64,
    ) -> bool {
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let identity = match identities.get(id_hash) {
            Some(id) => id,
            None => return false,
        };

        for zone in identity.geofence_zones.iter() {
            if !zone.is_safe {
                continue;
            }

            let distance_e6 = Self::manhattan_distance_e6(
                zone.latitude_e6,
                zone.longitude_e6,
                current_latitude_e6,
                current_longitude_e6,
            );
            if distance_e6 <= zone.radius_e6 {
                return true;
            }
        }

        false
    }

    pub fn update_trust_score(
        env: Env,
        id_hash: BytesN<32>,
        _activity_type: String,
        is_positive: bool,
    ) {
        let identities_key = Symbol::new(&env, "identities");
        let mut identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));

        let mut identity = match identities.get(id_hash.clone()) {
            Some(id) => id,
            None => return,
        };

        if is_positive {
            identity.trust_score = (identity.trust_score + 5).min(100);
        } else {
            identity.trust_score = identity.trust_score.saturating_sub(10);
        }

        identity.last_verified = env.ledger().timestamp();
        identities.set(id_hash, identity);
        env.storage().persistent().set(&identities_key, &identities);
    }

    pub fn get_identity(env: Env, id_hash: BytesN<32>) -> Option<BeneficiaryIdentity> {
        let identities_key = Symbol::new(&env, "identities");
        let identities: Map<BytesN<32>, BeneficiaryIdentity> = env
            .storage()
            .persistent()
            .get(&identities_key)
            .unwrap_or(Map::new(&env));
        identities.get(id_hash)
    }

    fn generate_recovery_codes(env: &Env, beneficiary_id: String) {
        let recovery_key = Symbol::new(env, "recovery_codes");
        let mut recovery_codes: Map<String, Vec<RecoveryCode>> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(env));

        let now = env.ledger().timestamp();
        let mut codes = Vec::new(env);

        let mut i = 0u32;
        while i < 3 {
            codes.push_back(RecoveryCode {
                beneficiary_id: beneficiary_id.clone(),
                code_hash: Self::generate_index_hash(env, now, i),
                created_at: now,
                expires_at: now + ((i as u64 + 1) * 30 * 86_400),
                is_used: false,
            });
            i += 1;
        }

        recovery_codes.set(beneficiary_id, codes);
        env.storage().instance().set(&recovery_key, &recovery_codes);
    }

    fn generate_identity_hash(env: &Env, factors: &Vec<IdentityFactor>, seed: u64) -> BytesN<32> {
        let mut out = [0u8; 32];
        out[0] = (factors.len() & 0xff) as u8;
        out[1] = ((seed >> 0) & 0xff) as u8;
        out[2] = ((seed >> 8) & 0xff) as u8;
        out[3] = ((seed >> 16) & 0xff) as u8;
        out[4] = ((seed >> 24) & 0xff) as u8;

        let mut idx = 5usize;
        for factor in factors.iter() {
            if idx >= 31 {
                break;
            }
            if let Some(byte) = factor.factor_hash.to_array().get(0) {
                out[idx] = *byte;
                idx += 1;
            }
        }

        BytesN::from_array(env, &out)
    }

    fn pseudo_hash(env: &Env, input: String) -> BytesN<32> {
        let mut out = [0u8; 32];
        out[0] = (input.len() & 0xff) as u8;
        out[1] = ((env.ledger().timestamp() >> 0) & 0xff) as u8;
        out[2] = ((env.ledger().timestamp() >> 8) & 0xff) as u8;
        BytesN::from_array(env, &out)
    }

    fn generate_index_hash(env: &Env, ts: u64, idx: u32) -> BytesN<32> {
        let mut out = [0u8; 32];
        out[0] = (idx & 0xff) as u8;
        out[1] = ((ts >> 0) & 0xff) as u8;
        out[2] = ((ts >> 8) & 0xff) as u8;
        out[3] = ((ts >> 16) & 0xff) as u8;
        BytesN::from_array(env, &out)
    }

    fn manhattan_distance_e6(lat1: i64, lon1: i64, lat2: i64, lon2: i64) -> i64 {
        let dlat = if lat2 >= lat1 { lat2 - lat1 } else { lat1 - lat2 };
        let dlon = if lon2 >= lon1 { lon2 - lon1 } else { lon1 - lon2 };
        dlat + dlon
    }
}
