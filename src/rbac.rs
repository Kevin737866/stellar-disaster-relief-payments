/// Role-Based Access Control (RBAC) for Stellar Disaster Relief Platform
///
/// Roles:
///   SuperAdmin  - Full platform control; can manage all roles and operations
///   Admin       - Fund management, beneficiary ops, merchant ops, transfers
///   NGOWorker   - Register/verify beneficiaries, create conditional transfers
///   GovOfficer  - Multi-sig disbursements, audit visibility, fraud review
///   UNOfficer   - Multi-sig disbursements, supply chain, cross-org visibility
///   FieldAgent  - Register/verify beneficiaries, process in-field payments
///   Auditor     - Read-only access to all records
///   Merchant    - Process payments, view own transactions
///   Oracle      - Submit oracle/sensor data for trigger verification
///
/// ## Permission-to-operation mapping (complete)
///
/// | Permission            | Operations                                                           |
/// |-----------------------|----------------------------------------------------------------------|
/// | PERM_MANAGE_ROLES     | rbac::assign_role, rbac::revoke_role, rbac::grant_permission        |
/// | PERM_CREATE_FUND      | aid_registry::create_fund                                            |
/// | PERM_MANAGE_FUND      | aid_registry::archive_fund, aid_registry::set_paused,               |
/// |                       | aid_registry::cleanup_expired_funds,                                 |
/// |                       | cash_transfer::cleanup_expired_transfers,                            |
/// |                       | cash_transfer::extend_expiry,                                        |
/// |                       | merchant_network::reset_monthly_volumes,                             |
/// |                       | merchant_network::sync_offline_transactions                          |
/// | PERM_DISBURSE_FUNDS   | aid_registry::submit_disbursement, execute_multi_sig_release         |
/// | PERM_REGISTER_BENEFICIARY | beneficiary_manager::register_beneficiary                        |
/// | PERM_VERIFY_BENEFICIARY   | beneficiary_manager::verify_beneficiary                          |
/// | PERM_DEACTIVATE_BENEFICIARY | beneficiary_manager::deactivate_beneficiary                  |
/// | PERM_CREATE_TRANSFER  | cash_transfer::create_transfer                                       |
/// | PERM_PROCESS_PAYMENT  | cash_transfer::spend, merchant_network::process_payment              |
/// | PERM_REGISTER_MERCHANT | merchant_network::register_merchant                                 |
/// | PERM_VERIFY_MERCHANT  | merchant_network::review_trial_merchant                              |
/// | PERM_MANAGE_SHIPMENT  | supply_chain_tracker::create_shipment, add_checkpoint,               |
/// |                       | assign_transporter                                                   |
/// | PERM_CONFIRM_DELIVERY | supply_chain_tracker::confirm_delivery                               |
/// | PERM_SUBMIT_ORACLE_DATA | aid_registry::submit_oracle_data                                   |
/// | PERM_REVIEW_FRAUD     | anti_fraud::review_transaction, anti_fraud::get_high_risk_entities, |
/// |                       | merchant_network::fraud_detection,                                   |
/// |                       | supply_chain_tracker::report_lost                                    |
/// | PERM_RECALL_FUNDS     | cash_transfer::recall_funds, aid_registry::recall_unused_funds       |
///
/// Permissions are checked by calling `require_permission` before any sensitive
/// operation.  `require_role` is also available for coarser role-only checks.
/// The storage layout keeps a `Map<Address, u32>` for roles and a
/// `Map<Address, u64>` for per-address permission overrides.

use soroban_sdk::{contracttype, Address, Env, Map, Symbol, Vec};

// ─────────────────────────────────────────────────────────────────────────────
// Role definitions (stored as bitmask flags so multiple roles can coexist)
// ─────────────────────────────────────────────────────────────────────────────

/// Individual role flags.  Each constant is a power-of-two so they can be
/// combined with bitwise OR into a single `u32` bitmask stored per address.
pub const ROLE_SUPER_ADMIN: u32  = 1 << 0; // 1
pub const ROLE_ADMIN: u32        = 1 << 1; // 2
pub const ROLE_NGO_WORKER: u32   = 1 << 2; // 4
pub const ROLE_GOV_OFFICER: u32  = 1 << 3; // 8
pub const ROLE_UN_OFFICER: u32   = 1 << 4; // 16
pub const ROLE_FIELD_AGENT: u32  = 1 << 5; // 32
pub const ROLE_AUDITOR: u32      = 1 << 6; // 64
pub const ROLE_MERCHANT: u32     = 1 << 7; // 128
pub const ROLE_ORACLE: u32       = 1 << 8; // 256

