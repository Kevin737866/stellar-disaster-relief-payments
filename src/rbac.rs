/// Role-Based Access Control (RBAC) module for the Stellar Disaster Relief Platform.
///
/// # Role Hierarchy
///
/// - **Admin**: Platform superuser. Set at initialization. Can assign/revoke all roles.
///   Manages funds, triggers, merchant reviews, and beneficiary deactivation.
/// - **NGO**: NGO field workers. Can register beneficiaries, create transfers and shipments,
///   add checkpoints, and assign transporters.
/// - **Gov**: Government signers. Participate in multi-sig fund releases.
/// - **UN**: UN signers. Participate in multi-sig fund releases.
/// - **Auditor**: Read-only fraud reviewers. Can review suspicious transactions and
///   query high-risk entities.
/// - **Oracle**: Trusted data providers. Can submit oracle data for trigger verification.
/// - **Operator**: Maintenance role. Can run cleanup jobs, reset volumes, settle balances,
///   and execute automated triggers.
/// - **Transporter**: Supply chain logistics agents. Carry and deliver relief shipments.
/// - **Merchant**: Approved vendors providing emergency goods in disaster zones.
/// - **Recipient**: Aid recipients and verified beneficiaries.
///
/// # Bitmask Semantics & Call-Site Audit
///
/// Role checks use `u32` bitmasks with two explicit modes:
/// - `has_role` / `require_role`: **all-bits-required (AND semantics)** — target must hold
///   every role bit present in `role_mask`.
/// - `has_any_role` / `require_any_role`: **any-of (OR semantics)** — target must hold
///   at least one role bit present in `role_mask`.
///
/// Audit of existing contract call sites:
/// - `beneficiary_manager.rs`: `require_role` with single bits (`ROLE_NGO`, `ROLE_ADMIN`)
/// - `cash_transfer.rs`: `require_role` with single bit (`ROLE_NGO`)
/// - `merchant_network.rs`: `require_role` with single bits (`ROLE_OPERATOR`, `ROLE_ADMIN`)
/// - `supply_chain_tracker.rs`: `require_role` / `has_role` with single bits (`ROLE_NGO`, `ROLE_TRANSPORTER`, `ROLE_RECIPIENT`)
/// For single-bit checks AND and OR behave identically; operations that accept multiple
/// interchangeable roles must explicitly call `require_any_role` / `has_any_role`.
///
/// # Role-Gated Operations
///
/// | Role | Modules & Operations |
/// |---|---|
/// | `ROLE_ADMIN` | `rbac::assign_role`, `rbac::revoke_role`, `beneficiary_manager::deactivate_beneficiary`, `merchant_network::review_trial_merchant`, `aid_registry::archive_fund`, `aid_registry::create_fund` |
/// | `ROLE_NGO` | `beneficiary_manager::register_beneficiary`, `beneficiary_manager::create_identity_from_factors`, `cash_transfer::create_transfer`, `supply_chain_tracker::create_shipment`, `supply_chain_tracker::add_checkpoint`, `supply_chain_tracker::assign_transporter` |
/// | `ROLE_OPERATOR` | `cash_transfer::cleanup_expired_transfers`, `merchant_network::settle_balances`, `merchant_network::reset_daily_volumes` |
/// | `ROLE_AUDITOR` | `anti_fraud::review_transaction`, `anti_fraud::get_high_risk_entities` |
/// | `ROLE_GOV` / `ROLE_UN` | Multi-sig emergency fund release approvals |
/// | `ROLE_TRANSPORTER` | Checkpoint custody confirmations (`supply_chain_tracker::add_checkpoint`) |
///
/// # Documented Policy Exceptions (Non-Role Gated / Self-Service Operations)
///
/// Certain operations intentionally do not require pre-assigned RBAC roles because they
/// are self-service, peer-to-peer, or public onboarding flows:
///
/// 1. **Public Merchant Onboarding (`merchant_network::register_merchant`)**:
///    Any prospective merchant/vendor in a disaster zone can self-register without an existing role.
///    The merchant starts in `Pending` or `Trial` status and cannot receive unlimited payouts until
///    graduated by an Admin or vouched by community members.
/// 2. **Beneficiary Location Updates (`beneficiary_manager::update_location`)**:
///    Displaced individuals must be able to update their own camp location without NGO intervention.
///    Guarded by wallet address ownership (`profile.wallet_address == caller`), not RBAC.
/// 3. **Transfer Fund Recall (`cash_transfer::recall_funds`)**:
///    The original creator of an expired conditional transfer can recall unspent funds.
///    Guarded by creator address ownership (`transfer.creator == caller`).
/// 4. **Transfer Spending (`cash_transfer::spend`)**:
///    Aid recipients execute spending within transfer limits and rules.
///    Guarded by recipient authorization and spending rule engine.
/// 5. **Merchant Payment Co-Authorization (`merchant_network::process_payment`)**:
///    Requires mutual consent: the registered merchant owner processes the transaction with
///    co-authorization from the spending beneficiary.
/// 6. **Social Recovery & Vouching (`beneficiary_manager::social_recovery`, `merchant_network::add_vouch`)**:
///    Community-based recovery and vouching where trusted contacts or existing beneficiaries
///    attest to identities or vendors.
///
/// # Storage Scope & Multi-Contract Deployment Architecture
///
/// Roles are stored in **instance storage** (`env.storage().instance()`) under `"roles"`
/// as a `Map<Address, u32>`. Because instance storage is bound to the deployed contract
/// instance lifecycle:
/// - In a monolithic deployment (`DisasterReliefPlatform` + modules compiled in one contract),
///   all modules share the contract instance's RBAC map initialized by `initialize()`.
/// - In a multi-contract deployment (separate contract IDs per module), each deployed
///   contract instance owns an isolated RBAC map and must seed/manage roles independently
///   (or perform explicit cross-contract queries against the platform contract).
///
/// # Privilege Escalation & Operator Safeguards
///
/// - Only Admin can assign or revoke roles; invalid or zero `role_mask` bits are rejected.
/// - Admin cannot revoke their own Admin role or remove the last remaining Admin holder.
/// - Revoking high-impact roles (`CRITICAL_ROLE_MASK`: `ROLE_ADMIN | ROLE_GOV | ROLE_UN`)
///   emits flagged audit events (`is_high_impact = true`), and operators should prefer
///   `revoke_critical_role(..., confirm_high_impact: true)` after governance confirmation.
/// - `DisasterReliefPlatform::initialize()` is guarded by a one-time init flag; re-initialization panics.

