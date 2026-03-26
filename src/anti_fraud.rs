use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol, U256, Vec};

#[contract]
pub struct AntiFraud;

#[contracttype]
#[derive(Clone)]
pub struct FraudPattern {
    pub id: String,
    pub pattern_type: String,
    pub severity: String,
    pub description: String,
    pub detected_at: u64,
    pub entities_involved: Vec<String>,
    pub confidence_score: u32,
    pub status: String,
    pub resolution_notes: String,
}

#[contracttype]
#[derive(Clone)]
pub struct RiskProfile {
    pub entity_id: String,
    pub entity_type: String,
    pub risk_score: u32,
    pub last_updated: u64,
    pub risk_factors: Vec<RiskFactor>,
    pub flagged_transactions: u32,
    pub total_transactions: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct RiskFactor {
    pub factor_type: String,
    pub weight: u32,
    pub value: String,
    pub detected_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct SuspiciousTransaction {
    pub id: String,
    pub transaction_hash: String,
    pub beneficiary_id: String,
    pub merchant_id: String,
    pub amount: U256,
    pub timestamp: u64,
    pub risk_score: u32,
    pub alert_reasons: Vec<String>,
    pub status: String,
    pub reviewer: Option<Address>,
    pub review_notes: String,
}

#[contractimpl]
impl AntiFraud {
    pub fn register_beneficiary_check(
        env: Env,
        beneficiary_id: String,
        verification_factors: Vec<String>,
        location: String,
        device_fingerprint: String,
    ) -> (bool, String) {
        let risk_score =
            Self::calculate_registration_risk(&env, &verification_factors, &location, &device_fingerprint);

        if risk_score > 70 {
            let mut entities = Vec::new(&env);
            entities.push_back(beneficiary_id.clone());
            Self::create_fraud_alert(
                &env,
                String::from_str(&env, "duplicate_registration"),
                String::from_str(&env, "high"),
                String::from_str(&env, "High risk registration detected"),
                entities,
                risk_score,
            );
            return (false, String::from_str(&env, "Registration flagged for review"));
        }

        let risk_profile = RiskProfile {
            entity_id: beneficiary_id.clone(),
            entity_type: String::from_str(&env, "beneficiary"),
            risk_score,
            last_updated: env.ledger().timestamp(),
            risk_factors: Vec::new(&env),
            flagged_transactions: 0,
            total_transactions: 0,
        };

        let profiles_key = Symbol::new(&env, "risk_profiles");
        let mut profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));
        profiles.set(beneficiary_id, risk_profile);
        env.storage().instance().set(&profiles_key, &profiles);

        (true, String::from_str(&env, "Registration approved"))
    }

    fn calculate_registration_risk(
        env: &Env,
        verification_factors: &Vec<String>,
        location: &String,
        device_fingerprint: &String,
    ) -> u32 {
        let mut risk_score = 0u32;

        if verification_factors.len() < 2 {
            risk_score += 20;
        }
        if location.len() == 0 {
            risk_score += 20;
        }
        if Self::is_suspicious_device(device_fingerprint) {
            risk_score += 30;
        }

        let profiles_key = Symbol::new(env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));

        for (_, existing) in profiles.iter() {
            if existing.entity_type == String::from_str(env, "beneficiary") {
                risk_score += 5;
            }
        }