// ─────────────────────────────────────────────────────────────────────────────
// Permission definitions
// ─────────────────────────────────────────────────────────────────────────────

/// Fine-grained permissions.  Each permission is also a bitmask flag stored as
/// a `u64` so the system can accommodate up to 64 distinct permissions.
pub const PERM_MANAGE_ROLES: u64         = 1 << 0;  // grant/revoke roles
pub const PERM_CREATE_FUND: u64          = 1 << 1;  // deploy emergency funds
pub const PERM_MANAGE_FUND: u64          = 1 << 2;  // update/close funds
pub const PERM_DISBURSE_FUNDS: u64       = 1 << 3;  // trigger/multi-sig release
pub const PERM_REGISTER_BENEFICIARY: u64 = 1 << 4;  // onboard beneficiaries
pub const PERM_VERIFY_BENEFICIARY: u64   = 1 << 5;  // run verification checks
pub const PERM_DEACTIVATE_BENEFICIARY: u64 = 1 << 6;
pub const PERM_CREATE_TRANSFER: u64      = 1 << 7;  // create conditional transfers
pub const PERM_PROCESS_PAYMENT: u64      = 1 << 8;  // spend from a transfer
pub const PERM_REGISTER_MERCHANT: u64    = 1 << 9;
pub const PERM_VERIFY_MERCHANT: u64      = 1 << 10;
pub const PERM_MANAGE_SHIPMENT: u64      = 1 << 11; // create/update supply shipments
pub const PERM_CONFIRM_DELIVERY: u64     = 1 << 12;
pub const PERM_SUBMIT_ORACLE_DATA: u64   = 1 << 13;
pub const PERM_REVIEW_FRAUD: u64         = 1 << 14; // investigate fraud patterns
pub const PERM_UPDATE_RISK_PROFILE: u64  = 1 << 15;
pub const PERM_READ_ALL: u64             = 1 << 16; // auditor-level read access
pub const PERM_MANAGE_TRIGGERS: u64      = 1 << 17; // add/deactivate fund triggers
pub const PERM_RECALL_FUNDS: u64         = 1 << 18;

// Convenience: all permissions combined
pub const PERM_ALL: u64 = u64::MAX;

