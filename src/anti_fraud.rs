use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};
use crate::rbac::{self, ROLE_ADMIN, ROLE_AUDITOR};
use crate::unique_id::*;

// Performance optimization constants
/// Maximum transactions to scan for velocity check (bounds iteration)
pub const MAX_VELOCITY_SCAN: u32 = 1000;
/// Maximum transactions to scan for amount anomaly check
pub const MAX_AMOUNT_SCAN: u32 = 500;
/// Maximum interaction patterns to check
pub const MAX_PATTERN_SCAN: u32 = 200;
/// Maximum risk profiles to scan for high-risk queries
pub const MAX_RISK_PROFILE_SCAN: u32 = 500;
/// Minimum prior transactions for a beneficiary before anomaly/pattern heuristics activate.
/// Prevents false-positive flags during cold start.
pub const MIN_COHORT_HISTORY: u32 = 3;

/// Derive canonical string severity directly from numeric `risk_score` (0..=100).
/// Keeps alert labels consistent across creation, triage, and scoped filtering (#154):
/// - `0..=29`  => `"low"`
/// - `30..=59` => `"medium"`
/// - `60..=79` => `"high"`
/// - `80..=100` => `"critical"`
pub fn severity_from_score(risk_score: u32) -> &'static str {
    let clamped = risk_score.min(100);
    if clamped >= 80 {
        "critical"
    } else if clamped >= 60 {
        "high"
    } else if clamped >= 30 {
        "medium"
    } else {
        "low"
    }
}

