use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Vec};

#[contract]
pub struct CashTransfer;

const MAX_TRANSFER_DURATION_SECS: u64 = 30 * 24 * 60 * 60;
const RECALL_SLA_SECS: u64 = 24 * 60 * 60;
const DEFAULT_GEOFENCE_E6: i64 = 500_000;

#[contracttype]
#[derive(Clone)]
pub enum TransferCondition {
    CashForWork,
    Education,
    Health,
    Shelter,
    Nutrition,
    Unrestricted,
}

#[contracttype]
#[derive(Clone)]
pub struct ConditionalTransfer {
    pub id: String,
    pub creator: Address,
    pub beneficiary: Address,
    pub amount: i128,
    pub remaining: i128,
    pub currency: String,
    pub allowed_categories: Vec<String>,
    pub expiry: u64,
    pub recall_due_by: u64,
    pub conditions: Vec<TransferCondition>,
    pub camp_lat_e6: i64,
    pub camp_lon_e6: i64,
    pub geofence_radius_e6: i64,
    pub max_tx_per_day: u32,
    pub max_amount_per_tx: i128,
    pub cosign_threshold_amount: i128,
    pub tx_day_index: u64,
    pub tx_count_today: u32,
    pub is_active: bool,
    pub recalled_amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferSpend {
    pub id: String,
    pub transfer_id: String,
    pub merchant_id: String,
    pub merchant_category: String,
    pub amount: i128,
    pub timestamp: u64,
    pub spend_lat_e6: i64,
    pub spend_lon_e6: i64,
    pub approved: bool,
    pub reason: String,
}

#[contracttype]
#[derive(Clone)]
pub struct WorkContract {
    pub id: String,
    pub beneficiary: Address,
    pub task_description: String,
    pub verification_oracle: Address,
    pub payment_schedule_total: i128,
    pub upfront_paid: i128,
    pub completion_paid: i128,
    pub created_at: u64,
    pub is_completed: bool,
    pub dispute_open: bool,
    pub arbitration_panel: Vec<Address>,
    pub required_approvals: u32,
    pub approvals_for_completion: Vec<Address>,
    pub approvals_rejecting_completion: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct CreateTransferInput {
    pub beneficiary: Address,
    pub amount: i128,
    pub currency: String,
    pub allowed_categories: Vec<String>,
    pub expiry: u64,
    pub conditions: Vec<TransferCondition>,
    pub camp_lat_e6: i64,
    pub camp_lon_e6: i64,
}

#[contracttype]
#[derive(Clone)]
pub struct WorkContractInput {
    pub beneficiary: Address,
    pub task_description: String,
    pub verification_oracle: Address,
    pub payment_schedule_total: i128,
    pub arbitration_panel: Vec<Address>,
    pub required_approvals: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum CashKey {
    Transfers,
    Spends(String),
    WorkContracts,
    MerchantCategories,
}

#[contractimpl]
impl CashTransfer {
    pub fn create_transfer(env: Env, ngo: Address, transfer_id: String, input: CreateTransferInput) {
        ngo.require_auth();

        if input.amount <= 0 {
            panic!("amount must be positive");
        }

        let now = env.ledger().timestamp();
        if input.expiry <= now {
            panic!("expiry must be in the future");
        }

        if input.expiry > now + MAX_TRANSFER_DURATION_SECS {
            panic!("time limit exceeded (max 30 days)");
        }

        if input.allowed_categories.len() == 0 {
            panic!("at least one allowed category required");
        }

        let transfers_key = CashKey::Transfers;
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .persistent()
            .get(&transfers_key)
            .unwrap_or(Map::new(&env));

        if transfers.contains_key(transfer_id.clone()) {
            panic!("transfer exists");
        }

        let transfer = ConditionalTransfer {
            id: transfer_id.clone(),
            creator: ngo,
            beneficiary: input.beneficiary,
            amount: input.amount,
            remaining: input.amount,
            currency: input.currency,
            allowed_categories: input.allowed_categories,
            expiry: input.expiry,
            recall_due_by: input.expiry + RECALL_SLA_SECS,
            conditions: input.conditions,
            camp_lat_e6: input.camp_lat_e6,
            camp_lon_e6: input.camp_lon_e6,
            geofence_radius_e6: DEFAULT_GEOFENCE_E6,
            max_tx_per_day: 3,
            max_amount_per_tx: 100,
            cosign_threshold_amount: 75,
            tx_day_index: Self::day_index(now),
            tx_count_today: 0,
            is_active: true,
            recalled_amount: 0,
        };

        transfers.set(transfer_id.clone(), transfer);
        env.storage().persistent().set(&transfers_key, &transfers);

        let spends_key = CashKey::Spends(transfer_id);
        env.storage().persistent().set(&spends_key, &Vec::<TransferSpend>::new(&env));
    }

