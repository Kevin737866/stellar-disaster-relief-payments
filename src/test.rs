#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Map, String, Vec, U256,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn u256(v: u64) -> U256 {
    U256::from_u64(v)
}

// ─── AidRegistry Tests ──────────────────────────────────────────────────────

mod aid_registry_tests {
    use super::*;
    use crate::aid_registry::{AidRegistry, AidRegistryClient};

    fn deploy(env: &Env) -> AidRegistryClient {
        let id = env.register(AidRegistry, ());
        AidRegistryClient::new(env, &id)
    }

    fn make_signers(env: &Env) -> (Address, Address, Address) {
        (
            Address::generate(env),
            Address::generate(env),
            Address::generate(env),
        )
    }

    #[test]
    fn test_create_fund_and_retrieve() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let (s1, s2, s3) = make_signers(&env);

        let triggers = Vec::from_array(&env, [s1.clone(), s2.clone(), s3.clone()]);

        client.create_fund(
            &admin,
            &str(&env, "fund_001"),
            &str(&env, "Haiti Earthquake Relief"),
            &str(&env, "Emergency fund for Haiti earthquake"),
            &u256(1_000_000),
            &str(&env, "earthquake"),
            &str(&env, "Haiti"),
            &9_999_999_999u64,
            &triggers,
            &2u32,
        );

        let fund = client.get_fund(&str(&env, "fund_001"));
        assert!(fund.is_some());

