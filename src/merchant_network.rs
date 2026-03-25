use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256, u64};

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

#[contract]
pub struct MerchantNetwork;

#[derive(Clone)]
pub struct Merchant {
    pub id: String,
    pub name: String,
    pub owner: Address,
    pub business_type: String,
    pub category: u32, // MerchantCategory enum value
    pub location: Location,
    pub contact_info: String,
    pub registration_date: u64,
    pub status: u32, // MerchantStatus enum value
    pub is_verified: bool,
    pub verification_documents: Vec<String>,
    // Community vouching
    pub vouchers: Vec<String>, // 3 beneficiary references or 1 NGO field worker
    pub vouching_threshold: u32, // 3 beneficiaries or 1 NGO
    pub current_vouches: u32,
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

#[derive(Clone)]
pub struct Location {
    pub latitude: f64,
    pub longitude: f64,
    pub address: String,
    pub city: String,
    pub country: String,
    pub postal_code: String,
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
    pub merchant_signature: String,
    pub beneficiary_signature: String,
    pub is_settled: bool,
    pub payment_method: u32, // PaymentMethod enum value
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
    pub fn register_merchant(
        env: Env,
        owner: Address,
        merchant_id: String,
        name: String,
        business_type: String,
        category: u32,
        location: Location,
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
        
        // Determine initial status based on fast-track
        let (status, daily_limit, trial_days) = if emergency_fast_track {
            // Emergency fast-track: immediate activation with higher limits
            (STATUS_ACTIVE, U256::from_u64(10000), 0u64)
        } else {
            // Standard: trial period with $100/day limit
            (STATUS_TRIAL, U256::from_u64(100), 7u64)
        };
        
        let current_time = env.ledger().timestamp();
        
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
            is_verified: !emergency_fast_track, // Auto-verify fast-track
            verification_documents: Vec::new(&env), // Simplified - no documents needed
            vouchers,
            vouching_threshold: 3, // 3 community vouches required
            current_vouches: 0,
            trial_start_date: current_time,
            trial_end_date: current_time + (trial_days * 24 * 60 * 60),
            trial_daily_limit: U256::from_u64(100),
            daily_volume_limit: daily_limit,
            monthly_limit: daily_limit * U256::from_u64(30),
            current_month_volume: U256::from_u64(0),
            current_day_volume: U256::from_u64(0),
            last_reset_date: current_time,
            reputation_score: 50, // Initial reputation
            is_active: emergency_fast_track, // Activate immediately for fast-track
            emergency_fast_track,
            accepts_qr: true,
            accepts_ussd: true,
            accepts_nfc: true,
            accepts_offline: true,
            pending_settlement: U256::from_u64(0),
            last_settlement_date: current_time,
        };
        
        merchants.set(merchant_id.clone(), merchant);
        env.storage().instance().set(&merchants_key, &merchants);
        
        // Add to onboarding queue for vouching
        let onboarding_key = Symbol::new(&env, "onboarding_queue");
        let mut queue: Vec<String> = env.storage().instance()
            .get(&onboarding_key)
            .unwrap_or(Vec::new(&env));
        
        queue.push_back(merchant_id);
        env.storage().instance().set(&onboarding_key, &queue);
    }
    
