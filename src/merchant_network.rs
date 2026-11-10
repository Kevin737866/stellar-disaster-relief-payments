//! Merchant onboarding, online/offline payments, QR/USSD helpers, and
//! settlement.
//!
//! Offline capture/sync guarantees, reconciliation steps, expiry, and known
//! abuse-resistance gaps are documented in `docs/offline-flows.md`.

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};
use crate::unique_id::*;

// Merchant categories for spending rules (stored as u32)
pub const CATEGORY_FOOD: u32 = 0;
pub const CATEGORY_WATER: u32 = 1;
pub const CATEGORY_SHELTER: u32 = 2;
pub const CATEGORY_MEDICAL: u32 = 3;
pub const CATEGORY_CLOTHING: u32 = 4;
pub const CATEGORY_FUEL: u32 = 5;

// Merchant status for lifecycle management (stored as u32)
pub const STATUS_PENDING: u32 = 0;
pub const STATUS_TRIAL: u32 = 1;
pub const STATUS_ACTIVE: u32 = 2;
pub const STATUS_SUSPENDED: u32 = 3;
pub const STATUS_GRADUATED: u32 = 4;

// Payment methods (stored as u32)
pub const PAYMENT_QR: u32 = 0;
pub const PAYMENT_USSD: u32 = 1;
pub const PAYMENT_NFC: u32 = 2;
pub const PAYMENT_OFFLINE: u32 = 3;
pub const PAYMENT_ONLINE: u32 = 4;

// Performance optimization constants
/// Maximum transactions to scan for fraud velocity check (bounds iteration)
pub const MAX_FRAUD_VELOCITY_SCAN: u32 = 1000;
/// Maximum risk profiles to scan for high-risk queries
pub const MAX_RISK_PROFILE_SCAN: u32 = 500;
/// Location grid size for spatial indexing (~1km at equator)
pub const LOCATION_GRID_SIZE: f64 = 0.01;
/// Maximum merchants to return in location/category queries
pub const MAX_MERCHANT_RESULTS: u32 = 100;
/// Maximum spatial grid cells scanned per radius lookup (#139).
pub const MAX_GRID_CELLS_SCAN: u32 = 2_500;
/// Graduated merchants receive double the base active daily throughput limit
/// after passing trial volume & fraud screening (#135).
pub const GRADUATED_DAILY_LIMIT_MULTIPLIER: u32 = 2;
/// Minimum payment amount eligible for repeated round-amount fraud alerting (#128).
pub const ROUND_AMOUNT_ALERT_MIN: u64 = 1_000;
/// Minimum rolling window (seconds) before emitting another identical round-amount alert (#128).
pub const ROUND_AMOUNT_DEDUP_SECS: u64 = 3_600;
/// Default validity TTL (seconds) for dynamic payment QR payloads (#136).
pub const DEFAULT_QR_TTL_SECS: u64 = 300;
/// Hard single-payment ceiling above which pre-payment fraud validation blocks settlement (#127).
pub const PRE_VALIDATION_MAX_SINGLE_PAYMENT: u64 = 50_000;

#[contract]
pub struct MerchantNetwork;

/// On-chain merchant record.
///
/// # Privacy model
/// Merchant data is **intentionally public** to support network discovery
/// and trust building.  However, operators should be aware of the following:
///
/// - `name`, `owner`, `contact_info`: All stored as plain text on-chain and
///   readable by any ledger observer.  Ensure merchants consent to this.
/// - `location` (lat/lng): Stored as integers scaled by 1e6.  Consider
///   rounding to 2 decimal places (~1 km precision) for public-facing QR
///   codes to avoid exposing precise shop coordinates.
/// - `verification_documents`: Stored as strings on-chain.  Use opaque
///   document reference IDs rather than actual document content.
/// - `vouchers`: Stellar addresses or beneficiary reference IDs stored
///   on-chain; readable by any ledger observer.
#[derive(Clone)]
pub struct Merchant {
    pub id: String,
    pub name: String,           // Plain text on-chain; ensure merchant consent
    pub owner: Address,
    pub business_type: String,
    pub category: u32, // MerchantCategory enum value
    pub location: Location,     // lat/lng rounded to ≤2dp for public QR; consent required
    pub contact_info: String,   // Plain text on-chain; ensure merchant consent
    pub registration_date: u64,
    pub status: u32, // MerchantStatus enum value
    pub is_verified: bool,
    pub verification_documents: Vec<String>, // Use document reference IDs, not document content
    // Community vouching (#133)
    pub vouchers: Vec<String>, // 3 beneficiary references or 1 NGO field worker
    pub vouching_threshold: u32, // Required vouch points (default 3)
    pub current_vouches: u32,
    pub ngo_vouch_weight: u32, // Points granted per NGO vouch (default equals standard threshold 3)
    pub graduated_limit_multiplier: u32, // Configurable graduated limit multiplier (#135, default 2)
    // Trial period tracking
    pub trial_start_date: u64,
    pub trial_end_date: u64,
    pub trial_daily_limit: U256, // $100/day during trial
    // Regular limits after trial
    pub daily_volume_limit: U256,
    pub monthly_limit: U256,
    pub current_month_volume: U256,
    pub current_day_volume: U256,
    pub last_reset_date: u64,
    // Reputation and fraud prevention
    pub reputation_score: u32, // 0-100
    pub is_active: bool,
    pub emergency_fast_track: bool, // Pre-approved from existing networks
    // Payment methods supported
    pub accepts_qr: bool,
    pub accepts_ussd: bool,
    pub accepts_nfc: bool,
    pub accepts_offline: bool,
    // Settlement
    pub pending_settlement: U256,
    pub last_settlement_date: u64,
}

/// Location with geographic coordinates and descriptive info
/// Uses standardized GeoPoint for coordinates
#[derive(Clone)]
pub struct Location {
    pub coordinates: GeoPoint,
    pub address: String,
    pub city: String,
    pub country: String,
    pub postal_code: String,
}

impl Location {
    /// Create a new Location with coordinates
    pub fn new(latitude: f64, longitude: f64, address: String, city: String, country: String, postal_code: String, env: &Env) -> Result<Self, String> {
        let coordinates = GeoPoint::new(latitude, longitude)?;
        Ok(Location { coordinates, address, city, country, postal_code })
    }

    /// Create from lat,lng string format
    pub fn from_string(lat_lng: String, address: String, city: String, country: String, postal_code: String, env: &Env) -> Result<Self, String> {
        let coordinates = GeoPoint::from_string(env, &lat_lng)?;
        Ok(Location { coordinates, address, city, country, postal_code })
    }

    /// Get latitude
    pub fn latitude(&self) -> f64 {
        self.coordinates.latitude
    }

    /// Get longitude
    pub fn longitude(&self) -> f64 {
        self.coordinates.longitude
    }

    /// Distance to another location (km)
    pub fn distance_to(&self, other: &Location) -> f64 {
        self.coordinates.distance_to(&other.coordinates)
    }
}

#[derive(Clone)]
pub struct Transaction {
    pub id: String,
    pub merchant_id: String,
    pub beneficiary_id: String,
    pub amount: U256,
    pub token: String,
    pub timestamp: u64,
    pub purpose: String,
    /// True when the merchant owner authenticated via Soroban `require_auth()` (#126).
    pub merchant_authorized: bool,
    /// True when the beneficiary authenticated via Soroban `require_auth()` (or offline reconciliation) (#126).
    pub beneficiary_authorized: bool,
    /// Descriptive evidence tag (`"soroban_require_auth"`, `"offline_unverified_pending_reconciliation"`, `"offline_reconciled"`).
    pub auth_evidence: String,
    pub is_settled: bool,
    pub payment_method: u32, // PaymentMethod enum value
}

#[derive(Clone)]
pub struct MonthlyVolumeSnapshot {
    pub merchant_id: String,
    pub period_volume: U256,
    pub reset_at: u64,
}