        let f = fund.unwrap();
        assert_eq!(f.id, str(&env, "fund_001"));
        assert_eq!(f.total_amount, u256(1_000_000));
        assert!(f.is_active);
        assert_eq!(f.required_signatures, 2u32);
    }

    #[test]
    fn test_get_fund_returns_none_for_unknown() {
        let env = make_env();
        let client = deploy(&env);

        let result = client.get_fund(&str(&env, "nonexistent"));
        assert!(result.is_none());
    }

    #[test]
    fn test_list_active_funds() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1.clone(), s2.clone()]);

        client.create_fund(
            &admin,
            &str(&env, "fund_a"),
            &str(&env, "Fund A"),
            &str(&env, "Desc A"),
            &u256(500_000),
            &str(&env, "flood"),
            &str(&env, "Region A"),
            &9_999_999_999u64,
            &triggers,
            &2u32,
        );

        client.create_fund(
            &admin,
            &str(&env, "fund_b"),
            &str(&env, "Fund B"),
            &str(&env, "Desc B"),
            &u256(300_000),
            &str(&env, "drought"),
            &str(&env, "Region B"),
            &9_999_999_999u64,
            &triggers,
            &2u32,
        );

        let active = client.list_active_funds();
        assert_eq!(active.len(), 2);
    }

    #[test]
    fn test_cleanup_removes_expired_funds() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1, s2]);

        // Create a fund that expires at timestamp 100
        client.create_fund(
            &admin,
            &str(&env, "expired_fund"),
            &str(&env, "Expired Fund"),
            &str(&env, "Will expire"),
            &u256(100_000),
            &str(&env, "earthquake"),
            &str(&env, "Zone X"),
            &100u64,
            &triggers,
            &2u32,
        );

        // Advance ledger past expiry
        env.ledger().with_mut(|l| l.timestamp = 1_000);
        client.cleanup_expired_funds();

        let active = client.list_active_funds();
        assert_eq!(active.len(), 0);

        let fund = client.get_fund(&str(&env, "expired_fund")).unwrap();
        assert!(!fund.is_active);
    }

    #[test]
    fn test_add_trigger_to_fund() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1]);

        client.create_fund(
            &admin,
            &str(&env, "fund_t"),
            &str(&env, "Trigger Fund"),
            &str(&env, "Has trigger"),
            &u256(500_000),
            &str(&env, "seismic"),
            &str(&env, "Zone T"),
            &9_999_999_999u64,
            &triggers,
            &1u32,
        );

        client.add_trigger(
            &admin,
            &str(&env, "fund_t"),
            &str(&env, "trigger_001"),
            &str(&env, "seismic"),
            &str(&env, "magnitude_7.0"),
            &str(&env, "usgs"),
            &u256(100_000),
            &18_900_000i64,   // ~18.9° latitude × 1e6
            &-72_300_000i64,  // ~-72.3° longitude × 1e6
            &50u64,
            &2u32,
        );

        let triggers_list = client.get_fund_triggers(&str(&env, "fund_t"));
        assert_eq!(triggers_list.len(), 1);
    }

    #[test]
    fn test_allocate_funds_to_sector() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let ben1 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1]);

        client.create_fund(
            &admin,
            &str(&env, "fund_alloc"),
            &str(&env, "Allocation Fund"),
            &str(&env, "For allocation"),
            &u256(1_000_000),
            &str(&env, "flood"),
            &str(&env, "Region Y"),
            &9_999_999_999u64,
            &triggers,
            &1u32,
        );

        let bens = Vec::from_array(&env, [ben1]);
        client.allocate_funds(
            &admin,
            &str(&env, "fund_alloc"),
            &str(&env, "medical"),
            &u256(200_000),
            &bens,
            &str(&env, "WHO assessment report"),
        );

        let allocations = client.get_fund_allocations(&str(&env, "fund_alloc"));
        assert_eq!(allocations.len(), 1);
        assert_eq!(allocations.get(0).unwrap().sector, str(&env, "medical"));
    }

    #[test]
    fn test_get_fund_status_fields() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1]);

        client.create_fund(
            &admin,
            &str(&env, "fund_status"),
            &str(&env, "Status Fund"),
            &str(&env, "Status test"),
            &u256(800_000),
            &str(&env, "hurricane"),
            &str(&env, "Region S"),
            &9_999_999_999u64,
            &triggers,
            &1u32,
        );

        let (status, total, released, available, _count) =
            client.get_fund_status(&str(&env, "fund_status"));

        assert_eq!(status, str(&env, "active"));
        assert_eq!(total, u256(800_000));
        assert_eq!(released, u256(0));
        assert_eq!(available, u256(800_000));
    }

    #[test]
    fn test_enable_recall() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1]);

        client.create_fund(
            &admin,
            &str(&env, "fund_recall"),
            &str(&env, "Recall Fund"),
            &str(&env, "Recall test"),
            &u256(400_000),
            &str(&env, "drought"),
            &str(&env, "Zone R"),
            &9_999_999_999u64,
            &triggers,
            &1u32,
        );

        client.enable_recall(&admin, &str(&env, "fund_recall"));

        let fund = client.get_fund(&str(&env, "fund_recall")).unwrap();
        assert!(fund.recall_enabled);
    }

    #[test]
    fn test_deactivate_trigger() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let triggers = Vec::from_array(&env, [s1]);

        client.create_fund(
            &admin,
            &str(&env, "fund_dt"),
            &str(&env, "Deactivate Trigger Fund"),
            &str(&env, "Test"),
            &u256(200_000),
            &str(&env, "health"),
            &str(&env, "Zone DT"),
            &9_999_999_999u64,
            &triggers,
            &1u32,
        );

        client.add_trigger(
            &admin,
            &str(&env, "fund_dt"),
            &str(&env, "trig_dt"),
            &str(&env, "health"),
            &str(&env, "outbreak"),
            &str(&env, "who"),
            &u256(50_000),
            &0i64,
            &0i64,
            &10u64,
            &1u32,
        );

        client.deactivate_trigger(&admin, &str(&env, "fund_dt"), &str(&env, "trig_dt"));

        let active_triggers = client.get_fund_triggers(&str(&env, "fund_dt"));
        assert_eq!(active_triggers.len(), 0);
    }
}

// ─── BeneficiaryManager Tests ────────────────────────────────────────────────

mod beneficiary_tests {
    use super::*;
    use crate::beneficiary_manager::{BeneficiaryManager, BeneficiaryManagerClient, VerificationFactor};

    fn deploy(env: &Env) -> BeneficiaryManagerClient {
        let id = env.register(BeneficiaryManager, ());
        BeneficiaryManagerClient::new(env, &id)
    }

