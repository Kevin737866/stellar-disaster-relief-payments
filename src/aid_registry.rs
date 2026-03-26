use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Vec};

#[contract]
pub struct AidRegistry;

#[contracttype]
#[derive(Clone)]
pub struct EmergencyFund {
    pub id: String,
    pub name: String,
    pub description: String,
    pub total_amount: i128,
    pub released_amount: i128,
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
    pub beneficiary: String,
    pub amount: i128,
    pub timestamp: u64,
    pub purpose: String,
    pub approved_by: Vec<String>,
    pub transaction_hash: String,
}

#[contracttype]
#[derive(Clone)]
pub struct CreateFundInput {
    pub name: String,
    pub description: String,
    pub total_amount: i128,
    pub disaster_type: String,
    pub geographic_scope: String,
    pub expires_at: u64,
    pub release_triggers: Vec<Address>,
    pub required_signatures: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum AidKey {
    Funds,
    Disbursements,
}

#[contractimpl]
impl AidRegistry {
    pub fn create_fund(env: Env, admin: Address, fund_id: String, input: CreateFundInput) {
        admin.require_auth();

        if input.total_amount <= 0 {
            panic!("invalid amount");
        }

        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&AidKey::Funds)
            .unwrap_or(Map::new(&env));

        if funds.contains_key(fund_id.clone()) {
            panic!("fund exists");
        }

        funds.set(
            fund_id.clone(),
            EmergencyFund {
                id: fund_id,
                name: input.name,
                description: input.description,
                total_amount: input.total_amount,
                released_amount: 0,
                created_at: env.ledger().timestamp(),
                expires_at: input.expires_at,
                disaster_type: input.disaster_type,
                geographic_scope: input.geographic_scope,
                is_active: true,
                release_triggers: input.release_triggers,
                required_signatures: input.required_signatures,
            },
        );

        env.storage().instance().set(&AidKey::Funds, &funds);
    }

    pub fn submit_disbursement(
        env: Env,
        requester: Address,
        fund_id: String,
        beneficiary: String,
        amount: i128,
        purpose: String,
        approvers: Vec<String>,
    ) -> bool {
        requester.require_auth();

        if amount <= 0 {
            return false;
        }

        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&AidKey::Funds)
            .unwrap_or(Map::new(&env));

        let mut fund = match funds.get(fund_id.clone()) {
            Some(v) => v,
            None => return false,
        };

        if !fund.is_active || env.ledger().timestamp() > fund.expires_at {
            return false;
        }

        if fund.released_amount + amount > fund.total_amount {
            return false;
        }

        fund.released_amount += amount;
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&AidKey::Funds, &funds);

        let mut records: Map<String, Vec<DisbursementRecord>> = env
            .storage()
            .instance()
            .get(&AidKey::Disbursements)
            .unwrap_or(Map::new(&env));

        let mut fund_records = records.get(fund_id.clone()).unwrap_or(Vec::new(&env));
        fund_records.push_back(DisbursementRecord {
            id: String::from_str(&env, "disbursement"),
            fund_id: fund_id.clone(),
            beneficiary,
            amount,
            timestamp: env.ledger().timestamp(),
            purpose,
            approved_by: approvers,
            transaction_hash: String::from_str(&env, "pending"),
        });
        records.set(fund_id, fund_records);
        env.storage().instance().set(&AidKey::Disbursements, &records);

        true
    }

    pub fn get_fund(env: Env, fund_id: String) -> Option<EmergencyFund> {
        let funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&AidKey::Funds)
            .unwrap_or(Map::new(&env));
        funds.get(fund_id)
    }

    pub fn list_active_funds(env: Env) -> Vec<EmergencyFund> {
        let funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&AidKey::Funds)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, fund) in funds.iter() {
            if fund.is_active {
                out.push_back(fund);
            }
        }
        out
    }

    pub fn get_disbursements(env: Env, fund_id: String) -> Vec<DisbursementRecord> {
        let records: Map<String, Vec<DisbursementRecord>> = env
            .storage()
            .instance()
            .get(&AidKey::Disbursements)
            .unwrap_or(Map::new(&env));
        records.get(fund_id).unwrap_or(Vec::new(&env))
    }

    pub fn cleanup_expired_funds(env: Env) {
        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&AidKey::Funds)
            .unwrap_or(Map::new(&env));

        let now = env.ledger().timestamp();
        for (id, mut fund) in funds.iter() {
            if fund.is_active && now > fund.expires_at {
                fund.is_active = false;
                funds.set(id, fund);
            }
        }

        env.storage().instance().set(&AidKey::Funds, &funds);
    }
}
