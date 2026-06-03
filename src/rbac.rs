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
///
/// # Storage Layout
///
/// Roles are stored in instance storage under the key `"roles"` as a
/// `Map<Address, u32>` where the u32 is a bitmask of assigned roles.
///
/// # Privilege Escalation Protection
///
/// - Only Admin can assign or revoke roles.
/// - Admin cannot revoke their own Admin role (lockout protection).
/// - `initialize()` is guarded by a one-time init flag; re-initialization panics.

use soroban_sdk::{Address, Env, Map, Symbol};

// Role bitmask constants — each role is a distinct bit.
pub const ROLE_ADMIN: u32    = 1 << 0; // 1
pub const ROLE_NGO: u32      = 1 << 1; // 2
pub const ROLE_GOV: u32      = 1 << 2; // 4
pub const ROLE_UN: u32       = 1 << 3; // 8
pub const ROLE_AUDITOR: u32  = 1 << 4; // 16
pub const ROLE_ORACLE: u32   = 1 << 5; // 32
pub const ROLE_OPERATOR: u32 = 1 << 6; // 64
pub const ROLE_TRANSPORTER: u32 = 1 << 7; // 128
pub const ROLE_MERCHANT: u32 = 1 << 8; // 256
pub const ROLE_RECIPIENT: u32 = 1 << 9; // 512

const ROLES_KEY: &str = "roles";

// ── Storage helpers ──────────────────────────────────────────────────────────

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

// ── Public API ───────────────────────────────────────────────────────────────

/// Assign `role_mask` to `target`. Caller must be Admin.
///
/// Multiple roles can be assigned in one call by OR-ing role constants:
/// ```
/// assign_role(&env, &admin, &target, ROLE_NGO | ROLE_OPERATOR);
/// ```
pub fn assign_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    caller.require_auth();
    require_role(env, caller, ROLE_ADMIN);

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);
    roles.set(target.clone(), current | role_mask);
    save_roles(env, &roles);
}

/// Revoke `role_mask` from `target`. Caller must be Admin.
///
/// Panics if the caller attempts to revoke their own Admin role (lockout protection).
pub fn revoke_role(env: &Env, caller: &Address, target: &Address, role_mask: u32) {
    caller.require_auth();
    require_role(env, caller, ROLE_ADMIN);

    // Prevent admin from locking themselves out.
    if target == caller && (role_mask & ROLE_ADMIN) != 0 {
        panic!("Cannot revoke own Admin role");
    }

    let mut roles = load_roles(env);
    let current = roles.get(target.clone()).unwrap_or(0);
    roles.set(target.clone(), current & !role_mask);
    save_roles(env, &roles);
}

/// Returns `true` if `address` holds all bits in `role_mask`.
pub fn has_role(env: &Env, address: &Address, role_mask: u32) -> bool {
    let roles = load_roles(env);
    let bits = roles.get(address.clone()).unwrap_or(0);
    (bits & role_mask) == role_mask
}

/// Panics with a descriptive message if `address` does not hold `role_mask`.
pub fn require_role(env: &Env, address: &Address, role_mask: u32) {
    if !has_role(env, address, role_mask) {
        panic!("Unauthorized: missing required role");
    }
}

/// Panics if `address` does not hold at least one of the roles in `role_mask`.
pub fn require_any_role(env: &Env, address: &Address, role_mask: u32) {
    let roles = load_roles(env);
    let bits = roles.get(address.clone()).unwrap_or(0);
    if (bits & role_mask) == 0 {
        panic!("Unauthorized: missing required role");
    }
}

/// Seed initial roles from the platform `initialize()` call.
/// Must only be called once (enforced by the caller via the init guard).
pub fn seed_initial_roles(
    env: &Env,
    admin: &Address,
    ngo: &Address,
    gov: &Address,
    un: &Address,
) {
    let mut roles = Map::new(env);
    roles.set(admin.clone(), ROLE_ADMIN);
    roles.set(ngo.clone(), ROLE_NGO);
    roles.set(gov.clone(), ROLE_GOV);
    roles.set(un.clone(), ROLE_UN);
    save_roles(env, &roles);
}

/// Return the bitmask of roles held by `address` (0 = no roles).
pub fn get_roles(env: &Env, address: &Address) -> u32 {
    load_roles(env).get(address.clone()).unwrap_or(0)
}