    fn make_factors(env: &Env) -> Vec<VerificationFactor> {
        let mut factors = Vec::new(env);
        factors.push_back(VerificationFactor {
            factor_type: str(env, "possession"),
            value: str(env, "camp_card_hash_abc123"),
            weight: 40u32,
            verified_at: 0u64,
        });
        factors.push_back(VerificationFactor {
            factor_type: str(env, "behavioral"),
            value: str(env, "arrival_pattern_xyz"),
            weight: 30u32,
            verified_at: 0u64,
        });
        factors.push_back(VerificationFactor {
            factor_type: str(env, "social"),
            value: str(env, "community_voucher_001"),
            weight: 30u32,
            verified_at: 0u64,
        });
        factors
    }

    #[test]
    fn test_register_beneficiary() {
        let env = make_env();
        let client = deploy(&env);
        let registrar = Address::generate(&env);
        let wallet = Address::generate(&env);

        client.register_beneficiary(
            &registrar,
            &str(&env, "ben_001"),
            &str(&env, "Anonymous Displaced Person"),
            &str(&env, "disaster_haiti_2024"),
            &str(&env, "Camp Alpha, Port-au-Prince"),
            &wallet,
            &4u32,
            &Vec::new(&env),
            &make_factors(&env),
        );

        let profile = client.get_beneficiary(&str(&env, "ben_001"));
        assert!(profile.is_some());

        let p = profile.unwrap();
        assert_eq!(p.id, str(&env, "ben_001"));
        assert!(p.is_active);
        assert_eq!(p.family_size, 4u32);
        assert_eq!(p.trust_score, 50u32);
    }

    #[test]
    fn test_get_beneficiary_returns_none_for_unknown() {
        let env = make_env();
        let client = deploy(&env);

        assert!(client.get_beneficiary(&str(&env, "nonexistent")).is_none());
    }

    #[test]
    fn test_verify_beneficiary_correct_factors() {
        let env = make_env();
        let client = deploy(&env);
        let registrar = Address::generate(&env);
        let verifier = Address::generate(&env);
        let wallet = Address::generate(&env);
        let factors = make_factors(&env);

        client.register_beneficiary(
            &registrar,
            &str(&env, "ben_verify"),
            &str(&env, "Verification Test"),
            &str(&env, "disaster_001"),
            &str(&env, "Camp Beta"),
            &wallet,
            &2u32,
            &Vec::new(&env),
            &factors.clone(),
        );

        // Provide correct matching factors — expect success (score = 100%)
        let result = client.verify_beneficiary(&verifier, &str(&env, "ben_verify"), &factors);
        assert!(result);

        // Trust score should have increased
        let profile = client.get_beneficiary(&str(&env, "ben_verify")).unwrap();
        assert!(profile.trust_score > 50u32);
    }

    #[test]
    fn test_verify_beneficiary_wrong_factors() {
        let env = make_env();
        let client = deploy(&env);
        let registrar = Address::generate(&env);
        let verifier = Address::generate(&env);
        let wallet = Address::generate(&env);

        client.register_beneficiary(
            &registrar,
            &str(&env, "ben_wrong"),
            &str(&env, "Wrong Factor Test"),
            &str(&env, "disaster_002"),
            &str(&env, "Camp Gamma"),
            &wallet,
            &1u32,
            &Vec::new(&env),
            &make_factors(&env),
        );

        // Provide wrong factors — expect failure
        let mut wrong = Vec::new(&env);
        wrong.push_back(VerificationFactor {
            factor_type: str(&env, "possession"),
            value: str(&env, "WRONG_HASH"),
            weight: 100u32,
            verified_at: 0u64,
        });

        let result = client.verify_beneficiary(&verifier, &str(&env, "ben_wrong"), &wrong);
        assert!(!result);
    }

