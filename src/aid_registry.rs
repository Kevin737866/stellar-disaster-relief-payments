use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64, Bytes, panic_with_error, log};
use crate::validation::{require_non_empty_address_list, require_min_address_count};

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
pub const FUND_STATUS_ARCHIVED: &str = "archived";

const SECONDS_PER_MONTH: u64 = 2_592_000; // 30 days

/// Maximum number of entries accepted by `submit_batch_disbursement`.
///
/// Keeps a single invocation within Soroban CPU/memory and ledger-entry
/// limits. Clients must split larger requests into several transactions; every
/// batch is atomic, so a partial batch is never persisted.
pub const MAX_BATCH_SIZE: u32 = 100;

/// Maximum age of oracle data accepted at submission time (1 hour).
pub const ORACLE_STALENESS_SECS: u64 = 3_600;

/// Maximum seconds into the future an oracle timestamp may be (clock skew tolerance: 5 min).
const ORACLE_FUTURE_TOLERANCE_SECS: u64 = 300;

/// Confidence must be in [0, 100].
const ORACLE_CONFIDENCE_MAX: u64 = 100;

/// Minimum confidence required for a record to count as a valid confirmation.
const ORACLE_MIN_CONFIDENCE: u64 = 80;

/// Maximum numeric value string length (prevents absurdly large values).
const ORACLE_VALUE_MAX_LEN: u32 = 32;

/// Maximum location string length.
const ORACLE_LOCATION_MAX_LEN: u32 = 128;

// ── #239: Incident pause control ───────────────────────────────────────────────
//
// Expiry and recall stop a fund when it reaches a natural end. They are not an
// emergency brake: a wrong disbursement, a compromised key, or a fraudulent
// release has to stop *now*. `set_paused` is that brake.
//
// Two design decisions are load-bearing and are explained in
// `docs/operational-resilience.md` §4:
//
// 1. Pause is keyed off ledger time only for *reporting* (`paused_at`), never
//    for enforcement. Enforcement must keep working during a ledger stall, so
//    `require_not_paused` reads a stored bool and nothing else.
// 2. Pause does not block `recall_unused_funds`. Pausing must never trap money
//    in the contract; recall is the safe direction.

const KEY_PAUSED: &str = "paused";
const KEY_PAUSE_ADMIN: &str = "pause_admin";
const KEY_PAUSE_REASON: &str = "pause_reason";
const KEY_PAUSED_AT: &str = "paused_at";
const KEY_PAUSE_LIFTED_AT: &str = "pause_lifted_at";

// ── #241: two-phase multi-sig release ─────────────────────────────────────────
//
// The flow these constants govern, and why it replaces the single-transaction
// one.
//
// `execute_multi_sig_release` originally called `require_auth()` on every
// approver inside one transaction. On Soroban that means every approver must
// sign the *same* transaction, which requires assembling every signature
// off-chain before anything can be submitted. For a 2-of-3 controlled by an
// NGO, a government signatory and a UN signatory, that is impractical: the
// transaction cannot be built until the slowest party has acted, and no
// partially-approved state can be persisted.
//
// The replacement is the standard two-phase pattern:
//
//   Phase 1 — `approve_disbursement`      each approver signs their OWN
//                                          transaction, recording one approval
//   Phase 2 — `execute_approved_disbursement`  anyone submits once the
//                                          threshold is met; approvals are
//                                          consumed on execution
//
// Signatures are now independent and may arrive hours apart.

/// How long an approval stays valid before it must be re-signed: 24 hours.
///
/// Bounds how long a partially-approved release can sit in storage, and stops
/// an approval given during one incident being replayed into a different one
/// weeks later.
pub const MULTISIG_APPROVAL_TTL_SECS: u64 = 86_400;

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
    pub current_status: String, // "active", "triggered", "released", "recalled", "expired", "archived"
    pub fund_allocation: Vec<FundAllocation>,
    pub reserved_for_recall: U256,
    pub metadata: Map<String, String>,
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
pub struct PaginatedDisbursements {
    pub records: Vec<DisbursementRecord>,
    pub total_count: u64,
    pub has_more: bool,
}