// Offline transaction for batch sync
#[derive(Clone)]
pub struct OfflineTransaction {
    pub id: String,
    pub merchant_id: String,
    pub beneficiary_id: String,
    pub amount: U256,
    pub token: String,
    pub timestamp: u64,
    pub purpose: String,
    pub signature: String,
    pub is_synced: bool,
}

// Secondary index structures for performance optimization
#[derive(Clone)]
pub struct MerchantIndex {
    /// Merchant IDs by category for O(1) category lookups
    pub by_category: Map<u32, Vec<String>>,
    /// Merchant IDs by location grid for spatial queries
    pub by_location_grid: Map<String, Vec<String>>,
    /// Active merchant IDs for quick active merchant enumeration
    pub active_merchants: Vec<String>,
}

// Fraud detection alert
#[derive(Clone)]
pub struct FraudAlert {
    pub id: String,
    pub merchant_id: String,
    pub alert_type: String,
    pub severity: u32, // 1-10
    pub description: String,
    pub timestamp: u64,
    pub is_resolved: bool,
}

// Settlement record
#[derive(Clone)]
pub struct Settlement {
    pub id: String,
    pub merchant_id: String,
    pub amount: U256,
    pub token: String,
    pub timestamp: u64,
    pub transaction_count: u32,
}

#[contractimpl]
impl MerchantNetwork {
    /// Register a local merchant with simplified onboarding (community vouching)
    /// Target: < 15 minutes onboarding time
    /// 
    /// Location is passed as lat,lng string for standardized geographic representation.
    pub fn register_merchant(
        env: Env,
        owner: Address,
        merchant_id: String,
        name: String,
        business_type: String,
        category: u32,
        location_lat_lng: String,
        location_address: String,
        location_city: String,
        location_country: String,
        location_postal_code: String,
        contact_info: String,
        accepted_tokens: Vec<String>,
        vouchers: Vec<String>, // References: 3 beneficiaries or 1 NGO field worker
        emergency_fast_track: bool, // Pre-approved from existing networks
    ) {
        owner.require_auth();
        
        // Check for duplicate registration
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if merchants.contains_key(merchant_id.clone()) {
            panic_with_error!(&env, "Merchant already registered");
        }
        
        // Determine initial status & verification consistently from a single source of truth (#134):
        // - Fast-track pre-approved merchants start STATUS_ACTIVE, is_active = true, is_verified = true.
        // - Standard trial merchants start STATUS_TRIAL, is_active = false, is_verified = false until vouched or reviewed.
        let (status, daily_limit, trial_days) = if emergency_fast_track {
            (STATUS_ACTIVE, U256::from_u64(10000), 0u64)
        } else {
            (STATUS_TRIAL, U256::from_u64(100), 7u64)
        };
        let (derived_active, derived_verified) = Self::derive_status_booleans(status);
        
        let current_time = env.ledger().timestamp();
        
        // Create standardized location
        let location = Location::from_string(
            location_lat_lng,
            location_address,
            location_city,
            location_country,
            location_postal_code,
            &env
        ).unwrap_or_else(|_| panic!("Invalid location coordinates"));
        
        // Create merchant profile with simplified onboarding
        let merchant = Merchant {
            id: merchant_id.clone(),
            name,
            owner,
            business_type,
            category,
            location,
            contact_info,
            registration_date: current_time,
            status,
            is_verified: derived_verified,
            verification_documents: Vec::new(&env), // Simplified - no documents needed
            vouchers,
            vouching_threshold: 3, // 3 community vouches required
            current_vouches: 0,
            ngo_vouch_weight: 3,
            graduated_limit_multiplier: GRADUATED_DAILY_LIMIT_MULTIPLIER,
            trial_start_date: current_time,
            trial_end_date: current_time + (trial_days * 24 * 60 * 60),
            trial_daily_limit: U256::from_u64(100),
            daily_volume_limit: daily_limit,
            monthly_limit: daily_limit * U256::from_u64(30),
            current_month_volume: U256::from_u64(0),
            current_day_volume: U256::from_u64(0),
            last_reset_date: current_time,
            reputation_score: 50, // Initial reputation
            is_active: derived_active,
            emergency_fast_track,
            accepts_qr: true,
            accepts_ussd: true,
            accepts_nfc: true,
            accepts_offline: true,
            pending_settlement: U256::from_u64(0),
            last_settlement_date: current_time,
        };
        
        merchants.set(merchant_id.clone(), merchant.clone());
        env.storage().instance().set(&merchants_key, &merchants);
        
        // Add to secondary indexes for fast lookups
        Self::index_merchant(&env, &merchant_id, &merchant);
        
        // Add to onboarding queue for vouching
        let onboarding_key = Symbol::new(&env, "onboarding_queue");
        let mut queue: Vec<String> = env.storage().instance()
            .get(&onboarding_key)
            .unwrap_or(Vec::new(&env));
        
        queue.push_back(merchant_id.clone());
        env.storage().instance().set(&onboarding_key, &queue);

        // Emit merchant registration event
        env.events().publish(
            (Symbol::new(&env, "merchant"), Symbol::new(&env, "registered")),
            (merchant_id, owner),
        );
    }
    
    /// Add community vouches for a merchant to satisfy onboarding verification.
    ///
    /// # Policy Semantics: Community Vouching Arithmetic
    ///
    /// - **Vouching Threshold**:
    ///   - Merchants in standard onboarding start with `vouching_threshold = 3` and `current_vouches = 0`.
    ///   - Initial status is `STATUS_PENDING` (0) and `is_active = false`.
    ///
    /// - **Weighted Voucher Arithmetic**:
    ///   - **NGO Field Worker** (`voucher_type == 1`): Carries a weight of **3 points**. A single NGO vouch
    ///     immediately satisfies the threshold (`current_vouches += 3`), enabling 1-step activation.
    ///   - **Beneficiary Reference** (`voucher_type == 0`): Carries a weight of **1 point** (`current_vouches += 1`).
    ///     Requires 3 independent beneficiary vouches to meet threshold.
    ///
    /// - **State Transition**:
    ///   - When `merchant.current_vouches >= merchant.vouching_threshold` and status is `STATUS_PENDING`:
    ///     - Status transitions to `STATUS_TRIAL` (1).
    ///     - `is_verified` becomes `true`.
    ///     - `is_active` becomes `true`.
    ///   - Once in trial, the merchant is subjected to `trial_daily_limit` ($100/day) until graduation.
    ///
    /// - **Fast-Track Exemption**:
    ///   - Merchants registered with `emergency_fast_track: true` bypass the vouching queue completely,
    ///     entering directly as `STATUS_ACTIVE` (2) with standard volume limits.
    fn derive_status_booleans(status: u32) -> (bool, bool) {
        match status {
            STATUS_ACTIVE | STATUS_GRADUATED => (true, true),
            _ => (false, false),
        }
    }

    fn effective_daily_limit(merchant: &Merchant) -> U256 {
        let mult = if merchant.graduated_limit_multiplier == 0 {
            GRADUATED_DAILY_LIMIT_MULTIPLIER
        } else {
            merchant.graduated_limit_multiplier
        };
        match merchant.status {
            STATUS_TRIAL => merchant.trial_daily_limit.clone(),
            STATUS_GRADUATED => merchant.daily_volume_limit.clone() * U256::from_u64(mult as u64),
            _ => merchant.daily_volume_limit.clone(),
        }
    }