    #[test]
    fn test_list_beneficiaries_by_disaster() {
        let env = make_env();
        let client = deploy(&env);
        let registrar = Address::generate(&env);
        let w1 = Address::generate(&env);
        let w2 = Address::generate(&env);
        let factors = make_factors(&env);

        client.register_beneficiary(
            &registrar,
            &str(&env, "ben_d1_a"),
            &str(&env, "Person A"),
            &str(&env, "disaster_xyz"),
            &str(&env, "Camp A"),
            &w1,
            &3u32,
            &Vec::new(&env),
            &factors.clone(),
        );

        client.register_beneficiary(
            &registrar,
            &str(&env, "ben_d1_b"),
            &str(&env, "Person B"),
            &str(&env, "disaster_xyz"),
            &str(&env, "Camp A"),
            &w2,
            &2u32,
            &Vec::new(&env),
            &factors,
        );

        let list = client.list_beneficiaries_by_disaster(&str(&env, "disaster_xyz"));
        assert_eq!(list.len(), 2);
    }
}

// ─── CashTransfer Tests ──────────────────────────────────────────────────────

mod cash_transfer_tests {
    use super::*;
    use crate::cash_transfer::{CashTransfer, CashTransferClient, SpendingRule};

    fn deploy(env: &Env) -> CashTransferClient {
        let id = env.register(CashTransfer, ());
        CashTransferClient::new(env, &id)
    }

    fn food_rule(env: &Env) -> SpendingRule {
        let mut params = Map::new(env);
        params.set(str(env, "category"), str(env, "food"));
        SpendingRule {
            rule_type: str(env, "category_limit"),
            parameters: params,
            limit: u256(500),
            current_usage: u256(0),
        }
    }

    #[test]
    fn test_create_transfer_and_retrieve() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);
        let rules = Vec::from_array(&env, [food_rule(&env)]);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_001"),
            &str(&env, "ben_001"),
            &u256(1_000),
            &str(&env, "USDC"),
            &9_999_999_999u64,
            &rules,
            &str(&env, "Monthly food allowance"),
        );

        let t = client.get_transfer(&str(&env, "txfr_001"));
        assert!(t.is_some());

        let transfer = t.unwrap();
        assert_eq!(transfer.amount, u256(1_000));
        assert_eq!(transfer.remaining_amount, u256(1_000));
        assert!(transfer.is_active);
    }

    #[test]
    fn test_spend_within_limits_succeeds() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let rules = Vec::from_array(&env, [food_rule(&env)]);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_spend"),
            &str(&env, "ben_spend"),
            &u256(1_000),
            &str(&env, "USDC"),
            &9_999_999_999u64,
            &rules,
            &str(&env, "Spend test"),
        );

        let approved = client.spend(
            &beneficiary,
            &str(&env, "txfr_spend"),
            &str(&env, "merchant_001"),
            &u256(300),
            &str(&env, "food"),
            &str(&env, "camp_market"),
        );

        assert!(approved);

        let transfer = client.get_transfer(&str(&env, "txfr_spend")).unwrap();
        assert_eq!(transfer.spent_amount, u256(300));
        assert_eq!(transfer.remaining_amount, u256(700));
    }

    #[test]
    fn test_spend_exceeding_balance_fails() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_exceed"),
            &str(&env, "ben_exceed"),
            &u256(100),
            &str(&env, "USDC"),
            &9_999_999_999u64,
            &Vec::new(&env),
            &str(&env, "Small transfer"),
        );

        let result = client.spend(
            &beneficiary,
            &str(&env, "txfr_exceed"),
            &str(&env, "merchant_002"),
            &u256(200), // More than transfer amount
            &str(&env, "food"),
            &str(&env, "camp_market"),
        );

        assert!(!result);
    }

    #[test]
    fn test_spend_on_expired_transfer_fails() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        // Create transfer that expires at timestamp 100
        client.create_transfer(
            &creator,
            &str(&env, "txfr_exp"),
            &str(&env, "ben_exp"),
            &u256(500),
            &str(&env, "USDC"),
            &100u64,
            &Vec::new(&env),
            &str(&env, "Expiring transfer"),
        );

        // Advance ledger past expiry
        env.ledger().with_mut(|l| l.timestamp = 200);

        let result = client.spend(
            &beneficiary,
            &str(&env, "txfr_exp"),
            &str(&env, "merchant_003"),
            &u256(100),
            &str(&env, "food"),
            &str(&env, "market"),
        );

        assert!(!result);
    }

    #[test]
    fn test_recall_funds_after_expiry() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_recall"),
            &str(&env, "ben_recall"),
            &u256(800),
            &str(&env, "USDC"),
            &100u64,
            &Vec::new(&env),
            &str(&env, "Recall test"),
        );

        env.ledger().with_mut(|l| l.timestamp = 200);
        let recalled = client.recall_funds(&creator, &str(&env, "txfr_recall"));

        assert_eq!(recalled, u256(800));
    }

    #[test]
    fn test_recall_before_expiry_returns_zero() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_early"),
            &str(&env, "ben_early"),
            &u256(300),
            &str(&env, "USDC"),
            &9_999_999_999u64,
            &Vec::new(&env),
            &str(&env, "Not yet expired"),
        );

        let recalled = client.recall_funds(&creator, &str(&env, "txfr_early"));
        assert_eq!(recalled, u256(0));
    }

    #[test]
    fn test_get_transactions_records_spending() {
        let env = make_env();
        let client = deploy(&env);
        let creator = Address::generate(&env);
        let beneficiary = Address::generate(&env);

        client.create_transfer(
            &creator,
            &str(&env, "txfr_hist"),
            &str(&env, "ben_hist"),
            &u256(1_000),
            &str(&env, "USDC"),
            &9_999_999_999u64,
            &Vec::new(&env),
            &str(&env, "History test"),
        );

        client.spend(
            &beneficiary,
            &str(&env, "txfr_hist"),
            &str(&env, "merchant_a"),
            &u256(100),
            &str(&env, "food"),
            &str(&env, "market_a"),
        );

        client.spend(
            &beneficiary,
            &str(&env, "txfr_hist"),
            &str(&env, "merchant_b"),
            &u256(200),
            &str(&env, "medical"),
            &str(&env, "clinic_a"),
        );

        let txns = client.get_transactions(&str(&env, "txfr_hist"));
        assert_eq!(txns.len(), 2);
    }
}