// ─────────────────────────────────────────────────────────────────────────────
// Role → default permission set mapping
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the default permission bitmask for a given role flag.
/// A single address may hold several roles; its effective permissions are the
/// union (bitwise OR) of each role's default permissions.
pub fn role_permissions(role: u32) -> u64 {
    match role {
        ROLE_SUPER_ADMIN => PERM_ALL,

        ROLE_ADMIN =>
            PERM_CREATE_FUND
            | PERM_MANAGE_FUND
            | PERM_DISBURSE_FUNDS
            | PERM_REGISTER_BENEFICIARY
            | PERM_VERIFY_BENEFICIARY
            | PERM_DEACTIVATE_BENEFICIARY
            | PERM_CREATE_TRANSFER
            | PERM_PROCESS_PAYMENT
            | PERM_REGISTER_MERCHANT
            | PERM_VERIFY_MERCHANT
            | PERM_MANAGE_SHIPMENT
            | PERM_CONFIRM_DELIVERY
            | PERM_REVIEW_FRAUD
            | PERM_UPDATE_RISK_PROFILE
            | PERM_READ_ALL
            | PERM_MANAGE_TRIGGERS
            | PERM_RECALL_FUNDS,

        ROLE_NGO_WORKER =>
            PERM_REGISTER_BENEFICIARY
            | PERM_VERIFY_BENEFICIARY
            | PERM_CREATE_TRANSFER
            | PERM_REGISTER_MERCHANT
            | PERM_MANAGE_SHIPMENT
            | PERM_READ_ALL,

        ROLE_GOV_OFFICER =>
            PERM_DISBURSE_FUNDS
            | PERM_REVIEW_FRAUD
            | PERM_READ_ALL
            | PERM_RECALL_FUNDS,

        ROLE_UN_OFFICER =>
            PERM_DISBURSE_FUNDS
            | PERM_MANAGE_SHIPMENT
            | PERM_CONFIRM_DELIVERY
            | PERM_REVIEW_FRAUD
            | PERM_READ_ALL,

        ROLE_FIELD_AGENT =>
            PERM_REGISTER_BENEFICIARY
            | PERM_VERIFY_BENEFICIARY
            | PERM_PROCESS_PAYMENT
            | PERM_REGISTER_MERCHANT,

        ROLE_AUDITOR =>
            PERM_READ_ALL,

        ROLE_MERCHANT =>
            PERM_PROCESS_PAYMENT,

        ROLE_ORACLE =>
            PERM_SUBMIT_ORACLE_DATA,

        _ => 0,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain storage helpers
// ─────────────────────────────────────────────────────────────────────────────

const ROLES_KEY: &str  = "rbac_roles";   // Map<Address, u32>  – role bitmask per address
const PERMS_KEY: &str  = "rbac_perms";   // Map<Address, u64>  – permission overrides per address

/// Storage key for the roles map.
fn roles_storage_key(env: &Env) -> Symbol {
    Symbol::new(env, ROLES_KEY)
}

/// Storage key for the permissions override map.
fn perms_storage_key(env: &Env) -> Symbol {
    Symbol::new(env, PERMS_KEY)
}

/// Load the roles map from instance storage.
fn load_roles(env: &Env) -> Map<Address, u32> {
    env.storage()
        .instance()
        .get(&roles_storage_key(env))
        .unwrap_or_else(|| Map::new(env))
}

/// Persist the roles map to instance storage.
fn save_roles(env: &Env, roles: &Map<Address, u32>) {
    env.storage()
        .instance()
        .set(&roles_storage_key(env), roles);
}

/// Load the per-address permission override map.
fn load_perms(env: &Env) -> Map<Address, u64> {
    env.storage()
        .instance()
        .get(&perms_storage_key(env))
        .unwrap_or_else(|| Map::new(env))
}

/// Persist the per-address permission override map.
fn save_perms(env: &Env, perms: &Map<Address, u64>) {
    env.storage()
        .instance()
        .set(&perms_storage_key(env), perms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public RBAC API
// ─────────────────────────────────────────────────────────────────────────────

/// Grant one or more roles (bitmask) to `target`.
///
/// The caller must hold `PERM_MANAGE_ROLES`.  `SuperAdmin` bootstrap: if no
/// roles exist yet the first call is allowed to set up the initial super-admin
/// without a pre-existing check (this mirrors the `initialize` function in
/// `lib.rs` that stores the admin address).
pub fn grant_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    // Bootstrap case: if the roles map is empty we trust lib.rs `initialize`
    // already called `bootstrap_super_admin` before this is invoked externally.
    require_permission(env, caller, PERM_MANAGE_ROLES);

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);
    roles.set(target.clone(), current | role_mask);
    save_roles(env, &roles);
}

/// Revoke one or more roles (bitmask) from `target`.
///
/// The caller must hold `PERM_MANAGE_ROLES`.  A `SuperAdmin` cannot have their
/// super-admin role revoked by a non-super-admin.
pub fn revoke_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    require_permission(env, caller, PERM_MANAGE_ROLES);

    // Guard: only another SuperAdmin can revoke the SUPER_ADMIN role.
    if role_mask & ROLE_SUPER_ADMIN != 0 {
        let caller_roles = get_roles(env, caller);
        if caller_roles & ROLE_SUPER_ADMIN == 0 {
            panic!("RBAC: only SuperAdmin can revoke SuperAdmin role");
        }
    }

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);
    roles.set(target.clone(), current & !role_mask);
    save_roles(env, &roles);
}

/// Override the effective permissions for `target` (adds to role-derived ones).
///
/// Useful for granting a single extra permission without promoting to a full role.
/// Requires `PERM_MANAGE_ROLES`.
pub fn grant_permission(env: &Env, caller: &Address, target: &Address, perm_mask: u64) {
    require_permission(env, caller, PERM_MANAGE_ROLES);

    let mut perms = load_perms(env);
    let current = perms.get(target.clone()).unwrap_or(0u64);
    perms.set(target.clone(), current | perm_mask);
    save_perms(env, &perms);
}

/// Revoke specific permission overrides from `target`.
/// Requires `PERM_MANAGE_ROLES`.
pub fn revoke_permission(env: &Env, caller: &Address, target: &Address, perm_mask: u64) {
    require_permission(env, caller, PERM_MANAGE_ROLES);

    let mut perms = load_perms(env);
    let current = perms.get(target.clone()).unwrap_or(0u64);
    perms.set(target.clone(), current & !perm_mask);
    save_perms(env, &perms);
}

/// Return the role bitmask assigned to `addr`.
pub fn get_roles(env: &Env, addr: &Address) -> u32 {
    load_roles(env).get(addr.clone()).unwrap_or(0)
}

