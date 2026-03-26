use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64, Bytes, panic_with_error, log};

const DISASTER_SEISMIC: &str = "seismic";
const DISASTER_WEATHER: &str = "weather";
const DISASTER_CONFLICT: &str = "conflict";
const DISASTER_HEALTH: &str = "health";
const DISASTER_MANUAL: &str = "manual";

const FUND_STATUS_ACTIVE: &str = "active";
const FUND_STATUS_TRIGGERED: &str = "triggered";
const FUND_STATUS_RELEASED: &str = "released";
const FUND_STATUS_RECALLED: &str = "recalled";
const FUND_STATUS_EXPIRED: &str = "expired";

const SECONDS_PER_MONTH: u64 = 2_592_000; // 30 days

#[contract]
pub struct AidRegistry;

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
    pub release_triggers: Vec<Address>, // Multi-sig signers
    pub required_signatures: u32,
    pub auto_release_enabled: bool,
    pub recall_enabled: bool,
    pub recall_after_months: u32,
    pub current_status: String, // "active", "triggered", "released", "recalled", "expired"
    pub fund_allocation: Vec<FundAllocation>,
    pub reserved_for_recall: U256,
}

#[derive(Clone)]
pub struct Trigger {
    pub id: String,
    pub fund_id: String,
    pub trigger_type: String, // "seismic", "weather", "conflict", "health", "manual"
    pub threshold: String,
    pub oracle_source: String, // "usgs", "weather_api", "acled", "who", "manual"
    pub auto_release_amount: U256,
    pub geofence_latitude: i64,  // Stored as degrees * 1e6
    pub geofence_longitude: i64, // Stored as degrees * 1e6
    pub geofence_radius_km: u64,
    pub min_oracle_confirmations: u32,
    pub is_active: bool,
    pub last_triggered: u64,
    pub trigger_count: u64,
    pub last_verified: u64,
}

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
    pub trigger_id: Option<String>,
    pub is_auto_released: bool,
}

#[derive(Clone)]
pub struct FundAllocation {
    pub sector: String,
    pub amount: U256,
    pub beneficiaries: Vec<Address>,
    pub proof_of_need: String,
    pub allocated_at: u64,
}

#[derive(Clone)]
pub struct OracleData {
    pub source: String,
    pub data_type: String,
    pub value: String,
    pub timestamp: u64,
    pub location: String,
    pub confidence: u64,
    pub is_verified: bool,
}

#[derive(Clone)]
pub struct SignatureApproval {
    pub fund_id: String,
    pub release_id: String,
    pub approver: Address,
    pub approved_at: u64,
}

#[contractimpl]
impl AidRegistry {
    /// Create a new emergency fund pool
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
        // Verify admin authorization
        admin.require_auth();
        
        // Create fund structure
        let fund = EmergencyFund {
            id: fund_id.clone(),
            name,
            description,
            total_amount,
            released_amount: U256::from_u64(0),
            created_at: env.ledger().timestamp(),
            expires_at,
            disaster_type,
            geographic_scope,
            is_active: true,
            release_triggers: release_triggers.clone(),
            required_signatures,
            auto_release_enabled: false,
            recall_enabled: false,
            recall_after_months: 12,
            current_status: String::from_str(&env, FUND_STATUS_ACTIVE),
            fund_allocation: Vec::new(&env),
            reserved_for_recall: U256::from_u64(0),
        };
        
        // Store fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);
        