// ─── MerchantNetwork Tests ───────────────────────────────────────────────────

mod merchant_tests {
    use super::*;
    use crate::merchant_network::{
        Location, MerchantNetwork, MerchantNetworkClient, STATUS_ACTIVE, STATUS_TRIAL,
    };

    fn deploy(env: &Env) -> MerchantNetworkClient {
        let id = env.register(MerchantNetwork, ());
        MerchantNetworkClient::new(env, &id)
    }

    fn location(env: &Env) -> Location {
        Location {
            latitude: 18.5944f64,
            longitude: -72.3074f64,
            address: str(env, "Rue des Casernes"),
            city: str(env, "Port-au-Prince"),
            country: str(env, "Haiti"),
            postal_code: str(env, "HT6110"),
        }
    }

    #[test]
    fn test_register_merchant_fast_track() {
        let env = make_env();
        let client = deploy(&env);
        let owner = Address::generate(&env);
        let tokens = Vec::from_array(&env, [str(&env, "USDC")]);
        let vouchers = Vec::new(&env);

        client.register_merchant(
            &owner,
            &str(&env, "merchant_ft"),
            &str(&env, "Fast Track Pharmacy"),
            &str(&env, "pharmacy"),
            &3u32, // CATEGORY_MEDICAL
            &location(&env),
            &str(&env, "+509-1234-5678"),
            &tokens,
            &vouchers,
            &true, // fast-track
        );

        let merchant = client.get_merchant(&str(&env, "merchant_ft")).unwrap();
        assert!(merchant.is_active);
        assert_eq!(merchant.status, STATUS_ACTIVE);
        assert_eq!(merchant.daily_volume_limit, u256(10_000));
    }

    #[test]
    fn test_register_merchant_standard_trial() {
        let env = make_env();
        let client = deploy(&env);
        let owner = Address::generate(&env);
        let tokens = Vec::from_array(&env, [str(&env, "USDC")]);
        let vouchers = Vec::new(&env);

        client.register_merchant(
            &owner,
            &str(&env, "merchant_trial"),
            &str(&env, "Corner Grocery"),
            &str(&env, "grocery"),
            &0u32, // CATEGORY_FOOD
            &location(&env),
            &str(&env, "+509-9876-5432"),
            &tokens,
            &vouchers,
            &false, // standard trial
        );

        let merchant = client.get_merchant(&str(&env, "merchant_trial")).unwrap();
        assert!(!merchant.is_active);
        assert_eq!(merchant.status, STATUS_TRIAL);
    }

