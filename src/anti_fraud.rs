use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};
use crate::unique_id::*;

#[contract]
pub struct AntiFraud;

#[derive(Clone)]
pub struct FraudPattern {
    pub id: String,
    pub pattern_type: String, // "duplicate_registration", "suspicious_transactions", "velocity_check"
    pub severity: String, // "low", "medium", "high", "critical"
    pub description: String,
    pub detected_at: u64,
    pub entities_involved: Vec<String>, // beneficiary IDs, merchant IDs, etc.
    pub confidence_score: u32, // 0-100
    pub status: String, // "detected", "investigating", "resolved", "false_positive"
    pub resolution_notes: String,
}

#[derive(Clone)]
pub struct RiskProfile {
    pub entity_id: String,
    pub entity_type: String, // "beneficiary", "merchant", "donor"
    pub risk_score: u32, // 0-100
    pub last_updated: u64,
    pub risk_factors: Vec<RiskFactor>,
    pub flagged_transactions: u32,
    pub total_transactions: u32,
}

#[derive(Clone)]
pub struct RiskFactor {
    pub factor_type: String,
    pub weight: u32,
    pub value: String,
    pub detected_at: u64,
}

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
    pub status: String, // "flagged", "reviewed", "cleared", "blocked"
    pub reviewer: Option<Address>,
    pub review_notes: String,
}