    pub fn register_merchant_category(
        env: Env,
        registrar: Address,
        merchant_id: String,
        merchant_category: String,
    ) {
        registrar.require_auth();

        let key = CashKey::MerchantCategories;
        let mut categories: Map<String, String> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        categories.set(merchant_id, merchant_category);
        env.storage().persistent().set(&key, &categories);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spend_transfer(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        merchant_category: String,
        amount: i128,
        spend_lat_e6: i64,
        spend_lon_e6: i64,
        cosigner: Option<Address>,
    ) -> bool {
        beneficiary.require_auth();

        let now = env.ledger().timestamp();
        let mut transfer = Self::get_transfer_required(&env, &transfer_id);

        let (eligible, reason) = Self::verify_spend_eligibility_internal(
            &env,
            &transfer,
            &merchant_id,
            &merchant_category,
            amount,
            spend_lat_e6,
            spend_lon_e6,
            now,
            cosigner,
        );

        if eligible {
            if Self::day_index(now) != transfer.tx_day_index {
                transfer.tx_day_index = Self::day_index(now);
                transfer.tx_count_today = 0;
            }

            transfer.tx_count_today += 1;
            transfer.remaining -= amount;
            if transfer.remaining <= 0 {
                transfer.remaining = 0;
                transfer.is_active = false;
            }

            Self::save_transfer(&env, &transfer);
        }

        Self::append_spend(
            &env,
            &transfer_id,
            TransferSpend {
                id: String::from_str(&env, "spend"),
                transfer_id: transfer_id.clone(),
                merchant_id,
                merchant_category,
                amount,
                timestamp: now,
                spend_lat_e6,
                spend_lon_e6,
                approved: eligible,
                reason,
            },
        );

        eligible
    }

    #[allow(clippy::too_many_arguments)]
    pub fn partial_spend(
        env: Env,
        beneficiary: Address,
        transfer_id: String,
        merchant_id: String,
        merchant_category: String,
        amount: i128,
        spend_lat_e6: i64,
        spend_lon_e6: i64,
        cosigner: Option<Address>,
    ) -> bool {
        Self::spend_transfer(
            env,
            beneficiary,
            transfer_id,
            merchant_id,
            merchant_category,
            amount,
            spend_lat_e6,
            spend_lon_e6,
            cosigner,
        )
    }

    pub fn check_expiry(env: Env, transfer_id: String) -> i128 {
        let now = env.ledger().timestamp();
        let mut transfer = Self::get_transfer_required(&env, &transfer_id);

        if transfer.is_active && now > transfer.expiry {
            transfer.is_active = false;
            transfer.recalled_amount = transfer.remaining;
            transfer.remaining = 0;
            Self::save_transfer(&env, &transfer);
        }

        transfer.recalled_amount
    }

    #[allow(clippy::too_many_arguments)]
    pub fn verify_spend_eligibility(
        env: Env,
        transfer_id: String,
        merchant_id: String,
        merchant_category: String,
        amount: i128,
        spend_lat_e6: i64,
        spend_lon_e6: i64,
        cosigner: Option<Address>,
    ) -> (bool, String) {
        let transfer = Self::get_transfer_required(&env, &transfer_id);
        Self::verify_spend_eligibility_internal(
            &env,
            &transfer,
            &merchant_id,
            &merchant_category,
            amount,
            spend_lat_e6,
            spend_lon_e6,
            env.ledger().timestamp(),
            cosigner,
        )
    }

    pub fn get_transfer_balance(env: Env, transfer_id: String) -> i128 {
        Self::get_transfer_required(&env, &transfer_id).remaining
    }

    pub fn get_transfer(env: Env, transfer_id: String) -> Option<ConditionalTransfer> {
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .persistent()
            .get(&CashKey::Transfers)
            .unwrap_or(Map::new(&env));
        transfers.get(transfer_id)
    }

    pub fn get_spending_history(env: Env, transfer_id: String) -> Vec<TransferSpend> {
        env.storage()
            .persistent()
            .get(&CashKey::Spends(transfer_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn recall_expired(env: Env) -> Vec<String> {
        let now = env.ledger().timestamp();
        let mut recalled = Vec::new(&env);

        let key = CashKey::Transfers;
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));

        for (id, mut transfer) in transfers.iter() {
            if transfer.is_active && now > transfer.expiry {
                transfer.is_active = false;
                transfer.recalled_amount = transfer.remaining;
                transfer.remaining = 0;
                transfers.set(id.clone(), transfer);
                recalled.push_back(id);
            }
        }

        env.storage().persistent().set(&key, &transfers);
        recalled
    }

    pub fn create_work_contract(env: Env, ngo: Address, contract_id: String, input: WorkContractInput) {
        ngo.require_auth();

        if input.payment_schedule_total <= 0 {
            panic!("invalid schedule");
        }

        if input.arbitration_panel.len() == 0 {
            panic!("arbitration panel required");
        }

        if input.required_approvals == 0 {
            panic!("required approvals must be > 0");
        }

        let key = CashKey::WorkContracts;
        let mut contracts: Map<String, WorkContract> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));

        if contracts.contains_key(contract_id.clone()) {
            panic!("work contract exists");
        }

        let upfront = (input.payment_schedule_total * 25) / 100;
        let contract = WorkContract {
            id: contract_id.clone(),
            beneficiary: input.beneficiary,
            task_description: input.task_description,
            verification_oracle: input.verification_oracle,
            payment_schedule_total: input.payment_schedule_total,
            upfront_paid: upfront,
            completion_paid: 0,
            created_at: env.ledger().timestamp(),
            is_completed: false,
            dispute_open: false,
            arbitration_panel: input.arbitration_panel,
            required_approvals: input.required_approvals,
            approvals_for_completion: Vec::new(&env),
            approvals_rejecting_completion: Vec::new(&env),
        };

        contracts.set(contract_id, contract);
        env.storage().persistent().set(&key, &contracts);
    }