        // Initialize disbursement records for this fund
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let disbursements: Map<String, DisbursementRecord> = Map::new(&env);
        env.storage().instance().set(&disbursement_key, &disbursements);
    }

    /// Get fund details
    pub fn get_fund(env: Env, fund_id: String) -> Option<EmergencyFund> {
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        funds.get(fund_id)
    }

    /// List all active funds
    pub fn list_active_funds(env: Env) -> Vec<EmergencyFund> {
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut active_funds = Vec::new(&env);
        for (_, fund) in funds.iter() {
            if fund.is_active {
                active_funds.push_back(fund);
            }
        }
        active_funds
    }

    /// Submit disbursement request with multi-sig approval
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
        
        // Verify fund exists and is active
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        if !fund.is_active {
            panic_with_error!(&env, "Fund is not active");
        }
        
        // Check if sufficient funds remain
        if fund.released_amount + amount > fund.total_amount {
            panic_with_error!(&env, "Insufficient funds in pool");
        }
        
        // Verify multi-sig requirements
        if approvers.len() < fund.required_signatures as usize {
            panic_with_error!(&env, "Insufficient signatures");
        }
        
        // Verify all approvers are authorized
        for approver in approvers.iter() {
            if !fund.release_triggers.contains(approver) {
                panic_with_error!(&env, "Unauthorized approver");
            }
        }
        
        // Create disbursement record
        let disbursement_id = format!("{}_{}", fund_id, env.ledger().timestamp());
        let disbursement = DisbursementRecord {
            id: disbursement_id.clone(),
            fund_id: fund_id.clone(),
            beneficiary,
            amount,
            timestamp: env.ledger().timestamp(),
            purpose,
            approved_by: approvers,
            transaction_hash: String::from_str(&env, ""), // Will be set after transaction
        };
        
        // Store disbursement
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let mut disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));
        
        disbursements.set(disbursement_id.clone(), disbursement);
        env.storage().instance().set(&disbursement_key, &disbursements);
        
        // Update fund released amount
        fund.released_amount += amount;
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    /// Get disbursement history for a fund
    pub fn get_disbursements(env: Env, fund_id: String) -> Vec<DisbursementRecord> {
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, record) in disbursements.iter() {
            result.push_back(record);
        }
        result
    }

    /// Deactivate expired funds
    pub fn cleanup_expired_funds(env: Env) {
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let current_time = env.ledger().timestamp();
        
        for (fund_id, mut fund) in funds.iter() {
            if current_time > fund.expires_at && fund.is_active {
                fund.is_active = false;
                fund.current_status = String::from_str(&env, FUND_STATUS_EXPIRED);
                funds.set(fund_id, fund);
            }
        }
        
        env.storage().instance().set(&fund_key, &funds);
    }

    /// Add a trigger (automated or manual) to an emergency fund
    pub fn add_trigger(
        env: Env,
        admin: Address,
        fund_id: String,
        trigger_id: String,
        trigger_type: String,
        threshold: String,
        oracle_source: String,
        auto_release_amount: U256,
        geofence_latitude: i64,
        geofence_longitude: i64,
        geofence_radius_km: u64,
        min_oracle_confirmations: u32,
    ) {
        admin.require_auth();
        
        // Verify fund exists
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        if funds.get(fund_id.clone()).is_none() {
            panic_with_error!(&env, "Fund does not exist");
        }
        
        // Validate trigger type
        match trigger_type.as_str() {
            DISASTER_SEISMIC | DISASTER_WEATHER | DISASTER_CONFLICT | DISASTER_HEALTH | DISASTER_MANUAL => {},
            _ => panic_with_error!(&env, "Invalid trigger type"),
        }
        
        // Create trigger
        let trigger = Trigger {
            id: trigger_id.clone(),
            fund_id: fund_id.clone(),
            trigger_type,
            threshold,
            oracle_source,
            auto_release_amount,
            geofence_latitude,
            geofence_longitude,
            geofence_radius_km,
            min_oracle_confirmations,
            is_active: true,
            last_triggered: 0,
            trigger_count: 0,
            last_verified: env.ledger().timestamp(),
        };
        
        // Store trigger
        let triggers_key = Symbol::new(&env, &format!("triggers_{}", fund_id));
        let mut triggers: Map<String, Trigger> = env.storage().instance()
            .get(&triggers_key)
            .unwrap_or(Map::new(&env));
        
        triggers.set(trigger_id, trigger);
        env.storage().instance().set(&triggers_key, &triggers);
    }

    /// Get all triggers for a fund
    pub fn get_fund_triggers(env: Env, fund_id: String) -> Vec<Trigger> {
        let triggers_key = Symbol::new(&env, &format!("triggers_{}", fund_id));
        let triggers: Map<String, Trigger> = env.storage().instance()
            .get(&triggers_key)
            .unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        for (_, trigger) in triggers.iter() {
            if trigger.is_active {
                result.push_back(trigger);
            }
        }
        result
    }

    /// Submit oracle data for trigger verification
    pub fn submit_oracle_data(
        env: Env,
        oracle: Address,
        fund_id: String,
        trigger_id: String,
        data_type: String,
        value: String,
        location: String,
        confidence: u64,
    ) {
        oracle.require_auth();
        
        // Store oracle data
        let oracle_key = Symbol::new(&env, &format!("oracle_{}_{}", fund_id, trigger_id));
        let mut oracle_records: Vec<OracleData> = env.storage().instance()
            .get(&oracle_key)
            .unwrap_or(Vec::new(&env));
        
        let oracle_data = OracleData {
            source: oracle.to_string(),
            data_type,
            value,
            timestamp: env.ledger().timestamp(),
            location,
            confidence,
            is_verified: false,
        };
        
        oracle_records.push_back(oracle_data);
        env.storage().instance().set(&oracle_key, &oracle_records);
    }

    /// Execute automated trigger release (called when oracle conditions met)
    pub fn execute_trigger(
        env: Env,
        fund_id: String,
        trigger_id: String,
    ) -> U256 {
        // Get fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        if !fund.is_active || fund.current_status != String::from_str(&env, FUND_STATUS_ACTIVE) {
            panic_with_error!(&env, "Fund is not active");
        }
        
        // Get trigger
        let triggers_key = Symbol::new(&env, &format!("triggers_{}", fund_id));
        let mut triggers: Map<String, Trigger> = env.storage().instance()
            .get(&triggers_key)
            .unwrap_or(Map::new(&env));
        
        let mut trigger = triggers.get(trigger_id.clone()).unwrap_or_panic_with(&env);
        
        if !trigger.is_active {
            panic_with_error!(&env, "Trigger is not active");
        }
        
        // Verify oracle data confirmations
        let oracle_key = Symbol::new(&env, &format!("oracle_{}_{}", fund_id, trigger_id));
        let oracle_records: Vec<OracleData> = env.storage().instance()
            .get(&oracle_key)
            .unwrap_or(Vec::new(&env));
        
        // Check if we have enough confirmations
        let recent_threshold = env.ledger().timestamp() - 3600; // Last 1 hour
        let mut valid_confirmations = 0;
        
        for record in oracle_records.iter() {
            if record.timestamp > recent_threshold && record.confidence >= 80 {
                valid_confirmations += 1;
            }
        }
        
        if valid_confirmations < trigger.min_oracle_confirmations as u64 {
            panic_with_error!(&env, "Insufficient oracle confirmations");
        }
        
        // Check available funds
        let available = fund.total_amount - fund.released_amount - fund.reserved_for_recall;
        if trigger.auto_release_amount > available {
            panic_with_error!(&env, "Insufficient available funds");
        }
        
        // Execute release
        fund.released_amount += trigger.auto_release_amount;
        fund.current_status = String::from_str(&env, FUND_STATUS_TRIGGERED);
        trigger.last_triggered = env.ledger().timestamp();
        trigger.trigger_count += 1;
        
        // Store updates
        funds.set(fund_id.clone(), fund.clone());
        env.storage().instance().set(&fund_key, &funds);
        
        triggers.set(trigger_id.clone(), trigger);
        env.storage().instance().set(&triggers_key, &triggers);
        
        // Record automated release
        let release_summary_key = Symbol::new(&env, &format!("auto_release_{}_{}", fund_id, env.ledger().timestamp()));
        env.storage().instance().set(&release_summary_key, &trigger.auto_release_amount);
        
        trigger.auto_release_amount
    }

    /// Multi-sig manual release with 2-of-3 threshold
    pub fn execute_multi_sig_release(
        env: Env,
        fund_id: String,
        beneficiary: Address,
        amount: U256,
        purpose: String,
        approvers: Vec<Address>,
    ) -> bool {
        // Get fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        if !fund.is_active {
            panic_with_error!(&env, "Fund is not active");
        }
        
        // Verify signatures (require each approver to authorize)
        for approver in approvers.iter() {
            approver.require_auth();
            
            if !fund.release_triggers.contains(approver) {
                panic_with_error!(&env, "Unauthorized approver");
            }
        }
        
        // Check multi-sig threshold
        if approvers.len() < fund.required_signatures as usize {
            panic_with_error!(&env, "Insufficient approvals");
        }
        
        // Check available funds
        let available = fund.total_amount - fund.released_amount - fund.reserved_for_recall;
        if amount > available {
            panic_with_error!(&env, "Insufficient available funds");
        }
        
        // Execute release
        fund.released_amount += amount;
        fund.current_status = String::from_str(&env, FUND_STATUS_RELEASED);
        
        let disbursement_id = format!("{}_{}", fund_id, env.ledger().timestamp());
        let disbursement = DisbursementRecord {
            id: disbursement_id.clone(),
            fund_id: fund_id.clone(),
            beneficiary,
            amount,
            timestamp: env.ledger().timestamp(),
            purpose,
            approved_by: approvers.clone(),
            transaction_hash: String::from_str(&env, ""),
            trigger_id: None,
            is_auto_released: false,
        };
        
        // Store disbursement
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let mut disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));
        
        disbursements.set(disbursement_id, disbursement);
        env.storage().instance().set(&disbursement_key, &disbursements);
        
        // Update fund
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
        
        true
    }

    /// Allocate funds to sectors and beneficiaries with proof of need
    pub fn allocate_funds(
        env: Env,
        admin: Address,
        fund_id: String,
        sector: String,
        amount: U256,
        beneficiaries: Vec<Address>,
        proof_of_need: String,
    ) {
        admin.require_auth();
        
        // Get fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        // Create allocation
        let allocation = FundAllocation {
            sector,
            amount,
            beneficiaries,
            proof_of_need,
            allocated_at: env.ledger().timestamp(),
        };
        
        // Add to fund allocations
        fund.fund_allocation.push_back(allocation);
        
        // Store updated fund
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    /// Get fund allocations
    pub fn get_fund_allocations(env: Env, fund_id: String) -> Vec<FundAllocation> {
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let fund = funds.get(fund_id).unwrap_or_panic_with(&env);
        fund.fund_allocation
    }

    /// Recall unused funds after 12 months
    pub fn recall_unused_funds(
        env: Env,
        donor: Address,
        fund_id: String,
    ) -> U256 {
        donor.require_auth();
        
        // Get fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        if !fund.recall_enabled {
            panic_with_error!(&env, "Recall not enabled for this fund");
        }
        
        let age_seconds = env.ledger().timestamp() - fund.created_at;
        let recall_threshold = fund.recall_after_months as u64 * SECONDS_PER_MONTH;
        
        if age_seconds < recall_threshold {
            panic_with_error!(&env, "Fund is not yet eligible for recall");
        }
        
        // Calculate amount available for recall
        let unused = fund.total_amount - fund.released_amount;
        
        if unused > U256::from_u64(0) {
            fund.reserved_for_recall = unused;
            fund.current_status = String::from_str(&env, FUND_STATUS_RECALLED);
        }
        
        // Store updated fund
        funds.set(fund_id, fund.clone());
        env.storage().instance().set(&fund_key, &funds);
        
        unused
    }

    /// Get fund status and metrics
    pub fn get_fund_status(env: Env, fund_id: String) -> (String, U256, U256, U256, u64) {
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        let available = fund.total_amount - fund.released_amount - fund.reserved_for_recall;
        let beneficiary_count = fund.fund_allocation.len() as u64;
        
        (
            fund.current_status,
            fund.total_amount,
            fund.released_amount,
            available,
            beneficiary_count,
        )
    }

    /// Enable recall for a fund
    pub fn enable_recall(
        env: Env,
        admin: Address,
        fund_id: String,
    ) {
        admin.require_auth();
        
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        fund.recall_enabled = true;
        
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    /// Deactivate a trigger
    pub fn deactivate_trigger(
        env: Env,
        admin: Address,
        fund_id: String,
        trigger_id: String,
    ) {
        admin.require_auth();
        
        let triggers_key = Symbol::new(&env, &format!("triggers_{}", fund_id));
        let mut triggers: Map<String, Trigger> = env.storage().instance()
            .get(&triggers_key)
            .unwrap_or(Map::new(&env));
        
        let mut trigger = triggers.get(trigger_id.clone()).unwrap_or_panic_with(&env);
        trigger.is_active = false;
        
        triggers.set(trigger_id, trigger);
        env.storage().instance().set(&triggers_key, &triggers);
    }
}