fn severity_rank(severity: &str) -> u32 {
    match severity {
        "critical" => 4,
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
}

fn has_rbac_roles(env: &Env) -> bool {
    env.storage().instance().has(&Symbol::new(env, "roles"))
}

#[contract]
pub struct AntiFraud;

#[derive(Clone)]
pub struct FraudPattern {
    pub id: String,
    pub pattern_type: String, // "duplicate_registration", "suspicious_transactions", "velocity_check"
    pub severity: String,     // derived via severity_from_score: "low" | "medium" | "high" | "critical"
    pub description: String,
    pub detected_at: u64,
    pub entities_involved: Vec<String>, // beneficiary IDs, merchant IDs, etc.
    pub confidence_score: u32,          // 0-100
    pub status: String,                 // "detected", "investigating", "resolved", "false_positive"
    pub resolution_notes: String,
}

#[derive(Clone)]
pub struct RiskProfile {
    pub entity_id: String,
    pub entity_type: String, // "beneficiary", "merchant", "donor"
    pub risk_score: u32,     // 0-100
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

#[derive(Clone)]
pub struct ReviewAuditRecord {
    pub transaction_id: String,
    pub reviewer: Address,
    pub status: String,
    pub notes: String,
    pub reviewed_at: u64,
}

#[contractimpl]
impl AntiFraud {
    /// Register a new beneficiary with fraud detection.
    ///
    /// Computes similarity against stored beneficiary verification factors (#147),
    /// records initial risk profile and factor fingerprints when approved, and
    /// derives alert severity consistently from numeric `risk_score` (#154).
    pub fn register_beneficiary_check(
        env: Env,
        beneficiary_id: String,
        verification_factors: Vec<String>,
        location: String,
        device_fingerprint: String,
    ) -> (bool, String) {
        let mut incoming_factors: Vec<String> = Vec::new(&env);
        for f in verification_factors.iter() {
            incoming_factors.push_back(f);
        }

        let risk_score = Self::calculate_registration_risk(
            &env,
            &beneficiary_id,
            &verification_factors,
            &location,
            &device_fingerprint,
        );

        if risk_score > 70 {
            let mut entities = Vec::new(&env);
            entities.push_back(beneficiary_id.clone());
            Self::create_fraud_alert(
                &env,
                "duplicate_registration",
                &format!("High risk registration detected for beneficiary {}", beneficiary_id),
                entities,
                risk_score,
            );
            return (false, String::from_str(&env, "Registration flagged for review"));
        }

        // Persist normalized factor set for future duplicate similarity comparisons (#147)
        if !incoming_factors.is_empty() {
            let factors_key = Symbol::new(&env, "reg_factors");
            let mut stored_factors: Map<String, Vec<String>> = env
                .storage()
                .instance()
                .get(&factors_key)
                .unwrap_or(Map::new(&env));
            stored_factors.set(beneficiary_id.clone(), incoming_factors);
            env.storage().instance().set(&factors_key, &stored_factors);
        }

        // Create risk profile
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

    /// Calculate registration risk score.
    ///
    /// - Factor similarity (#147): compares `verification_factors` against stored
    ///   factor sets in `reg_factors` across existing beneficiary profiles (+40 when > 80% overlap).
    /// - Device risk signal (#148): advisory heuristic (+30 max, never sole cause for blocking > 70).
    /// - Location heuristic: retains bounded placeholder weight (<= 50 score, never > 90 threshold).
    fn calculate_registration_risk(
        env: &Env,
        beneficiary_id: &String,
        verification_factors: &Vec<String>,
        location: &String,
        device_fingerprint: &String,
    ) -> u32 {
        let mut risk_score = 0u32;

        let profiles_key = Symbol::new(env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));

        let factors_key = Symbol::new(env, "reg_factors");
        let stored_factors: Map<String, Vec<String>> = env
            .storage()
            .instance()
            .get(&factors_key)
            .unwrap_or(Map::new(env));

        let mut max_similarity = 0u32;
        for (existing_id, existing_profile) in profiles.iter() {
            if existing_id != *beneficiary_id
                && existing_profile.entity_type == String::from_str(env, "beneficiary")
            {
                if let Some(existing_vec) = stored_factors.get(existing_id.clone()) {
                    let sim = Self::calculate_factor_similarity(verification_factors, &existing_vec);
                    if sim > max_similarity {
                        max_similarity = sim;
                    }
                }

                // Advisory placeholder: geospatial coordinate proximity requires GeoPoint input
                if Self::location_similarity(&location.to_string(), &existing_profile.entity_id.to_string()) > 90 {
                    risk_score += 20;
                }
            }
        }
        if max_similarity > 80 {
            risk_score += 40;
        }

        // Advisory device fingerprint check (#148): contributes +30 without auto-blocking alone
        if Self::is_suspicious_device(&device_fingerprint.to_string()) {
            risk_score += 30;
        }

        risk_score.min(100)
    }

    /// Percentage of `factors1` present in `factors2` (symmetric cap for duplicate checking).
    fn calculate_factor_similarity(factors1: &Vec<String>, factors2: &Vec<String>) -> u32 {
        if factors1.is_empty() || factors2.is_empty() {
            return 0;
        }

        let mut matches = 0u32;
        for factor1 in factors1.iter() {
            for factor2 in factors2.iter() {
                if factor1 == factor2 {
                    matches += 1;
                    break;
                }
            }
        }

        (matches * 100) / (factors1.len() as u32)
    }

    /// [ADVISORY PLACEHOLDER]: Returns static placeholder score (50 if non-empty, else 0).
    /// Full geospatial clustering uses `crate::geo::GeoPoint`.
    fn location_similarity(location1: &str, _entity_id: &str) -> u32 {
        if !location1.is_empty() {
            50
        } else {
            0
        }
    }

    /// Evaluate device fingerprint risk signal (#148).
    ///
    /// Advisory signal only (contributes at most +30, below the 70 review threshold).
    /// Flags empty/short strings (< 12 chars), implausibly long strings (> 256 chars),
    /// low-entropy repeated characters, or known automation markers (`bot`, `headless`, `emulator`).
    /// Device strings are untrusted client metadata and can be spoofed, so callers must
    /// combine this with independent identity/transaction checks.
    fn is_suspicious_device(device_fingerprint: &str) -> bool {
        let trimmed = device_fingerprint.trim();
        if trimmed.len() < 12 || trimmed.len() > 256 {
            return true;
        }
        let lower = trimmed.to_lowercase();
        if lower.contains("bot")
            || lower.contains("headless")
            || lower.contains("emulator")
            || lower == "000000000000"
        {
            return true;
        }
        let mut chars = trimmed.chars();
        if let Some(first) = chars.next() {
            if chars.all(|c| c == first) {
                return true;
            }
        }
        false
    }

    /// Monitor transaction for suspicious patterns.
    ///
    /// Evaluates velocity (#149), per-beneficiary amount anomaly (#150), and
    /// merchant concentration (#151), then persists the transaction to per-beneficiary
    /// history and interaction patterns for downstream checks.
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

        // Velocity check - >10 transactions for this beneficiary in rolling 1h window (#149)
        if Self::is_velocity_breach(&env, &beneficiary_id, timestamp) {
            risk_factors.push_back(String::from_str(&env, "High transaction velocity"));
            risk_score += 30;
        }

        // Amount anomaly - compared strictly against this beneficiary's prior baseline (#150)
        if Self::is_amount_anomaly(&env, &beneficiary_id, amount.clone()) {
            risk_factors.push_back(String::from_str(&env, "Unusual transaction amount"));
            risk_score += 25;
        }

        // Merchant-beneficiary pattern analysis (#151)
        if Self::is_suspicious_pattern(&env, &beneficiary_id, &merchant_id) {
            risk_factors.push_back(String::from_str(&env, "Suspicious merchant interaction pattern"));
            risk_score += 35;
        }

        // Geographic anomaly placeholder
        if Self::is_geographic_anomaly(&env, &beneficiary_id, timestamp) {
            risk_factors.push_back(String::from_str(&env, "Geographic location anomaly"));
            risk_score += 20;
        }

        // Record transaction into history & interaction patterns (#149, #151)
        Self::record_transaction_telemetry(&env, &beneficiary_id, &merchant_id, &amount, timestamp, &transaction_hash);

        // Update risk profile
        Self::update_risk_profile(&env, &beneficiary_id, risk_score, risk_factors.len() as u32);

        if risk_score > 60 {
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
            let mut suspicious: Map<String, SuspiciousTransaction> = env
                .storage()
                .instance()
                .get(&suspicious_key)
                .unwrap_or(Map::new(&env));

            suspicious.set(suspicious_tx.id.clone(), suspicious_tx);
            env.storage().instance().set(&suspicious_key, &suspicious);

            let mut entities = Vec::new(&env);
            entities.push_back(beneficiary_id);
            Self::create_fraud_alert(
                &env,
                "suspicious_transactions",
                "High-risk transaction flagged during monitoring",
                entities,
                risk_score,
            );

            return (false, risk_factors);
        }

        (true, risk_factors)
    }

    /// Persist monitored transaction into per-beneficiary history (`transaction_history`)
    /// and merchant interaction counters (`interaction_patterns`) so velocity, amount,
    /// and pattern heuristics observe live traffic (#149, #151).
    fn record_transaction_telemetry(
        env: &Env,
        beneficiary_id: &String,
        merchant_id: &String,
        amount: &U256,
        timestamp: u64,
        _transaction_hash: &String,
    ) {
        let hist_key = Symbol::new(env, "transaction_history");
        let mut history: Map<String, Vec<(u64, U256)>> = env
            .storage()
            .instance()
            .get(&hist_key)
            .unwrap_or(Map::new(env));
        let mut ben_history = history.get(beneficiary_id.clone()).unwrap_or(Vec::new(env));
        ben_history.push_back((timestamp, amount.clone()));
        history.set(beneficiary_id.clone(), ben_history);
        env.storage().instance().set(&hist_key, &history);

        let patterns_key = Symbol::new(env, "interaction_patterns");
        let mut patterns: Map<String, Map<String, u32>> = env
            .storage()
            .instance()
            .get(&patterns_key)
            .unwrap_or(Map::new(env));
        let mut ben_patterns = patterns.get(beneficiary_id.clone()).unwrap_or(Map::new(env));
        let prev = ben_patterns.get(merchant_id.clone()).unwrap_or(0);
        ben_patterns.set(merchant_id.clone(), prev + 1);
        patterns.set(beneficiary_id.clone(), ben_patterns);
        env.storage().instance().set(&patterns_key, &patterns);
    }

    /// Check for per-beneficiary velocity breaches (>10 transactions in rolling 1-hour window, bounded scan) (#149).
    fn is_velocity_breach(env: &Env, beneficiary_id: &String, timestamp: u64) -> bool {
        let hist_key = Symbol::new(env, "transaction_history");
        let history: Map<String, Vec<(u64, U256)>> = env
            .storage()
            .instance()
            .get(&hist_key)
            .unwrap_or(Map::new(env));

        let Some(ben_txs) = history.get(beneficiary_id.clone()) else {
            return false;
        };

        let mut recent_count = 0u32;
        let mut scanned = 0u32;

        for (tx_timestamp, _) in ben_txs.iter() {
            if scanned >= MAX_VELOCITY_SCAN {
                break;
            }
            scanned += 1;

            if tx_timestamp <= timestamp && (timestamp - tx_timestamp) < 3600 {
                recent_count += 1;
                if recent_count > 10 {
                    return true;
                }
            }
        }

        false
    }

    /// Check for per-beneficiary amount anomalies (#150).
    ///
    /// Compares `amount` only against `beneficiary_id`'s own prior history (cohort-scoped,
    /// avoiding skew from unrelated beneficiaries). Requires at least `MIN_COHORT_HISTORY`
    /// prior observations so cold-start averages do not flag initial aid disbursements.
    fn is_amount_anomaly(env: &Env, beneficiary_id: &String, amount: U256) -> bool {
        let hist_key = Symbol::new(env, "transaction_history");
        let history: Map<String, Vec<(u64, U256)>> = env
            .storage()
            .instance()
            .get(&hist_key)
            .unwrap_or(Map::new(env));

        let Some(ben_txs) = history.get(beneficiary_id.clone()) else {
            return false;
        };

        let mut total_amount = U256::from_u64(0);
        let mut count = 0u32;
        let mut scanned = 0u32;

        for (_, tx_amount) in ben_txs.iter() {
            if scanned >= MAX_AMOUNT_SCAN {
                break;
            }
            scanned += 1;

            total_amount += tx_amount;
            count += 1;
        }

        if count < MIN_COHORT_HISTORY {
            return false;
        }

        let average = total_amount / U256::from_u64(count as u64);
        if average == U256::from_u64(0) {
            return false;
        }

        amount > average * 3 || amount < average / 10
    }

    /// Check for suspicious merchant concentration (>80% with one merchant after `MIN_COHORT_HISTORY` transactions) (#151).
    fn is_suspicious_pattern(env: &Env, beneficiary_id: &String, merchant_id: &String) -> bool {
        let patterns_key = Symbol::new(env, "interaction_patterns");
        let patterns: Map<String, Map<String, u32>> = env
            .storage()
            .instance()
            .get(&patterns_key)
            .unwrap_or(Map::new(env));

        if let Some(beneficiary_patterns) = patterns.get(beneficiary_id.clone()) {
            let mut total_interactions = 0u32;
            let mut merchant_interactions = 0u32;
            let mut scanned = 0u32;

            for (merchant, count) in beneficiary_patterns.iter() {
                if scanned >= MAX_PATTERN_SCAN {
                    break;
                }
                scanned += 1;

                total_interactions += count;
                if merchant == *merchant_id {
                    merchant_interactions = count;
                }
            }

            if total_interactions >= MIN_COHORT_HISTORY {
                let percentage = (merchant_interactions * 100) / total_interactions;
                return percentage > 80;
            }
        }

        false
    }

    /// [INERT / PLACEHOLDER HEURISTIC]: Check for geographic anomalies.
    /// Returns false unconditionally because transaction GPS telemetry is not captured on-chain.
    fn is_geographic_anomaly(_env: &Env, _beneficiary_id: &String, _timestamp: u64) -> bool {
        false
    }

    /// Update risk profile
    fn update_risk_profile(env: &Env, beneficiary_id: &String, risk_score: u32, flagged_count: u32) {
        let profiles_key = Symbol::new(env, "risk_profiles");
        let mut profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(env));

        if let Some(mut profile) = profiles.get(beneficiary_id.clone()) {
            profile.risk_score = ((profile.risk_score + risk_score) / 2).min(100);
            profile.last_updated = env.ledger().timestamp();
            profile.flagged_transactions += flagged_count;
            profile.total_transactions += 1;
            profiles.set(beneficiary_id.clone(), profile);
            env.storage().instance().set(&profiles_key, &profiles);
        }
    }

    /// Create fraud alert with severity deterministically derived from numeric `risk_score` (#154).
    fn create_fraud_alert(
        env: &Env,
        pattern_type: &str,
        description: &str,
        entities: Vec<String>,
        risk_score: u32,
    ) {
        let clamped_score = risk_score.min(100);
        let derived_severity = severity_from_score(clamped_score);
        let entity_id = entities.get(0).unwrap_or(String::from_str(env, "unknown"));
        let alert_id = generate_fraud_alert_id(env, &entity_id, pattern_type);
        let alert = FraudPattern {
            id: alert_id,
            pattern_type: String::from_str(env, pattern_type),
            severity: String::from_str(env, derived_severity),
            description: String::from_str(env, description),
            detected_at: env.ledger().timestamp(),
            entities_involved: entities,
            confidence_score: clamped_score,
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

    /// Derive canonical alert severity string from numeric score (#154).
    pub fn severity_for_score(env: Env, risk_score: u32) -> String {
        String::from_str(&env, severity_from_score(risk_score))
    }

    /// Get risk profile for entity
    pub fn get_risk_profile(env: Env, entity_id: String) -> Option<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));

        profiles.get(entity_id)
    }

    /// Get global fraud alerts (administrative overview).
    /// Prefer `get_fraud_alerts_scoped` when enforcing role-gated entity/severity filtering (#152).
    pub fn get_fraud_alerts(env: Env) -> Vec<FraudPattern> {
        let alerts_key = Symbol::new(&env, "fraud_alerts");
        let alerts: Map<String, FraudPattern> = env
            .storage()
            .instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        let mut scanned = 0u32;
        for (_, alert) in alerts.iter() {
            if scanned >= MAX_RISK_PROFILE_SCAN {
                break;
            }
            scanned += 1;
            result.push_back(alert);
        }
        result
    }

    /// Role-gated, scoped fraud alert query (#152).
    ///
    /// Requires `caller.require_auth()` and `ROLE_AUDITOR` or `ROLE_ADMIN` when RBAC is seeded.
    /// Optionally restricts returned alerts to those involving `entity_id` and/or at least
    /// `min_severity` (`"low" | "medium" | "high" | "critical"`).
    pub fn get_fraud_alerts_scoped(
        env: Env,
        caller: Address,
        entity_id: Option<String>,
        min_severity: Option<String>,
    ) -> Vec<FraudPattern> {
        caller.require_auth();
        if has_rbac_roles(&env) {
            if !rbac::has_role(&env, &caller, ROLE_AUDITOR) && !rbac::has_role(&env, &caller, ROLE_ADMIN) {
                panic!("Unauthorized: auditor or admin role required for fraud alert queries");
            }
        }

        let min_rank = match min_severity {
            Some(ref sev) => severity_rank(&sev.to_string()),
            None => 0,
        };

        let alerts_key = Symbol::new(&env, "fraud_alerts");
        let alerts: Map<String, FraudPattern> = env
            .storage()
            .instance()
            .get(&alerts_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        let mut scanned = 0u32;
        for (_, alert) in alerts.iter() {
            if scanned >= MAX_RISK_PROFILE_SCAN {
                break;
            }
            scanned += 1;

            if min_rank > 0 && severity_rank(&alert.severity.to_string()) < min_rank {
                continue;
            }

            if let Some(ref target_entity) = entity_id {
                let mut matches_entity = false;
                for involved in alert.entities_involved.iter() {
                    if involved == *target_entity {
                        matches_entity = true;
                        break;
                    }
                }
                if !matches_entity {
                    continue;
                }
            }

            result.push_back(alert);
        }
        result
    }

    /// Review suspicious transaction (#153).
    ///
    /// Policy:
    /// - Enforces `ROLE_AUDITOR` when RBAC roles are initialized.
    /// - Validates `status` (`"reviewed"`, `"cleared"`, or `"blocked"`).
    /// - Appends an immutable `ReviewAuditRecord` and publishes an audit event.
    pub fn review_transaction(
        env: Env,
        reviewer: Address,
        transaction_id: String,
        status: String,
        notes: String,
    ) {
        reviewer.require_auth();
        if has_rbac_roles(&env) {
            rbac::require_role(&env, &reviewer, ROLE_AUDITOR);
        }

        let status_str = status.to_string();
        if status_str != "reviewed" && status_str != "cleared" && status_str != "blocked" {
            panic!("Invalid review status: expected reviewed, cleared, or blocked");
        }

        let suspicious_key = Symbol::new(&env, "suspicious_transactions");
        let mut suspicious: Map<String, SuspiciousTransaction> = env
            .storage()
            .instance()
            .get(&suspicious_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut transaction) = suspicious.get(transaction_id.clone()) {
            transaction.status = status.clone();
            transaction.reviewer = Some(reviewer.clone());
            transaction.review_notes = notes.clone();
            suspicious.set(transaction_id.clone(), transaction);
            env.storage().instance().set(&suspicious_key, &suspicious);
        }

        // Persist immutable review audit trail & emit event (#153)
        let audit_key = Symbol::new(&env, "review_audit_log");
        let mut audit_log: Map<String, Vec<ReviewAuditRecord>> = env
            .storage()
            .instance()
            .get(&audit_key)
            .unwrap_or(Map::new(&env));
        let mut entries = audit_log.get(transaction_id.clone()).unwrap_or(Vec::new(&env));
        entries.push_back(ReviewAuditRecord {
            transaction_id: transaction_id.clone(),
            reviewer: reviewer.clone(),
            status: status.clone(),
            notes,
            reviewed_at: env.ledger().timestamp(),
        });
        audit_log.set(transaction_id.clone(), entries);
        env.storage().instance().set(&audit_key, &audit_log);

        env.events().publish(
            (Symbol::new(&env, "anti_fraud"), Symbol::new(&env, "tx_reviewed")),
            (transaction_id, reviewer, status),
        );
    }

    /// Retrieve review audit records for a suspicious transaction (#153).
    pub fn get_review_audit_log(env: Env, transaction_id: String) -> Vec<ReviewAuditRecord> {
        let audit_key = Symbol::new(&env, "review_audit_log");
        let audit_log: Map<String, Vec<ReviewAuditRecord>> = env
            .storage()
            .instance()
            .get(&audit_key)
            .unwrap_or(Map::new(&env));
        audit_log.get(transaction_id).unwrap_or(Vec::new(&env))
    }

    /// Get high-risk entities (bounded scan for performance).
    /// Prefer `get_high_risk_entities_scoped` for role-gated and entity-type filtered queries (#155).
    pub fn get_high_risk_entities(env: Env, threshold: u32) -> Vec<RiskProfile> {
        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));

        let mut high_risk = Vec::new(&env);
        let mut scanned = 0u32;

        for (_, profile) in profiles.iter() {
            if scanned >= MAX_RISK_PROFILE_SCAN {
                break;
            }
            scanned += 1;

            if profile.risk_score >= threshold {
                high_risk.push_back(profile);
            }
        }
        high_risk
    }

    /// Scoped, role-gated high-risk entity query (#155).
    ///
    /// Intended for compliance auditors and platform admins only: enforces
    /// `ROLE_AUDITOR` or `ROLE_ADMIN` when RBAC is configured, and filters results by
    /// optional `entity_type` (`"beneficiary"`, `"merchant"`, `"donor"`).
    pub fn get_high_risk_entities_scoped(
        env: Env,
        caller: Address,
        entity_type: Option<String>,
        threshold: u32,
    ) -> Vec<RiskProfile> {
        caller.require_auth();
        if has_rbac_roles(&env) {
            if !rbac::has_role(&env, &caller, ROLE_AUDITOR) && !rbac::has_role(&env, &caller, ROLE_ADMIN) {
                panic!("Unauthorized: auditor or admin role required for high-risk queries");
            }
        }

        let profiles_key = Symbol::new(&env, "risk_profiles");
        let profiles: Map<String, RiskProfile> = env
            .storage()
            .instance()
            .get(&profiles_key)
            .unwrap_or(Map::new(&env));

        let mut high_risk = Vec::new(&env);
        let mut scanned = 0u32;

        for (_, profile) in profiles.iter() {
            if scanned >= MAX_RISK_PROFILE_SCAN {
                break;
            }
            scanned += 1;

            if let Some(ref target_type) = entity_type {
                if profile.entity_type != *target_type {
                    continue;
                }
            }

            if profile.risk_score >= threshold {
                high_risk.push_back(profile);
            }
        }
        high_risk
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_duplicate_factor_similarity_detection() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = AntiFraudClient::new(&env, &contract_id);

        let f1 = Vec::from_array(
            &env,
            [
                String::from_str(&env, "doc:abc123"),
                String::from_str(&env, "biometric:iris99"),
            ],
        );
        let (ok1, _) = client.register_beneficiary_check(
            &String::from_str(&env, "ben_1"),
            &f1,
            &String::from_str(&env, "Camp A"),
            &String::from_str(&env, "clean_device_fingerprint_9988"),
        );
        assert!(ok1);

        // Second beneficiary with identical factors + suspicious device reaches risk_score 70;
        // verify profile similarity contribution is non-zero (+40 vs 0 before).
        let (ok2, _) = client.register_beneficiary_check(
            &String::from_str(&env, "ben_2"),
            &f1,
            &String::from_str(&env, "Camp A"),
            &String::from_str(&env, "clean_device_fingerprint_7766"),
        );
        assert!(ok2);
        let p2 = client.get_risk_profile(&String::from_str(&env, "ben_2")).unwrap();
        assert_eq!(p2.risk_score, 40);
    }

    #[test]
    fn test_velocity_amount_and_pattern_heuristics_on_live_telemetry() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = AntiFraudClient::new(&env, &contract_id);

        let ben = String::from_str(&env, "ben_live");
        let other_ben = String::from_str(&env, "ben_other");
        let merchant = String::from_str(&env, "mer_only");

        client.register_beneficiary_check(
            &ben,
            &Vec::new(&env),
            &String::from_str(&env, "Camp A"),
            &String::from_str(&env, "clean_device_fingerprint_0001"),
        );
        client.register_beneficiary_check(
            &other_ben,
            &Vec::new(&env),
            &String::from_str(&env, "Camp B"),
            &String::from_str(&env, "clean_device_fingerprint_0002"),
        );

        // Other beneficiary has huge transactions — must NOT skew `ben`'s per-cohort average (#150)
        for i in 0..4u64 {
            client.monitor_transaction(
                &other_ben,
                &merchant,
                &U256::from_u64(100_000),
                &(1000 + i),
                &String::from_str(&env, "other_tx"),
            );
        }

        // Seed 11 small transactions within 1h at `mer_only` to trip velocity + pattern + spike
        for i in 0..11u64 {
            client.monitor_transaction(
                &ben,
                &merchant,
                &U256::from_u64(100),
                &(2000 + i),
                &String::from_str(&env, "small_tx"),
            );
        }

        // 12th transaction is 1000 (10x baseline 100) + 12th in 1h + >80% same merchant (#149,#150,#151)
        let (clean, reasons) = client.monitor_transaction(
            &ben,
            &merchant,
            &U256::from_u64(1000),
            &2050u64,
            &String::from_str(&env, "spike_tx"),
        );
        assert!(!clean);
        assert_eq!(reasons.len(), 3);
    }

    #[test]
    fn test_severity_derivation_and_scoped_queries_and_audit() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let auditor = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &admin, &admin, &admin);
        rbac::assign_role(&env, &admin, &auditor, ROLE_AUDITOR);

        let contract_id = env.register_contract(None, AntiFraud);
        let client = AntiFraudClient::new(&env, &contract_id);

        assert_eq!(client.severity_for_score(&15), String::from_str(&env, "low"));
        assert_eq!(client.severity_for_score(&40), String::from_str(&env, "medium"));
        assert_eq!(client.severity_for_score(&65), String::from_str(&env, "high"));
        assert_eq!(client.severity_for_score(&90), String::from_str(&env, "critical"));

        client.register_beneficiary_check(
            &String::from_str(&env, "ben_s"),
            &Vec::new(&env),
            &String::from_str(&env, "Camp"),
            &String::from_str(&env, "bot"),
        );

        let high = client.get_high_risk_entities_scoped(
            &auditor,
            &Some(String::from_str(&env, "beneficiary")),
            &25u32,
        );
        assert_eq!(high.len(), 1);

        let merchants = client.get_high_risk_entities_scoped(
            &auditor,
            &Some(String::from_str(&env, "merchant")),
            &0u32,
        );
        assert_eq!(merchants.len(), 0);

        client.review_transaction(
            &auditor,
            &String::from_str(&env, "susp_1"),
            &String::from_str(&env, "cleared"),
            &String::from_str(&env, "verified receipt"),
        );
        let log = client.get_review_audit_log(&String::from_str(&env, "susp_1"));
        assert_eq!(log.len(), 1);
        assert_eq!(log.get(0).unwrap().status, String::from_str(&env, "cleared"));
    }

    #[test]
    #[should_panic(expected = "Invalid review status")]
    fn test_review_rejects_invalid_status() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let auditor = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &admin, &admin, &admin);
        rbac::assign_role(&env, &admin, &auditor, ROLE_AUDITOR);

        let contract_id = env.register_contract(None, AntiFraud);
        let client = AntiFraudClient::new(&env, &contract_id);
        client.review_transaction(
            &auditor,
            &String::from_str(&env, "susp_bad"),
            &String::from_str(&env, "bogus"),
            &String::from_str(&env, "notes"),
        );
    }
}
