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
pub struct RecoveryCode {
    pub beneficiary_id: String,
    pub code_hash: BytesN<32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub is_used: bool,
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

        beneficiaries.set(
            beneficiary_id.clone(),
            BeneficiaryProfile {
                id: beneficiary_id.clone(),
                name,
                disaster_id,
                location,
                registration_date: env.ledger().timestamp(),
                last_verified: env.ledger().timestamp(),
                verification_factors,
                wallet_address,
                is_active: true,
                family_size,
                special_needs,
                trust_score: 50,
            },
        );
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

        let mut total = 0u32;
        let mut matched = 0u32;

        for stored in profile.verification_factors.iter() {
            total += stored.weight;
            for provided in provided_factors.iter() {
                if stored.factor_type == provided.factor_type && stored.value == provided.value {
                    matched += stored.weight;
                    break;
                }
            }
        }

        let score = if total == 0 { 0 } else { (matched * 100) / total };
        if score >= 70 {
            profile.last_verified = env.ledger().timestamp();
            profile.trust_score = (profile.trust_score + 10).min(100);
            beneficiaries.set(beneficiary_id, profile);
            env.storage().instance().set(&beneficiaries_key, &beneficiaries);
            true
        } else {
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
        let recovery_codes: Map<String, Vec<RecoveryCode>> = env
            .storage()
            .instance()
            .get(&recovery_key)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        let codes = match recovery_codes.get(beneficiary_id.clone()) {
            Some(c) => c,
            None => return false,
        };

        let mut valid = false;
        for code in codes.iter() {
            if code.code_hash == recovery_code && !code.is_used && now <= code.expires_at {
                valid = true;
                break;
            }
        }

        if !valid {
            return false;
        }

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
            return true;
        }

        false
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
            let mut b = [0u8; 32];
            b[0] = (i & 0xff) as u8;
            b[1] = ((now >> 0) & 0xff) as u8;
            b[2] = ((now >> 8) & 0xff) as u8;

            codes.push_back(RecoveryCode {
                beneficiary_id: beneficiary_id.clone(),
                code_hash: BytesN::from_array(env, &b),
                created_at: now,
                expires_at: now + ((i as u64 + 1) * 30 * 86_400),
                is_used: false,
            });
            i += 1;
        }

        recovery_codes.set(beneficiary_id, codes);
        env.storage().instance().set(&recovery_key, &recovery_codes);
    }
}