    /// Add community vouches for merchant (3 beneficiaries or 1 NGO worker)
    pub fn add_vouch(
        env: Env,
        voucher: Address,
        merchant_id: String,
        voucher_type: u32, // 0 = beneficiary, 1 = ngo
    ) {
        voucher.require_auth();
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            // Add voucher
            let voucher_id = format!("vouch_{}", voucher.to_string());
            merchant.vouchers.push_back(voucher_id);
            
            // NGO vouch counts as 3
            if voucher_type == 1 {
                merchant.current_vouches += 3;
            } else {
                merchant.current_vouches += 1;
            }
            
            // Check if threshold met
            let threshold_met = merchant.current_vouches >= merchant.vouching_threshold;
            
            if threshold_met && merchant.status == STATUS_PENDING {
                merchant.status = STATUS_TRIAL;
                merchant.is_verified = true;
                merchant.is_active = true;
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
        
        if !merchant_profile.is_active {
            panic_with_error!(&env, "Merchant is not active");
        }
        
        // Check if token is accepted
        if !merchant_profile.accepted_tokens.contains(&token) {
            panic_with_error!(&env, "Token not accepted by merchant");
        }
        
        // Get appropriate daily limit based on status
        let daily_limit = match merchant_profile.status {
            STATUS_TRIAL => merchant_profile.trial_daily_limit,
            STATUS_GRADUATED => merchant_profile.daily_volume_limit * U256::from_u64(2),
            _ => merchant_profile.daily_volume_limit,
        };
        
        // Check daily limit
        if merchant_profile.current_day_volume + amount > daily_limit {
            panic_with_error!(&env, "Amount exceeds daily limit");
        }
        
        // Check monthly limit
        if merchant_profile.current_month_volume + amount > merchant_profile.monthly_limit {
            panic_with_error!(&env, "Amount exceeds monthly limit");
        }
        
        // Create transaction record
        let transaction_id = format!("tx_{}_{}", merchant_id, env.ledger().timestamp());
        let transaction = Transaction {
            id: transaction_id.clone(),
            merchant_id: merchant_id.clone(),
            beneficiary_id,
            amount,
            token: token.clone(),
            timestamp: env.ledger().timestamp(),
            purpose,
            merchant_signature: String::from_str(&env, "merchant_signed"),
            beneficiary_signature: String::from_str(&env, "beneficiary_signed"),
            is_settled: false,
            payment_method,
        };
        
        // Store transaction in temporary storage (high-frequency data)
        let transactions_key = Symbol::new(&env, "transactions");
        let mut transactions: Map<String, Transaction> = env.storage().temporary()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));
        
        transactions.set(transaction_id.clone(), transaction);
        env.storage().temporary().set(&transactions_key, &transactions);
        
        // Update merchant volume
        merchant_profile.current_day_volume += amount;
        merchant_profile.current_month_volume += amount;
        merchant_profile.pending_settlement += amount;
        
        merchants.set(merchant_id, merchant_profile);
        env.storage().instance().set(&merchants_key, &merchants);
        
        // Run fraud detection
        Self::fraud_detection(env.clone(), merchant_id.clone(), amount);
        
