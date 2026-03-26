use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Vec};

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
pub struct RiskFactor {
    pub factor_type: String,
    pub weight: u32,
    pub value: String,
    pub detected_at: u64,
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
pub struct SuspiciousTransaction {
    pub id: String,
    pub transaction_hash: String,
    pub beneficiary_id: String,
    pub merchant_id: String,
    pub amount: i128,
    pub timestamp: u64,
    pub risk_score: u32,
    pub alert_reasons: Vec<String>,
    pub status: String,
    pub reviewer: Option<Address>,
    pub review_notes: String,
}

#[contracttype]
#[derive(Clone)]
pub enum FraudKey {
    RiskProfiles,
    FraudAlerts,
    SuspiciousTransactions,
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
        let mut risk_score = 0u32;

        if verification_factors.len() < 2 {
            risk_score += 30;
        }
        if location.len() == 0 {
            risk_score += 20;
        }
        if device_fingerprint.len() < 10 {
            risk_score += 30;
        }

        let mut profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&FraudKey::RiskProfiles)
            .unwrap_or(Map::new(&env));

        profiles.set(
            beneficiary_id.clone(),
            RiskProfile {
                entity_id: beneficiary_id.clone(),
                entity_type: String::from_str(&env, "beneficiary"),
                risk_score,
                last_updated: env.ledger().timestamp(),
                risk_factors: Vec::new(&env),
                flagged_transactions: 0,
                total_transactions: 0,
            },
        );
        env.storage().instance().set(&FraudKey::RiskProfiles, &profiles);

        if risk_score > 70 {
            let mut alerts: Vec<FraudPattern> = env
                .storage()
                .instance()
                .get(&FraudKey::FraudAlerts)
                .unwrap_or(Vec::new(&env));

            let mut entities = Vec::new(&env);
            entities.push_back(beneficiary_id);

            alerts.push_back(FraudPattern {
                id: String::from_str(&env, "alert"),
                pattern_type: String::from_str(&env, "duplicate_registration"),
                severity: String::from_str(&env, "high"),
                description: String::from_str(&env, "High risk registration detected"),
                detected_at: env.ledger().timestamp(),
                entities_involved: entities,
                confidence_score: risk_score,
                status: String::from_str(&env, "detected"),
                resolution_notes: String::from_str(&env, ""),
            });
            env.storage().instance().set(&FraudKey::FraudAlerts, &alerts);

            return (false, String::from_str(&env, "Registration flagged for review"));
        }

        (true, String::from_str(&env, "Registration approved"))
    }

    pub fn monitor_transaction(
        env: Env,
        beneficiary_id: String,
        merchant_id: String,
        amount: i128,
        timestamp: u64,
        transaction_hash: String,
    ) -> (bool, Vec<String>) {
        let mut reasons = Vec::new(&env);
        let mut risk_score = 0u32;

        if amount > 1_000_000 {
            risk_score += 40;
            reasons.push_back(String::from_str(&env, "Unusual transaction amount"));
        }

        if merchant_id.len() == 0 {
            risk_score += 20;
            reasons.push_back(String::from_str(&env, "Invalid merchant"));
        }

        if risk_score > 60 {
            let mut suspicious: Map<String, SuspiciousTransaction> = env
                .storage()
                .instance()
                .get(&FraudKey::SuspiciousTransactions)
                .unwrap_or(Map::new(&env));

            suspicious.set(
                transaction_hash.clone(),
                SuspiciousTransaction {
                    id: String::from_str(&env, "suspicious"),
                    transaction_hash,
                    beneficiary_id,
                    merchant_id,
                    amount,
                    timestamp,
                    risk_score,
                    alert_reasons: reasons.clone(),
                    status: String::from_str(&env, "flagged"),
                    reviewer: None,
                    review_notes: String::from_str(&env, ""),
                },
            );
            env.storage()
                .instance()
                .set(&FraudKey::SuspiciousTransactions, &suspicious);

            return (false, reasons);
        }

        (true, reasons)
    }

    pub fn get_risk_profile(env: Env, entity_id: String) -> Option<RiskProfile> {
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&FraudKey::RiskProfiles)
            .unwrap_or(Map::new(&env));
        profiles.get(entity_id)
    }

    pub fn get_fraud_alerts(env: Env) -> Vec<FraudPattern> {
        env.storage()
            .instance()
            .get(&FraudKey::FraudAlerts)
            .unwrap_or(Vec::new(&env))
    }

    pub fn review_transaction(
        env: Env,
        reviewer: Address,
        transaction_id: String,
        status: String,
        notes: String,
    ) {
        reviewer.require_auth();

        let mut suspicious: Map<String, SuspiciousTransaction> = env
            .storage()
            .instance()
            .get(&FraudKey::SuspiciousTransactions)
            .unwrap_or(Map::new(&env));

        if let Some(mut tx) = suspicious.get(transaction_id.clone()) {
            tx.status = status;
            tx.reviewer = Some(reviewer);
            tx.review_notes = notes;
            suspicious.set(transaction_id, tx);
            env.storage()
                .instance()
                .set(&FraudKey::SuspiciousTransactions, &suspicious);
        }
    }

    pub fn get_high_risk_entities(env: Env, threshold: u32) -> Vec<RiskProfile> {
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&FraudKey::RiskProfiles)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, profile) in profiles.iter() {
            if profile.risk_score >= threshold {
                out.push_back(profile);
            }
        }
        out
    }
}