/// Compute the effective permission bitmask for `addr`.
///
/// Effective permissions = union of all role-default permissions + any
/// per-address overrides stored in the perms map.
pub fn get_permissions(env: &Env, addr: &Address) -> u64 {
    let role_mask = get_roles(env, addr);
    let mut effective: u64 = 0;

    // Iterate through each possible role bit and accumulate permissions.
    for bit in 0..9u32 {
        let role = 1u32 << bit;
        if role_mask & role != 0 {
            effective |= role_permissions(role);
        }
    }

    // Apply per-address overrides.
    let overrides = load_perms(env).get(addr.clone()).unwrap_or(0u64);
    effective |= overrides;
    effective
}

/// Returns `true` if `addr` holds all permissions in `perm_mask`.
pub fn has_permission(env: &Env, addr: &Address, perm_mask: u64) -> bool {
    let effective = get_permissions(env, addr);
    (effective & perm_mask) == perm_mask
}

/// Returns `true` if `addr` holds at least one of the roles in `role_mask`.
pub fn has_role(env: &Env, addr: &Address, role_mask: u32) -> bool {
    (get_roles(env, addr) & role_mask) != 0
}

/// Panics with a descriptive error if `addr` does not hold all permissions in
/// `perm_mask`.  Call this at the start of any privileged function.
pub fn require_permission(env: &Env, addr: &Address, perm_mask: u64) {
    if !has_permission(env, addr, perm_mask) {
        panic!("RBAC: insufficient permissions");
    }
}

/// Panics if `addr` does not hold at least one of the roles in `role_mask`.
pub fn require_role(env: &Env, addr: &Address, role_mask: u32) {
    if !has_role(env, addr, role_mask) {
        panic!("RBAC: insufficient role");
    }
}

/// Bootstrap: called once during `initialize` to seed the first SuperAdmin.
/// Skips the `require_permission` guard since no roles exist yet.
pub fn bootstrap_super_admin(env: &Env, admin: &Address) {
    let mut roles = load_roles(env);
    // Only set if not already initialized to prevent re-entrancy on upgrades.
    if !roles.contains_key(admin.clone()) {
        roles.set(admin.clone(), ROLE_SUPER_ADMIN | ROLE_ADMIN);
        save_roles(env, &roles);
    }
}

/// Assign well-known platform signers their default roles.
///
/// - `ngo_signer`  → `ROLE_NGO_WORKER`
/// - `gov_signer`  → `ROLE_GOV_OFFICER`
/// - `un_signer`   → `ROLE_UN_OFFICER`
///
/// Called from `lib.rs` `initialize` after `bootstrap_super_admin`.
pub fn assign_platform_roles(
    env: &Env,
    ngo_signer: &Address,
    gov_signer: &Address,
    un_signer: &Address,
) {
    let mut roles = load_roles(env);

    let ngo_current = roles.get(ngo_signer.clone()).unwrap_or(0);
    roles.set(ngo_signer.clone(), ngo_current | ROLE_NGO_WORKER);

    let gov_current = roles.get(gov_signer.clone()).unwrap_or(0);
    roles.set(gov_signer.clone(), gov_current | ROLE_GOV_OFFICER);

    let un_current = roles.get(un_signer.clone()).unwrap_or(0);
    roles.set(un_signer.clone(), un_current | ROLE_UN_OFFICER);

    save_roles(env, &roles);
}

/// Return a list of all addresses that currently hold any role.
pub fn list_role_holders(env: &Env) -> Vec<Address> {
    let roles = load_roles(env);
    let mut holders = Vec::new(env);
    for (addr, mask) in roles.iter() {
        if mask != 0 {
            holders.push_back(addr);
        }
    }
    holders
}

/// Return a human-readable role name for a single role flag.  Useful for
/// off-chain tooling and event logs.
pub fn role_name(role: u32) -> &'static str {
    match role {
        ROLE_SUPER_ADMIN  => "SuperAdmin",
        ROLE_ADMIN        => "Admin",
        ROLE_NGO_WORKER   => "NGOWorker",
        ROLE_GOV_OFFICER  => "GovOfficer",
        ROLE_UN_OFFICER   => "UNOfficer",
        ROLE_FIELD_AGENT  => "FieldAgent",
        ROLE_AUDITOR      => "Auditor",
        ROLE_MERCHANT     => "Merchant",
        ROLE_ORACLE       => "Oracle",
        _                 => "Unknown",
    }
}