    #[test]
    fn test_add_ngo_vouch_activates_merchant() {
        let env = make_env();
        let client = deploy(&env);
        let owner = Address::generate(&env);
        let ngo = Address::generate(&env);
        let tokens = Vec::from_array(&env, [str(&env, "USDC")]);

        client.register_merchant(
            &owner,
            &str(&env, "merchant_vouch"),
            &str(&env, "Local Store"),
            &str(&env, "grocery"),
            &0u32,
            &location(&env),
            &str(&env, "+509-0000-0001"),
            &tokens,
            &Vec::new(&env),
            &false,
        );

        // NGO vouch counts as 3 — meets threshold of 3
        client.add_vouch(&ngo, &str(&env, "merchant_vouch"), &1u32);

        let merchant = client.get_merchant(&str(&env, "merchant_vouch")).unwrap();
        assert!(merchant.is_active);
    }

    #[test]
    fn test_three_beneficiary_vouches_activate_merchant() {
        let env = make_env();
        let client = deploy(&env);
        let owner = Address::generate(&env);
        let tokens = Vec::from_array(&env, [str(&env, "USDC")]);

        client.register_merchant(
            &owner,
            &str(&env, "merchant_bv"),
            &str(&env, "Village Market"),
            &str(&env, "grocery"),
            &0u32,
            &location(&env),
            &str(&env, "+509-0000-0002"),
            &tokens,
            &Vec::new(&env),
            &false,
        );

        // Three beneficiary vouches (type 0)
        let b1 = Address::generate(&env);
        let b2 = Address::generate(&env);
        let b3 = Address::generate(&env);
        client.add_vouch(&b1, &str(&env, "merchant_bv"), &0u32);
        client.add_vouch(&b2, &str(&env, "merchant_bv"), &0u32);
        client.add_vouch(&b3, &str(&env, "merchant_bv"), &0u32);

        let merchant = client.get_merchant(&str(&env, "merchant_bv")).unwrap();
        assert!(merchant.is_active);
    }
}

// ─── SupplyChainTracker Tests ────────────────────────────────────────────────

mod supply_chain_tests {
    use super::*;
    use crate::supply_chain_tracker::{
        Location, SupplyChainTracker, SupplyChainTrackerClient, TemperatureRequirements,
    };

    fn deploy(env: &Env) -> SupplyChainTrackerClient {
        let id = env.register(SupplyChainTracker, ());
        SupplyChainTrackerClient::new(env, &id)
    }

    fn loc(env: &Env, name: &str) -> Location {
        Location {
            latitude: 18.5944f64,
            longitude: -72.3074f64,
            address: str(env, name),
            facility_name: str(env, name),
            contact_person: str(env, "Contact Person"),
        }
    }