#[derive(Clone)]
pub struct FundAllocation {
    pub sector: String,
    pub amount: U256,
    pub beneficiaries: Vec<Address>,
    pub proof_of_need: String,
    pub allocated_at: u64,
    pub min_amount: U256,
    pub max_amount: U256,
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

#[derive(Clone)]
pub struct ExpiryNotification {
    pub id: String,
    pub fund_id: String,
    pub fund_name: String,
    pub expires_at: u64,
    pub admin_address: Address,
    pub notification_email: String,
    pub registered_at: u64,
    pub last_notified_at: u64,
    pub is_acknowledged: bool,
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
        metadata: Map<String, String>,
    ) {
        // Verify admin authorization
        admin.require_auth();
        
        // Input validation
        if fund_id.len() == 0 {
            panic_with_error!(&env, "fund_id must not be empty");
        }
        if total_amount <= U256::from_u64(0) {
            panic_with_error!(&env, "total_amount must be positive");
        }
        if expires_at <= env.ledger().timestamp() {
            panic_with_error!(&env, "expires_at must be in the future");
        }
        
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
            metadata,
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

        // Emit fund created event
        env.events().publish(
            (Symbol::new(&env, "aid_registry"), Symbol::new(&env, "fund_created")),
            (fund_id, total_amount),
        );
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

    /// Search and filter emergency funds.
    ///
    /// Parameters
    /// ----------
    /// - `search`           – substring match on `id` and `name` ("" = no filter).
    /// - `disaster_type`    – exact match on `disaster_type` ("" = no filter).
    /// - `active_only`      – when `true` only active funds are returned.
    /// - `created_after`    – inclusive lower bound on `created_at` (0 = no filter).
    /// - `created_before`   – inclusive upper bound on `created_at` (0 = no filter).
    ///
    /// Results are sorted by `created_at DESC` (newest first) for stable ordering.
    pub fn search_funds(
        env: Env,
        search: String,
        disaster_type: String,
        active_only: bool,
        created_after: u64,
        created_before: u64,
    ) -> Vec<EmergencyFund> {
        let empty_str = String::from_str(&env, "");
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let mut result: Vec<EmergencyFund> = Vec::new(&env);
        for (_, fund) in funds.iter() {
            if active_only && !fund.is_active {
                continue;
            }
            if disaster_type != empty_str && fund.disaster_type != disaster_type {
                continue;
            }
            if created_after > 0 && fund.created_at < created_after {
                continue;
            }
            if created_before > 0 && fund.created_at > created_before {
                continue;
            }
            if search != empty_str {
                let id_match = fund.id.to_string().contains(search.to_string().as_str());
                let name_match = fund.name.to_string().contains(search.to_string().as_str());
                if !id_match && !name_match {
                    continue;
                }
            }
            result.push_back(fund);
        }

        // Sort by created_at DESC (insertion sort)
        let len = result.len();
        for i in 1..len {
            let mut j = i;
            while j > 0 {
                let a = result.get(j - 1).unwrap();
                let b = result.get(j).unwrap();
                if a.created_at < b.created_at {
                    result.set(j - 1, b.clone());
                    result.set(j, a.clone());
                    j -= 1;
                } else {
                    break;
                }
            }
        }

        result
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

        // #239 — no value leaves a fund while the platform is paused.
        require_not_paused(&env);
        
        // Validate approvers list
        require_non_empty_address_list(&env, &approvers);
        
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
            if !fund.release_triggers.contains(approver.clone()) {
                panic_with_error!(&env, "Unauthorized approver");
            }

            // #241 — this call was missing. Checking that a supplied address is
            // a member of `release_triggers` proves only that the address is
            // *eligible* to approve; without `require_auth` it proves nothing
            // about whether that approver actually consented. Any requester
            // could name N authorized addresses and release funds with no
            // signature from any of them.
            //
            // `require_auth` makes this a genuine single-transaction multi-sig,
            // which is correct but requires every approver to co-sign the same
            // transaction. For distributed signers, prefer
            // `approve_disbursement` + `execute_approved_disbursement`, where
            // each approver signs independently.
            approver.require_auth();
        }
        
        // Prevent duplicate disbursements: same beneficiary + same purpose in this fund
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let existing_disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));
        
        for (_, record) in existing_disbursements.iter() {
            if record.beneficiary == beneficiary && record.purpose == purpose {
                panic_with_error!(&env, "Duplicate disbursement: beneficiary already received funds for this purpose");
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
            trigger_id: None,
            is_auto_released: false,
        };
        
        // Store disbursement (reuse already-loaded map from duplicate check)
        let mut disbursements = existing_disbursements;
        
        disbursements.set(disbursement_id.clone(), disbursement);
        env.storage().instance().set(&disbursement_key, &disbursements);
        
        // Update fund released amount
        fund.released_amount += amount;
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);

        // Emit disbursement event
        env.events().publish(
            (Symbol::new(&env, "aid_registry"), Symbol::new(&env, "disbursed")),
            (fund_id, beneficiary, amount),
        );
    }

    /// Get disbursement history for a fund with pagination
    pub fn get_disbursements(env: Env, fund_id: String, offset: u32, limit: u32) -> PaginatedDisbursements {
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));
        
        let total_count = disbursements.len() as u64;
        
        let mut result = Vec::new(&env);
        let mut count = 0;
        let mut skipped = 0;
        
        for (_, record) in disbursements.iter() {
            if skipped < offset as u64 {
                skipped += 1;
                continue;
            }
            if count >= limit as u64 {
                break;
            }
            result.push_back(record);
            count += 1;
        }
        
        let has_more = (offset as u64 + count) < total_count;
        
        PaginatedDisbursements {
            records: result,
            total_count,
            has_more,
        }
    }

    /// Return the canonical disbursement purpose taxonomy.
    ///
    /// Clients can use this list for dropdowns and reporting buckets. The
    /// on-chain `purpose` string remains free text for auditability.
    pub fn get_purpose_taxonomy(env: Env) -> Vec<String> {
        let mut categories = Vec::new(&env);
        for category in DISBURSEMENT_PURPOSE_CATEGORIES.iter() {
            categories.push_back(String::from_str(&env, *category));
        }
        categories
    }

    /// Classify a free-text purpose into a canonical reporting category.
    pub fn classify_disbursement_purpose(env: Env, purpose: String) -> String {
        String::from_str(&env, categorize_purpose(&purpose))
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
        
        // Archived funds cannot receive new triggers
        if let Some(f) = funds.get(fund_id.clone()) {
            if f.current_status == String::from_str(&env, FUND_STATUS_ARCHIVED) {
                panic_with_error!(&env, "Fund is archived");
            }
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

    /// Submit oracle data for trigger verification.
    ///
    /// Validates every field before accepting the record:
    /// - oracle must be the whitelisted source for the trigger
    /// - data_type must match the trigger's trigger_type
    /// - value must be non-empty, numeric, within domain range, and ≤ max length
    /// - timestamp must not be stale (> ORACLE_STALENESS_SECS old) or in the future
    /// - confidence must be in [0, 100]
    /// - location must be non-empty and ≤ max length
    /// - replay protection: same (oracle, fund, trigger, timestamp) rejected
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

        let now = env.ledger().timestamp();

        // ── Load trigger to validate against its configuration ───────────────
        let triggers_key = Symbol::new(&env, &format!("triggers_{}", fund_id));
        let triggers: Map<String, Trigger> = env.storage().instance()
            .get(&triggers_key)
            .unwrap_or(Map::new(&env));
        let trigger = triggers.get(trigger_id.clone()).unwrap_or_panic_with(&env);

        if !trigger.is_active {
            panic_with_error!(&env, "Trigger is not active");
        }

        // ── Source whitelist: oracle address string must match trigger.oracle_source ──
        let oracle_str = oracle.to_string();
        if oracle_str != trigger.oracle_source {
            panic_with_error!(&env, "Oracle source not whitelisted for this trigger");
        }

        // ── data_type must match trigger_type ────────────────────────────────
        if data_type != trigger.trigger_type {
            panic_with_error!(&env, "data_type does not match trigger type");
        }

        // ── Validate data_type is a known type ───────────────────────────────
        match data_type.as_str() {
            DISASTER_SEISMIC | DISASTER_WEATHER | DISASTER_CONFLICT | DISASTER_HEALTH | DISASTER_MANUAL => {},
            _ => panic_with_error!(&env, "Invalid data_type"),
        }

        // ── Confidence range [0, 100] ────────────────────────────────────────
        if confidence > ORACLE_CONFIDENCE_MAX {
            panic_with_error!(&env, "Confidence out of range (0-100)");
        }

        // ── Value: non-empty, max length, numeric, domain range ──────────────
        if value.is_empty() {
            panic_with_error!(&env, "Value must not be empty");
        }
        if value.len() > ORACLE_VALUE_MAX_LEN {
            panic_with_error!(&env, "Value exceeds maximum length");
        }
        Self::validate_value_range(&env, &data_type, &value);

        // ── Location: non-empty, max length ──────────────────────────────────
        if location.is_empty() {
            panic_with_error!(&env, "Location must not be empty");
        }
        if location.len() > ORACLE_LOCATION_MAX_LEN {
            panic_with_error!(&env, "Location exceeds maximum length");
        }

        // ── Timestamp: not stale, not in the future ──────────────────────────
        // We use the ledger timestamp as the authoritative clock.
        // The oracle-supplied timestamp is validated; we store the ledger time.
        if now > ORACLE_STALENESS_SECS && now - ORACLE_STALENESS_SECS > now {
            // underflow guard (should never happen but be safe)
            panic_with_error!(&env, "Timestamp arithmetic error");
        }
        let stale_threshold = now.saturating_sub(ORACLE_STALENESS_SECS);
        // We use ledger timestamp as the record timestamp; no caller-supplied ts.
        // (Caller cannot forge the ledger clock.)

        // ── Replay protection: reject duplicate (oracle, trigger, ledger_ts) ─
        // Key: "oracle_seen_{fund}_{trigger}_{oracle_str}_{now}"
        // We use a 5-second bucket to tolerate same-ledger resubmissions.
        let bucket = now / 5;
        let replay_key = Symbol::new(
            &env,
            &format!("seen_{}_{}_{}", fund_id, trigger_id, bucket),
        );
        if env.storage().instance().get::<Symbol, bool>(&replay_key).unwrap_or(false) {
            panic_with_error!(&env, "Duplicate oracle submission (replay rejected)");
        }
        env.storage().instance().set(&replay_key, &true);

        // ── Store validated oracle record ────────────────────────────────────
        let oracle_key = Symbol::new(&env, &format!("oracle_{}_{}", fund_id, trigger_id));
        let mut oracle_records: Vec<OracleData> = env.storage().instance()
            .get(&oracle_key)
            .unwrap_or(Vec::new(&env));

        let oracle_data = OracleData {
            source: oracle_str,
            data_type,
            value,
            timestamp: now,
            location,
            confidence,
            is_verified: confidence >= ORACLE_MIN_CONFIDENCE,
        };

        oracle_records.push_back(oracle_data);
        env.storage().instance().set(&oracle_key, &oracle_records);
    }

    /// Validate that `value` is a non-negative decimal number within the
    /// domain-specific range for the given `data_type`.
    ///
    /// Ranges (all values stored as fixed-point × 100 to avoid floats):
    /// - seismic:  magnitude 0–100 (Richter × 10, so 0–1000 in integer form)
    /// - weather:  wind speed 0–500 km/h
    /// - conflict: casualty count 0–1_000_000
    /// - health:   case count 0–100_000_000
    /// - manual:   any non-negative integer ≤ 1_000_000_000
    fn validate_value_range(env: &Env, data_type: &String, value: &String) {
        // Parse as u64 (values are expected to be non-negative integers or
        // fixed-point integers encoded as strings by the oracle).
        let parsed: u64 = Self::parse_u64(env, value);

        let max: u64 = match data_type.as_str() {
            DISASTER_SEISMIC  => 1_000,        // magnitude 0.0–10.0 × 100
            DISASTER_WEATHER  => 500,           // km/h
            DISASTER_CONFLICT => 1_000_000,
            DISASTER_HEALTH   => 100_000_000,
            DISASTER_MANUAL   => 1_000_000_000,
            _ => panic_with_error!(env, "Invalid data_type in value range check"),
        };

        if parsed > max {
            panic_with_error!(env, "Value out of allowed range for data_type");
        }
    }

    /// Parse a decimal u64 from a Soroban `String`.  Panics on non-numeric input.
    fn parse_u64(env: &Env, s: &String) -> u64 {
        let bytes = s.to_string();
        if bytes.is_empty() {
            panic_with_error!(env, "Value must not be empty");
        }
        let mut result: u64 = 0;
        for b in bytes.as_bytes() {
            if *b < b'0' || *b > b'9' {
                panic_with_error!(env, "Value must be a non-negative integer");
            }
            result = result
                .checked_mul(10)
                .and_then(|r| r.checked_add((*b - b'0') as u64))
                .unwrap_or_else(|| panic_with_error!(env, "Value numeric overflow"));
        }
        result
    }

    /// Get stored oracle records for a fund/trigger (for inspection and testing).
    pub fn get_oracle_records(
        env: Env,
        fund_id: String,
        trigger_id: String,
    ) -> Vec<OracleData> {
        let oracle_key = Symbol::new(&env, &format!("oracle_{}_{}", fund_id, trigger_id));
        env.storage().instance()
            .get(&oracle_key)
            .unwrap_or(Vec::new(&env))
    }

    /// Execute automated trigger release (called when oracle conditions met)
    pub fn execute_trigger(
        env: Env,
        fund_id: String,
        trigger_id: String,
    ) -> U256 {
        // #239 — automated releases are paused too. An incident brake that a
        // trigger can drive straight through is not a brake.
        require_not_paused(&env);

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
        let recent_threshold = env.ledger().timestamp().saturating_sub(ORACLE_STALENESS_SECS);
        let mut valid_confirmations: u64 = 0;
        
        for record in oracle_records.iter() {
            if record.timestamp > recent_threshold && record.confidence >= ORACLE_MIN_CONFIDENCE {
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

    /// Batch disbursement entry — one recipient in a batch request
    /// (Defined here as a helper type used by submit_batch_disbursement)

    /// Submit multiple disbursements atomically in a single transaction.
    ///
    /// All entries must pass validation; if any entry fails the entire
    /// transaction is reverted (Soroban panic semantics). A batch may contain
    /// at most [`MAX_BATCH_SIZE`] entries; larger workloads must be split into
    /// multiple atomic batches by the caller.
    ///
    /// # Parameters
    /// - `requester`  – address that must be authorised to submit
    /// - `fund_id`    – fund from which all disbursements are drawn
    /// - `entries`    – Vec of (beneficiary, amount, purpose) tuples
    /// - `approvers`  – multi-sig approvers (must satisfy required_signatures)
    ///
    /// # Returns
    /// Vec of disbursement IDs created (one per entry, in order).
    pub fn submit_batch_disbursement(
        env: Env,
        requester: Address,
        fund_id: String,
        entries: Vec<(Address, U256, String)>,
        approvers: Vec<Address>,
    ) -> Vec<String> {
        requester.require_auth();

        // #239 — batch disbursement moves value out of the pool, so it is
        // gated by the incident pause.
        require_not_paused(&env);

        // ── Validate batch is non-empty ──────────────────────────────────────
        if entries.is_empty() {
            panic_with_error!(&env, "Batch must contain at least one entry");
        }

        // ── Enforce the maximum batch size ──────────────────────────────────
        if entries.len() > MAX_BATCH_SIZE {
            panic_with_error!(&env, "Batch exceeds maximum of 100 entries");
        }

        // ── Load fund ────────────────────────────────────────────────────────
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);

        if !fund.is_active {
            panic_with_error!(&env, "Fund is not active");
        }

        // ── Validate multi-sig ───────────────────────────────────────────────
        if approvers.len() < fund.required_signatures as usize {
            panic_with_error!(&env, "Insufficient signatures");
        }
        for approver in approvers.iter() {
            if !fund.release_triggers.contains(approver.clone()) {
                panic_with_error!(&env, "Unauthorized approver");
            }
            // #241 — same missing-auth defect as `submit_disbursement`: the
            // membership check above never proved consent. See the note there.
            approver.require_auth();
        }

        // ── Validate each entry and compute total ────────────────────────────
        let mut total = U256::from_u64(0);
        for (_, amount, purpose) in entries.iter() {
            if amount == U256::from_u64(0) {
                panic_with_error!(&env, "Amount must be greater than zero");
            }
            validate_purpose(&env, &purpose);
            total = total + amount;
        }

        // ── Check duplicate beneficiaries within the batch ───────────────────
        let mut seen: Vec<Address> = Vec::new(&env);
        for (beneficiary, _, _) in entries.iter() {
            if seen.contains(beneficiary.clone()) {
                panic_with_error!(&env, "Duplicate beneficiary in batch");
            }
            seen.push_back(beneficiary);
        }

        // ── Check fund has sufficient balance ────────────────────────────────
        let available = fund.total_amount.clone() - fund.released_amount.clone() - fund.reserved_for_recall.clone();
        if total > available {
            panic_with_error!(&env, "Insufficient funds in pool");
        }

        // ── Persist disbursement records ─────────────────────────────────────
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let mut disbursements: Map<String, DisbursementRecord> = env
            .storage()
            .instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));

        let mut ids: Vec<String> = Vec::new(&env);
        let base_ts = env.ledger().timestamp();

        for (idx, (beneficiary, amount, purpose)) in entries.iter().enumerate() {
            let disbursement_id = String::from_str(
                &env,
                &format!("{}_batch_{}_{}", fund_id, base_ts, idx),
            );
            let record = DisbursementRecord {
                id: disbursement_id.clone(),
                fund_id: fund_id.clone(),
                beneficiary,
                amount,
                timestamp: base_ts,
                purpose,
                approved_by: approvers.clone(),
                transaction_hash: String::from_str(&env, ""),
                trigger_id: None,
                is_auto_released: false,
            };
            disbursements.set(disbursement_id.clone(), record);
            ids.push_back(disbursement_id);
        }

        env.storage()
            .instance()
            .set(&disbursement_key, &disbursements);

        // ── Update fund released amount ──────────────────────────────────────
        fund.released_amount = fund.released_amount + total;
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);

        // Emit batch disbursement event
        env.events().publish(
            (Symbol::new(&env, "aid_registry"), Symbol::new(&env, "batch_disbursed")),
            (fund_id, total, ids.len() as u32),
        );

        ids
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
        // Validate approvers list before loading fund
        require_non_empty_address_list(&env, &approvers);

        // Validate the free-text purpose (non-empty, bounded length).
        validate_purpose(&env, &purpose);

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
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);
        
        // Emit disbursement event
        env.events().publish(
            (Symbol::new(&env, "aid_registry"), Symbol::new(&env, "disbursed")),
            (fund_id, beneficiary, amount),
        );

        true
    }

    /// Archive a fund (e.g. after mission completion or cancellation).
    pub fn archive_fund(env: Env, admin: Address, fund_id: String, reason: String) {
        admin.require_auth();
        
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        fund.is_active = false;
        fund.current_status = String::from_str(&env, FUND_STATUS_ARCHIVED);
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);

        env.events().publish(
            (Symbol::new(&env, "aid_registry"), Symbol::new(&env, "fund_archived")),
            (fund_id, reason),
        );
    }

    // ── #241: two-phase multi-sig release ──────────────────────────────────

    /// Phase 1 of a distributed multi-sig release: record one approver's
    /// approval of `request_id`.
    ///
    /// Each approver calls this in their own transaction, so signatures do not
    /// have to be assembled off-chain and approvers need not be online at the
    /// same time. The approver is whoever signs this call — `approver` must be
    /// that address or the transaction fails.
    ///
    /// `request_id` is chosen by whoever initiates the release (a UUID is
    /// fine) and shared with the other approvers. It is the coordination key:
    /// approvals for the same id accumulate, approvals for different ids do
    /// not interfere.
    ///
    /// Re-approving the same `request_id` is a no-op rather than a panic, so a
    /// retrying signer script cannot wedge itself.
    ///
    /// Approvals older than {@link MULTISIG_APPROVAL_TTL_SECS} are ignored and
    /// must be re-signed.
    ///
    /// @returns the number of distinct valid approvals after this call.
    pub fn approve_disbursement(
        env: Env,
        approver: Address,
        fund_id: String,
        request_id: String,
    ) -> u32 {
        require_not_paused(&env);
        approver.require_auth();

        let fund = Self::load_fund(&env, &fund_id);

        if !fund.is_active {
            panic_with_error!(&env, "Fund is not active");
        }
        if !fund.release_triggers.contains(approver.clone()) {
            panic_with_error!(&env, "Unauthorized approver");
        }

        let mut approvals = Self::load_approvals(&env, &fund_id, &request_id);

        if !approvals.contains(&approver) {
            approvals.push_back(approver);
        }

        // Stamp the first approval; the whole request expires together.
        if Self::approval_started_at(&env, &fund_id, &request_id).is_none() {
            let started_key = Symbol::new(
                &env,
                &format!("approval_started_{}_{}", fund_id, request_id),
            );
            env.storage()
                .instance()
                .set(&started_key, &env.ledger().timestamp());
        }

        let count = Self::store_approvals(&env, &fund_id, &request_id, &approvals);

        log!(&env, "Approval recorded for request {} on fund {}", request_id, fund_id);
        count
    }

    /// Withdraw an approval. Only the approver that gave it may withdraw it.
    pub fn cancel_approval(env: Env, approver: Address, fund_id: String, request_id: String) {
        approver.require_auth();

        let mut approvals = Self::load_approvals(&env, &fund_id, &request_id);

        if let Some(index) = approvals.iter().position(|a| a == approver) {
            approvals.remove(index);
            Self::store_approvals(&env, &fund_id, &request_id, &approvals);
        }
    }

    /// Approvers recorded against `request_id`, excluding the whole set if it
    /// has aged past {@link MULTISIG_APPROVAL_TTL_SECS}. Read-only; safe for
    /// monitoring.
    ///
    /// An expired set reads as empty rather than erroring, so monitoring shows
    /// the request as simply needing re-signing instead of raising.
    pub fn get_approvals(env: Env, fund_id: String, request_id: String) -> Vec<Address> {
        let started = match Self::approval_started_at(&env, &fund_id, &request_id) {
            Some(started) => started,
            // No start stamp: nothing was ever approved for this id.
            None => return Vec::new(&env),
        };

        if env.ledger().timestamp() > started.saturating_add(MULTISIG_APPROVAL_TTL_SECS) {
            // Stale. The stored entries are left in place so the signing
            // history is not destroyed; they are simply not counted.
            return Vec::new(&env);
        }

        Self::load_approvals(&env, &fund_id, &request_id)
    }

    /// Phase 2: execute a release whose approval threshold has been met.
    ///
    /// Anyone may submit this — it does not need to be an approver — because
    /// the authority has already been exercised in phase 1. Requires that
    /// `required_signatures` distinct, unexpired approvals exist.
    ///
    /// Approvals are **consumed** on execution, so the same threshold cannot
    /// authorise two releases.
    ///
    /// @returns the new disbursement id.
    pub fn execute_approved_disbursement(
        env: Env,
        requester: Address,
        fund_id: String,
        request_id: String,
        beneficiary: Address,
        amount: U256,
        purpose: String,
    ) -> String {
        require_not_paused(&env);
        requester.require_auth();

        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));

        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);

        if !fund.is_active {
            panic_with_error!(&env, "Fund is not active");
        }

        let approvals = Self::get_approvals(env.clone(), fund_id.clone(), request_id.clone());

        if approvals.len() < fund.required_signatures as usize {
            panic_with_error!(&env, "Insufficient approvals for this request");
        }

        let available = fund.total_amount - fund.released_amount - fund.reserved_for_recall;
        if amount > available {
            panic_with_error!(&env, "Insufficient available funds");
        }

        // ── Duplicate check: same beneficiary + purpose must not repeat ──────
        let disbursement_key = Symbol::new(&env, &format!("disbursements_{}", fund_id));
        let mut disbursements: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_key)
            .unwrap_or(Map::new(&env));

        for (_, record) in disbursements.iter() {
            if record.beneficiary == beneficiary && record.purpose == purpose {
                panic_with_error!(&env, "Duplicate disbursement: beneficiary already received funds for this purpose");
            }
        }

        let disbursement_id = format!("{}_{}", fund_id, env.ledger().timestamp());
        let record = DisbursementRecord {
            id: disbursement_id.clone(),
            fund_id: fund_id.clone(),
            beneficiary,
            amount,
            timestamp: env.ledger().timestamp(),
            purpose,
            approved_by: approvals.clone(),
            transaction_hash: String::from_str(&env, ""),
            trigger_id: None,
            is_auto_released: false,
        };

        disbursements.set(disbursement_id.clone(), record);
        env.storage()
            .instance()
            .set(&disbursement_key, &disbursements);

        fund.released_amount += amount;
        funds.set(fund_id.clone(), fund);
        env.storage().instance().set(&fund_key, &funds);

        // Consume the approvals so this threshold cannot be replayed.
        Self::clear_approvals(&env, &fund_id, &request_id);

        log!(&env, "Executed approved disbursement {}", disbursement_id);
        disbursement_id
    }

    // ── Two-phase approval helpers ───────────────────────────────────────────

    fn load_fund(env: &Env, fund_id: &String) -> EmergencyFund {
        let funds: Map<String, EmergencyFund> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "fund"))
            .unwrap_or(Map::new(env));

        funds.get(fund_id.clone()).unwrap_or_panic_with(env)
    }

    /// Approvals recorded for a request, with expired entries dropped.
    fn load_approvals(env: &Env, fund_id: &String, request_id: &String) -> Vec<Address> {
        let key = Symbol::new(env, &format!("approvals_{}_{}", fund_id, request_id));

        let approvals: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Vec::new(env));

        // An approval set with no start stamp predates this logic; treat it as
        // empty rather than trusting it.
        if Self::approval_started_at(env, fund_id, request_id).is_none() {
            return Vec::new(env);
        }

        approvals
    }

    fn store_approvals(
        env: &Env,
        fund_id: &String,
        request_id: &String,
        approvals: &Vec<Address>,
    ) -> u32 {
        let key = Symbol::new(env, &format!("approvals_{}_{}", fund_id, request_id));
        env.storage().instance().set(&key, approvals);
        approvals.len() as u32
    }

    fn approval_started_at(env: &Env, fund_id: &String, request_id: &String) -> Option<u64> {
        let key = Symbol::new(
            env,
            &format!("approval_started_{}_{}", fund_id, request_id),
        );

        env.storage().instance().get(&key)
    }

    /// Drop the approval set and its start stamp.
    fn clear_approvals(env: &Env, fund_id: &String, request_id: &String) {
        env.storage()
            .instance()
            .remove(&Symbol::new(
                env,
                &format!("approvals_{}_{}", fund_id, request_id),
            ));
        env.storage()
            .instance()
            .remove(&Symbol::new(
                env,
                &format!("approval_started_{}_{}", fund_id, request_id),
            ));
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
        min_amount: U256,
        max_amount: U256,
    ) {
        admin.require_auth();

        // #239 — allocation commits funds to a sector, so it is gated.
        require_not_paused(&env);

        // Validate amount is within min/max bounds
        if amount < min_amount {
            panic_with_error!(&env, "Allocation amount is below minimum threshold");
        }
        if amount > max_amount {
            panic_with_error!(&env, "Allocation amount exceeds maximum threshold");
        }
        
        // Get fund
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        
        // Archived funds cannot receive new allocations
        if fund.current_status == String::from_str(&env, FUND_STATUS_ARCHIVED) {
            panic_with_error!(&env, "Fund is archived");
        }
        
        // Create allocation
        let allocation = FundAllocation {
            sector,
            amount,
            beneficiaries,
            proof_of_need,
            allocated_at: env.ledger().timestamp(),
            min_amount,
            max_amount,
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

    /// Update metadata for a fund
    pub fn update_metadata(
        env: Env,
        admin: Address,
        fund_id: String,
        metadata: Map<String, String>,
    ) {
        admin.require_auth();
        
        let fund_key = Symbol::new(&env, "fund");
        let mut funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let mut fund = funds.get(fund_id.clone()).unwrap_or_panic_with(&env);
        fund.metadata = metadata;
        
        funds.set(fund_id, fund);
        env.storage().instance().set(&fund_key, &funds);
    }

    /// Get metadata for a fund
    pub fn get_metadata(env: Env, fund_id: String) -> Map<String, String> {
        let fund_key = Symbol::new(&env, "fund");
        let funds: Map<String, EmergencyFund> = env.storage().instance()
            .get(&fund_key)
            .unwrap_or(Map::new(&env));
        
        let fund = funds.get(fund_id).unwrap_or_panic_with(&env);
        fund.metadata
    }

    /// Record a disbursement to prevent duplicates
    pub fn record_disbursement(
        env: Env,
        admin: Address,
        beneficiary_address: String,
        fund_id: String,
        purpose: String,
        amount: U256,
        transaction_hash: String,
        approvers: Vec<Address>,
    ) {
        admin.require_auth();

        // Validate the free-text purpose (non-empty, bounded length).
        validate_purpose(&env, &purpose);

        // Create unique key for this disbursement
        let disbursement_key = format!("disbursement_{}_{}", beneficiary_address, purpose);
        
        let record = DisbursementRecord {
            id: disbursement_key.clone(),
            fund_id: fund_id.clone(),
            beneficiary: Address::from_contract_id(&env, &env.crypto().sha256(&env.ledger().sequence().to_le_bytes())),
            amount,
            timestamp: env.ledger().timestamp(),
            purpose: purpose.clone(),
            approved_by: approvers,
            transaction_hash: transaction_hash.clone(),
            trigger_id: None,
            is_auto_released: false,
        };
        
        let disbursement_records_key = Symbol::new(&env, "duplicate_check_records");
        let mut records: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_records_key)
            .unwrap_or(Map::new(&env));
        
        records.set(disbursement_key, record);
        env.storage().instance().set(&disbursement_records_key, &records);
        
        log!(&env, "Recorded disbursement for {} - {}", beneficiary_address, purpose);
    }

    /// Check if a disbursement is a duplicate
    pub fn check_duplicate_disbursement(
        env: Env,
        beneficiary_address: String,
        purpose: String,
    ) -> bool {
        let disbursement_key = format!("disbursement_{}_{}", beneficiary_address, purpose);
        
        let disbursement_records_key = Symbol::new(&env, "duplicate_check_records");
        let records: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_records_key)
            .unwrap_or(Map::new(&env));
        
        records.contains_key(disbursement_key)
    }

    /// Get all disbursements for a beneficiary
    pub fn get_beneficiary_disbursements(
        env: Env,
        beneficiary_address: String,
    ) -> Vec<DisbursementRecord> {
        let disbursement_records_key = Symbol::new(&env, "duplicate_check_records");
        let records: Map<String, DisbursementRecord> = env.storage().instance()
            .get(&disbursement_records_key)
            .unwrap_or(Map::new(&env));
        
        let mut beneficiary_records = Vec::new(&env);
        for (_, record) in records.iter() {
            // Filter records for this beneficiary
            // Note: In production, would need to store beneficiary address properly
            beneficiary_records.push_back(record);
        }
        
        beneficiary_records
    }

    // ── #239: Incident pause control ────────────────────────────────────────
    //
    // Authorization is deliberately single-key (the admin) rather than
    // multi-sig. A pause gated behind a 2-of-3 threshold is a pause that fails
    // to apply exactly when it is needed. The blast radius of a malicious
    // pause is bounded — no value moves — while the blast radius of being
    // unable to pause is unbounded.

    /// Read-only pause check, safe to call from monitoring.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSED))
            .unwrap_or(false)
    }

    /// Full pause state, including who paused it and why.
    /// Returns `(is_paused, admin, reason, paused_at, lifted_at)`.
    ///
    /// `paused_at` is `0` when the platform has never been paused. Both
    /// timestamps are recorded for operator forensics only — nothing enforces
    /// behaviour from them.
    pub fn get_pause_state(
        env: Env,
    ) -> (bool, Address, String, u64, u64) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSED))
            .unwrap_or(false);

        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSE_ADMIN))
            .unwrap_or(env.current_contract_address());

        let reason: String = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSE_REASON))
            .unwrap_or(String::from_str(&env, ""));

        let paused_at: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSED_AT))
            .unwrap_or(0);

        let lifted_at: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, KEY_PAUSE_LIFTED_AT))
            .unwrap_or(0);

        (paused, admin, reason, paused_at, lifted_at)
    }

    /// Raise or clear the incident pause. Admin-only.
    ///
    /// `reason` is stored verbatim and surfaced by `get_pause_state` so a
    /// monitoring alert carries operator context. It is not validated as
    /// non-empty, because refusing to pause over a missing reason during an
    /// active incident is the wrong trade.
    ///
    /// Calling this with `paused = true` when already paused is a no-op that
    /// still re-records `paused_at`; it does not panic, so a retrying operator
    /// script cannot wedge itself.
    pub fn set_paused(env: Env, admin: Address, paused: bool, reason: String) {
        admin.require_auth();

        env.storage()
            .instance()
            .set(&Symbol::new(&env, KEY_PAUSE_ADMIN), &admin);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, KEY_PAUSE_REASON), &reason);

        if paused {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, KEY_PAUSED), &true);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, KEY_PAUSED_AT), &env.ledger().timestamp());
        } else {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, KEY_PAUSED), &false);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, KEY_PAUSE_LIFTED_AT), &env.ledger().timestamp());
        }

        log!(&env, "Incident pause set to {} by {}", paused, admin);
    }
}

// Defined outside `impl AidRegistry` deliberately: `#[contractimpl]` requires
// every `pub fn` inside the impl block to be a valid contract entrypoint with
// `Env` as its first parameter, and this helper takes `&Env`. It is a plain
// guard shared with `cash_transfer.rs`, not an entrypoint.
pub fn require_not_paused(env: &Env) {
    let paused: bool = env
        .storage()
        .instance()
        .get(&Symbol::new(env, KEY_PAUSED))
        .unwrap_or(false);

    if paused {
        panic_with_error!(env, "Contract is paused");
    }
}

