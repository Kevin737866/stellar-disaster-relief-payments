use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol, U256, Vec};

#[contract]
pub struct CashTransfer;

#[contracttype]
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

#[contracttype]
#[derive(Clone)]
pub struct SpendingRule {
    pub rule_type: String,
    pub parameters: Map<String, String>,
    pub limit: U256,
    pub current_usage: U256,
}

#[contracttype]
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

        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        if transfers.contains_key(transfer_id.clone()) {
            panic!("transfer exists");
        }

        let transfer = ConditionalTransfer {
            id: transfer_id.clone(),
            beneficiary_id,
            amount: amount.clone(),
            token,
            created_at: env.ledger().timestamp(),
            expires_at,
            spending_rules,
            is_active: true,
            spent_amount: U256::from_u32(&env, 0),
            remaining_amount: amount.clone(),
            creator,
            purpose,
        };

        transfers.set(transfer_id.clone(), transfer);
        env.storage().instance().set(&transfers_key, &transfers);

        let tx_key = Symbol::new(&env, "transfer_transactions");
        let mut txs_by_transfer: Map<String, Vec<Transaction>> = env
            .storage()
            .instance()
            .get(&tx_key)
            .unwrap_or(Map::new(&env));
        txs_by_transfer.set(transfer_id, Vec::new(&env));
        env.storage().instance().set(&tx_key, &txs_by_transfer);
    }

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
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let mut transfer = match transfers.get(transfer_id.clone()) {
            Some(t) => t,
            None => return false,
        };

        if !transfer.is_active || env.ledger().timestamp() > transfer.expires_at {
            return false;
        }
        if amount > transfer.remaining_amount {
            return false;
        }

        let (is_approved, rejection_reason) =
            Self::validate_spending_rules(&env, &transfer, &amount, &category, &location);

        let tx = Transaction {
            id: String::from_str(&env, "txn"),
            transfer_id: transfer_id.clone(),
            merchant_id,
            amount: amount.clone(),
            category,
            timestamp: env.ledger().timestamp(),
            location,
            is_approved,
            rejection_reason,
        };

        let tx_key = Symbol::new(&env, "transfer_transactions");
        let mut txs_by_transfer: Map<String, Vec<Transaction>> = env
            .storage()
            .instance()
            .get(&tx_key)
            .unwrap_or(Map::new(&env));
        let mut txs = txs_by_transfer
            .get(transfer_id.clone())
            .unwrap_or(Vec::new(&env));
        txs.push_back(tx);
        txs_by_transfer.set(transfer_id.clone(), txs);
        env.storage().instance().set(&tx_key, &txs_by_transfer);

        if is_approved {
            transfer.spent_amount = transfer.spent_amount.add(&amount);
            transfer.remaining_amount = transfer.remaining_amount.sub(&amount);
            transfers.set(transfer_id, transfer);
            env.storage().instance().set(&transfers_key, &transfers);
            true
        } else {
            false
        }
    }

    fn validate_spending_rules(
        env: &Env,
        transfer: &ConditionalTransfer,
        amount: &U256,
        category: &String,
        location: &String,
    ) -> (bool, String) {
        for rule in transfer.spending_rules.iter() {
            if rule.rule_type == String::from_str(env, "category_limit") {
                if let Some(rule_category) = rule.parameters.get(String::from_str(env, "category")) {
                    if rule_category == *category && rule.current_usage.add(amount) > rule.limit {
                        return (false, String::from_str(env, "Category limit exceeded"));
                    }
                }
            }
            if rule.rule_type == String::from_str(env, "location_based") {
                if let Some(allowed_location) = rule.parameters.get(String::from_str(env, "location")) {
                    if allowed_location != *location {
                        return (false, String::from_str(env, "Location not allowed"));
                    }
                }
            }
        }
        (true, String::from_str(env, ""))
    }

    pub fn get_transfer(env: Env, transfer_id: String) -> Option<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));
        transfers.get(transfer_id)
    }

    pub fn get_transactions(env: Env, transfer_id: String) -> Vec<Transaction> {
        let tx_key = Symbol::new(&env, "transfer_transactions");
        let txs_by_transfer: Map<String, Vec<Transaction>> = env
            .storage()
            .instance()
            .get(&tx_key)
            .unwrap_or(Map::new(&env));
        txs_by_transfer.get(transfer_id).unwrap_or(Vec::new(&env))
    }

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
            None => return U256::from_u32(&env, 0),
        };

        if env.ledger().timestamp() <= transfer.expires_at {
            return U256::from_u32(&env, 0);
        }

        let recall_amount = transfer.remaining_amount.clone();
        transfer.is_active = false;
        transfers.set(transfer_id, transfer);
        env.storage().instance().set(&transfers_key, &transfers);

        recall_amount
    }

    pub fn list_beneficiary_transfers(env: Env, beneficiary_id: String) -> Vec<ConditionalTransfer> {
        let transfers_key = Symbol::new(&env, "transfers");
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
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

    pub fn extend_expiry(env: Env, creator: Address, transfer_id: String, new_expiry: u64) {
        creator.require_auth();

        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
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

    pub fn cleanup_expired_transfers(env: Env) {
        let transfers_key = Symbol::new(&env, "transfers");
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .instance()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        for (transfer_id, mut transfer) in transfers.iter() {
            if now > transfer.expires_at && transfer.is_active {
                transfer.is_active = false;
                transfers.set(transfer_id, transfer);
            }
        }

        env.storage().instance().set(&transfers_key, &transfers);
    }
}