use soroban_sdk::{Address, Env, Map, Symbol};

// Role bitmask constants — each role is a distinct bit.
pub const ROLE_ADMIN: u32       = 1 << 0; // 1
pub const ROLE_NGO: u32         = 1 << 1; // 2
pub const ROLE_GOV: u32         = 1 << 2; // 4
pub const ROLE_UN: u32          = 1 << 3; // 8
pub const ROLE_AUDITOR: u32     = 1 << 4; // 16
pub const ROLE_ORACLE: u32      = 1 << 5; // 32
pub const ROLE_OPERATOR: u32    = 1 << 6; // 64
pub const ROLE_TRANSPORTER: u32 = 1 << 7; // 128
pub const ROLE_MERCHANT: u32    = 1 << 8; // 256
pub const ROLE_RECIPIENT: u32   = 1 << 9; // 512

/// Bitmask of all defined roles (`ROLE_ADMIN` through `ROLE_RECIPIENT`).
pub const VALID_ROLE_MASK: u32 = ROLE_ADMIN
    | ROLE_NGO
    | ROLE_GOV
    | ROLE_UN
    | ROLE_AUDITOR
    | ROLE_ORACLE
    | ROLE_OPERATOR
    | ROLE_TRANSPORTER
    | ROLE_MERCHANT
    | ROLE_RECIPIENT;

/// High-impact governance/custody roles requiring elevated operator caution on revocation.
pub const CRITICAL_ROLE_MASK: u32 = ROLE_ADMIN | ROLE_GOV | ROLE_UN;

const ROLES_KEY: &str = "roles";

// ── Storage & validation helpers ─────────────────────────────────────────────

fn roles_key(env: &Env) -> Symbol {
    Symbol::new(env, ROLES_KEY)
}

fn load_roles(env: &Env) -> Map<Address, u32> {
    env.storage()
        .instance()
        .get(&roles_key(env))
        .unwrap_or_else(|| Map::new(env))
}

fn save_roles(env: &Env, roles: &Map<Address, u32>) {
    env.storage().instance().set(&roles_key(env), roles);
}

/// Returns `true` iff `role_mask` is non-zero and contains only defined role bits (`VALID_ROLE_MASK`).
pub fn is_valid_role_mask(role_mask: u32) -> bool {
    role_mask != 0 && (role_mask & !VALID_ROLE_MASK) == 0
}

fn validate_role_mask(role_mask: u32) {
    if !is_valid_role_mask(role_mask) {
        panic!("Invalid role mask");
    }
}

fn count_role_holders(roles: &Map<Address, u32>, role_bit: u32) -> u32 {
    let mut count = 0u32;
    for (_, bits) in roles.iter() {
        if (bits & role_bit) == role_bit {
            count += 1;
        }
    }
    count
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Assign `role_mask` to `target`. Caller must be Admin.
///
/// Rejects zero or undefined role bits (`VALID_ROLE_MASK`) and emits an RBAC
/// `"role_assigned"` audit event.
pub fn assign_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    caller.require_auth();
    require_role(env, caller, ROLE_ADMIN);
    validate_role_mask(role_mask);

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);
    let updated = current | role_mask;
    roles.set(target.clone(), updated);
    save_roles(env, &roles);

    env.events().publish(
        (Symbol::new(env, "rbac"), Symbol::new(env, "role_assigned")),
        (caller.clone(), target.clone(), role_mask, updated),
    );
}