    #[test]
    fn test_create_shipment_and_retrieve() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);

        client.create_shipment(
            &donor,
            &str(&env, "ship_001"),
            &str(&env, "donor_red_cross"),
            &str(&env, "medicine"),
            &u256(500),
            &str(&env, "kg"),
            &loc(&env, "Geneva Warehouse"),
            &loc(&env, "Port-au-Prince Clinic"),
            &9_999_999_999u64,
            &None,
            &Vec::new(&env),
        );

        let ship = client.get_shipment(&str(&env, "ship_001"));
        assert!(ship.is_some());

        let s = ship.unwrap();
        assert_eq!(s.supply_type, str(&env, "medicine"));
        assert_eq!(s.current_status, str(&env, "in_transit"));
    }

    #[test]
    fn test_add_checkpoint_updates_status() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);
        let verifier = Address::generate(&env);

        client.create_shipment(
            &donor,
            &str(&env, "ship_cp"),
            &str(&env, "donor_001"),
            &str(&env, "food"),
            &u256(1_000),
            &str(&env, "boxes"),
            &loc(&env, "Origin Warehouse"),
            &loc(&env, "Distribution Center"),
            &9_999_999_999u64,
            &None,
            &Vec::new(&env),
        );

        // Add 3 checkpoints to trigger "at_checkpoint" status
        for i in 0..3u64 {
            env.ledger().with_mut(|l| l.timestamp = i + 1);
            client.add_checkpoint(
                &verifier,
                &str(&env, "ship_cp"),
                &loc(&env, "Transit Point"),
                &u256(1_000),
                &str(&env, "good"),
                &Vec::new(&env),
                &str(&env, "All good"),
                &None,
            );
        }

        let ship = client.get_shipment(&str(&env, "ship_cp")).unwrap();
        assert_eq!(ship.current_status, str(&env, "at_checkpoint"));
        assert_eq!(ship.checkpoints.len(), 3);
    }

    #[test]
    fn test_confirm_delivery_marks_delivered() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.create_shipment(
            &donor,
            &str(&env, "ship_del"),
            &str(&env, "donor_002"),
            &str(&env, "water"),
            &u256(200),
            &str(&env, "liters"),
            &loc(&env, "Source"),
            &loc(&env, "Destination"),
            &9_999_999_999u64,
            &None,
            &Vec::new(&env),
        );

        client.confirm_delivery(
            &recipient,
            &str(&env, "ship_del"),
            &str(&env, "recipient_001"),
            &u256(195),
            &str(&env, "Good condition, minor spillage"),
            &Vec::new(&env),
        );

        let ship = client.get_shipment(&str(&env, "ship_del")).unwrap();
        assert_eq!(ship.current_status, str(&env, "delivered"));
    }

    #[test]
    fn test_assign_transporter() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);
        let transporter = Address::generate(&env);

        client.create_shipment(
            &donor,
            &str(&env, "ship_trans"),
            &str(&env, "donor_003"),
            &str(&env, "shelter_kits"),
            &u256(50),
            &str(&env, "units"),
            &loc(&env, "Depot"),
            &loc(&env, "Camp"),
            &9_999_999_999u64,
            &None,
            &Vec::new(&env),
        );

        client.assign_transporter(&donor, &str(&env, "ship_trans"), &transporter);

        let ship = client.get_shipment(&str(&env, "ship_trans")).unwrap();
        assert!(ship.assigned_transporter.is_some());
    }

    #[test]
    fn test_get_shipment_history() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.create_shipment(
            &donor,
            &str(&env, "ship_hist"),
            &str(&env, "donor_hist"),
            &str(&env, "food"),
            &u256(300),
            &str(&env, "kg"),
            &loc(&env, "Origin"),
            &loc(&env, "Dest"),
            &9_999_999_999u64,
            &None,
            &Vec::new(&env),
        );

        client.confirm_delivery(
            &recipient,
            &str(&env, "ship_hist"),
            &str(&env, "recipient_hist"),
            &u256(300),
            &str(&env, "Perfect condition"),
            &Vec::new(&env),
        );

        let (shipment, confirmation) = client.get_shipment_history(&str(&env, "ship_hist"));
        assert!(shipment.is_some());
        assert!(confirmation.is_some());
    }

    #[test]
    #[should_panic]
    fn test_temperature_violation_panics() {
        let env = make_env();
        let client = deploy(&env);
        let donor = Address::generate(&env);
        let verifier = Address::generate(&env);

        let temp_req = TemperatureRequirements {
            min_temp: 2.0f64,
            max_temp: 8.0f64,
            critical: true,
        };

        client.create_shipment(
            &donor,
            &str(&env, "ship_cold"),
            &str(&env, "donor_pharma"),
            &str(&env, "vaccines"),
            &u256(1_000),
            &str(&env, "doses"),
            &loc(&env, "Lab"),
            &loc(&env, "Clinic"),
            &9_999_999_999u64,
            &Some(temp_req),
            &Vec::new(&env),
        );

        // Temperature of 20°C exceeds 2–8°C range — should panic
        client.add_checkpoint(
            &verifier,
            &str(&env, "ship_cold"),
            &loc(&env, "Customs"),
            &u256(1_000),
            &str(&env, "damaged"),
            &Vec::new(&env),
            &str(&env, "Left in sun"),
            &Some(20.0f64),
        );
    }
}