        risk_score.min(100)
    }

    fn is_suspicious_device(device_fingerprint: &String) -> bool {
        device_fingerprint.len() < 10
    }

    pub fn monitor_transaction(
        env: Env,
        beneficiary_id: String,
        merchant_id: String,
        amount: U256,
        timestamp: u64,
        transaction_hash: String,
    ) -> (bool, Vec<String>) {
        let mut risk_factors = Vec::new(&env);
        let mut risk_score = 0u32;

        if Self::is_velocity_breach(&env, timestamp) {
            risk_factors.push_back(String::from_str(&env, "High transaction velocity"));
            risk_score += 30;
        }
        if Self::is_amount_anomaly(&env, &amount) {
            risk_factors.push_back(String::from_str(&env, "Unusual transaction amount"));
            risk_score += 25;
        }
        if merchant_id.len() == 0 {
            risk_factors.push_back(String::from_str(&env, "Invalid merchant"));
            risk_score += 10;
        }

        Self::update_risk_profile(&env, beneficiary_id.clone(), risk_score, risk_factors.len());

        if risk_score > 60 {
            let suspicious_tx = SuspiciousTransaction {
                id: transaction_hash.clone(),
                transaction_hash,
                beneficiary_id,
                merchant_id,
                amount,
                timestamp,
                risk_score,
                alert_reasons: risk_factors.clone(),
                status: String::from_str(&env, "flagged"),
                reviewer: None,
                review_notes: String::from_str(&env, ""),
            };

            let suspicious_key = Symbol::new(&env, "suspicious_transactions");
            let mut suspicious: Map<String, SuspiciousTransaction> = env
                .storage()
                .instance()
                .get(&suspicious_key)
                .unwrap_or(Map::new(&env));
            suspicious.set(suspicious_tx.id.clone(), suspicious_tx);
            env.storage().instance().set(&suspicious_key, &suspicious);

            return (false, risk_factors);
        }

        (true, risk_factors)
    }

    fn is_velocity_breach(env: &Env, timestamp: u64) -> bool {
        let transactions_key = Symbol::new(env, "transaction_history");
        let transactions: Map<String, (u64, U256)> = env
            .storage()
            .instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(env));

        let mut recent_count = 0u32;
        for (_, (tx_timestamp, _)) in transactions.iter() {
            if timestamp >= tx_timestamp && timestamp - tx_timestamp < 3600 {
                recent_count += 1;
            }
        }

        recent_count > 10
    }

    fn is_amount_anomaly(env: &Env, amount: &U256) -> bool {
        amount.clone() > U256::from_u32(env, 1_000_000)
    }

    fn update_risk_profile(env: &Env, beneficiary_id: String, risk_score: u32, flagged_count: u32) {
        let profiles_key = Symbol::new(env, "risk_profiles");
        let mut profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));

        if let Some(mut profile) = profiles.get(beneficiary_id.clone()) {
            profile.risk_score = (profile.risk_score + risk_score) / 2;
            profile.last_updated = env.ledger().timestamp();
            profile.flagged_transactions += flagged_count;
            profile.total_transactions += 1;
            profiles.set(beneficiary_id, profile);
            env.storage().instance().set(&profiles_key, &profiles);
        }
    }

    fn create_fraud_alert(
        env: &Env,
        pattern_type: String,
        severity: String,
        description: String,
        entities: Vec<String>,
        confidence_score: u32,
    ) {
        let alert = FraudPattern {
            id: String::from_str(env, "alert"),
            pattern_type,
            severity,
            description,
            detected_at: env.ledger().timestamp(),
            entities_involved: entities,
            confidence_score,
            status: String::from_str(env, "detected"),
            resolution_notes: String::from_str(env, ""),
        };

        let alerts_key = Symbol::new(env, "fraud_alerts");
        let mut alerts: Map<String, FraudPattern> = env
            .storage()
            .instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(env));
        alerts.set(alert.id.clone(), alert);
        env.storage().instance().set(&alerts_key, &alerts);
    }

    pub fn get_risk_profile(env: Env, entity_id: String) -> Option<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));
        profiles.get(entity_id)
    }

    pub fn get_fraud_alerts(env: Env) -> Vec<FraudPattern> {
        let alerts_key = Symbol::new(&env, "fraud_alerts");
        let alerts: Map<String, FraudPattern> = env
            .storage()
            .instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        for (_, alert) in alerts.iter() {
            result.push_back(alert);
        }
        result
    }

    pub fn review_transaction(
        env: Env,
        reviewer: Address,
        transaction_id: String,
        status: String,
        notes: String,
    ) {
        reviewer.require_auth();

        let suspicious_key = Symbol::new(&env, "suspicious_transactions");
        let mut suspicious: Map<String, SuspiciousTransaction> = env
            .storage()
            .instance()
            .get(&suspicious_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut transaction) = suspicious.get(transaction_id.clone()) {
            transaction.status = status;
            transaction.reviewer = Some(reviewer);
            transaction.review_notes = notes;
            suspicious.set(transaction_id, transaction);
            env.storage().instance().set(&suspicious_key, &suspicious);
        }
    }

    pub fn get_high_risk_entities(env: Env, threshold: u32) -> Vec<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));

        let mut high_risk = Vec::new(&env);
        for (_, profile) in profiles.iter() {
            if profile.risk_score >= threshold {
                high_risk.push_back(profile);
            }
        }
        high_risk
    }
}
