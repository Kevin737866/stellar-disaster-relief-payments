#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Events as _}, Address, Env};
use crate::{DisasterReliefPlatform, DisasterReliefPlatformClient};

use crate::rbac::{
    assign_role, get_roles, has_any_role, has_role, is_valid_role_mask, require_any_role,
    require_role, revoke_critical_role, revoke_role, CRITICAL_ROLE_MASK, VALID_ROLE_MASK,
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

// ── Platform initialization seeding (#156) ───────────────────────────────────

#[test]
fn test_platform_initialize_seeds_rbac_roles() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(DisasterReliefPlatform, ());
    let client = DisasterReliefPlatformClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let ngo = Address::generate(&env);
    let gov = Address::generate(&env);
    let un = Address::generate(&env);

    client.initialize(&admin, &ngo, &gov, &un);

    env.as_contract(&contract_id, || {
        assert!(has_role(&env, &admin, ROLE_ADMIN));
        assert!(has_role(&env, &ngo, ROLE_NGO));
        assert!(has_role(&env, &gov, ROLE_GOV));
        assert!(has_role(&env, &un, ROLE_UN));
    });
}

#[test]
#[should_panic(expected = "Platform already initialized")]
fn test_platform_initialize_rejects_duplicate_init() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(DisasterReliefPlatform, ());
    let client = DisasterReliefPlatformClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let ngo = Address::generate(&env);
    let gov = Address::generate(&env);
    let un = Address::generate(&env);

    client.initialize(&admin, &ngo, &gov, &un);
    client.initialize(&admin, &ngo, &gov, &un);
}

// ── Bitmask AND vs OR semantics (#157) ───────────────────────────────────────

#[test]
#[should_panic(expected = "Unauthorized: missing required role")]
fn test_require_role_demands_all_bits_whereas_require_any_allows_subset() {
    let (env, _, ngo, _, _) = setup();
    // Precondition: require_any_role passes when target has one of the bits.
    assert!(has_any_role(&env, &ngo, ROLE_NGO | ROLE_OPERATOR));
    require_any_role(&env, &ngo, ROLE_NGO | ROLE_OPERATOR);
    // require_role demands ALL bits and therefore panics here.
    require_role(&env, &ngo, ROLE_NGO | ROLE_OPERATOR);
}

// ── Role mask validation (#158) ──────────────────────────────────────────────

#[test]
fn test_valid_role_mask_boundaries() {
    assert!(is_valid_role_mask(ROLE_ADMIN));
    assert!(is_valid_role_mask(VALID_ROLE_MASK));
    assert!(!is_valid_role_mask(0));
    assert!(!is_valid_role_mask(1 << 10));
}

#[test]
#[should_panic(expected = "Invalid role mask")]
fn test_assign_role_rejects_unknown_bits() {
    let (env, admin, _, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &admin, &target, 1 << 10);
}

#[test]
#[should_panic(expected = "Invalid role mask")]
fn test_assign_role_rejects_zero_mask() {
    let (env, admin, _, _, _) = setup();
    let target = Address::generate(&env);
    assign_role(&env, &admin, &target, 0);
}

#[test]
#[should_panic(expected = "Invalid role mask")]
fn test_revoke_role_rejects_unknown_bits() {
    let (env, admin, ngo, _, _) = setup();
    revoke_role(&env, &admin, &ngo, 1 << 15);
}

// ── Revocation safeguards & audit events (#159) ──────────────────────────────

#[test]
fn test_revoke_role_emits_audit_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(DisasterReliefPlatform, ());
    let client = DisasterReliefPlatformClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let ngo = Address::generate(&env);
    let gov = Address::generate(&env);
    let un = Address::generate(&env);
    client.initialize(&admin, &ngo, &gov, &un);

    env.as_contract(&contract_id, || {
        let before = env.events().all().len();
        revoke_critical_role(&env, &admin, &gov, ROLE_GOV, true);
        let after = env.events().all().len();
        assert_eq!(after, before + 1);
        assert!(!has_role(&env, &gov, ROLE_GOV));
        assert_ne!(CRITICAL_ROLE_MASK & ROLE_GOV, 0);
    });
}

#[test]
#[should_panic(expected = "Confirmation required to revoke high-impact role")]
fn test_revoke_critical_role_requires_confirmation() {
    let (env, admin, _, gov, _) = setup();
    revoke_critical_role(&env, &admin, &gov, ROLE_GOV, false);
}

// ── Instance storage isolation across contracts (#160) ───────────────────────

#[test]
fn test_rbac_roles_are_isolated_per_contract_instance() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_a = env.register(DisasterReliefPlatform, ());
    let contract_b = env.register(DisasterReliefPlatform, ());
    let client_a = DisasterReliefPlatformClient::new(&env, &contract_a);
    let client_b = DisasterReliefPlatformClient::new(&env, &contract_b);

    let admin_a = Address::generate(&env);
    let ngo_a = Address::generate(&env);
    let gov_a = Address::generate(&env);
    let un_a = Address::generate(&env);
    client_a.initialize(&admin_a, &ngo_a, &gov_a, &un_a);

    let admin_b = Address::generate(&env);
    let ngo_b = Address::generate(&env);
    let gov_b = Address::generate(&env);
    let un_b = Address::generate(&env);
    client_b.initialize(&admin_b, &ngo_b, &gov_b, &un_b);

    env.as_contract(&contract_a, || {
        assign_role(&env, &admin_a, &ngo_a, ROLE_OPERATOR);
        assert!(has_role(&env, &ngo_a, ROLE_OPERATOR));
    });

    env.as_contract(&contract_b, || {
        assert!(!has_role(&env, &ngo_a, ROLE_OPERATOR));
        assert!(!has_role(&env, &admin_a, ROLE_ADMIN));
        assert!(has_role(&env, &admin_b, ROLE_ADMIN));
    });
}
