use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol, U256, Vec};

#[contract]
pub struct MerchantNetwork;

#[contracttype]
#[derive(Clone)]
pub struct Location {
    pub latitude_e6: i64,
    pub longitude_e6: i64,
    pub address: String,
    pub city: String,
    pub country: String,
    pub postal_code: String,
}

#[contracttype]
#[derive(Clone)]
pub struct Merchant {
    pub id: String,
    pub name: String,
    pub owner: Address,
    pub business_type: String,
    pub location: Location,
    pub contact_info: String,
    pub accepted_tokens: Vec<String>,
    pub daily_limit: U256,
    pub monthly_limit: U256,
    pub current_day_volume: U256,
    pub current_month_volume: U256,
    pub registration_date: u64,
    pub is_verified: bool,
    pub is_active: bool,
    pub verification_documents: Vec<String>,
    pub reputation_score: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct MerchantRegistrationInput {
    pub name: String,
    pub business_type: String,
    pub location: Location,
    pub contact_info: String,
    pub stellar_toml_url: String,
    pub accepted_tokens: Vec<String>,
    pub daily_limit: U256,
    pub monthly_limit: U256,
    pub verification_documents: Vec<String>,
}

#[contracttype]
#[derive(Clone)]
pub struct Transaction {
    pub id: String,
    pub merchant_id: String,
    pub beneficiary_id: String,
    pub amount: U256,
    pub token: String,
    pub timestamp: u64,
    pub purpose: String,
    pub merchant_signature: String,
    pub beneficiary_signature: String,
    pub is_settled: bool,
}

#[contractimpl]
impl MerchantNetwork {
    pub fn register_merchant(
        env: Env,
        owner: Address,
        merchant_id: String,
        input: MerchantRegistrationInput,
    ) {
        owner.require_auth();

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        if merchants.contains_key(merchant_id.clone()) {
            panic!("merchant exists");
        }

        let mut docs = input.verification_documents;
        docs.push_back(input.stellar_toml_url);

        let merchant = Merchant {
            id: merchant_id.clone(),
            name: input.name,
            owner,
            business_type: input.business_type,
            location: input.location,
            contact_info: input.contact_info,
            accepted_tokens: input.accepted_tokens,
            daily_limit: input.daily_limit,
            monthly_limit: input.monthly_limit,
            current_day_volume: U256::from_u32(&env, 0),
            current_month_volume: U256::from_u32(&env, 0),
            registration_date: env.ledger().timestamp(),
            is_verified: false,
            is_active: false,
            verification_documents: docs,
            reputation_score: 50,
        };

        merchants.set(merchant_id.clone(), merchant);
        env.storage().instance().set(&merchants_key, &merchants);

        let queue_key = Symbol::new(&env, "merchant_queue");
        let mut queue: Vec<String> = env
            .storage()
            .instance()
            .get(&queue_key)
            .unwrap_or(Vec::new(&env));
        queue.push_back(merchant_id);
        env.storage().instance().set(&queue_key, &queue);
    }