    /// Configure vouching threshold and NGO weight for a merchant (#133).
    /// **Required role:** ADMIN
    pub fn configure_vouch_policy(
        env: Env,
        admin: Address,
        merchant_id: String,
        vouching_threshold: u32,
        ngo_vouch_weight: u32,
    ) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);
        if vouching_threshold == 0 || ngo_vouch_weight == 0 {
            panic!("Vouching threshold and weight must be greater than zero");
        }
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        let mut merchant = match merchants.get(merchant_id.clone()) {
            Some(m) => m,
            None => panic_with_error!(&env, "Merchant not found"),
        };
        merchant.vouching_threshold = vouching_threshold;
        merchant.ngo_vouch_weight = ngo_vouch_weight;
        merchants.set(merchant_id, merchant);
        env.storage().instance().set(&merchants_key, &merchants);
    }

    /// Configure graduated daily throughput limit multiplier for a merchant (#135).
    /// **Required role:** ADMIN
    pub fn configure_limit_progression(
        env: Env,
        admin: Address,
        merchant_id: String,
        graduated_limit_multiplier: u32,
    ) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);
        if graduated_limit_multiplier == 0 {
            panic!("Graduated limit multiplier must be at least 1");
        }
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        let mut merchant = match merchants.get(merchant_id.clone()) {
            Some(m) => m,
            None => panic_with_error!(&env, "Merchant not found"),
        };
        merchant.graduated_limit_multiplier = graduated_limit_multiplier;
        merchants.set(merchant_id, merchant);
        env.storage().instance().set(&merchants_key, &merchants);
    }

    pub fn add_vouch(
        env: Env,
        voucher: Address,
        merchant_id: String,
        voucher_type: u32, // 0 = beneficiary (weight: 1), 1 = ngo (weight: ngo_vouch_weight)
    ) {
        voucher.require_auth();
        if voucher_type > 1 {
            panic!("Invalid voucher_type: expected 0 (beneficiary) or 1 (NGO)");
        }

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            let voucher_id = format!("vouch_{}", voucher.to_string());
            let voucher_str = String::from_str(&env, &voucher_id);
            if merchant.vouchers.contains(&voucher_str) {
                panic!("Duplicate vouch from same address");
            }
            merchant.vouchers.push_back(voucher_str);

            // Apply configured NGO weight (defaults to 3, respects custom thresholds) (#133)
            let increment = if voucher_type == 1 {
                if merchant.ngo_vouch_weight == 0 {
                    3
                } else {
                    merchant.ngo_vouch_weight
                }
            } else {
                1
            };
            merchant.current_vouches += increment;

            let threshold_met = merchant.current_vouches >= merchant.vouching_threshold;
            if threshold_met && (merchant.status == STATUS_PENDING || merchant.status == STATUS_TRIAL) {
                merchant.status = STATUS_ACTIVE;
                let (active, verified) = Self::derive_status_booleans(merchant.status);
                merchant.is_active = active;
                merchant.is_verified = verified;
                Self::update_merchant_active_status(&env, &merchant_id, true);
            }

            merchants.set(merchant_id, merchant);
            env.storage().instance().set(&merchants_key, &merchants);
        }
    }
    
    /// Process payment from beneficiary to merchant
    /// Sub-3 second processing for online, < 1 hour for offline sync
    pub fn process_payment(
        env: Env,
        merchant: Address,
        beneficiary: Address,
        merchant_id: String,
        beneficiary_id: String,
        amount: U256,
        token: String,
        purpose: String,
        payment_method: u32,
    ) -> String {
        merchant.require_auth();
        beneficiary.require_auth();
        
        // Verify merchant exists and is active
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut merchant_profile = match merchants.get(merchant_id.clone()) {
            Some(m) => m,
            None => panic_with_error!(&env, "Merchant not found"),
        };
        
        if merchant != merchant_profile.owner {
            panic!("Unauthorized: signer is not the merchant owner");
        }
        
        if !merchant_profile.is_active {
            panic_with_error!(&env, "Merchant is not active");
        }
        
        // Check if token is accepted
        if !merchant_profile.accepted_tokens.contains(&token) {
            panic_with_error!(&env, "Token not accepted by merchant");
        }
        
        // Check explicit configurable daily limit (#135)
        let daily_limit = Self::effective_daily_limit(&merchant_profile);

        if merchant_profile.current_day_volume + amount > daily_limit {
            panic_with_error!(&env, "Amount exceeds daily limit");
        }

        if merchant_profile.current_month_volume + amount > merchant_profile.monthly_limit {
            panic_with_error!(&env, "Amount exceeds monthly limit");
        }

        // Pre-payment fraud validation BEFORE mutating volume or pending settlement (#127)
        let amount_u64: u64 = amount.clone().into();
        if amount_u64 > PRE_VALIDATION_MAX_SINGLE_PAYMENT {
            Self::fraud_detection(env.clone(), merchant_id.clone(), amount.clone());
            panic_with_error!(&env, "Payment blocked by pre-settlement fraud threshold");
        }
        Self::fraud_detection(env.clone(), merchant_id.clone(), amount.clone());

        // Create transaction record with real Soroban auth evidence (no fake placeholder strings) (#126)
        let transaction_id = generate_merchant_txn_id(&env, &merchant_id);
        let transaction = Transaction {
            id: transaction_id.clone(),
            merchant_id: merchant_id.clone(),
            beneficiary_id: beneficiary_id.clone(),
            amount: amount.clone(),
            token: token.clone(),
            timestamp: env.ledger().timestamp(),
            purpose,
            merchant_authorized: true,
            beneficiary_authorized: true,
            auth_evidence: String::from_str(&env, "soroban_require_auth"),
            is_settled: false,
            payment_method,
        };

        // Store transaction in persistent storage so history survives temporary TTL eviction (#138)
        let transactions_key = Symbol::new(&env, "transactions");
        let mut transactions: Map<String, Transaction> = env
            .storage()
            .persistent()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        transactions.set(transaction_id.clone(), transaction);
        env.storage().persistent().set(&transactions_key, &transactions);

        // Update merchant volume & per-token pending settlement (#131)
        merchant_profile.current_day_volume += amount.clone();
        merchant_profile.current_month_volume += amount.clone();
        merchant_profile.pending_settlement += amount.clone();
        Self::accrue_token_pending(&env, &merchant_id, &token, &amount);

        merchants.set(merchant_id.clone(), merchant_profile);
        env.storage().instance().set(&merchants_key, &merchants);

        // Emit payment processed event
        env.events().publish(
            (Symbol::new(&env, "merchant"), Symbol::new(&env, "payment_processed")),
            (merchant_id, beneficiary_id, amount),
        );

        transaction_id
    }
    
    /// Process offline transaction (batched and synced when connectivity returns).
    ///
    /// This only stores the record for later sync. It does **not** verify the
    /// supplied `signature`, enforce merchant daily/monthly limits, or apply an
    /// expiry. Reconcile against beneficiary receipts before settlement; see
    /// `docs/offline-flows.md`.
    pub fn process_offline_payment(
        env: Env,
        merchant_id: String,
        beneficiary_id: String,
        amount: U256,
        token: String,
        purpose: String,
        signature: String,
    ) -> String {
        // Verify merchant exists and is active
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let merchant_profile = match merchants.get(merchant_id.clone()) {
            Some(m) => m,
            None => panic_with_error!(&env, "Merchant not found"),
        };
        
        if !merchant_profile.is_active || !merchant_profile.accepts_offline {
            panic_with_error!(&env, "Merchant does not accept offline payments");
        }
        // Require a non-trivial cryptographic/voucher signature payload (>=16 bytes) (#129)
        if signature.to_string().trim().len() < 16 {
            panic!("Invalid offline signature payload: minimum 16 characters required");
        }

        // Create offline transaction (stored persistently until synced/reconciled) (#138)
        let transaction_id = generate_offline_txn_id(&env, &merchant_id);
        let offline_tx = OfflineTransaction {
            id: transaction_id.clone(),
            merchant_id: merchant_id.clone(),
            beneficiary_id,
            amount,
            token,
            timestamp: env.ledger().timestamp(),
            purpose,
            signature,
            is_synced: false,
        };

        let offline_key = Symbol::new(&env, "offline_transactions");
        let mut offline_txs: Map<String, OfflineTransaction> = env
            .storage()
            .persistent()
            .get(&offline_key)
            .unwrap_or(Map::new(&env));

        offline_txs.set(transaction_id.clone(), offline_tx);
        env.storage().persistent().set(&offline_key, &offline_txs);

        transaction_id
    }

    /// Sync offline transactions with persistent cross-state idempotency (#130, #138).
    ///
    /// Tracks settled offline IDs in persistent `synced_offline_ids` storage AND verifies
    /// `offline_tx.merchant_id == merchant_id` so duplicate syncs across state resets never
    /// double-count volume or pending settlements.
    pub fn sync_offline_transactions(
        env: Env,
        merchant_id: String,
        offline_transaction_ids: Vec<String>,
    ) -> u32 {
        let offline_key = Symbol::new(&env, "offline_transactions");
        let mut offline_txs: Map<String, OfflineTransaction> = env
            .storage()
            .persistent()
            .get(&offline_key)
            .unwrap_or(Map::new(&env));

        let synced_set_key = Symbol::new(&env, "synced_offline_ids");
        let mut synced_ids: Map<String, bool> = env
            .storage()
            .persistent()
            .get(&synced_set_key)
            .unwrap_or(Map::new(&env));

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));

        let transactions_key = Symbol::new(&env, "transactions");
        let mut transactions: Map<String, Transaction> = env
            .storage()
            .persistent()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        let mut synced_count = 0u32;

        for tx_id in offline_transaction_ids.iter() {
            if synced_ids.get(tx_id.clone()).unwrap_or(false) {
                continue;
            }
            if let Some(mut offline_tx) = offline_txs.get(tx_id.clone()) {
                if !offline_tx.is_synced && offline_tx.merchant_id == merchant_id {
                    offline_tx.is_synced = true;
                    offline_txs.set(tx_id.clone(), offline_tx.clone());
                    synced_ids.set(tx_id.clone(), true);

                    if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
                        merchant.current_day_volume += offline_tx.amount.clone();
                        merchant.current_month_volume += offline_tx.amount.clone();
                        merchant.pending_settlement += offline_tx.amount.clone();
                        Self::accrue_token_pending(&env, &merchant_id, &offline_tx.token, &offline_tx.amount);
                        merchants.set(merchant_id.clone(), merchant);
                    }

                    let transaction_id = format!("offline_tx_{}", offline_tx.id);
                    if !transactions.contains_key(transaction_id.clone()) {
                        let transaction = Transaction {
                            id: transaction_id.clone(),
                            merchant_id: merchant_id.clone(),
                            beneficiary_id: offline_tx.beneficiary_id,
                            amount: offline_tx.amount,
                            token: offline_tx.token,
                            timestamp: offline_tx.timestamp,
                            purpose: offline_tx.purpose,
                            merchant_authorized: false,
                            beneficiary_authorized: false,
                            auth_evidence: String::from_str(&env, "offline_reconciled_unverified_sig"),
                            is_settled: false,
                            payment_method: PAYMENT_OFFLINE,
                        };
                        transactions.set(transaction_id, transaction);
                    }

                    synced_count += 1;
                }
            }
        }

        env.storage().persistent().set(&offline_key, &offline_txs);
        env.storage().persistent().set(&synced_set_key, &synced_ids);
        env.storage().persistent().set(&transactions_key, &transactions);
        env.storage().instance().set(&merchants_key, &merchants);

        synced_count
    }
    
    /// Fraud detection - Pattern analysis for suspicious merchant activity
    /// Target: < 0.5% fraud rate
    pub fn fraud_detection(env: Env, merchant_id: String, amount: U256) {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let merchant = match merchants.get(merchant_id.clone()) {
            Some(m) => m,
            None => return,
        };
        
        let mut alerts: Vec<FraudAlert> = Vec::new(&env);
        let alerts_key = Symbol::new(&env, "fraud_alerts");
        
        if let Some(existing) = env.storage().instance().get(&alerts_key) {
            alerts = existing;
        }
        
        // Pattern 1: Unusually large transaction
        let amount_u64: u64 = amount.into();
        if amount_u64 > 5000 {
            let alert = FraudAlert {
                id: generate_fraud_alert_id(&env, &merchant_id, "large"),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "large_transaction"),
                severity: 7,
                description: String::from_str(&env, "Unusually large transaction detected"),
                timestamp: env.ledger().timestamp(),
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        // Pattern 2: High velocity (many transactions in short time) - bounded scan
        let transactions_key = Symbol::new(&env, "transactions");
        let transactions: Map<String, Transaction> = env
            .storage()
            .persistent()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        let mut recent_count = 0u32;
        let mut scanned = 0u32;
        let current_time = env.ledger().timestamp();
        let one_hour_ago = current_time.saturating_sub(3600);
        
        for (_, tx) in transactions.iter() {
            if scanned >= MAX_FRAUD_VELOCITY_SCAN {
                break; // Bound the scan for performance
            }
            scanned += 1;
            
            if tx.merchant_id == merchant_id && tx.timestamp > one_hour_ago {
                recent_count += 1;
                if recent_count > 20 {
                    break; // Early exit when threshold exceeded
                }
            }
        }
        
        if recent_count > 20 {
            let alert = FraudAlert {
                id: generate_fraud_alert_id(&env, &merchant_id, "velocity"),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "high_velocity"),
                severity: 8,
                description: String::from_str(&env, "High transaction velocity detected"),
                timestamp: current_time,
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        // Pattern 3: Large round-amount alert with context floor & 1h deduplication (#128)
        if amount_u64 >= ROUND_AMOUNT_ALERT_MIN && amount_u64 % 100 == 0 {
            let round_type = String::from_str(&env, "round_amount");
            let mut recently_alerted = false;
            for existing_alert in alerts.iter() {
                if existing_alert.merchant_id == merchant_id
                    && existing_alert.alert_type == round_type
                    && !existing_alert.is_resolved
                    && current_time.saturating_sub(existing_alert.timestamp) < ROUND_AMOUNT_DEDUP_SECS
                {
                    recently_alerted = true;
                    break;
                }
            }
            if !recently_alerted {
                let alert = FraudAlert {
                    id: generate_fraud_alert_id(&env, &merchant_id, "round"),
                    merchant_id: merchant_id.clone(),
                    alert_type: round_type,
                    severity: 3,
                    description: String::from_str(&env, "High-value round amount transaction"),
                    timestamp: current_time,
                    is_resolved: false,
                };
                alerts.push_back(alert);
            }
        }
        
        // Pattern 4: New merchant with high volume
        if merchant.status == STATUS_TRIAL && merchant.current_month_volume > U256::from_u64(1000) {
            let alert = FraudAlert {
                id: generate_fraud_alert_id(&env, &merchant_id, "new_merchant"),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "new_merchant_high_volume"),
                severity: 6,
                description: String::from_str(&env, "Trial period merchant exceeding expected volume"),
                timestamp: current_time,
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        env.storage().instance().set(&alerts_key, &alerts);
    }
    
    /// Get fraud alerts for a merchant
    pub fn get_fraud_alerts(env: Env, merchant_id: String) -> Vec<FraudAlert> {
        let alerts_key = Symbol::new(&env, "fraud_alerts");
        let all_alerts: Vec<FraudAlert> = env.storage().instance()
            .get(&alerts_key)
            .unwrap_or(Vec::new(&env));
        
        let mut merchant_alerts = Vec::new(&env);
        for alert in all_alerts.iter() {
            if alert.merchant_id == merchant_id {
                merchant_alerts.push_back(alert);
            }
        }
        merchant_alerts
    }
    
    /// Settle outstanding merchant balances and record settlement history.
    ///
    /// # Policy Semantics: Settlement & Settlement Token
    ///
    /// - **Settlement Token**:
    ///   - The settlement currency is standardized as `"USDC"` (Soroban token string representation).
    ///   - All settlement records created by this function explicitly designate `"USDC"` as their settlement token.
    ///
    /// - **Pending Balance Accrual**:
    ///   - Every approved payment (via `process_payment` online or reconciled offline payment via `sync_offline_transactions`)
    ///     increments `merchant.pending_settlement` by the transaction amount.
    ///
    /// - **Batch Settlement Execution**:
    ///   - Invocation requires Admin authorization (`admin.require_auth()`).
    ///   - Iterates across all registered merchants in storage.
    ///   - For every merchant where `pending_settlement > 0`:
    ///     1. Mints a unique `Settlement` record (`id: "settle_{merchant_id}_{timestamp}"`).
    ///     2. Assigns `amount = merchant.pending_settlement`, `token = "USDC"`.
    ///     3. Stores the record in the `"settlements"` storage map.
    ///     4. Resets `merchant.pending_settlement` to 0.
    ///     5. Updates `merchant.last_settlement_date` to current ledger timestamp.
    ///   - Returns the total count of settled merchants.
    ///
    /// # Edge Cases
    /// - Zero pending balances: Merchants with `pending_settlement == 0` are skipped; no settlement record created.
    /// - Partial/unsettled transactions: Offline transactions must be synced via `sync_offline_transactions`
    ///   before they appear in `pending_settlement`.
    pub fn settle_balances(env: Env, admin: Address) -> u32 {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_OPERATOR);
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut settlement_count = 0u32;
        let current_time = env.ledger().timestamp();
        
        let settlements_key = Symbol::new(&env, "settlements");
        let mut settlements: Map<String, Settlement> = env
            .storage()
            .instance()
            .get(&settlements_key)
            .unwrap_or(Map::new(&env));

        let pending_tok_key = Symbol::new(&env, "pending_by_token");
        let mut pending_by_token: Map<String, Map<String, U256>> = env
            .storage()
            .instance()
            .get(&pending_tok_key)
            .unwrap_or(Map::new(&env));

        for (merchant_id, mut merchant) in merchants.iter() {
            if merchant.pending_settlement > U256::from_u64(0) {
                let tok_map = pending_by_token
                    .get(merchant_id.clone())
                    .unwrap_or(Map::new(&env));
                let mut emitted_for_merchant = false;

                for (tok, tok_amount) in tok_map.iter() {
                    if tok_amount > U256::from_u64(0) {
                        let settlement_id = format!("settle_{}_{}_{}", merchant_id, tok, current_time);
                        let settlement = Settlement {
                            id: settlement_id.clone(),
                            merchant_id: merchant_id.clone(),
                            amount: tok_amount,
                            token: tok,
                            timestamp: current_time,
                            transaction_count: 0,
                        };
                        settlements.set(settlement_id, settlement);
                        emitted_for_merchant = true;
                    }
                }

                // Fallback for legacy balances settled before per-token tracking
                if !emitted_for_merchant {
                    let settlement_id = format!("settle_{}_{}", merchant_id, current_time);
                    let settlement = Settlement {
                        id: settlement_id.clone(),
                        merchant_id: merchant_id.clone(),
                        amount: merchant.pending_settlement.clone(),
                        token: String::from_str(&env, "USDC"),
                        timestamp: current_time,
                        transaction_count: 0,
                    };
                    settlements.set(settlement_id, settlement);
                }

                pending_by_token.set(merchant_id.clone(), Map::new(&env));
                merchant.pending_settlement = U256::from_u64(0);
                merchant.last_settlement_date = current_time;

                merchants.set(merchant_id, merchant);
                settlement_count += 1;
            }
        }

        env.storage().instance().set(&settlements_key, &settlements);
        env.storage().instance().set(&pending_tok_key, &pending_by_token);
        
        env.storage().instance().set(&merchants_key, &merchants);

        env.events().publish(
            (Symbol::new(&env, "merchant"), Symbol::new(&env, "balances_settled")),
            (settlement_count, current_time),
        );

        settlement_count
    }
    
    /// Review trial merchant for graduation
    pub fn review_trial_merchant(
        env: Env,
        admin: Address,
        merchant_id: String,
        approve: bool,
    ) {
        admin.require_auth();
        rbac::require_role(&env, &admin, ROLE_ADMIN);
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            if merchant.status == STATUS_TRIAL {
                let was_active = merchant.is_active;
                if approve {
                    // Graduate: derive active/verified consistently from STATUS_GRADUATED (#134)
                    merchant.status = STATUS_GRADUATED;
                    let (active, verified) = Self::derive_status_booleans(STATUS_GRADUATED);
                    merchant.is_active = active;
                    merchant.is_verified = verified;
                    merchant.daily_volume_limit = merchant.daily_volume_limit * U256::from_u64(5);
                    merchant.monthly_limit = merchant.monthly_limit * U256::from_u64(5);
                    merchant.reputation_score = (merchant.reputation_score + 20).min(100);
                } else {
                    merchant.status = STATUS_SUSPENDED;
                    let (active, verified) = Self::derive_status_booleans(STATUS_SUSPENDED);
                    merchant.is_active = active;
                    merchant.is_verified = verified;
                }
                
                // Update active status in index if changed
                if merchant.is_active != was_active {
                    Self::update_merchant_active_status(&env, &merchant_id, merchant.is_active);
                }
                
                merchants.set(merchant_id.clone(), merchant);
                env.storage().instance().set(&merchants_key, &merchants);

                env.events().publish(
                    (Symbol::new(&env, "merchant"), Symbol::new(&env, "trial_reviewed")),
                    (merchant_id, approve),
                );
            }
        }
    }
    
    /// Generate static QR code for shop.
    ///
    /// The payload is unsigned public directory data (`merchant_id|category|lat|lng|name`)
    /// and carries no expiry. It is not a payment authorisation.
    pub fn generate_shop_qr(env: Env, merchant_id: String) -> String {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(merchant) = merchants.get(merchant_id) {
            // Return QR data in format: merchant_id|category|lat|lng|name
            format!(
                "{}|{}|{}|{}|{}",
                merchant_id,
                merchant.category,
                merchant.location.latitude,
                merchant.location.longitude,
                merchant.name
            )
        } else {
            String::from_str(&env, "")
        }
    }
    
    fn accrue_token_pending(env: &Env, merchant_id: &String, token: &String, amount: &U256) {
        let key = Symbol::new(env, "pending_by_token");
        let mut all: Map<String, Map<String, U256>> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or(Map::new(env));
        let mut merchant_tok = all.get(merchant_id.clone()).unwrap_or(Map::new(env));
        let prev = merchant_tok.get(token.clone()).unwrap_or(U256::from_u64(0));
        merchant_tok.set(token.clone(), prev + amount.clone());
        all.set(merchant_id.clone(), merchant_tok);
        env.storage().instance().set(&key, &all);
    }

    /// Generate scoped, time-limited dynamic QR token for checkout (#136).
    ///
    /// Does NOT include plaintext transfer codes or amounts; instead embeds a
    /// SHA-256 commitment prefix bound to `(merchant_id, transfer_code, amount, expires_at)`
    /// valid for `DEFAULT_QR_TTL_SECS` (300s).
    pub fn generate_transaction_qr(
        env: Env,
        merchant_id: String,
        amount: U256,
        transfer_code: String,
    ) -> String {
        let expires_at = env.ledger().timestamp() + DEFAULT_QR_TTL_SECS;
        let preimage = format!("{}|{}|{}|{}", merchant_id, amount.to_string(), transfer_code, expires_at);
        let digest = env.crypto().sha256(&String::from_str(&env, &preimage).into());
        let bytes = digest.to_array();
        format!(
            "{}|{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}|{}",
            merchant_id, bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], expires_at
        )
    }

    /// Validate a dynamic QR payload generated by `generate_transaction_qr` against
    /// expected merchant, amount, transfer code, and ledger timestamp (#136).
    pub fn validate_transaction_qr(
        env: Env,
        qr_payload: String,
        merchant_id: String,
        amount: U256,
        transfer_code: String,
    ) -> bool {
        let raw = qr_payload.to_string();
        let parts: std::vec::Vec<&str> = raw.split('|').collect();
        if parts.len() != 3 {
            return false;
        }
        let qr_merchant = parts[0];
        let qr_tag = parts[1];
        let expires_at = match parts[2].parse::<u64>() {
            Ok(ts) => ts,
            Err(_) => return false,
        };
        if qr_merchant != merchant_id.to_string() || env.ledger().timestamp() > expires_at {
            return false;
        }
        let preimage = format!("{}|{}|{}|{}", merchant_id, amount.to_string(), transfer_code, expires_at);
        let digest = env.crypto().sha256(&String::from_str(&env, &preimage).into());
        let bytes = digest.to_array();
        let expected_tag = format!("{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}", bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
        qr_tag == expected_tag
    }

    /// Strictly parse USSD code: `*<merchant_code>*<positive_integer_amount>#` (#137).
    ///
    /// Rejects missing `*` prefix, missing `#` suffix, extra segments, empty/invalid merchant
    /// identifiers, non-digit amounts, or zero amounts by returning `("", 0)`.
    pub fn parse_ussd_code(env: Env, code: String) -> (String, U256) {
        let raw = code.to_string();
        if !raw.starts_with('*') || !raw.ends_with('#') {
            return (String::from_str(&env, ""), U256::from_u64(0));
        }
        let inner = &raw[1..raw.len() - 1];
        let mut iter = inner.split('*');
        let merchant_code = match iter.next() {
            Some(m) if !m.is_empty() && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') => m,
            _ => return (String::from_str(&env, ""), U256::from_u64(0)),
        };
        let amount_str = match iter.next() {
            Some(a) if !a.is_empty() && a.bytes().all(|b| b.is_ascii_digit()) => a,
            _ => return (String::from_str(&env, ""), U256::from_u64(0)),
        };
        if iter.next().is_some() {
            return (String::from_str(&env, ""), U256::from_u64(0));
        }
        let parsed = match amount_str.parse::<u64>() {
            Ok(v) if v > 0 => v,
            _ => return (String::from_str(&env, ""), U256::from_u64(0)),
        };
        (String::from_str(&env, merchant_code), U256::from_u64(parsed))
    }
    
    /// Get merchant details
    pub fn get_merchant(env: Env, merchant_id: String) -> Option<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        merchants.get(merchant_id)
    }
    
    /// Find merchants by location (geographic search) - optimized with spatial grid index
    pub fn find_merchants_by_location(
        env: Env,
        latitude: f64,
        longitude: f64,
        radius_km: f64,
    ) -> Vec<Merchant> {
        let center = GeoPoint::new(latitude, longitude).unwrap();
        let bounds = GeoBounds::from_radius(&center, radius_km);
        
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let index = Self::get_merchant_index(&env);
        
        // Calculate grid range to search
        // 1 degree lat ~= 111km, 1 degree lon ~= 111km * cos(lat)
        let lat_delta = radius_km / 111.0;
        let lon_delta = radius_km / (111.0 * latitude.cos().max(0.1));
        
        let grid_lat_start = ((latitude - lat_delta) / LOCATION_GRID_SIZE).floor() as i64;
        let grid_lat_end = ((latitude + lat_delta) / LOCATION_GRID_SIZE).floor() as i64;
        let grid_lon_start = ((longitude - lon_delta) / LOCATION_GRID_SIZE).floor() as i64;
        let grid_lon_end = ((longitude + lon_delta) / LOCATION_GRID_SIZE).floor() as i64;
        
        if !radius_km.is_finite() || radius_km < 0.0 {
            panic!("Radius must be finite and non-negative");
        }

        let mut nearby_merchants = Vec::new(&env);
        let mut count = 0u32;
        let mut cells_scanned = 0u32;

        // Iterate over grid cells in range with explicit cell + result caps (#139)
        'grid: for grid_lat in grid_lat_start..=grid_lat_end {
            for grid_lon in grid_lon_start..=grid_lon_end {
                if count >= MAX_MERCHANT_RESULTS || cells_scanned >= MAX_GRID_CELLS_SCAN {
                    break 'grid;
                }
                cells_scanned += 1;
                let grid_key = String::from_str(&env, &format!("grid_{}_{}", grid_lat, grid_lon));
                
                if let Some(grid_merchant_ids) = index.by_location_grid.get(grid_key) {
                    for merchant_id in grid_merchant_ids.iter() {
                        if count >= MAX_MERCHANT_RESULTS {
                            break;
                        }
                        if let Some(merchant) = merchants.get(merchant_id) {
                            if merchant.is_active {
                                let distance = Self::calculate_distance(
                                    latitude, longitude,
                                    merchant.location.latitude, merchant.location.longitude
                                );
                                
                                if distance <= radius_km {
                                    nearby_merchants.push_back(merchant);
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        nearby_merchants
    }
    
    /// Find merchants by category (optimized with secondary index)
    pub fn find_merchants_by_category(
        env: Env,
        category: u32,
    ) -> Vec<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let index = Self::get_merchant_index(&env);
        let category_merchant_ids: Vec<String> = index.by_category
            .get(category)
            .unwrap_or(Vec::new(&env));
        
        let mut category_merchants = Vec::new(&env);
        let mut count = 0u32;
        
        for merchant_id in category_merchant_ids.iter() {
            if count >= MAX_MERCHANT_RESULTS {
                break;
            }
            if let Some(merchant) = merchants.get(merchant_id) {
                if merchant.is_active {
                    category_merchants.push_back(merchant);
                    count += 1;
                }
            }
        }
        
        category_merchants
    }
    
    /// Simple distance calculation (Haversine formula approximation)
    fn calculate_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
        let r = 6371.0; // Earth's radius in km
        let dlat = (lat2 - lat1).to_radians();
        let dlon = (lon2 - lon1).to_radians();
        let a = (dlat / 2.0).sin().powi(2) +
                lat1.to_radians().cos() * lat2.to_radians().cos() *
                (dlon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
        r * c
    }

    /// Compute location grid key for spatial indexing
    /// Grid size ~1km at equator (0.01 degrees)
    fn location_grid_key(latitude: f64, longitude: f64) -> String {
        let grid_lat = (latitude / LOCATION_GRID_SIZE).floor() as i64;
        let grid_lon = (longitude / LOCATION_GRID_SIZE).floor() as i64;
        String::from_str(&env, &format!("grid_{}_{}", grid_lat, grid_lon))
    }

    /// Get or create merchant index
    fn get_merchant_index(env: &Env) -> MerchantIndex {
        let index_key = Symbol::new(env, "merchant_index");
        env.storage().instance()
            .get(&index_key)
            .unwrap_or(MerchantIndex {
                by_category: Map::new(env),
                by_location_grid: Map::new(env),
                active_merchants: Vec::new(env),
            })
    }

    /// Save merchant index
    fn save_merchant_index(env: &Env, index: &MerchantIndex) {
        let index_key = Symbol::new(env, "merchant_index");
        env.storage().instance().set(&index_key, index);
    }

    /// Add merchant to secondary indexes
    fn index_merchant(env: &Env, merchant_id: &String, merchant: &Merchant) {
        let mut index = Self::get_merchant_index(env);
        
        // Index by category
        let mut category_vec: Vec<String> = index.by_category
            .get(merchant.category)
            .unwrap_or(Vec::new(env));
        category_vec.push_back(merchant_id.clone());
        index.by_category.set(merchant.category, category_vec);
        
        // Index by location grid
        let grid_key = Self::location_grid_key(merchant.location.latitude, merchant.location.longitude);
        let mut grid_vec: Vec<String> = index.by_location_grid
            .get(grid_key.clone())
            .unwrap_or(Vec::new(env));
        grid_vec.push_back(merchant_id.clone());
        index.by_location_grid.set(grid_key, grid_vec);
        
        // Track active merchants
        if merchant.is_active {
            index.active_merchants.push_back(merchant_id.clone());
        }
        
        Self::save_merchant_index(env, &index);
    }

    /// Remove merchant from secondary indexes
    fn unindex_merchant(env: &Env, merchant_id: &String, merchant: &Merchant) {
        let mut index = Self::get_merchant_index(env);
        
        // Remove from category index
        if let Some(mut category_vec) = index.by_category.get(merchant.category) {
            let mut new_vec = Vec::new(env);
            for id in category_vec.iter() {
                if id != *merchant_id {
                    new_vec.push_back(id);
                }
            }
            index.by_category.set(merchant.category, new_vec);
        }
        
        // Remove from location grid index
        let grid_key = Self::location_grid_key(merchant.location.latitude, merchant.location.longitude);
        if let Some(mut grid_vec) = index.by_location_grid.get(grid_key.clone()) {
            let mut new_vec = Vec::new(env);
            for id in grid_vec.iter() {
                if id != *merchant_id {
                    new_vec.push_back(id);
                }
            }
            index.by_location_grid.set(grid_key, new_vec);
        }
        
        // Remove from active merchants
        let mut new_active = Vec::new(env);
        for id in index.active_merchants.iter() {
            if id != *merchant_id {
                new_vec.push_back(id);
            }
        }
        index.active_merchants = new_active;
        
        Self::save_merchant_index(env, &index);
    }

    /// Update merchant active status in index
    fn update_merchant_active_status(env: &Env, merchant_id: &String, is_active: bool) {
        let mut index = Self::get_merchant_index(env);
        
        if is_active {
            // Add to active if not already present
            let mut found = false;
            for id in index.active_merchants.iter() {
                if id == *merchant_id {
                    found = true;
                    break;
                }
            }
            if !found {
                index.active_merchants.push_back(merchant_id.clone());
            }
        } else {
            // Remove from active
            let mut new_active = Vec::new(env);
            for id in index.active_merchants.iter() {
                if id != *merchant_id {
                    new_active.push_back(id);
                }
            }
            index.active_merchants = new_active;
        }
        
        Self::save_merchant_index(env, &index);
    }
    
    /// Get merchant transaction history (backed by persistent storage) (#138).
    pub fn get_merchant_transactions(env: Env, merchant_id: String) -> Vec<Transaction> {
        let transactions_key = Symbol::new(&env, "transactions");
        let transactions: Map<String, Transaction> = env
            .storage()
            .persistent()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));

        let mut merchant_transactions = Vec::new(&env);
        for (_, transaction) in transactions.iter() {
            if transaction.merchant_id == merchant_id {
                merchant_transactions.push_back(transaction);
                if merchant_transactions.len() >= MAX_MERCHANT_RESULTS {
                    break;
                }
            }
        }
        merchant_transactions
    }
    
    /// Get settlement history for a merchant
    pub fn get_settlement_history(env: Env, merchant_id: String) -> Vec<Settlement> {
        let settlements_key = Symbol::new(&env, "settlements");
        let settlements: Map<String, Settlement> = env.storage().instance()
            .get(&settlements_key)
            .unwrap_or(Map::new(&env));
        
        let mut merchant_settlements = Vec::new(&env);
        for (_, settlement) in settlements.iter() {
            if settlement.merchant_id == merchant_id {
                merchant_settlements.push_back(settlement);
            }
        }
        merchant_settlements
    }
    
    /// Reset daily volumes (called at start of each day by operator)
    pub fn reset_daily_volumes(env: Env, caller: Address) {
        caller.require_auth();
        rbac::require_role(&env, &caller, ROLE_OPERATOR);

        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let current_date = env.ledger().timestamp() / 86400; // Days since epoch
        
        for (merchant_id, mut merchant) in merchants.iter() {
            if merchant.last_reset_date / 86400 < current_date {
                merchant.current_day_volume = U256::from_u64(0);
                merchant.last_reset_date = env.ledger().timestamp();
                merchants.set(merchant_id, merchant);
            }
        }
        
        env.storage().instance().set(&merchants_key, &merchants);
    }
    
    fn execute_monthly_volume_reset(env: &Env) -> u32 {
        let merchants_key = Symbol::new(env, "merchants");
        let mut merchants: Map<String, Merchant> = env
            .storage()
            .instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(env));

        let history_key = Symbol::new(env, "monthly_volume_history");
        let mut history: Map<String, Vec<MonthlyVolumeSnapshot>> = env
            .storage()
            .instance()
            .get(&history_key)
            .unwrap_or(Map::new(env));

        let now = env.ledger().timestamp();
        let mut reset_count = 0u32;

        for (merchant_id, mut merchant) in merchants.iter() {
            if merchant.current_month_volume > U256::from_u64(0) {
                let mut m_hist = history.get(merchant_id.clone()).unwrap_or(Vec::new(env));
                m_hist.push_back(MonthlyVolumeSnapshot {
                    merchant_id: merchant_id.clone(),
                    period_volume: merchant.current_month_volume.clone(),
                    reset_at: now,
                });
                history.set(merchant_id.clone(), m_hist);
            }
            merchant.current_month_volume = U256::from_u64(0);
            merchants.set(merchant_id, merchant);
            reset_count += 1;
        }

        env.storage().instance().set(&history_key, &history);
        env.storage().instance().set(&merchants_key, &merchants);
        env.events().publish(
            (Symbol::new(env, "merchant"), Symbol::new(env, "monthly_volumes_reset")),
            (reset_count, now),
        );
        reset_count
    }

    /// Operator-authorized monthly reset preserving archived volume aggregates (#132).
    /// **Required role:** OPERATOR
    pub fn reset_monthly_volumes_authorized(env: Env, caller: Address) -> u32 {
        caller.require_auth();
        rbac::require_role(&env, &caller, ROLE_OPERATOR);
        Self::execute_monthly_volume_reset(&env)
    }

    /// Archive monthly volumes into `monthly_volume_history` and reset counters (#132).
    pub fn reset_monthly_volumes(env: Env) {
        Self::execute_monthly_volume_reset(&env);
    }

    /// Retrieve archived monthly volume snapshots for a merchant (#132).
    pub fn get_monthly_volume_history(env: Env, merchant_id: String) -> Vec<MonthlyVolumeSnapshot> {
        let history_key = Symbol::new(&env, "monthly_volume_history");
        let history: Map<String, Vec<MonthlyVolumeSnapshot>> = env
            .storage()
            .instance()
            .get(&history_key)
            .unwrap_or(Map::new(&env));
        history.get(merchant_id).unwrap_or(Vec::new(&env))
    }
    
    /// Get onboarding queue
    pub fn get_onboarding_queue(env: Env) -> Vec<String> {
        let onboarding_key = Symbol::new(&env, "onboarding_queue");
        env.storage().instance()
            .get(&onboarding_key)
            .unwrap_or(Vec::new(&env))
    }
    
    /// Get merchant statistics
    pub fn get_merchant_stats(env: Env, merchant_id: String) -> (u32, U256, U256, u32) {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(merchant) = merchants.get(merchant_id) {
            (
                merchant.reputation_score,
                merchant.current_day_volume,
                merchant.current_month_volume,
                merchant.current_vouches
            )
        } else {
            (0, U256::from_u64(0), U256::from_u64(0), 0)
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn loc_str(env: &Env) -> String {
        String::from_str(env, "18.5944,-72.3074")
    }

    #[test]
    fn test_status_consistency_and_configurable_vouch_policy() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let owner1 = Address::generate(&env);
        let owner2 = Address::generate(&env);
        let ngo = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);

        let client = MerchantNetworkClient::new(&env, &env.register(MerchantNetwork, ()));
        let tokens = Vec::from_array(&env, [String::from_str(&env, "USDC")]);

        // Fast-track -> active AND verified (#134)
        client.register_merchant(
            &owner1,
            &String::from_str(&env, "m_fast"),
            &String::from_str(&env, "Fast Market"),
            &String::from_str(&env, "grocery"),
            &CATEGORY_FOOD,
            &loc_str(&env),
            &String::from_str(&env, "Addr"),
            &String::from_str(&env, "City"),
            &String::from_str(&env, "HT"),
            &String::from_str(&env, "0000"),
            &String::from_str(&env, "+509"),
            &tokens,
            &Vec::new(&env),
            &true,
        );
        let fast = client.get_merchant(&String::from_str(&env, "m_fast")).unwrap();
        assert!(fast.is_active && fast.is_verified);
        assert_eq!(fast.status, STATUS_ACTIVE);

        // Standard trial -> inactive AND unverified until threshold (#134)
        client.register_merchant(
            &owner2,
            &String::from_str(&env, "m_trial"),
            &String::from_str(&env, "Trial Market"),
            &String::from_str(&env, "grocery"),
            &CATEGORY_FOOD,
            &loc_str(&env),
            &String::from_str(&env, "Addr"),
            &String::from_str(&env, "City"),
            &String::from_str(&env, "HT"),
            &String::from_str(&env, "0000"),
            &String::from_str(&env, "+509"),
            &tokens,
            &Vec::new(&env),
            &false,
        );
        let trial = client.get_merchant(&String::from_str(&env, "m_trial")).unwrap();
        assert!(!trial.is_active && !trial.is_verified);

        // Raise threshold to 5 while NGO weight stays 3 -> 1 NGO vouch must NOT prematurely activate (#133)
        client.configure_vouch_policy(&admin, &String::from_str(&env, "m_trial"), &5u32, &3u32);
        client.add_vouch(&ngo, &String::from_str(&env, "m_trial"), &1u32);
        let after_one_ngo = client.get_merchant(&String::from_str(&env, "m_trial")).unwrap();
        assert_eq!(after_one_ngo.current_vouches, 3);
        assert!(!after_one_ngo.is_active);
    }

    #[test]
    fn test_payment_auth_evidence_multitoken_settlement_and_monthly_archive() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let owner = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &admin, &admin, &admin);
        rbac::assign_role(&env, &admin, &operator, crate::rbac::ROLE_OPERATOR);

        let client = MerchantNetworkClient::new(&env, &env.register(MerchantNetwork, ()));
        let tokens = Vec::from_array(
            &env,
            [String::from_str(&env, "XLM"), String::from_str(&env, "EURC")],
        );

        client.register_merchant(
            &owner,
            &String::from_str(&env, "m_tok"),
            &String::from_str(&env, "Multi Store"),
            &String::from_str(&env, "grocery"),
            &CATEGORY_FOOD,
            &loc_str(&env),
            &String::from_str(&env, "Addr"),
            &String::from_str(&env, "City"),
            &String::from_str(&env, "HT"),
            &String::from_str(&env, "0000"),
            &String::from_str(&env, "+509"),
            &tokens,
            &Vec::new(&env),
            &true,
        );

        client.process_payment(
            &owner,
            &beneficiary,
            &String::from_str(&env, "m_tok"),
            &String::from_str(&env, "ben_1"),
            &U256::from_u64(120),
            &String::from_str(&env, "XLM"),
            &String::from_str(&env, "food"),
            &PAYMENT_ONLINE,
        );

        let txns = client.get_merchant_transactions(&String::from_str(&env, "m_tok"));
        assert_eq!(txns.len(), 1);
        let tx = txns.get(0).unwrap();
        // No fake literal signature strings (#126); persistent retention (#138)
        assert!(tx.merchant_authorized && tx.beneficiary_authorized);
        assert_eq!(tx.auth_evidence, String::from_str(&env, "soroban_require_auth"));

        // Per-token settlement records preserve actual token "XLM" instead of hardcoding USDC (#131)
        assert_eq!(client.settle_balances(&operator), 1);
        let settlements = client.get_settlement_history(&String::from_str(&env, "m_tok"));
        assert_eq!(settlements.len(), 1);
        assert_eq!(settlements.get(0).unwrap().token, String::from_str(&env, "XLM"));

        // Monthly reset preserves archived volume (#132)
        client.reset_monthly_volumes_authorized(&operator);
        let archives = client.get_monthly_volume_history(&String::from_str(&env, "m_tok"));
        assert_eq!(archives.len(), 1);
        assert_eq!(archives.get(0).unwrap().period_volume, U256::from_u64(120));
    }

    #[test]
    fn test_qr_scoping_expiry_and_strict_ussd_parsing() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let client = MerchantNetworkClient::new(&env, &env.register(MerchantNetwork, ()));
        let mid = String::from_str(&env, "m_qr");
        let code = String::from_str(&env, "SECRET_TRANSFER_CODE");
        let qr = client.generate_transaction_qr(&mid, &U256::from_u64(250), &code);

        // Plaintext transfer code must not appear in QR payload (#136)
        assert!(!qr.to_string().contains("SECRET_TRANSFER_CODE"));
        assert!(client.validate_transaction_qr(&qr, &mid, &U256::from_u64(250), &code));
        assert!(!client.validate_transaction_qr(
            &qr,
            &String::from_str(&env, "other_merchant"),
            &U256::from_u64(250),
            &code
        ));

        // Expires after TTL (#136)
        env.ledger().with_mut(|l| l.timestamp = 1_500);
        assert!(!client.validate_transaction_qr(&qr, &mid, &U256::from_u64(250), &code));

        // Strict USSD parsing (#137)
        let (parsed_m, parsed_amt) = client.parse_ussd_code(&String::from_str(&env, "*mer_01*450#"));
        assert_eq!(parsed_m, String::from_str(&env, "mer_01"));
        assert_eq!(parsed_amt, U256::from_u64(450));

        for bad in ["mer_01*100#", "*mer_01*100", "*mer_01*abc#", "**100#", "*mer_01*0#", "*a*b*10#"] {
            let (m, amt) = client.parse_ussd_code(&String::from_str(&env, bad));
            assert_eq!(m, String::from_str(&env, ""));
            assert_eq!(amt, U256::from_u64(0));
        }
    }

    #[test]
    fn test_offline_sync_idempotency_and_round_alert_dedup() {
        let env = Env::default();
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let client = MerchantNetworkClient::new(&env, &env.register(MerchantNetwork, ()));
        let tokens = Vec::from_array(&env, [String::from_str(&env, "USDC")]);

        client.register_merchant(
            &owner,
            &String::from_str(&env, "m_off"),
            &String::from_str(&env, "Offline Store"),
            &String::from_str(&env, "grocery"),
            &CATEGORY_FOOD,
            &loc_str(&env),
            &String::from_str(&env, "Addr"),
            &String::from_str(&env, "City"),
            &String::from_str(&env, "HT"),
            &String::from_str(&env, "0000"),
            &String::from_str(&env, "+509"),
            &tokens,
            &Vec::new(&env),
            &true,
        );

        let off_id = client.process_offline_payment(
            &String::from_str(&env, "m_off"),
            &String::from_str(&env, "ben_off"),
            &U256::from_u64(75),
            &String::from_str(&env, "USDC"),
            &String::from_str(&env, "water"),
            &String::from_str(&env, "sig_0123456789abcdef"),
        );

        let ids = Vec::from_array(&env, [off_id.clone()]);
        assert_eq!(client.sync_offline_transactions(&String::from_str(&env, "m_off"), &ids), 1);
        // Repeated sync must not double-count (#130)
        assert_eq!(client.sync_offline_transactions(&String::from_str(&env, "m_off"), &ids), 0);
        assert_eq!(
            client.get_merchant(&String::from_str(&env, "m_off")).unwrap().pending_settlement,
            U256::from_u64(75)
        );

        // Small multiple of 100 below ROUND_AMOUNT_ALERT_MIN does not spam alerts; >= 1000 deduplicates within 1h (#128)
        client.fraud_detection(&String::from_str(&env, "m_off"), &U256::from_u64(200));
        assert_eq!(client.get_fraud_alerts(&String::from_str(&env, "m_off")).len(), 0);
        client.fraud_detection(&String::from_str(&env, "m_off"), &U256::from_u64(1000));
        client.fraud_detection(&String::from_str(&env, "m_off"), &U256::from_u64(2000));
        assert_eq!(client.get_fraud_alerts(&String::from_str(&env, "m_off")).len(), 1);
    }
}
