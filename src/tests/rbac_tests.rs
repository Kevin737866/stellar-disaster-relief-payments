#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::rbac::{
    assign_role, get_roles, has_role, require_any_role, require_role, revoke_role,
    seed_initial_roles, ROLE_ADMIN, ROLE_AUDITOR, ROLE_GOV, ROLE_NGO, ROLE_OPERATOR,
    ROLE_ORACLE, ROLE_UN, ROLE_TRANSPORTER, ROLE_MERCHANT, ROLE_RECIPIENT,
};

fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ngo = Address::generate(&env);
    let gov = Address::generate(&env);
    let un = Address::generate(&env);
    seed_initial_roles(&env, &admin, &ngo, &gov, &un);
    (env, admin, ngo, gov, un)
}

// ── seed_initial_roles ───────────────────────────────────────────────────────

#[test]
fn test_seed_assigns_correct_roles() {
    let (env, admin, ngo, gov, un) = setup();
    assert!(has_role(&env, &admin, ROLE_ADMIN));
    assert!(has_role(&env, &ngo, ROLE_NGO));
    assert!(has_role(&env, &gov, ROLE_GOV));
    assert!(has_role(&env, &un, ROLE_UN));
}

#[test]
fn test_seed_does_not_cross_assign() {
    let (env, admin, ngo, gov, un) = setup();
    assert!(!has_role(&env, &admin, ROLE_NGO));
    assert!(!has_role(&env, &ngo, ROLE_ADMIN));
    assert!(!has_role(&env, &gov, ROLE_UN));
    assert!(!has_role(&env, &un, ROLE_GOV));
}

// ── assign_role ──────────────────────────────────────────────────────────────

#[test]
fn test_admin_can_assign_role() {
    let (env, admin, _, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &admin, &target, ROLE_OPERATOR);
    assert!(has_role(&env, &target, ROLE_OPERATOR));
}

#[test]
fn test_admin_can_assign_multiple_roles_at_once() {
    let (env, admin, _, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &admin, &target, ROLE_NGO | ROLE_AUDITOR);
    assert!(has_role(&env, &target, ROLE_NGO));
    assert!(has_role(&env, &target, ROLE_AUDITOR));
}

#[test]
#[should_panic(expected = "Unauthorized: missing required role")]
fn test_non_admin_cannot_assign_role() {
    let (env, _, ngo, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &ngo, &target, ROLE_OPERATOR);
}

// ── revoke_role ──────────────────────────────────────────────────────────────

#[test]
fn test_admin_can_revoke_role() {
    let (env, admin, ngo, _, _) = setup();
    revoke_role(&env, &admin, &ngo, ROLE_NGO);
    assert!(!has_role(&env, &ngo, ROLE_NGO));
}

#[test]
#[should_panic(expected = "Cannot revoke own Admin role")]
fn test_admin_cannot_revoke_own_admin_role() {
    let (env, admin, _, _, _) = setup();
    revoke_role(&env, &admin, &admin, ROLE_ADMIN);
}

#[test]
#[should_panic(expected = "Unauthorized: missing required role")]
fn test_non_admin_cannot_revoke_role() {
    let (env, _, ngo, gov, _) = setup();
    revoke_role(&env, &ngo, &gov, ROLE_GOV);
}

#[test]
fn test_revoke_only_removes_specified_bits() {
    let (env, admin, _, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &admin, &target, ROLE_NGO | ROLE_OPERATOR);
    revoke_role(&env, &admin, &target, ROLE_OPERATOR);
    assert!(has_role(&env, &target, ROLE_NGO));
    assert!(!has_role(&env, &target, ROLE_OPERATOR));
}

// ── has_role / require_role ──────────────────────────────────────────────────

#[test]
fn test_has_role_returns_false_for_unknown_address() {
    let (env, _, _, _, _) = setup();
    let stranger = Address::generate(&env);
    assert!(!has_role(&env, &stranger, ROLE_ADMIN));
}

#[test]
fn test_get_roles_returns_zero_for_unknown() {
    let (env, _, _, _, _) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(get_roles(&env, &stranger), 0);
}

#[test]
#[should_panic(expected = "Unauthorized: missing required role")]
fn test_require_role_panics_on_missing_role() {
    let (env, _, ngo, _, _) = setup();
    require_role(&env, &ngo, ROLE_ADMIN);
}

#[test]
fn test_require_role_passes_for_correct_role() {
    let (env, admin, _, _, _) = setup();
    require_role(&env, &admin, ROLE_ADMIN); // must not panic
}

// ── require_any_role ─────────────────────────────────────────────────────────

#[test]
fn test_require_any_role_passes_if_one_matches() {
    let (env, _, ngo, _, _) = setup();
    require_any_role(&env, &ngo, ROLE_ADMIN | ROLE_NGO); // must not panic
}

#[test]
#[should_panic(expected = "Unauthorized: missing required role")]
fn test_require_any_role_panics_if_none_match() {
    let (env, _, ngo, _, _) = setup();
    require_any_role(&env, &ngo, ROLE_ADMIN | ROLE_ORACLE);
}

// ── role bitmask integrity ───────────────────────────────────────────────────

#[test]
fn test_all_role_constants_are_distinct_powers_of_two() {
    let roles = [
        ROLE_ADMIN, ROLE_NGO, ROLE_GOV, ROLE_UN, ROLE_AUDITOR, ROLE_ORACLE, ROLE_OPERATOR,
        ROLE_TRANSPORTER, ROLE_MERCHANT, ROLE_RECIPIENT,
    ];
    for (i, &a) in roles.iter().enumerate() {
        assert!(a.is_power_of_two(), "role {} is not a power of two", a);
        for &b in &roles[i + 1..] {
            assert_ne!(a, b, "duplicate role constant");
            assert_eq!(a & b, 0, "role constants overlap");
        }
    }
}