        transaction_id
    }
    
    /// Process offline transaction (batched and synced when connectivity returns)
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
        
        // Create offline transaction
        let transaction_id = format!("offline_{}_{}", merchant_id, env.ledger().timestamp());
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
        
        // Store offline transactions
        let offline_key = Symbol::new(&env, "offline_transactions");
        let mut offline_txs: Map<String, OfflineTransaction> = env.storage().temporary()
            .get(&offline_key)
            .unwrap_or(Map::new(&env));
        
        offline_txs.set(transaction_id.clone(), offline_tx);
        env.storage().temporary().set(&offline_key, &offline_txs);
        
        transaction_id
    }
    
    /// Sync offline transactions (when connectivity returns)
    pub fn sync_offline_transactions(
        env: Env,
        merchant_id: String,
        offline_transaction_ids: Vec<String>,
    ) -> u32 {
        let offline_key = Symbol::new(&env, "offline_transactions");
        let mut offline_txs: Map<String, OfflineTransaction> = env.storage().temporary()
            .get(&offline_key)
            .unwrap_or(Map::new(&env));
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut synced_count = 0u32;
        
        for tx_id in offline_transaction_ids.iter() {
            if let Some(mut offline_tx) = offline_txs.get(tx_id.clone()) {
                if !offline_tx.is_synced {
                    offline_tx.is_synced = true;
                    
                    // Update merchant volume
                    if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
                        merchant.current_day_volume += offline_tx.amount;
                        merchant.current_month_volume += offline_tx.amount;
                        merchant.pending_settlement += offline_tx.amount;
                        merchants.set(merchant_id.clone(), merchant);
                    }
                    
                    // Create settled transaction record
                    let transaction_id = format!("tx_{}_{}", merchant_id, offline_tx.timestamp);
                    let transaction = Transaction {
                        id: transaction_id,
                        merchant_id: merchant_id.clone(),
                        beneficiary_id: offline_tx.beneficiary_id,
                        amount: offline_tx.amount,
                        token: offline_tx.token,
                        timestamp: offline_tx.timestamp,
                        purpose: offline_tx.purpose,
                        merchant_signature: offline_tx.signature,
                        beneficiary_signature: String::from_str(&env, "synced"),
                        is_settled: false,
                        payment_method: PAYMENT_OFFLINE,
                    };
                    
                    let transactions_key = Symbol::new(&env, "transactions");
                    let mut transactions: Map<String, Transaction> = env.storage().temporary()
                        .get(&transactions_key)
                        .unwrap_or(Map::new(&env));
                    
                    transactions.set(transaction_id, transaction);
                    env.storage().temporary().set(&transactions_key, &transactions);
                    
                    synced_count += 1;
                }
            }
        }
        
        env.storage().temporary().set(&offline_key, &offline_txs);
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
                id: format!("alert_{}_{}", merchant_id, env.ledger().timestamp()),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "large_transaction"),
                severity: 7,
                description: String::from_str(&env, "Unusually large transaction detected"),
                timestamp: env.ledger().timestamp(),
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        // Pattern 2: High velocity (many transactions in short time)
        let transactions_key = Symbol::new(&env, "transactions");
        let transactions: Map<String, Transaction> = env.storage().temporary()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));
        
        let mut recent_count = 0u32;
        let current_time = env.ledger().timestamp();
        let one_hour_ago = current_time - 3600;
        
        for (_, tx) in transactions.iter() {
            if tx.merchant_id == merchant_id && tx.timestamp > one_hour_ago {
                recent_count += 1;
            }
        }
        
        if recent_count > 20 {
            let alert = FraudAlert {
                id: format!("alert_{}_{}", merchant_id, env.ledger().timestamp()),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "high_velocity"),
                severity: 8,
                description: String::from_str(&env, "High transaction velocity detected"),
                timestamp: current_time,
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        // Pattern 3: Round amount transactions (potential testing)
        if amount_u64 % 100 == 0 && amount_u64 > 100 {
            let alert = FraudAlert {
                id: format!("alert_{}_{}", merchant_id, env.ledger().timestamp()),
                merchant_id: merchant_id.clone(),
                alert_type: String::from_str(&env, "round_amount"),
                severity: 3,
                description: String::from_str(&env, "Round amount transaction - potential testing"),
                timestamp: current_time,
                is_resolved: false,
            };
            alerts.push_back(alert);
        }
        
        // Pattern 4: New merchant with high volume
        if merchant.status == STATUS_TRIAL && merchant.current_month_volume > U256::from_u64(1000) {
            let alert = FraudAlert {
                id: format!("alert_{}_{}", merchant_id, env.ledger().timestamp()),
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
    
    /// Daily automatic settlement to merchant wallets
    pub fn settle_balances(env: Env, admin: Address) -> u32 {
        admin.require_auth();
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut settlement_count = 0u32;
        let current_time = env.ledger().timestamp();
        
        for (merchant_id, mut merchant) in merchants.iter() {
            if merchant.pending_settlement > U256::from_u64(0) {
                // Create settlement record
                let settlement_id = format!("settle_{}_{}", merchant_id, current_time);
                let settlement = Settlement {
                    id: settlement_id,
                    merchant_id: merchant_id.clone(),
                    amount: merchant.pending_settlement,
                    token: String::from_str(&env, "USDC"),
                    timestamp: current_time,
                    transaction_count: 0,
                };
                
                // Store settlement
                let settlements_key = Symbol::new(&env, "settlements");
                let mut settlements: Map<String, Settlement> = env.storage().instance()
                    .get(&settlements_key)
                    .unwrap_or(Map::new(&env));
                
                settlements.set(settlement_id.clone(), settlement);
                env.storage().instance().set(&settlements_key, &settlements);
                
                // Reset pending settlement
                merchant.pending_settlement = U256::from_u64(0);
                merchant.last_settlement_date = current_time;
                
                merchants.set(merchant_id, merchant);
                settlement_count += 1;
            }
        }
        
        env.storage().instance().set(&merchants_key, &merchants);
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
        
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        if let Some(mut merchant) = merchants.get(merchant_id.clone()) {
            if merchant.status == STATUS_TRIAL {
                if approve {
                    // Graduate: increase limits based on transaction history
                    merchant.status = STATUS_GRADUATED;
                    merchant.daily_volume_limit = merchant.daily_volume_limit * U256::from_u64(5);
                    merchant.monthly_limit = merchant.monthly_limit * U256::from_u64(5);
                    merchant.reputation_score = (merchant.reputation_score + 20).min(100);
                } else {
                    // Extend trial or suspend
                    merchant.status = STATUS_SUSPENDED;
                }
                
                merchants.set(merchant_id, merchant);
                env.storage().instance().set(&merchants_key, &merchants);
            }
        }
    }
    
    /// Generate static QR code for shop
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
    
    /// Generate dynamic QR code for transaction
    pub fn generate_transaction_qr(
        env: Env,
        merchant_id: String,
        amount: U256,
        transfer_code: String,
    ) -> String {
        format!(
            "{}|{}|{}|{}",
            merchant_id,
            amount.to_string(),
            transfer_code,
            env.ledger().timestamp()
        )
    }
    
    /// Parse USSD code: *merchant_code*amount#
    pub fn parse_ussd_code(env: Env, code: String) -> (String, U256) {
        // Simplified parsing - in production use proper parsing
        // Format: *merchant_code*amount#
        let parts: Vec<&str> = code.split('*').collect();
        if parts.len() >= 3 {
            let merchant_code = parts[1];
            let amount_str = parts[2].trim_end_matches('#');
            let amount = U256::from_u64(amount_str.parse::<u64>().unwrap_or(0));
            return (String::from_str(&env, merchant_code), amount);
        }
        (String::from_str(&env, ""), U256::from_u64(0))
    }
    
    /// Get merchant details
    pub fn get_merchant(env: Env, merchant_id: String) -> Option<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        merchants.get(merchant_id)
    }
    
    /// Find merchants by location (geographic search)
    pub fn find_merchants_by_location(
        env: Env,
        latitude: f64,
        longitude: f64,
        radius_km: f64,
    ) -> Vec<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut nearby_merchants = Vec::new(&env);
        
        for (_, merchant) in merchants.iter() {
            if merchant.is_active {
                let distance = Self::calculate_distance(
                    latitude, longitude,
                    merchant.location.latitude, merchant.location.longitude
                );
                
                if distance <= radius_km {
                    nearby_merchants.push_back(merchant);
                }
            }
        }
        
        nearby_merchants
    }
    
    /// Find merchants by category
    pub fn find_merchants_by_category(
        env: Env,
        category: u32,
    ) -> Vec<Merchant> {
        let merchants_key = Symbol::new(&env, "merchants");
        let merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        let mut category_merchants = Vec::new(&env);
        
        for (_, merchant) in merchants.iter() {
            if merchant.is_active && merchant.category == category {
                category_merchants.push_back(merchant);
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
    
    /// Get merchant transaction history
    pub fn get_merchant_transactions(env: Env, merchant_id: String) -> Vec<Transaction> {
        let transactions_key = Symbol::new(&env, "transactions");
        let transactions: Map<String, Transaction> = env.storage().temporary()
            .get(&transactions_key)
            .unwrap_or(Map::new(&env));
        
        let mut merchant_transactions = Vec::new(&env);
        for (_, transaction) in transactions.iter() {
            if transaction.merchant_id == merchant_id {
                merchant_transactions.push_back(transaction);
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
    
    /// Reset daily volumes (called at start of each day)
    pub fn reset_daily_volumes(env: Env) {
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
    
    /// Reset monthly volume (called periodically)
    pub fn reset_monthly_volumes(env: Env) {
        let merchants_key = Symbol::new(&env, "merchants");
        let mut merchants: Map<String, Merchant> = env.storage().instance()
            .get(&merchants_key)
            .unwrap_or(Map::new(&env));
        
        for (merchant_id, mut merchant) in merchants.iter() {
            merchant.current_month_volume = U256::from_u64(0);
            merchants.set(merchant_id, merchant);
        }
        
        env.storage().instance().set(&merchants_key, &merchants);
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
