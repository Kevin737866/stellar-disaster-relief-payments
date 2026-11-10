use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};
use crate::unique_id::*;

// Performance optimization constants
/// Maximum spending rules to check per transaction (bounds iteration)
pub const MAX_SPENDING_RULES_CHECK: u32 = 50;
/// Maximum transactions to return in history queries
pub const MAX_TRANSACTION_HISTORY: u32 = 100;
/// Maximum transfers to return in beneficiary queries
pub const MAX_BENEFICIARY_TRANSFERS: u32 = 50;
/// Maximum transfers to scan in cleanup
pub const MAX_CLEANUP_SCAN: u32 = 200;

/// Built-in supported settlement asset codes (#145). Additional custom assets can
/// be registered by governance via `register_supported_token`.
pub const BUILTIN_SUPPORTED_TOKENS: [&str; 3] = ["XLM", "USDC", "EURC"];

fn parse_strict_u64(raw: &str) -> Option<u64> {
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    raw.parse::<u64>().ok()
}

fn is_supported_token(env: &Env, token: &String) -> bool {
    let raw = token.to_string();
    if BUILTIN_SUPPORTED_TOKENS.iter().any(|allowed| *allowed == raw) {
        return true;
    }
    let key = Symbol::new(env, "supported_tokens");
    let custom: Map<String, bool> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(Map::new(env));
    custom.get(token.clone()).unwrap_or(false)
}

fn validate_rule_schema(env: &Env, rule: &SpendingRule) {
    match rule.rule_type.to_string().as_str() {
        "category_limit" => {
            let cat = rule
                .parameters
                .get(String::from_str(env, "category"))
                .unwrap_or(String::from_str(env, ""));
            if cat.is_empty() || rule.limit == U256::from_u64(0) {
                panic!("Invalid category_limit schema: non-empty category and positive limit required");
            }
        }
        "merchant_whitelist" => {
            let single = rule
                .parameters
                .get(String::from_str(env, "merchant"))
                .unwrap_or(String::from_str(env, ""));
            let multi = rule
                .parameters
                .get(String::from_str(env, "merchants"))
                .unwrap_or(String::from_str(env, ""));
            if single.is_empty() && multi.is_empty() {
                panic!("Invalid merchant_whitelist schema: non-empty merchant or merchants required");
            }
        }
        "time_window" => {
            let start_s = rule
                .parameters
                .get(String::from_str(env, "start_time"))
                .unwrap_or(String::from_str(env, ""));
            let end_s = rule
                .parameters
                .get(String::from_str(env, "end_time"))
                .unwrap_or(String::from_str(env, ""));
            let start = parse_strict_u64(&start_s.to_string())
                .unwrap_or_else(|| panic!("Invalid time_window schema: numeric start_time required"));
            let end = parse_strict_u64(&end_s.to_string())
                .unwrap_or_else(|| panic!("Invalid time_window schema: numeric end_time required"));
            if start > end {
                panic!("Invalid time_window schema: start_time must be <= end_time");
            }
        }
        "location_based" => {
            let loc = rule
                .parameters
                .get(String::from_str(env, "location"))
                .unwrap_or(String::from_str(env, ""));
            if loc.is_empty() {
                panic!("Invalid location_based schema: non-empty location required");
            }
        }
        _ => panic!("Unsupported spending rule type"),
    }
}

fn rule_matches_merchant(env: &Env, rule: &SpendingRule, merchant_id: &String) -> bool {
    if let Some(single) = rule.parameters.get(String::from_str(env, "merchant")) {
        if single == *merchant_id {
            return true;
        }
    }
    if let Some(multi) = rule.parameters.get(String::from_str(env, "merchants")) {
        let target = merchant_id.to_string();
        if multi.to_string().split(',').map(|s| s.trim()).any(|m| m == target) {
            return true;
        }
    }
    false
}

fn rule_matches_spend(
    env: &Env,
    rule: &SpendingRule,
    merchant_id: &String,
    category: &String,
    location: &String,
) -> bool {
    match rule.rule_type.to_string().as_str() {
        "category_limit" => rule
            .parameters
            .get(String::from_str(env, "category"))
            .map(|c| c == *category)
            .unwrap_or(false),
        "merchant_whitelist" => rule_matches_merchant(env, rule, merchant_id),
        "time_window" => true,
        "location_based" => rule
            .parameters
            .get(String::from_str(env, "location"))
            .map(|l| l == *location)
            .unwrap_or(false),
        _ => false,
    }
}

