use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};
use crate::unique_id::*;

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

#[contractimpl]
impl CashTransfer {
    /// Create a conditional cash transfer
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
        
        // Check for duplicate transfer
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        if transfers.contains_key(transfer_id.clone()) {
            panic_with_error!(&env, "Transfer already exists");
        }
        
        // Create conditional transfer
        let transfer = ConditionalTransfer {
            id: transfer_id.clone(),
            beneficiary_id,
            amount,
            token,
            created_at: env.ledger().timestamp(),
            expires_at,
            spending_rules,
            is_active: true,
            spent_amount: U256::from_u64(0),
            remaining_amount: amount,
            creator,
            purpose,
        };
        
        transfers.set(transfer_id.clone(), transfer);
        env.storage().instance().set(&transfers_key, &transfers);
        
        // Initialize transaction history
        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let transactions: Map<String, Transaction> = Map::new(&env);
        env.storage().instance().set(&transactions_key, &transactions);
    }

    /// Attempt to spend from conditional transfer
    pub fn spend(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        amount: U256,
        category: String,
        location: String,
    ) -> bool {
        beneficiary.require_auth();
        
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => return false,
        };
        
        // Check if transfer is active and not expired
        if !transfer.is_active || env.ledger().timestamp() > transfer.expires_at {
            return false;
        }
        
        // Check sufficient remaining balance
        if amount > transfer.remaining_amount {
            return false;
        }
        
        // Validate spending rules
        let (is_approved, rejection_reason) = Self::validate_spending_rules(&env, &transfer, amount, &category, &location);
        
        // Create transaction record
        let transaction_id = generate_cash_transfer_txn_id(&env, &transfer_id);
        let transaction = Transaction {
            id: transaction_id.clone(),
            transfer_id: transfer_id.clone(),
            merchant_id,
            amount,
            category,
            timestamp: env.ledger().timestamp(),
            location,
            is_approved,
            rejection_reason,
        };
        
        // Store transaction
        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let mut transactions: Map<String, Transaction> = env.storage().instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));
        
        transactions.set(transaction_id, transaction);
        env.storage().instance().set(&transactions_key, &transactions);
        
        if is_approved {
            // Update transfer state
            transfer.spent_amount += amount;
            transfer.remaining_amount -= amount;
            
            // Update spending rule usage
            for mut rule in transfer.spending_rules.iter() {
                if rule.rule_type == "category_limit" {
                    if let Some(rule_category) = rule.parameters.get(&String::from_str(&env, "category")) {
                        if rule_category == &category {
                            rule.current_usage += amount;
                        }
                    }
                }
            }
            
            transfers.set(transfer_id, transfer);
            env.storage().instance().set(&transfers_key, &transfers);
            
            true
        } else {
            false
        }
    }

    /// Validate spending against rules
    fn validate_spending_rules(
        env: &Env,
        transfer: &ConditionalTransfer,
        amount: U256,
        category: &String,
        location: &String,
    ) -> (bool, String) {
        for rule in transfer.spending_rules.iter() {
            match rule.rule_type.to_string().as_str() {
                "category_limit" => {
                    if let Some(rule_category) = rule.parameters.get(&String::from_str(env, "category")) {
                        if rule_category == category {
                            if rule.current_usage + amount > rule.limit {
                                return (false, String::from_str(env, "Category limit exceeded"));
                            }
                        }
                    }
                }
                "merchant_whitelist" => {
                    // In production, check if merchant is in whitelist
                    // For now, assume all merchants are allowed
                }
                "time_window" => {
                    if let Some(start_time) = rule.parameters.get(&String::from_str(env, "start_time")) {
                        if let Some(end_time) = rule.parameters.get(&String::from_str(env, "end_time")) {
                            let current_time = env.ledger().timestamp();
                            let start = start_time.clone().to_string().parse::<u64>().unwrap_or(0);
                            let end = end_time.clone().to_string().parse::<u64>().unwrap_or(u64::MAX);
                            if current_time < start || current_time > end {
                                return (false, String::from_str(env, "Outside allowed time window"));
                            }
                        }
                    }
                }
                "location_based" => {
                    if let Some(allowed_location) = rule.parameters.get(&String::from_str(env, "location")) {
                        if allowed_location != location {
                            return (false, String::from_str(env, "Location not allowed"));
                        }
                    }
                }
                _ => {}
            }
        }
        
        (true, String::from_str(env, ""))
    }

    /// Get transfer details
    pub fn get_transfer(env: Env, transfer_id: String) -> Option<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        transfers.get(transfer_id)
    }

    /// Get transaction history for a transfer
    pub fn get_transactions(env: Env, transfer_id: String) -> Vec<Transaction> {
        let transactions_key = Symbol::new(&env, &format!("transactions_{}", transfer_id));
        let transactions: Map<String, Transaction> = env.storage().instance()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, transaction) in transactions.iter() {
            result.push_back(transaction);
        }
        result
    }

    /// Recall unspent funds after expiry
    pub fn recall_funds(env: Env, creator: Address, transfer_id: String) -> U256 {
        creator.require_auth();
        
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => return U256::from_u64(0),
        };
        
        // Check if transfer is expired
        if env.ledger().timestamp() <= transfer.expires_at {
            return U256::from_u64(0);
        }
        
        let recall_amount = transfer.remaining_amount;
        
        // Deactivate transfer
        transfer.is_active = false;
        transfers.set(transfer_id, transfer);
        env.storage().instance().set(&transfers_key, &transfers);
        
        recall_amount
    }

    /// List active transfers for a beneficiary
    pub fn list_beneficiary_transfers(env: Env, beneficiary_id: String) -> Vec<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, transfer) in transfers.iter() {
            if transfer.beneficiary_id == beneficiary_id && transfer.is_active {
                result.push_back(transfer);
            }
        }
        result
    }

    /// Extend transfer expiry (for ongoing relief operations)
    pub fn extend_expiry(
        env: Env,
        creator: Address,
        transfer_id: String,
        new_expiry: u64,
    ) {
        creator.require_auth();
        
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut transfer) = transfers.get(transfer_id.clone()) {
            if transfer.creator == creator {
                transfer.expires_at = new_expiry;
                transfers.set(transfer_id, transfer);
                env.storage().instance().set(&transfers_key, &transfers);
            }
        }
    }

    /// Cleanup expired transfers
    pub fn cleanup_expired_transfers(env: Env) {
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env.storage().instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        
        let current_time = env.ledger().timestamp();
        
        for (transfer_id, mut transfer) in transfers.iter() {
            if current_time > transfer.expires_at && transfer.is_active {
                transfer.is_active = false;
                transfers.set(transfer_id, transfer);
            }
        }
        
        env.storage().instance().set(&transfers_key, &transfers);
    }
}