#[contractimpl]
impl AntiFraud {
    /// Register a new beneficiary with fraud detection
    pub fn register_beneficiary_check(
        env: Env,
        beneficiary_id: String,
        verification_factors: Vec<String>,
        location: String,
        device_fingerprint: String,
    ) -> (bool, String) {
        // Check for duplicate registrations using various factors
        let risk_score = Self::calculate_registration_risk(&env, &beneficiary_id, &verification_factors, &location, &device_fingerprint);
        
        if risk_score > 70 {
            // High risk - flag for manual review
            Self::create_fraud_alert(
                &env,
                "duplicate_registration",
                "high",
                &format!("High risk registration detected for beneficiary {}", beneficiary_id),
                vec![beneficiary_id],
                risk_score,
            );
            return (false, String::from_str(&env, "Registration flagged for review"));
        }
        
        // Create risk profile
        let risk_profile = RiskProfile {
            entity_id: beneficiary_id,
            entity_type: String::from_str(&env, "beneficiary"),
            risk_score,
            last_updated: env.ledger().timestamp(),
            risk_factors: Vec::new(&env),
            flagged_transactions: 0,
            total_transactions: 0,
        };
        
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let mut profiles: Map<String, RiskProfile> = env.storage().instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));
        
        profiles.set(beneficiary_id, risk_profile);
        env.storage().instance().set(&profiles_key, &profiles);
        
        (true, String::from_str(&env, "Registration approved"))
    }

    /// Calculate registration risk score
    ///
    /// Evaluates device fingerprint patterns and checks against existing profiles.
    /// Note: Factors similarity and location clustering contain inert/placeholder heuristics as noted below.
    fn calculate_registration_risk(
        env: &Env,
        beneficiary_id: &String,
        verification_factors: &[String],
        location: &String,
        device_fingerprint: &String,
    ) -> u32 {
        let mut risk_score = 0u32;
        
        // Check for similar verification factors (potential duplicate)
        let profiles_key = Symbol::new(env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env.storage().instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));
        
        for (_, existing_profile) in profiles.iter() {
            if existing_profile.entity_type == String::from_str(env, "beneficiary") {
                // [INERT / PLACEHOLDER HEURISTIC]: calculate_similarity is called with an empty
                // slice (&[]), always returning 0. Full factor comparison is not yet implemented.
                if Self::calculate_similarity(verification_factors, &[]) > 80 {
                    risk_score += 40;
                }
                
                // [INERT / PLACEHOLDER HEURISTIC]: location_similarity returns a static 50 score
                // for any non-empty location; coordinate-based geospatial proximity is not computed.
                if Self::location_similarity(location, &existing_profile.entity_id) > 90 {
                    risk_score += 20;
                }
            }
        }
        
        // Check device fingerprint patterns (active heuristic)
        if Self::is_suspicious_device(device_fingerprint) {
            risk_score += 30;
        }
        
        risk_score.min(100)
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Simple similarity calculation (placeholder for more sophisticated ML)
    /// Always returns 0 when factors2 is empty. Verification factor vector comparison is not yet functional.
    fn calculate_similarity(factors1: &[String], factors2: &[String]) -> u32 {
        if factors2.is_empty() {
            return 0;
        }
        
        let mut matches = 0;
        for factor1 in factors1.iter() {
            for factor2 in factors2.iter() {
                if factor1 == factor2 {
                    matches += 1;
                    break;
                }
            }
        }
        
        (matches * 100) / factors1.len() as u32
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Location similarity check
    /// Returns fixed placeholder score (50 if location non-empty, else 0); geospatial distance calculation is not implemented.
    fn location_similarity(location1: &str, entity_id: &str) -> u32 {
        // Simple string similarity (in production, use geospatial analysis)
        if location1.len() > 0 {
            50 // Placeholder
        } else {
            0
        }
    }

    /// Check if device fingerprint is suspicious
    fn is_suspicious_device(device_fingerprint: &str) -> bool {
        // Check for known suspicious patterns
        device_fingerprint.len() < 10 || device_fingerprint.contains("bot")
    }

    /// Monitor transaction for suspicious patterns
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
        
        // Velocity check - too many transactions in short time
        if Self::is_velocity_breach(&env, &beneficiary_id, timestamp) {
            risk_factors.push_back(String::from_str(&env, "High transaction velocity"));
            risk_score += 30;
        }
        
        // Amount anomaly - unusually large or small amounts
        if Self::is_amount_anomaly(&env, &beneficiary_id, amount) {
            risk_factors.push_back(String::from_str(&env, "Unusual transaction amount"));
            risk_score += 25;
        }
        
        // Merchant-beneficiary pattern analysis
        if Self::is_suspicious_pattern(&env, &beneficiary_id, &merchant_id) {
            risk_factors.push_back(String::from_str(&env, "Suspicious merchant interaction pattern"));
            risk_score += 35;
        }
        
        // Geographic anomaly
        if Self::is_geographic_anomaly(&env, &beneficiary_id, timestamp) {
            risk_factors.push_back(String::from_str(&env, "Geographic location anomaly"));
            risk_score += 20;
        }
        
        // Update risk profile
        Self::update_risk_profile(&env, &beneficiary_id, risk_score, risk_factors.len() as u32);
        
        if risk_score > 60 {
            // Create suspicious transaction record
            let suspicious_tx = SuspiciousTransaction {
                id: format!("susp_{}", transaction_hash),
                transaction_hash,
                beneficiary_id: beneficiary_id.clone(),
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
            let mut suspicious: Map<String, SuspiciousTransaction> = env.storage().instance()
                .get(&suspicious_key)
                .unwrap_or(Map::new(&env));
            
            suspicious.set(suspicious_tx.id.clone(), suspicious_tx);
            env.storage().instance().set(&suspicious_key, &suspicious);
            
            return (false, risk_factors);
        }
        
        (true, risk_factors)
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Check for velocity breaches
    /// Queries the "transaction_history" storage map, which is currently not populated by standard transactions.
    fn is_velocity_breach(env: &Env, beneficiary_id: &String, timestamp: u64) -> bool {
        // Check if more than 10 transactions in last hour
        let transactions_key = Symbol::new(env, "transaction_history");
        let transactions: Map<String, (u64, U256)> = env.storage().instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(env));
        
        let mut recent_count = 0;
        for (_, (tx_timestamp, _)) in transactions.iter() {
            if timestamp - tx_timestamp < 3600 && tx_timestamp <= timestamp {
                recent_count += 1;
            }
        }
        
        recent_count > 10
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Check for amount anomalies
    /// Queries the "transaction_history" storage map, which is currently not populated by standard transactions.
    fn is_amount_anomaly(env: &Env, beneficiary_id: &String, amount: U256) -> bool {
        // Check if amount is significantly different from average
        let transactions_key = Symbol::new(env, "transaction_history");
        let transactions: Map<String, (u64, U256)> = env.storage().instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(env));
        
        let mut total_amount = U256::from_u64(0);
        let mut count = 0;
        
        for (_, (_, tx_amount)) in transactions.iter() {
            total_amount += tx_amount;
            count += 1;
        }
        
        if count == 0 {
            return false;
        }
        
        let average = total_amount / U256::from_u64(count as u64);
        
        // Flag if amount is more than 3x average or less than 1/10 of average
        amount > average * 3 || amount < average / 10
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Check for suspicious merchant interaction patterns
    /// Queries the "interaction_patterns" storage map, which is currently not populated by standard payments.
    fn is_suspicious_pattern(env: &Env, beneficiary_id: &String, merchant_id: &String) -> bool {
        // Check if beneficiary always transacts with same merchant
        let patterns_key = Symbol::new(env, "interaction_patterns");
        let patterns: Map<String, Map<String, u32>> = env.storage().instance()
            .get(&patterns_key)
            .unwrap_or(Map::new(env));
        
        if let Some(beneficiary_patterns) = patterns.get(beneficiary_id) {
            let mut total_interactions = 0;
            let mut merchant_interactions = 0;
            
            for (merchant, count) in beneficiary_patterns.iter() {
                total_interactions += count;
                if merchant == merchant_id {
                    merchant_interactions = count;
                }
            }
            
            if total_interactions > 0 {
                let percentage = (merchant_interactions * 100) / total_interactions;
                return percentage > 80; // More than 80% with same merchant
            }
        }
        
        false
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Check for geographic anomalies
    /// Returns false unconditionally because transaction GPS/location telemetry is not currently captured on-chain.
    fn is_geographic_anomaly(env: &Env, beneficiary_id: &String, timestamp: u64) -> bool {
        // Check if transactions are happening in impossible locations
        // This would require location data from transactions
        false // Placeholder
    }

    /// Update risk profile
    fn update_risk_profile(env: &Env, beneficiary_id: &String, risk_score: u32, flagged_count: u32) {
        let profiles_key = Symbol::new(env, "risk_profiles");
        let mut profiles: Map<String, RiskProfile> = env.storage().instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));
        
        if let Some(mut profile) = profiles.get(beneficiary_id) {
            profile.risk_score = (profile.risk_score + risk_score) / 2; // Average with previous
            profile.last_updated = env.ledger().timestamp();
            profile.flagged_transactions += flagged_count;
            profiles.set(beneficiary_id, profile);
            env.storage().instance().set(&profiles_key, &profiles);
        }
    }

    /// Create fraud alert
    fn create_fraud_alert(
        env: &Env,
        pattern_type: &str,
        severity: &str,
        description: &str,
        entities: Vec<String>,
        confidence_score: u32,
    ) {
        // Use first entity for alert ID, or pattern_type if no entities
        let entity_id = entities.get(0).unwrap_or(String::from_str(env, "unknown"));
        let alert_id = generate_fraud_alert_id(env, &entity_id, pattern_type);
        let alert = FraudPattern {
            id: alert_id,
            pattern_type: String::from_str(env, pattern_type),
            severity: String::from_str(env, severity),
            description: String::from_str(env, description),
            detected_at: env.ledger().timestamp(),
            entities_involved: entities,
            confidence_score,
            status: String::from_str(env, "detected"),
            resolution_notes: String::from_str(env, ""),
        };
        
        let alerts_key = Symbol::new(env, "fraud_alerts");
        let mut alerts: Map<String, FraudPattern> = env.storage().instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(env));
        
        alerts.set(alert.id.clone(), alert);
        env.storage().instance().set(&alerts_key, &alerts);
    }

    /// Get risk profile for entity
    pub fn get_risk_profile(env: Env, entity_id: String) -> Option<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env.storage().instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));
        
        profiles.get(entity_id)
    }

    /// Get fraud alerts
    pub fn get_fraud_alerts(env: Env) -> Vec<FraudPattern> {
        let alerts_key = Symbol::new(&env, "fraud_alerts");
        let alerts: Map<String, FraudPattern> = env.storage().instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, alert) in alerts.iter() {
            result.push_back(alert);
        }
        result
    }

    /// Review suspicious transaction
    pub fn review_transaction(
        env: Env,
        reviewer: Address,
        transaction_id: String,
        status: String, // "cleared", "blocked"
        notes: String,
    ) {
        reviewer.require_auth();
        
        let suspicious_key = Symbol::new(&env, "suspicious_transactions");
        let mut suspicious: Map<String, SuspiciousTransaction> = env.storage().instance()
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

    /// Get high-risk entities
    pub fn get_high_risk_entities(env: Env, threshold: u32) -> Vec<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env.storage().instance()
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