#[contract]
pub struct CashTransfer;

#[derive(Clone)]
pub struct ConditionalTransfer {
    pub id: String,
    pub beneficiary_id: String,
    pub amount: U256,
    pub token: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub spending_rules: Vec<SpendingRule>,
    pub is_active: bool,
    pub recalled: bool,
    pub recalled_at: Option<u64>,
    pub spent_amount: U256,
    pub remaining_amount: U256,
    pub creator: Address,
    pub purpose: String,
}

#[derive(Clone)]
pub struct SpendingRule {
    pub rule_type: String, // "category_limit", "merchant_whitelist", "time_window", "location_based"
    pub parameters: Map<String, String>,
    pub limit: U256,
    pub current_usage: U256,
}

#[derive(Clone)]
pub struct Transaction {
    pub id: String,
    pub transfer_id: String,
    pub merchant_id: String,
    pub amount: U256,
    pub category: String,
    pub timestamp: u64,
    pub location: String,
    pub is_approved: bool,
    pub rejection_reason: String,
}

/// Structured outcome recorded on every `spend` / `spend_with_outcome` call (#141).
#[derive(Clone)]
pub struct SpendOutcome {
    pub approved: bool,
    pub reason_code: String,
    pub reason: String,
}

#[contractimpl]
impl CashTransfer {
    /// Register an additional approved settlement token (#145).
    /// **Required role:** ADMIN
    pub fn register_supported_token(env: Env, admin: Address, token: String) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);
        if token.is_empty() {
            panic!("Token identifier must not be empty");
        }
        let key = Symbol::new(&env, "supported_tokens");
        let mut custom: Map<String, bool> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Map::new(&env));
        custom.set(token, true);
        env.storage().instance().set(&key, &custom);
    }

    /// Create a conditional cash transfer with token allowlist (#145) and rule schema validation (#146).
    pub fn create_transfer(
        env: Env,
        creator: Address,
        transfer_id: String,
        beneficiary_id: String,
        amount: U256,
        token: String,
        expires_at: u64,
        spending_rules: Vec<SpendingRule>,
        purpose: String,
    ) {
        creator.require_auth();
        rbac::require_role(&env, &creator, ROLE_NGO);

        // #239 — gated by the shared incident pause
        require_not_paused(&env);

        if !is_supported_token(&env, &token) {
            panic!("Unsupported token identifier");
        }

        for rule in spending_rules.iter() {
            validate_rule_schema(&env, &rule);
        }

        // Check for duplicate transfer
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        if transfers.contains_key(transfer_id.clone()) {
            panic_with_error!(&env, "Transfer already exists");
        }

        // Create conditional transfer
        let transfer = ConditionalTransfer {
            id: transfer_id.clone(),
            beneficiary_id: beneficiary_id.clone(),
            amount: amount.clone(),
            token,
            created_at: env.ledger().timestamp(),
            expires_at,
            spending_rules,
            is_active: true,
            recalled: false,
            recalled_at: None,
            spent_amount: U256::from_u64(0),
            remaining_amount: amount.clone(),
            creator,
            purpose,
        };

        transfers.set(transfer_id.clone(), transfer);
        env.storage().instance().set(&transfers_key, &transfers);

        // Initialize transaction history
        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let transactions: Map<String, Transaction> = Map::new(&env);
        env.storage().instance().set(&transactions_key, &transactions);

        // Emit transfer created event
        env.events().publish(
            (Symbol::new(&env, "cash_transfer"), Symbol::new(&env, "transfer_created")),
            (transfer_id, beneficiary_id, amount),
        );
    }

    /// Attempt to spend from conditional transfer, returning a boolean decision while
    /// persisting a structured `SpendOutcome` retrievable via `get_last_spend_outcome` (#141).
    pub fn spend(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        amount: U256,
        category: String,
        location: String,
    ) -> bool {
        Self::execute_spend(
            env,
            beneficiary,
            transfer_id,
            merchant_id,
            amount,
            category,
            location,
        )
        .approved
    }

    /// Attempt to spend and return structured classification (`approved`, `reason_code`, `reason`) (#141).
    pub fn spend_with_outcome(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        amount: U256,
        category: String,
        location: String,
    ) -> SpendOutcome {
        Self::execute_spend(
            env,
            beneficiary,
            transfer_id,
            merchant_id,
            amount,
            category,
            location,
        )
    }

    /// Retrieve the most recent structured outcome for `transfer_id` (#141).
    pub fn get_last_spend_outcome(env: Env, transfer_id: String) -> Option<SpendOutcome> {
        let key = Symbol::new(&env, "spend_outcomes");
        let outcomes: Map<String, SpendOutcome> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Map::new(&env));
        outcomes.get(transfer_id)
    }

    fn record_outcome(env: &Env, transfer_id: &String, outcome: &SpendOutcome) {
        let key = Symbol::new(env, "spend_outcomes");
        let mut outcomes: Map<String, SpendOutcome> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Map::new(env));
        outcomes.set(transfer_id.clone(), outcome.clone());
        env.storage().instance().set(&key, &outcomes);
    }

    fn execute_spend(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        amount: U256,
        category: String,
        location: String,
    ) -> SpendOutcome {
        beneficiary.require_auth();

        // #239 — spending is the primary path a pause must stop.
        require_not_paused(&env);

        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => {
                let outcome = SpendOutcome {
                    approved: false,
                    reason_code: String::from_str(&env, "TRANSFER_NOT_FOUND"),
                    reason: String::from_str(&env, "Transfer not found"),
                };
                Self::record_outcome(&env, &transfer_id, &outcome);
                return outcome;
            }
        };

        if transfer.recalled {
            let outcome = SpendOutcome {
                approved: false,
                reason_code: String::from_str(&env, "TRANSFER_RECALLED"),
                reason: String::from_str(&env, "Transfer already recalled"),
            };
            Self::record_outcome(&env, &transfer_id, &outcome);
            return outcome;
        }

        if !transfer.is_active {
            let outcome = SpendOutcome {
                approved: false,
                reason_code: String::from_str(&env, "TRANSFER_INACTIVE"),
                reason: String::from_str(&env, "Transfer is not active"),
            };
            Self::record_outcome(&env, &transfer_id, &outcome);
            return outcome;
        }

        if env.ledger().timestamp() > transfer.expires_at {
            let outcome = SpendOutcome {
                approved: false,
                reason_code: String::from_str(&env, "TRANSFER_EXPIRED"),
                reason: String::from_str(&env, "Transfer has expired"),
            };
            Self::record_outcome(&env, &transfer_id, &outcome);
            return outcome;
        }

        if amount <= U256::from_u64(0) {
            let outcome = SpendOutcome {
                approved: false,
                reason_code: String::from_str(&env, "INVALID_AMOUNT"),
                reason: String::from_str(&env, "Spend amount must be greater than zero"),
            };
            Self::record_outcome(&env, &transfer_id, &outcome);
            return outcome;
        }

        if amount > transfer.remaining_amount {
            let outcome = SpendOutcome {
                approved: false,
                reason_code: String::from_str(&env, "INSUFFICIENT_BALANCE"),
                reason: String::from_str(&env, "Insufficient remaining balance"),
            };
            Self::record_outcome(&env, &transfer_id, &outcome);
            return outcome;
        }

        // Validate spending rules (#140, #141, #142, #146)
        let (is_approved, reason_code, rejection_reason) = Self::validate_spending_rules(
            &env,
            &transfer,
            amount.clone(),
            &merchant_id,
            &category,
            &location,
        );

        let transaction_id = generate_cash_transfer_txn_id(&env, &transfer_id);
        let transaction = Transaction {
            id: transaction_id.clone(),
            transfer_id: transfer_id.clone(),
            merchant_id: merchant_id.clone(),
            amount: amount.clone(),
            category: category.clone(),
            timestamp: env.ledger().timestamp(),
            location: location.clone(),
            is_approved,
            rejection_reason: rejection_reason.clone(),
        };

        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let mut transactions: Map<String, Transaction> = env
            .storage()
            .instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        transactions.set(transaction_id, transaction);
        env.storage().instance().set(&transactions_key, &transactions);

        let outcome = SpendOutcome {
            approved: is_approved,
            reason_code,
            reason: rejection_reason,
        };
        Self::record_outcome(&env, &transfer_id, &outcome);

        if is_approved {
            transfer.spent_amount += amount.clone();
            transfer.remaining_amount -= amount.clone();

            // Persist cumulative `current_usage` consistently across every matching rule type (#140)
            let mut updated_rules = Vec::new(&env);
            let mut rules_checked = 0u32;
            for mut rule in transfer.spending_rules.iter() {
                if rules_checked < MAX_SPENDING_RULES_CHECK {
                    rules_checked += 1;
                    if rule_matches_spend(&env, &rule, &merchant_id, &category, &location) {
                        rule.current_usage += amount.clone();
                    }
                }
                updated_rules.push_back(rule);
            }
            transfer.spending_rules = updated_rules;

            transfers.set(transfer_id.clone(), transfer);
            env.storage().instance().set(&transfers_key, &transfers);

            env.events().publish(
                (Symbol::new(&env, "cash_transfer"), Symbol::new(&env, "transfer_spent")),
                (transfer_id, merchant_id, amount),
            );
        }

        outcome
    }

    /// Validate spending against rules (bounded iteration for performance) (#140-#142, #146).
    fn validate_spending_rules(
        env: &Env,
        transfer: &ConditionalTransfer,
        amount: U256,
        merchant_id: &String,
        category: &String,
        location: &String,
    ) -> (bool, String, String) {
        let zero = U256::from_u64(0);
        let mut rules_checked = 0u32;
        for rule in transfer.spending_rules.iter() {
            if rules_checked >= MAX_SPENDING_RULES_CHECK {
                break;
            }
            rules_checked += 1;

            match rule.rule_type.to_string().as_str() {
                "category_limit" => {
                    if let Some(rule_category) = rule.parameters.get(String::from_str(env, "category")) {
                        if rule_category == *category && rule.current_usage.clone() + amount.clone() > rule.limit {
                            return (
                                false,
                                String::from_str(env, "RULE_CATEGORY_LIMIT"),
                                String::from_str(env, "Category limit exceeded"),
                            );
                        }
                    }
                }
                "merchant_whitelist" => {
                    if !rule_matches_merchant(env, &rule, merchant_id) {
                        return (
                            false,
                            String::from_str(env, "RULE_MERCHANT_WHITELIST"),
                            String::from_str(env, "Merchant not allowed"),
                        );
                    }
                    if rule.limit > zero && rule.current_usage.clone() + amount.clone() > rule.limit {
                        return (
                            false,
                            String::from_str(env, "RULE_MERCHANT_WHITELIST"),
                            String::from_str(env, "Merchant whitelist spend limit exceeded"),
                        );
                    }
                }
                "time_window" => {
                    let start_opt = rule
                        .parameters
                        .get(String::from_str(env, "start_time"))
                        .and_then(|s| parse_strict_u64(&s.to_string()));
                    let end_opt = rule
                        .parameters
                        .get(String::from_str(env, "end_time"))
                        .and_then(|s| parse_strict_u64(&s.to_string()));
                    match (start_opt, end_opt) {
                        (Some(start), Some(end)) if start <= end => {
                            let current_time = env.ledger().timestamp();
                            if current_time < start || current_time > end {
                                return (
                                    false,
                                    String::from_str(env, "RULE_TIME_WINDOW"),
                                    String::from_str(env, "Outside allowed time window"),
                                );
                            }
                            if rule.limit > zero && rule.current_usage.clone() + amount.clone() > rule.limit {
                                return (
                                    false,
                                    String::from_str(env, "RULE_TIME_WINDOW"),
                                    String::from_str(env, "Time window spend limit exceeded"),
                                );
                            }
                        }
                        _ => {
                            return (
                                false,
                                String::from_str(env, "RULE_TIME_WINDOW"),
                                String::from_str(env, "Invalid time window configuration"),
                            );
                        }
                    }
                }
                "location_based" => {
                    if let Some(allowed_location) = rule.parameters.get(String::from_str(env, "location")) {
                        if allowed_location != *location {
                            return (
                                false,
                                String::from_str(env, "RULE_LOCATION"),
                                String::from_str(env, "Location not allowed"),
                            );
                        }
                        if rule.limit > zero && rule.current_usage.clone() + amount.clone() > rule.limit {
                            return (
                                false,
                                String::from_str(env, "RULE_LOCATION"),
                                String::from_str(env, "Location spend limit exceeded"),
                            );
                        }
                    }
                }
                _ => {}
            }
        }

        (true, String::from_str(env, "APPROVED"), String::from_str(env, ""))
    }

    /// Get transfer details
    pub fn get_transfer(env: Env, transfer_id: String) -> Option<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        transfers.get(transfer_id)
    }

    /// Get transaction history for a transfer (bounded results)
    pub fn get_transactions(env: Env, transfer_id: String) -> Vec<Transaction> {
        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let transactions: Map<String, Transaction> = env
            .storage()
            .instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        let mut count = 0u32;

        for (_, transaction) in transactions.iter() {
            if count >= MAX_TRANSACTION_HISTORY {
                break;
            }
            result.push_back(transaction);
            count += 1;
        }
        result
    }

    /// Recall unspent funds after expiry (idempotent: emits at most one recall event) (#143).
    pub fn recall_funds(env: Env, creator: Address, transfer_id: String) -> U256 {
        creator.require_auth();

        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => return U256::from_u64(0),
        };

        if transfer.creator != creator {
            panic!("Unauthorized: caller is not the transfer creator");
        }

        // Idempotent guard: if already recalled/deactivated or balance exhausted, return 0 with no duplicate event (#143)
        if transfer.recalled || !transfer.is_active || transfer.remaining_amount == U256::from_u64(0) {
            return U256::from_u64(0);
        }

        // Check if transfer is expired
        if env.ledger().timestamp() <= transfer.expires_at {
            return U256::from_u64(0);
        }

        let recall_amount = transfer.remaining_amount.clone();

        // Mark recalled and zero out remaining balance
        transfer.is_active = false;
        transfer.recalled = true;
        transfer.recalled_at = Some(env.ledger().timestamp());
        transfer.remaining_amount = U256::from_u64(0);
        transfers.set(transfer_id.clone(), transfer);
        env.storage().instance().set(&transfers_key, &transfers);

        env.events().publish(
            (Symbol::new(&env, "cash_transfer"), Symbol::new(&env, "funds_recalled")),
            (transfer_id, creator, recall_amount.clone()),
        );

        recall_amount
    }

    /// List active transfers for a beneficiary (bounded results)
    pub fn list_beneficiary_transfers(env: Env, beneficiary_id: String) -> Vec<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let mut result = Vec::new(&env);
        let mut count = 0u32;

        for (_, transfer) in transfers.iter() {
            if count >= MAX_BENEFICIARY_TRANSFERS {
                break;
            }
            if transfer.beneficiary_id == beneficiary_id && transfer.is_active {
                result.push_back(transfer);
                count += 1;
            }
        }
        result
    }

    /// Extend transfer expiry with policy validation and audit event (#144).
    ///
    /// Enforces creator ownership, active non-recalled state, positive remaining balance,
    /// strictly later `new_expiry > transfer.expires_at` and `new_expiry > ledger_timestamp`,
    /// and strict time-window compatibility when `"strict_expiry" == "true"`.
    pub fn extend_expiry(
        env: Env,
        creator: Address,
        transfer_id: String,
        new_expiry: u64,
    ) {
        creator.require_auth();

        // #239 — gated with the rest of value-moving paths
        require_not_paused(&env);

        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => panic!("Transfer not found"),
        };

        if transfer.creator != creator {
            panic!("Unauthorized: caller is not the transfer creator");
        }
        if transfer.recalled || !transfer.is_active {
            panic!("Cannot extend inactive or recalled transfer");
        }
        if transfer.remaining_amount == U256::from_u64(0) {
            panic!("Cannot extend exhausted transfer");
        }
        if new_expiry <= transfer.expires_at || new_expiry <= env.ledger().timestamp() {
            panic!("Invalid expiry extension: new_expiry must exceed current expiry and timestamp");
        }

        for rule in transfer.spending_rules.iter() {
            if rule.rule_type == String::from_str(&env, "time_window") {
                if let Some(strict) = rule.parameters.get(String::from_str(&env, "strict_expiry")) {
                    if strict == String::from_str(&env, "true") {
                        if let Some(end) = rule
                            .parameters
                            .get(String::from_str(&env, "end_time"))
                            .and_then(|s| parse_strict_u64(&s.to_string()))
                        {
                            if new_expiry > end {
                                panic!("Expiry extension violates strict time_window policy");
                            }
                        }
                    }
                }
            }
        }

        let old_expiry = transfer.expires_at;
        transfer.expires_at = new_expiry;
        transfers.set(transfer_id.clone(), transfer);
        env.storage().instance().set(&transfers_key, &transfers);

        env.events().publish(
            (Symbol::new(&env, "cash_transfer"), Symbol::new(&env, "expiry_extended")),
            (transfer_id, old_expiry, new_expiry),
        );
    }

    /// Cleanup expired transfers (bounded scan for performance)
    pub fn cleanup_expired_transfers(env: Env) {
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let current_time = env.ledger().timestamp();
        let mut scanned = 0u32;

        for (transfer_id, mut transfer) in transfers.iter() {
            if scanned >= MAX_CLEANUP_SCAN {
                break;
            }
            scanned += 1;

            if current_time > transfer.expires_at && transfer.is_active {
                transfer.is_active = false;
                transfers.set(transfer_id, transfer);
            }
        }

        env.storage().instance().set(&transfers_key, &transfers);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn test_rule_usage_tracking_across_rule_types_and_outcomes() {
        let env = Env::default();
        env.mock_all_auths();
        let client = CashTransferClient::new(&env, &env.register(CashTransfer, ()));
        let creator = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        let mut cat_p = Map::new(&env);
        cat_p.set(String::from_str(&env, "category"), String::from_str(&env, "food"));
        let mut mer_p = Map::new(&env);
        mer_p.set(String::from_str(&env, "merchant"), String::from_str(&env, "mer_allowed"));
        let mut win_p = Map::new(&env);
        win_p.set(String::from_str(&env, "start_time"), String::from_str(&env, "10"));
        win_p.set(String::from_str(&env, "end_time"), String::from_str(&env, "1000"));
        let mut loc_p = Map::new(&env);
        loc_p.set(String::from_str(&env, "location"), String::from_str(&env, "Camp A"));

        let rules = Vec::from_array(
            &env,
            [
                SpendingRule {
                    rule_type: String::from_str(&env, "category_limit"),
                    parameters: cat_p,
                    limit: U256::from_u64(500),
                    current_usage: U256::from_u64(0),
                },
                SpendingRule {
                    rule_type: String::from_str(&env, "merchant_whitelist"),
                    parameters: mer_p,
                    limit: U256::from_u64(400),
                    current_usage: U256::from_u64(0),
                },
                SpendingRule {
                    rule_type: String::from_str(&env, "time_window"),
                    parameters: win_p,
                    limit: U256::from_u64(0),
                    current_usage: U256::from_u64(0),
                },
                SpendingRule {
                    rule_type: String::from_str(&env, "location_based"),
                    parameters: loc_p,
                    limit: U256::from_u64(0),
                    current_usage: U256::from_u64(0),
                },
            ],
        );

        env.ledger().with_mut(|l| l.timestamp = 50);
        client.create_transfer(
            &creator,
            &String::from_str(&env, "tr_all"),
            &String::from_str(&env, "ben_1"),
            &U256::from_u64(1000),
            &String::from_str(&env, "USDC"),
            &500u64,
            &rules,
            &String::from_str(&env, "aid"),
        );

        let ok = client.spend_with_outcome(
            &beneficiary,
            &String::from_str(&env, "tr_all"),
            &String::from_str(&env, "mer_allowed"),
            &U256::from_u64(250),
            &String::from_str(&env, "food"),
            &String::from_str(&env, "Camp A"),
        );
        assert!(ok.approved);
        assert_eq!(ok.reason_code, String::from_str(&env, "APPROVED"));

        // Verify persisted usage updated on ALL four rule types (#140)
        let saved = client.get_transfer(&String::from_str(&env, "tr_all")).unwrap();
        for rule in saved.spending_rules.iter() {
            assert_eq!(rule.current_usage, U256::from_u64(250));
        }

        // Disallowed merchant emits structured failure outcome (#141)
        let denied = client.spend_with_outcome(
            &beneficiary,
            &String::from_str(&env, "tr_all"),
            &String::from_str(&env, "mer_rogue"),
            &U256::from_u64(50),
            &String::from_str(&env, "food"),
            &String::from_str(&env, "Camp A"),
        );
        assert!(!denied.approved);
        assert_eq!(denied.reason_code, String::from_str(&env, "RULE_MERCHANT_WHITELIST"));
        assert_eq!(
            client.get_last_spend_outcome(&String::from_str(&env, "tr_all")).unwrap().reason_code,
            String::from_str(&env, "RULE_MERCHANT_WHITELIST")
        );
    }

    #[test]
    fn test_recall_idempotency() {
        let env = Env::default();
        env.mock_all_auths();
        let client = CashTransferClient::new(&env, &env.register(CashTransfer, ()));
        let creator = Address::generate(&env);

        client.create_transfer(
            &creator,
            &String::from_str(&env, "tr_rec"),
            &String::from_str(&env, "ben_rec"),
            &U256::from_u64(400),
            &String::from_str(&env, "XLM"),
            &100u64,
            &Vec::new(&env),
            &String::from_str(&env, "aid"),
        );

        env.ledger().with_mut(|l| l.timestamp = 200);
        assert_eq!(client.recall_funds(&creator, &String::from_str(&env, "tr_rec")), U256::from_u64(400));
        // Second call is idempotent -> returns 0 (#143)
        assert_eq!(client.recall_funds(&creator, &String::from_str(&env, "tr_rec")), U256::from_u64(0));
        let stored = client.get_transfer(&String::from_str(&env, "tr_rec")).unwrap();
        assert!(stored.recalled);
        assert!(!stored.is_active);
    }

    #[test]
    #[should_panic(expected = "Unsupported token identifier")]
    fn test_rejects_unsupported_token() {
        let env = Env::default();
        env.mock_all_auths();
        let client = CashTransferClient::new(&env, &env.register(CashTransfer, ()));
        let creator = Address::generate(&env);

        client.create_transfer(
            &creator,
            &String::from_str(&env, "tr_tok"),
            &String::from_str(&env, "ben_1"),
            &U256::from_u64(100),
            &String::from_str(&env, "INVALID_TOK"),
            &1000u64,
            &Vec::new(&env),
            &String::from_str(&env, "aid"),
        );
    }

    #[test]
    #[should_panic(expected = "Invalid time_window schema")]
    fn test_rejects_malformed_time_window_on_creation() {
        let env = Env::default();
        env.mock_all_auths();
        let client = CashTransferClient::new(&env, &env.register(CashTransfer, ()));
        let creator = Address::generate(&env);

        let mut bad_p = Map::new(&env);
        bad_p.set(String::from_str(&env, "start_time"), String::from_str(&env, "not_a_number"));
        bad_p.set(String::from_str(&env, "end_time"), String::from_str(&env, "500"));

        let rules = Vec::from_array(
            &env,
            [SpendingRule {
                rule_type: String::from_str(&env, "time_window"),
                parameters: bad_p,
                limit: U256::from_u64(0),
                current_usage: U256::from_u64(0),
            }],
        );

        client.create_transfer(
            &creator,
            &String::from_str(&env, "tr_tw"),
            &String::from_str(&env, "ben_1"),
            &U256::from_u64(100),
            &String::from_str(&env, "USDC"),
            &1000u64,
            &rules,
            &String::from_str(&env, "aid"),
        );
    }

    #[test]
    #[should_panic(expected = "Expiry extension violates strict time_window policy")]
    fn test_extend_expiry_respects_strict_window_policy() {
        let env = Env::default();
        env.mock_all_auths();
        let client = CashTransferClient::new(&env, &env.register(CashTransfer, ()));
        let creator = Address::generate(&env);

        let mut win_p = Map::new(&env);
        win_p.set(String::from_str(&env, "start_time"), String::from_str(&env, "10"));
        win_p.set(String::from_str(&env, "end_time"), String::from_str(&env, "500"));
        win_p.set(String::from_str(&env, "strict_expiry"), String::from_str(&env, "true"));

        let rules = Vec::from_array(
            &env,
            [SpendingRule {
                rule_type: String::from_str(&env, "time_window"),
                parameters: win_p,
                limit: U256::from_u64(0),
                current_usage: U256::from_u64(0),
            }],
        );

        client.create_transfer(
            &creator,
            &String::from_str(&env, "tr_ext"),
            &String::from_str(&env, "ben_1"),
            &U256::from_u64(200),
            &String::from_str(&env, "USDC"),
            &400u64,
            &rules,
            &String::from_str(&env, "aid"),
        );

        client.extend_expiry(&creator, &String::from_str(&env, "tr_ext"), &800u64);
    }
}