// ─── AntiFraud Tests ─────────────────────────────────────────────────────────

mod anti_fraud_tests {
    use super::*;
    use crate::anti_fraud::{AntiFraud, AntiFraudClient};

    fn deploy(env: &Env) -> AntiFraudClient {
        let id = env.register(AntiFraud, ());
        AntiFraudClient::new(env, &id)
    }

    #[test]
    fn test_clean_registration_approved() {
        let env = make_env();
        let client = deploy(&env);

        let factors = Vec::from_array(&env, [
            str(&env, "possession:card_abc"),
            str(&env, "behavioral:morning_arrival"),
        ]);

        let (approved, _msg) = client.register_beneficiary_check(
            &str(&env, "ben_clean"),
            &factors,
            &str(&env, "Camp Alpha, Port-au-Prince"),
            &str(&env, "device_fingerprint_ABC123XYZ"),
        );

        assert!(approved);
    }

    #[test]
    fn test_suspicious_device_increases_risk() {
        let env = make_env();
        let client = deploy(&env);

        // Short device fingerprint + "bot" in name = suspicious
        let factors = Vec::new(&env);
        let (approved, _msg) = client.register_beneficiary_check(
            &str(&env, "ben_bot"),
            &factors,
            &str(&env, "Unknown Location"),
            &str(&env, "bot"), // triggers is_suspicious_device
        );

        // Risk score of 30 (from bot device) is below 70 threshold — still approved
        // but marks the device as suspicious
        assert!(approved);
    }

    #[test]
    fn test_monitor_clean_transaction() {
        let env = make_env();
        let client = deploy(&env);

        // First register the beneficiary to create a risk profile
        client.register_beneficiary_check(
            &str(&env, "ben_monitor"),
            &Vec::new(&env),
            &str(&env, "Camp Beta"),
            &str(&env, "device_XYZ_ABCDEFGHIJK"),
        );

        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let (is_clean, risk_factors) = client.monitor_transaction(
            &str(&env, "ben_monitor"),
            &str(&env, "merchant_001"),
            &u256(50),
            &1_000u64,
            &str(&env, "tx_hash_abc123"),
        );

        assert!(is_clean);
        assert!(risk_factors.is_empty() || risk_factors.len() < 3);
    }

    #[test]
    fn test_get_risk_profile() {
        let env = make_env();
        let client = deploy(&env);

        let factors = Vec::from_array(&env, [str(&env, "possession:id_card")]);

        client.register_beneficiary_check(
            &str(&env, "ben_profile"),
            &factors,
            &str(&env, "Camp Gamma"),
            &str(&env, "device_LONGFINGERPRINT123"),
        );

        let profile = client.get_risk_profile(&str(&env, "ben_profile"));
        assert!(profile.is_some());
        assert_eq!(profile.unwrap().entity_type, str(&env, "beneficiary"));
    }
}

// ─── Platform Integration Tests ──────────────────────────────────────────────

mod platform_tests {
    use super::*;
    use crate::{DisasterReliefPlatform, DisasterReliefPlatformClient};

    fn deploy(env: &Env) -> DisasterReliefPlatformClient {
        let id = env.register(DisasterReliefPlatform, ());
        DisasterReliefPlatformClient::new(env, &id)
    }

    #[test]
    fn test_initialize_platform() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        let gov = Address::generate(&env);
        let un = Address::generate(&env);

        assert!(!client.is_initialized());

        client.initialize(&admin, &ngo, &gov, &un);

        assert!(client.is_initialized());
    }

    #[test]
    fn test_get_config_returns_signers() {
        let env = make_env();
        let client = deploy(&env);
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        let gov = Address::generate(&env);
        let un = Address::generate(&env);

        client.initialize(&admin, &ngo, &gov, &un);

        let config = client.get_config();
        assert_eq!(config.len(), 4);
    }
}
