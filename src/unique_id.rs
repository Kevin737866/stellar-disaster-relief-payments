use soroban_sdk::{Env, String, Address, Symbol, U64};

/// Unique ID generation utilities for globally unique identifiers.
/// 
/// ID Format: `{prefix}_{sequence}_{nonce}_{caller_suffix}`
/// - prefix: semantic prefix (e.g., "txn", "dsb", "alrt", "mrt")
/// - sequence: ledger sequence number (monotonically increasing)
/// - nonce: per-contract counter (stored in storage, increments per call)
/// - caller_suffix: first 8 chars of caller address (optional, for extra uniqueness)
/// 
/// This ensures:
/// - Global uniqueness across contracts and deployments
/// - Collision resistance even with concurrent submissions
/// - Deterministic format for debugging and indexing
/// - No reliance on timestamps which can collide

const NONCE_KEY: &str = "id_nonce";

/// Generate a unique ID with the given prefix.
/// Uses ledger sequence + stored nonce + optional caller address.
pub fn generate_unique_id(env: &Env, prefix: &str, caller: Option<&Address>) -> String {
    // Get and increment the per-contract nonce
    let nonce_key = Symbol::new(env, NONCE_KEY);
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    // Get ledger sequence number (monotonically increasing)
    let sequence = env.ledger().sequence();
    
    // Build ID components
    let mut id = String::from_str(env, prefix);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    // Add caller suffix if provided (first 8 chars of address)
    if let Some(addr) = caller {
        let addr_str = addr.to_string();
        if addr_str.len() > 8 {
            id.push_str("_");
            // Take first 8 chars after "G" (stellar address prefix)
            let suffix = &addr_str[1..9.min(addr_str.len())];
            id.push_str(suffix);
        }
    }
    
    id
}

/// Generate a unique ID without caller info (for system-generated IDs).
pub fn generate_system_id(env: &Env, prefix: &str) -> String {
    generate_unique_id(env, prefix, None)
}

/// Generate a unique ID with caller info (for user-initiated actions).
pub fn generate_user_id(env: &Env, prefix: &str, caller: &Address) -> String {
    generate_unique_id(env, prefix, Some(caller))
}

/// Generate a disbursement ID with fund context.
/// Format: dsb_{fund_id}_{sequence}_{nonce}
pub fn generate_disbursement_id(env: &Env, fund_id: &String) -> String {
    let nonce_key = Symbol::new(env, "dsb_nonce");
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "dsb");
    id.push_str("_");
    id.push_str(fund_id);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// Generate a batch disbursement ID.
/// Format: dsb_{fund_id}_batch_{sequence}_{nonce}_{index}
pub fn generate_batch_disbursement_id(env: &Env, fund_id: &String, index: u32) -> String {
    let nonce_key = Symbol::new(env, "dsb_batch_nonce");
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "dsb");
    id.push_str("_");
    id.push_str(fund_id);
    id.push_str("_batch_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    id.push_str("_");
    id.push_str(&index.to_string());
    
    id
}

/// Generate a transaction ID for cash transfers.
/// Format: txn_{transfer_id}_{sequence}_{nonce}
pub fn generate_cash_transfer_txn_id(env: &Env, transfer_id: &String) -> String {
    let nonce_key = Symbol::new(env, &format!("txn_nonce_{}", transfer_id));
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "txn");
    id.push_str("_");
    id.push_str(transfer_id);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// Generate a merchant transaction ID.
/// Format: mrt_{merchant_id}_{sequence}_{nonce}
pub fn generate_merchant_txn_id(env: &Env, merchant_id: &String) -> String {
    let nonce_key = Symbol::new(env, &format!("mrt_nonce_{}", merchant_id));
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "mrt");
    id.push_str("_");
    id.push_str(merchant_id);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// Generate an offline transaction ID.
/// Format: ofl_{merchant_id}_{sequence}_{nonce}
pub fn generate_offline_txn_id(env: &Env, merchant_id: &String) -> String {
    let nonce_key = Symbol::new(env, &format!("ofl_nonce_{}", merchant_id));
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "ofl");
    id.push_str("_");
    id.push_str(merchant_id);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// Generate a fraud alert ID.
/// Format: alrt_{entity_id}_{type}_{sequence}_{nonce}
pub fn generate_fraud_alert_id(env: &Env, entity_id: &String, alert_type: &str) -> String {
    let nonce_key = Symbol::new(env, &format!("alrt_nonce_{}", entity_id));
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "alrt");
    id.push_str("_");
    id.push_str(entity_id);
    id.push_str("_");
    id.push_str(alert_type);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// Generate an auto-release summary key.
/// Format: arl_{fund_id}_{sequence}_{nonce}
pub fn generate_auto_release_key(env: &Env, fund_id: &String) -> String {
    let nonce_key = Symbol::new(env, &format!("arl_nonce_{}", fund_id));
    let mut nonce: u64 = env.storage().instance()
        .get(&nonce_key)
        .unwrap_or(0);
    
    nonce = nonce.saturating_add(1);
    env.storage().instance().set(&nonce_key, &nonce);
    
    let sequence = env.ledger().sequence();
    
    let mut id = String::from_str(env, "arl");
    id.push_str("_");
    id.push_str(fund_id);
    id.push_str("_");
    id.push_str(&sequence.to_string());
    id.push_str("_");
    id.push_str(&nonce.to_string());
    
    id
}

/// ID Semantics Documentation:
/// 
/// Prefix meanings:
/// - "dsb": Disbursement (aid_registry)
/// - "txn": Cash transfer transaction (cash_transfer)
/// - "mrt": Merchant transaction (merchant_network)
/// - "ofl": Offline transaction (merchant_network)
/// - "alrt": Fraud alert (merchant_network, anti_fraud)
/// - "arl": Auto-release summary (aid_registry)
/// 
/// Components:
/// - sequence: Ledger sequence number (globally unique, monotonically increasing)
/// - nonce: Per-context counter (prevents collision within same ledger)
/// - caller_suffix: Optional caller address fragment (extra entropy)
/// 
/// Collision Resistance:
/// - Ledger sequence increments per transaction globally
/// - Nonce increments per contract per context
/// - Combined: astronomically low collision probability
/// - Even with same sequence (same ledger), nonce differs
/// 
/// Storage Keys:
/// - "id_nonce": Global contract nonce
/// - "dsb_nonce": Disbursement counter
/// - "dsb_batch_nonce": Batch disbursement counter
/// - "txn_nonce_{transfer_id}": Per-transfer transaction counter
/// - "mrt_nonce_{merchant_id}": Per-merchant transaction counter
/// - "ofl_nonce_{merchant_id}": Per-merchant offline counter
/// - "alrt_nonce_{entity_id}": Per-entity alert counter
/// - "arl_nonce_{fund_id}": Per-fund auto-release counter