    pub fn verify_work_completion(
        env: Env,
        oracle: Address,
        contract_id: String,
        supervisor_attested: bool,
        photo_proof_hash: String,
        gps_check_in_ok: bool,
    ) -> i128 {
        oracle.require_auth();

        if photo_proof_hash.len() == 0 {
            panic!("photo proof required");
        }

        let key = CashKey::WorkContracts;
        let mut contracts: Map<String, WorkContract> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));

        let mut contract = contracts
            .get(contract_id.clone())
            .unwrap_or_else(|| panic!("work contract missing"));

        if oracle != contract.verification_oracle {
            panic!("unauthorized oracle");
        }

        if contract.is_completed {
            return 0;
        }

        if supervisor_attested && gps_check_in_ok {
            let completion = (contract.payment_schedule_total * 75) / 100;
            contract.completion_paid = completion;
            contract.is_completed = true;
            contracts.set(contract_id, contract);
            env.storage().persistent().set(&key, &contracts);
            completion
        } else {
            0
        }
    }

    pub fn open_dispute(env: Env, beneficiary: Address, contract_id: String) {
        beneficiary.require_auth();

        let key = CashKey::WorkContracts;
        let mut contracts: Map<String, WorkContract> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));

        if let Some(mut contract) = contracts.get(contract_id.clone()) {
            if contract.beneficiary != beneficiary {
                panic!("unauthorized");
            }
            contract.dispute_open = true;
            contract.approvals_for_completion = Vec::new(&env);
            contract.approvals_rejecting_completion = Vec::new(&env);
            contracts.set(contract_id, contract);
            env.storage().persistent().set(&key, &contracts);
        }
    }

    pub fn resolve_dispute(
        env: Env,
        panel_member: Address,
        contract_id: String,
        approve_completion: bool,
    ) -> i128 {
        panel_member.require_auth();

        let key = CashKey::WorkContracts;
        let mut contracts: Map<String, WorkContract> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));

        let mut contract = contracts
            .get(contract_id.clone())
            .unwrap_or_else(|| panic!("work contract missing"));

        if !contract.dispute_open {
            return 0;
        }

        if !Self::contains_address(&contract.arbitration_panel, &panel_member) {
            panic!("not in arbitration panel");
        }

        if approve_completion {
            if !Self::contains_address(&contract.approvals_for_completion, &panel_member) {
                contract.approvals_for_completion.push_back(panel_member);
            }
        } else if !Self::contains_address(&contract.approvals_rejecting_completion, &panel_member) {
            contract.approvals_rejecting_completion.push_back(panel_member);
        }

        if contract.approvals_for_completion.len() >= contract.required_approvals {
            let completion = (contract.payment_schedule_total * 75) / 100;
            contract.completion_paid = completion;
            contract.is_completed = true;
            contract.dispute_open = false;
            contracts.set(contract_id, contract);
            env.storage().persistent().set(&key, &contracts);
            return completion;
        }

        if contract.approvals_rejecting_completion.len() >= contract.required_approvals {
            contract.dispute_open = false;
            contracts.set(contract_id, contract);
            env.storage().persistent().set(&key, &contracts);
            return 0;
        }

        contracts.set(contract_id, contract);
        env.storage().persistent().set(&key, &contracts);
        0
    }

    fn verify_spend_eligibility_internal(
        env: &Env,
        transfer: &ConditionalTransfer,
        merchant_id: &String,
        merchant_category: &String,
        amount: i128,
        spend_lat_e6: i64,
        spend_lon_e6: i64,
        now: u64,
        cosigner: Option<Address>,
    ) -> (bool, String) {
        if !transfer.is_active {
            return (false, String::from_str(env, "inactive transfer"));
        }

        if now > transfer.expiry {
            return (false, String::from_str(env, "transfer expired"));
        }

        if amount <= 0 || amount > transfer.remaining {
            return (false, String::from_str(env, "insufficient remaining balance"));
        }

        if amount > transfer.max_amount_per_tx {
            return (false, String::from_str(env, "max per transaction exceeded"));
        }

        let registered_category = Self::merchant_category(env, merchant_id);
        if registered_category.is_none() {
            return (false, String::from_str(env, "merchant not registered"));
        }

        if registered_category.unwrap() != merchant_category.clone() {
            return (false, String::from_str(env, "merchant category mismatch"));
        }

        if !Self::contains_category(&transfer.allowed_categories, merchant_category) {
            return (false, String::from_str(env, "merchant category locked"));
        }

        let day = Self::day_index(now);
        let tx_count = if day == transfer.tx_day_index {
            transfer.tx_count_today
        } else {
            0
        };

        if tx_count >= transfer.max_tx_per_day {
            return (false, String::from_str(env, "velocity: max 3 tx/day"));
        }

        let distance = Self::distance_e6(
            transfer.camp_lat_e6,
            transfer.camp_lon_e6,
            spend_lat_e6,
            spend_lon_e6,
        );
        if distance > transfer.geofence_radius_e6 {
            return (false, String::from_str(env, "outside 50km geofence"));
        }

        if amount >= transfer.cosign_threshold_amount {
            if let Some(addr) = cosigner {
                addr.require_auth();
            } else {
                return (false, String::from_str(env, "2-of-2 cosign required"));
            }
        }

        (true, String::from_str(env, "eligible"))
    }

    fn merchant_category(env: &Env, merchant_id: &String) -> Option<String> {
        let categories: Map<String, String> = env
            .storage()
            .persistent()
            .get(&CashKey::MerchantCategories)
            .unwrap_or(Map::new(env));
        categories.get(merchant_id.clone())
    }

    fn get_transfer_required(env: &Env, transfer_id: &String) -> ConditionalTransfer {
        let transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .persistent()
            .get(&CashKey::Transfers)
            .unwrap_or(Map::new(env));
        transfers
            .get(transfer_id.clone())
            .unwrap_or_else(|| panic!("transfer not found"))
    }

    fn save_transfer(env: &Env, transfer: &ConditionalTransfer) {
        let key = CashKey::Transfers;
        let mut transfers: Map<String, ConditionalTransfer> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(env));
        transfers.set(transfer.id.clone(), transfer.clone());
        env.storage().persistent().set(&key, &transfers);
    }

    fn append_spend(env: &Env, transfer_id: &String, spend: TransferSpend) {
        let key = CashKey::Spends(transfer_id.clone());
        let mut history: Vec<TransferSpend> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));
        history.push_back(spend);
        env.storage().persistent().set(&key, &history);
    }

    fn contains_category(categories: &Vec<String>, category: &String) -> bool {
        for item in categories.iter() {
            if item == category.clone() {
                return true;
            }
        }
        false
    }

    fn contains_address(values: &Vec<Address>, target: &Address) -> bool {
        for item in values.iter() {
            if item == target.clone() {
                return true;
            }
        }
        false
    }

    fn day_index(ts: u64) -> u64 {
        ts / 86_400
    }

    fn distance_e6(lat1: i64, lon1: i64, lat2: i64, lon2: i64) -> i64 {
        let dlat = if lat2 >= lat1 { lat2 - lat1 } else { lat1 - lat2 };
        let dlon = if lon2 >= lon1 { lon2 - lon1 } else { lon1 - lon2 };
        dlat + dlon
    }
}