    pub fn verify_merchant(
        env: Env,
        verifier: Address,
        merchant_id: String,
        approved: bool,
        notes: String,
    ) {
        verifier.require_auth();

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            merchant.is_verified = approved;
            merchant.is_active = approved;
            merchant.verification_documents.push_back(notes);
            merchants.set(merchant_id, merchant);
            env.storage().instance().set(&merchants_key, &merchants);
        } else {
            panic!("merchant not found");
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn process_payment(
        env: Env,
        merchant_signer: Address,
        beneficiary_signer: Address,
        merchant_id: String,
        beneficiary_id: String,
        amount: U256,
        token: String,
        purpose: String,
    ) -> String {
        merchant_signer.require_auth();
        beneficiary_signer.require_auth();

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        let mut merchant = merchants
            .get(merchant_id.clone())
            .unwrap_or_else(|| panic!("merchant not found"));

        if !merchant.is_active || !merchant.is_verified {
            panic!("merchant not active");
        }

        if !Self::token_allowed(&merchant.accepted_tokens, &token) {
            panic!("token not accepted");
        }

        if amount > merchant.daily_limit {
            panic!("daily limit exceeded");
        }

        if amount > merchant.monthly_limit {
            panic!("monthly limit exceeded");
        }

        merchant.current_day_volume = amount.clone();
        merchant.current_month_volume = amount.clone();
        merchants.set(merchant_id.clone(), merchant);
        env.storage().instance().set(&merchants_key, &merchants);

        let tx = Transaction {
            id: String::from_str(&env, "tx"),
            merchant_id: merchant_id.clone(),
            beneficiary_id,
            amount,
            token,
            timestamp: env.ledger().timestamp(),
            purpose,
            merchant_signature: String::from_str(&env, "merchant_signed"),
            beneficiary_signature: String::from_str(&env, "beneficiary_signed"),
            is_settled: false,
        };

        let tx_key = Symbol::new(&env, "merchant_txs");
        let mut tx_map: Map<String, Vec<Transaction>> = env
            .storage()
            .instance()
            .get(&tx_key)
            .unwrap_or(Map::new(&env));

        let mut txs = tx_map.get(merchant_id.clone()).unwrap_or(Vec::new(&env));
        txs.push_back(tx);
        tx_map.set(merchant_id, txs);
        env.storage().instance().set(&tx_key, &tx_map);

        String::from_str(&env, "payment_processed")
    }

    pub fn get_merchant(env: Env, merchant_id: String) -> Option<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        merchants.get(merchant_id)
    }

    pub fn find_merchants_by_location(
        env: Env,
        latitude_e6: i64,
        longitude_e6: i64,
        radius_e6: i64,
    ) -> Vec<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, merchant) in merchants.iter() {
            let distance = Self::calculate_distance_e6(
                latitude_e6,
                longitude_e6,
                merchant.location.latitude_e6,
                merchant.location.longitude_e6,
            );

            if distance <= radius_e6 && merchant.is_active {
                out.push_back(merchant);
            }
        }

        out
    }

    pub fn get_merchant_transactions(env: Env, merchant_id: String) -> Vec<Transaction> {
        let tx_key = Symbol::new(&env, "merchant_txs");
        let tx_map: Map<String, Vec<Transaction>> = env
            .storage()
            .instance()
            .get(&tx_key)
            .unwrap_or(Map::new(&env));
        tx_map.get(merchant_id).unwrap_or(Vec::new(&env))
    }

    pub fn update_reputation(
        env: Env,
        admin: Address,
        merchant_id: String,
        feedback_score: i32,
    ) {
        admin.require_auth();

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            if feedback_score >= 0 {
                merchant.reputation_score =
                    (merchant.reputation_score + feedback_score as u32).min(100);
            } else {
                merchant.reputation_score = merchant
                    .reputation_score
                    .saturating_sub((-feedback_score) as u32);
            }

            merchants.set(merchant_id, merchant);
            env.storage().instance().set(&merchants_key, &merchants);
        }
    }

    pub fn get_verification_queue(env: Env) -> Vec<String> {
        let queue_key = Symbol::new(&env, "merchant_queue");
        env.storage()
            .instance()
            .get(&queue_key)
            .unwrap_or(Vec::new(&env))
    }

    fn token_allowed(tokens: &Vec<String>, token: &String) -> bool {
        for allowed in tokens.iter() {
            if allowed == token.clone() {
                return true;
            }
        }
        false
    }

    fn calculate_distance_e6(lat1: i64, lon1: i64, lat2: i64, lon2: i64) -> i64 {
        let dlat = if lat2 >= lat1 { lat2 - lat1 } else { lat1 - lat2 };
        let dlon = if lon2 >= lon1 { lon2 - lon1 } else { lon1 - lon2 };
        dlat + dlon
    }
}