/// Revoke `role_mask` from `target`. Caller must be Admin.
///
/// Rejects invalid role masks, prevents self-Admin lockout, prevents removing the
/// last remaining Admin holder, and emits an auditable `"role_revoked"` event
/// flagged with `is_high_impact = true` whenever `CRITICAL_ROLE_MASK` bits change.
pub fn revoke_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    caller.require_auth();
    require_role(env, caller, ROLE_ADMIN);
    validate_role_mask(role_mask);

    // Prevent admin from locking themselves out.
    if target == caller && (role_mask & ROLE_ADMIN) != 0 {
        panic!("Cannot revoke own Admin role");
    }

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);

    // Prevent revoking the last remaining Admin holder.
    if (role_mask & ROLE_ADMIN) != 0
        && (current & ROLE_ADMIN) != 0
        && count_role_holders(&roles, ROLE_ADMIN) <= 1
    {
        panic!("Cannot revoke the last remaining Admin role");
    }

    let updated = current & !role_mask;
    if updated == 0 {
        roles.remove(target.clone());
    } else {
        roles.set(target.clone(), updated);
    }
    save_roles(env, &roles);

    let is_high_impact = (role_mask & CRITICAL_ROLE_MASK) != 0;
    env.events().publish(
        (Symbol::new(env, "rbac"), Symbol::new(env, "role_revoked")),
        (caller.clone(), target.clone(), role_mask, updated, is_high_impact),
    );
}

/// Explicit guarded revocation for high-impact roles (`ROLE_ADMIN`, `ROLE_GOV`, `ROLE_UN`).
/// Panics unless `confirm_high_impact` is `true` when revoking any critical role bit.
pub fn revoke_critical_role(
    env: &Env,
    caller: &Address,
    target: &Address,
    role_mask: u32,
    confirm_high_impact: bool,
) {
    validate_role_mask(role_mask);
    if (role_mask & CRITICAL_ROLE_MASK) != 0 && !confirm_high_impact {
        panic!("Confirmation required to revoke high-impact role");
    }
    revoke_role(env, caller, target, role_mask);
}

/// Returns `true` if `role_mask` is valid and `address` holds ALL bits in `role_mask` (AND semantics).
pub fn has_role(env: &Env, address: &Address, role_mask: u32) -> bool {
    if !is_valid_role_mask(role_mask) {
        return false;
    }
    let roles = load_roles(env);
    let bits = roles.get(address.clone()).unwrap_or(0);
    (bits & role_mask) == role_mask
}

/// Returns `true` if `role_mask` is valid and `address` holds AT LEAST ONE bit in `role_mask` (OR semantics).
pub fn has_any_role(env: &Env, address: &Address, role_mask: u32) -> bool {
    if !is_valid_role_mask(role_mask) {
        return false;
    }
    let roles = load_roles(env);
    let bits = roles.get(address.clone()).unwrap_or(0);
    (bits & role_mask) != 0
}

/// Panics with a descriptive message if `address` does not hold ALL roles in `role_mask` (AND semantics).
pub fn require_role(env: &Env, address: &Address, role_mask: u32) {
    validate_role_mask(role_mask);
    if !has_role(env, address, role_mask) {
        panic!("Unauthorized: missing required role");
    }
}

/// Panics if `address` does not hold AT LEAST ONE of the roles in `role_mask` (OR semantics).
pub fn require_any_role(env: &Env, address: &Address, role_mask: u32) {
    validate_role_mask(role_mask);
    if !has_any_role(env, address, role_mask) {
        panic!("Unauthorized: missing required role");
    }
}

/// Seed initial roles from the platform `initialize()` call.
/// OR-s role bits when the same address fulfills multiple initial signer roles.
pub fn seed_initial_roles(
    env: &Env,
    admin: &Address,
    ngo: &Address,
    gov: &Address,
    un: &Address,
) {
    let mut roles = Map::new(env);
    for (addr, bit) in [
        (admin, ROLE_ADMIN),
        (ngo, ROLE_NGO),
        (gov, ROLE_GOV),
        (un, ROLE_UN),
    ] {
        let cur = roles.get(addr.clone()).unwrap_or(0);
        roles.set(addr.clone(), cur | bit);
    }
    save_roles(env, &roles);
}

/// Return the bitmask of roles held by `address` (0 = no roles).
pub fn get_roles(env: &Env, address: &Address) -> u32 {
    load_roles(env).get(address.clone()).unwrap_or(0)
}
