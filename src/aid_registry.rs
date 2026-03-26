use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol, U256, Vec};

#[contract]
pub struct AidRegistry;

#[contracttype]
#[derive(Clone)]
pub struct EmergencyFund {
    pub id: String,
    pub name: String,
    pub description: String,
    pub total_amount: U256,
    pub released_amount: U256,
    pub created_at: u64,
    pub expires_at: u64,
    pub disaster_type: String,
    pub geographic_scope: String,
    pub is_active: bool,
    pub release_triggers: Vec<Address>,
    pub required_signatures: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct DisbursementRecord {
    pub id: String,
    pub fund_id: String,
    pub beneficiary: Address,
    pub amount: U256,
    pub timestamp: u64,
    pub purpose: String,
    pub approved_by: Vec<Address>,
    pub transaction_hash: String,
}

#[contractimpl]
impl AidRegistry {
    pub fn create_fund(
        env: Env,
        admin: Address,
        fund_id: String,
        name: String,
        description: String,
        total_amount: U256,
        disaster_type: String,
        geographic_scope: String,
        expires_at: u64,
        release_triggers: Vec<Address>,
        required_signatures: u32,
    ) {
        admin.require_auth();

        let fund = EmergencyFund {
            id: fund_id.clone(),
            name,
            description,
            total_amount,
            released_amount: U256::from_u32(&env, 0),
            created_at: env.ledger().timestamp(),
            expires_at,
            disaster_type,
            geographic_scope,
            is_active: true,
            release_triggers,
            required_signatures,
        };

        let fund_key = Symbol::new(&env, "funds");
        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    pub fn get_fund(env: Env, fund_id: String) -> Option<EmergencyFund> {
        let fund_key = Symbol::new(&env, "funds");
        let funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        funds.get(fund_id)
    }

    pub fn list_active_funds(env: Env) -> Vec<EmergencyFund> {
        let fund_key = Symbol::new(&env, "funds");
        let funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let mut active = Vec::new(&env);
        for (_, fund) in funds.iter() {
            if fund.is_active {
                active.push_back(fund);
            }
        }
        active
    }

    pub fn submit_disbursement(
        env: Env,
        requester: Address,
        fund_id: String,
        beneficiary: Address,
        amount: U256,
        purpose: String,
        approvers: Vec<Address>,
    ) {
        requester.require_auth();

        let fund_key = Symbol::new(&env, "funds");
        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let mut fund = funds.get(fund_id.clone()).unwrap_or_else(|| panic!("fund not found"));
        if !fund.is_active {
            panic!("fund inactive");
        }
        if fund.released_amount.add(&amount) > fund.total_amount {
            panic!("insufficient fund balance");
        }
        if approvers.len() < fund.required_signatures {
            panic!("insufficient signatures");
        }

        for approver in approvers.iter() {
            if !fund.release_triggers.contains(approver.clone()) {
                panic!("unauthorized approver");
            }
        }

        let record = DisbursementRecord {
            id: String::from_str(&env, "disbursement"),
            fund_id: fund_id.clone(),
            beneficiary,
            amount: amount.clone(),
            timestamp: env.ledger().timestamp(),
            purpose,
            approved_by: approvers,
            transaction_hash: String::from_str(&env, ""),
        };

        let disb_key = Symbol::new(&env, "disbursements");
        let mut disbursements: Map<String, Vec<DisbursementRecord>> = env
            .storage()
            .instance()
            .get(&disb_key)
            .unwrap_or(Map::new(&env));

        let mut fund_records = disbursements
            .get(fund_id.clone())
            .unwrap_or(Vec::new(&env));
        fund_records.push_back(record);
        disbursements.set(fund_id.clone(), fund_records);
        env.storage().instance().set(&disb_key, &disbursements);

        fund.released_amount = fund.released_amount.add(&amount);
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    pub fn get_disbursements(env: Env, fund_id: String) -> Vec<DisbursementRecord> {
        let disb_key = Symbol::new(&env, "disbursements");
        let disbursements: Map<String, Vec<DisbursementRecord>> = env
            .storage()
            .instance()
            .get(&disb_key)
            .unwrap_or(Map::new(&env));
        disbursements.get(fund_id).unwrap_or(Vec::new(&env))
    }

    pub fn cleanup_expired_funds(env: Env) {
        let fund_key = Symbol::new(&env, "funds");
        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        for (id, mut fund) in funds.iter() {
            if now > fund.expires_at && fund.is_active {
                fund.is_active = false;
                funds.set(id, fund);
            }
        }

        env.storage().instance().set(&fund_key, &funds);
    }
}
