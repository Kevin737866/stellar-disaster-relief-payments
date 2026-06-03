#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

use crate::rbac::{self, ROLE_ADMIN, ROLE_AUDITOR, ROLE_NGO, ROLE_OPERATOR};

// ── BeneficiaryManager ───────────────────────────────────────────────────────

mod beneficiary_tests {
    use super::*;
    use crate::{BeneficiaryManager, beneficiary_manager::VerificationFactor};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);
        (env, admin, ngo)
    }

    fn make_factors(env: &Env) -> Vec<VerificationFactor> {
        let mut v = Vec::new(env);
        v.push_back(VerificationFactor {
            factor_type: String::from_str(env, "possession"),
            value: String::from_str(env, "doc_hash_abc"),
            weight: 40,
            verified_at: env.ledger().timestamp(),
        });
        v
    }

    #[test]
    fn test_ngo_can_register_beneficiary() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b1"),
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "disaster1"),
            &String::from_str(&env, "camp_a"),
            &Address::generate(&env),
            &4,
            &Vec::new(&env),
            &make_factors(&env),
        );
        assert!(client.get_beneficiary(&String::from_str(&env, "b1")).is_some());
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_ngo_cannot_register_beneficiary() {
        let (env, admin, _) = setup();
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &admin, // admin has ROLE_ADMIN, not ROLE_NGO
            &String::from_str(&env, "b2"),
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "disaster1"),
            &String::from_str(&env, "camp_b"),
            &Address::generate(&env),
            &1,
            &Vec::new(&env),
            &make_factors(&env),
        );
    }

    #[test]
    fn test_admin_can_deactivate_beneficiary() {
        let (env, admin, ngo) = setup();
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b3"),
            &String::from_str(&env, "Carol"),
            &String::from_str(&env, "d1"),
            &String::from_str(&env, "camp_c"),
            &Address::generate(&env),
            &2,
            &Vec::new(&env),
            &make_factors(&env),
        );
        client.deactivate_beneficiary(&admin, &String::from_str(&env, "b3"));
        let profile = client.get_beneficiary(&String::from_str(&env, "b3")).unwrap();
        assert!(!profile.is_active);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_ngo_cannot_deactivate_beneficiary() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b4"),
            &String::from_str(&env, "Dave"),
            &String::from_str(&env, "d1"),
            &String::from_str(&env, "camp_d"),
            &Address::generate(&env),
            &1,
            &Vec::new(&env),
            &make_factors(&env),
        );
        client.deactivate_beneficiary(&ngo, &String::from_str(&env, "b4"));
    }

    #[test]
    fn test_owner_can_update_location() {
        let (env, _, ngo) = setup();
        let wallet = Address::generate(&env);
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b5"),
            &String::from_str(&env, "Eve"),
            &String::from_str(&env, "d1"),
            &String::from_str(&env, "camp_e"),
            &wallet,
            &1,
            &Vec::new(&env),
            &make_factors(&env),
        );
        client.update_location(&wallet, &String::from_str(&env, "b5"), &String::from_str(&env, "camp_f"));
        let profile = client.get_beneficiary(&String::from_str(&env, "b5")).unwrap();
        assert_eq!(profile.location, String::from_str(&env, "camp_f"));
    }

    #[test]
    #[should_panic(expected = "Unauthorized: caller is not the beneficiary")]
    fn test_non_owner_cannot_update_location() {
        let (env, _, ngo) = setup();
        let wallet = Address::generate(&env);
        let impostor = Address::generate(&env);
        let contract_id = env.register_contract(None, BeneficiaryManager);
        let client = crate::BeneficiaryManagerClient::new(&env, &contract_id);
        client.register_beneficiary(
            &ngo,
            &String::from_str(&env, "b6"),
            &String::from_str(&env, "Frank"),
            &String::from_str(&env, "d1"),
            &String::from_str(&env, "camp_g"),
            &wallet,
            &1,
            &Vec::new(&env),
            &make_factors(&env),
        );
        client.update_location(&impostor, &String::from_str(&env, "b6"), &String::from_str(&env, "camp_h"));
    }
}

// ── CashTransfer ─────────────────────────────────────────────────────────────

mod cash_transfer_tests {
    use super::*;
    use crate::{CashTransfer, cash_transfer::SpendingRule};
    use soroban_sdk::{Map, U256};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);
        (env, admin, ngo)
    }

    #[test]
    fn test_ngo_can_create_transfer() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, CashTransfer);
        let client = crate::CashTransferClient::new(&env, &contract_id);
        client.create_transfer(
            &ngo,
            &String::from_str(&env, "t1"),
            &String::from_str(&env, "b1"),
            &U256::from_u64(&env, 500),
            &String::from_str(&env, "USDC"),
            &(env.ledger().timestamp() + 86400),
            &Vec::new(&env),
            &String::from_str(&env, "food aid"),
        );
        assert!(client.get_transfer(&String::from_str(&env, "t1")).is_some());
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_ngo_cannot_create_transfer() {
        let (env, admin, _) = setup();
        let contract_id = env.register_contract(None, CashTransfer);
        let client = crate::CashTransferClient::new(&env, &contract_id);
        client.create_transfer(
            &admin,
            &String::from_str(&env, "t2"),
            &String::from_str(&env, "b2"),
            &U256::from_u64(&env, 100),
            &String::from_str(&env, "USDC"),
            &(env.ledger().timestamp() + 86400),
            &Vec::new(&env),
            &String::from_str(&env, "test"),
        );
    }

    #[test]
    fn test_operator_can_cleanup_expired_transfers() {
        let (env, admin, _) = setup();
        let operator = Address::generate(&env);
        rbac::assign_role(&env, &admin, &operator, ROLE_OPERATOR);
        let contract_id = env.register_contract(None, CashTransfer);
        let client = crate::CashTransferClient::new(&env, &contract_id);
        client.cleanup_expired_transfers(&operator); // must not panic
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_operator_cannot_cleanup_expired_transfers() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, CashTransfer);
        let client = crate::CashTransferClient::new(&env, &contract_id);
        client.cleanup_expired_transfers(&ngo);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: caller is not the transfer creator")]
    fn test_non_creator_cannot_recall_funds() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, CashTransfer);
        let client = crate::CashTransferClient::new(&env, &contract_id);
        client.create_transfer(
            &ngo,
            &String::from_str(&env, "t3"),
            &String::from_str(&env, "b3"),
            &U256::from_u64(&env, 100),
            &String::from_str(&env, "USDC"),
            &(env.ledger().timestamp() - 1), // already expired
            &Vec::new(&env),
            &String::from_str(&env, "test"),
        );
        let impostor = Address::generate(&env);
        client.recall_funds(&impostor, &String::from_str(&env, "t3"));
    }
}

// ── MerchantNetwork ──────────────────────────────────────────────────────────

mod merchant_tests {
    use super::*;
    use crate::{MerchantNetwork, merchant_network::Location};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);
        (env, admin, ngo)
    }

    fn make_location(env: &Env) -> Location {
        Location {
            latitude: 10.0,
            longitude: 20.0,
            address: String::from_str(env, "123 Main St"),
            city: String::from_str(env, "City"),
            country: String::from_str(env, "Country"),
            postal_code: String::from_str(env, "00000"),
        }
    }

    #[test]
    fn test_anyone_can_register_merchant() {
        let (env, _, _) = setup();
        let owner = Address::generate(&env);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.register_merchant(
            &owner,
            &String::from_str(&env, "m1"),
            &String::from_str(&env, "Shop A"),
            &String::from_str(&env, "grocery"),
            &0u32,
            &make_location(&env),
            &String::from_str(&env, "contact"),
            &Vec::new(&env),
            &Vec::new(&env),
            &false,
        );
        assert!(client.get_merchant(&String::from_str(&env, "m1")).is_some());
    }

    #[test]
    fn test_admin_can_review_trial_merchant() {
        let (env, admin, _) = setup();
        let owner = Address::generate(&env);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.register_merchant(
            &owner,
            &String::from_str(&env, "m2"),
            &String::from_str(&env, "Shop B"),
            &String::from_str(&env, "grocery"),
            &0u32,
            &make_location(&env),
            &String::from_str(&env, "contact"),
            &Vec::new(&env),
            &Vec::new(&env),
            &false,
        );
        client.review_trial_merchant(&admin, &String::from_str(&env, "m2"), &true);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_admin_cannot_review_trial_merchant() {
        let (env, _, ngo) = setup();
        let owner = Address::generate(&env);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.register_merchant(
            &owner,
            &String::from_str(&env, "m3"),
            &String::from_str(&env, "Shop C"),
            &String::from_str(&env, "grocery"),
            &0u32,
            &make_location(&env),
            &String::from_str(&env, "contact"),
            &Vec::new(&env),
            &Vec::new(&env),
            &false,
        );
        client.review_trial_merchant(&ngo, &String::from_str(&env, "m3"), &true);
    }

    #[test]
    fn test_operator_can_settle_balances() {
        let (env, admin, _) = setup();
        let operator = Address::generate(&env);
        rbac::assign_role(&env, &admin, &operator, ROLE_OPERATOR);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.settle_balances(&operator); // must not panic
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_operator_cannot_settle_balances() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.settle_balances(&ngo);
    }

    #[test]
    fn test_operator_can_reset_daily_volumes() {
        let (env, admin, _) = setup();
        let operator = Address::generate(&env);
        rbac::assign_role(&env, &admin, &operator, ROLE_OPERATOR);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.reset_daily_volumes(&operator);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_operator_cannot_reset_daily_volumes() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.reset_daily_volumes(&ngo);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: signer is not the merchant owner")]
    fn test_non_owner_cannot_process_payment() {
        let (env, _, _) = setup();
        let owner = Address::generate(&env);
        let impostor = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let contract_id = env.register_contract(None, MerchantNetwork);
        let client = crate::MerchantNetworkClient::new(&env, &contract_id);
        client.register_merchant(
            &owner,
            &String::from_str(&env, "m4"),
            &String::from_str(&env, "Shop D"),
            &String::from_str(&env, "grocery"),
            &0u32,
            &make_location(&env),
            &String::from_str(&env, "contact"),
            &Vec::new(&env),
            &Vec::new(&env),
            &true, // fast-track so it's active
        );
        use soroban_sdk::U256;
        client.process_payment(
            &impostor,
            &beneficiary,
            &String::from_str(&env, "m4"),
            &String::from_str(&env, "b1"),
            &U256::from_u64(&env, 10),
            &String::from_str(&env, "USDC"),
            &String::from_str(&env, "food"),
            &0u32,
        );
    }
}

// ── SupplyChainTracker ───────────────────────────────────────────────────────

mod supply_chain_tests {
    use super::*;
    use crate::{SupplyChainTracker, supply_chain_tracker::Location};
    use soroban_sdk::U256;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let ngo = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &ngo, &admin, &admin);
        (env, admin, ngo)
    }

    fn make_location(env: &Env) -> Location {
        Location {
            latitude: 0.0,
            longitude: 0.0,
            address: String::from_str(env, "addr"),
            facility_name: String::from_str(env, "facility"),
            contact_person: String::from_str(env, "contact"),
        }
    }

    #[test]
    fn test_ngo_can_create_shipment() {
        let (env, _, ngo) = setup();
        let contract_id = env.register_contract(None, SupplyChainTracker);
        let client = crate::SupplyChainTrackerClient::new(&env, &contract_id);
        client.create_shipment(
            &ngo,
            &String::from_str(&env, "s1"),
            &String::from_str(&env, "donor1"),
            &String::from_str(&env, "medicine"),
            &U256::from_u64(&env, 1000),
            &String::from_str(&env, "units"),
            &make_location(&env),
            &make_location(&env),
            &(env.ledger().timestamp() + 86400),
            &None,
            &Vec::new(&env),
        );
        assert!(client.get_shipment(&String::from_str(&env, "s1")).is_some());
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_ngo_cannot_create_shipment() {
        let (env, admin, _) = setup();
        let contract_id = env.register_contract(None, SupplyChainTracker);
        let client = crate::SupplyChainTrackerClient::new(&env, &contract_id);
        client.create_shipment(
            &admin,
            &String::from_str(&env, "s2"),
            &String::from_str(&env, "donor2"),
            &String::from_str(&env, "food"),
            &U256::from_u64(&env, 500),
            &String::from_str(&env, "kg"),
            &make_location(&env),
            &make_location(&env),
            &(env.ledger().timestamp() + 86400),
            &None,
            &Vec::new(&env),
        );
    }

    #[test]
    fn test_anyone_can_confirm_delivery() {
        let (env, _, ngo) = setup();
        let recipient = Address::generate(&env);
        let contract_id = env.register_contract(None, SupplyChainTracker);
        let client = crate::SupplyChainTrackerClient::new(&env, &contract_id);
        client.create_shipment(
            &ngo,
            &String::from_str(&env, "s3"),
            &String::from_str(&env, "donor3"),
            &String::from_str(&env, "water"),
            &U256::from_u64(&env, 200),
            &String::from_str(&env, "liters"),
            &make_location(&env),
            &make_location(&env),
            &(env.ledger().timestamp() + 86400),
            &None,
            &Vec::new(&env),
        );
        client.confirm_delivery(
            &recipient,
            &String::from_str(&env, "s3"),
            &String::from_str(&env, "r1"),
            &U256::from_u64(&env, 200),
            &String::from_str(&env, "good"),
            &Vec::new(&env),
        );
        let shipment = client.get_shipment(&String::from_str(&env, "s3")).unwrap();
        assert_eq!(shipment.current_status, String::from_str(&env, "delivered"));
    }
}

// ── AntiFraud ────────────────────────────────────────────────────────────────

mod anti_fraud_tests {
    use super::*;
    use crate::AntiFraud;
    use soroban_sdk::U256;

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let auditor = Address::generate(&env);
        rbac::seed_initial_roles(&env, &admin, &admin, &admin, &admin);
        rbac::assign_role(&env, &admin, &auditor, ROLE_AUDITOR);
        (env, admin, auditor)
    }

    #[test]
    fn test_auditor_can_review_transaction() {
        let (env, _, auditor) = setup();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        // review a non-existent tx — should silently succeed (no-op)
        client.review_transaction(
            &auditor,
            &String::from_str(&env, "susp_abc"),
            &String::from_str(&env, "cleared"),
            &String::from_str(&env, "looks fine"),
        );
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_auditor_cannot_review_transaction() {
        let (env, admin, _) = setup();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        client.review_transaction(
            &admin,
            &String::from_str(&env, "susp_xyz"),
            &String::from_str(&env, "blocked"),
            &String::from_str(&env, "suspicious"),
        );
    }

    #[test]
    fn test_auditor_can_get_high_risk_entities() {
        let (env, _, auditor) = setup();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        let result = client.get_high_risk_entities(&auditor, &50u32);
        assert_eq!(result.len(), 0); // empty — no profiles yet
    }

    #[test]
    #[should_panic(expected = "Unauthorized: missing required role")]
    fn test_non_auditor_cannot_get_high_risk_entities() {
        let (env, admin, _) = setup();
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        client.get_high_risk_entities(&admin, &50u32);
    }

    #[test]
    fn test_any_authenticated_caller_can_monitor_transaction() {
        let (env, _, _) = setup();
        let caller = Address::generate(&env);
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        let (ok, _) = client.monitor_transaction(
            &caller,
            &String::from_str(&env, "b1"),
            &String::from_str(&env, "m1"),
            &U256::from_u64(&env, 50),
            &env.ledger().timestamp(),
            &String::from_str(&env, "txhash123"),
        );
        assert!(ok);
    }

    #[test]
    fn test_any_authenticated_caller_can_register_beneficiary_check() {
        let (env, _, _) = setup();
        let caller = Address::generate(&env);
        let contract_id = env.register_contract(None, AntiFraud);
        let client = crate::AntiFraudClient::new(&env, &contract_id);
        let (ok, _) = client.register_beneficiary_check(
            &caller,
            &String::from_str(&env, "b2"),
            &Vec::new(&env),
            &String::from_str(&env, "camp_a"),
            &String::from_str(&env, "device_fingerprint_12345"),
        );
        assert!(ok);
    }
}

// ── AidRegistry — Batch Disbursement ────────────────────────────────────────

mod batch_disbursement_tests {
    use super::*;
    use crate::AidRegistry;
    use soroban_sdk::{U256, Vec};

    fn setup_fund(env: &Env) -> (Address, Address, String) {
        let admin = Address::generate(env);
        let signer = Address::generate(env);
        let fund_id = String::from_str(env, "fund_batch_test");

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(env);
        signers.push_back(signer.clone());

        client.create_fund(
            &admin,
            &fund_id,
            &String::from_str(env, "Batch Test Fund"),
            &String::from_str(env, "Fund for batch tests"),
            &U256::from_u64(env, 10_000),
            &String::from_str(env, "manual"),
            &String::from_str(env, "global"),
            &(env.ledger().timestamp() + 86_400),
            &signers,
            &1u32,
        );

        (admin, signer, fund_id)
    }

    fn make_entries(env: &Env, count: u32, amount: u64) -> Vec<(Address, U256, String)> {
        let mut entries = Vec::new(env);
        for i in 0..count {
            entries.push_back((
                Address::generate(env),
                U256::from_u64(env, amount),
                String::from_str(env, &format!("purpose_{}", i)),
            ));
        }
        entries
    }

    #[test]
    fn test_batch_disbursement_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        // Re-create fund on this contract instance
        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin,
            &fund_id,
            &String::from_str(&env, "Batch Test Fund"),
            &String::from_str(&env, "desc"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"),
            &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400),
            &signers,
            &1u32,
        );

        let entries = make_entries(&env, 3, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer.clone());

        let ids = client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
        assert_eq!(ids.len(), 3);

        // Fund released amount should be 300
        let (_, _, released, _, _) = client.get_fund_status(&fund_id);
        assert_eq!(released, U256::from_u64(&env, 300));
    }

    #[test]
    #[should_panic(expected = "Batch must contain at least one entry")]
    fn test_batch_empty_entries_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        let empty: Vec<(Address, U256, String)> = Vec::new(&env);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer);
        client.submit_batch_disbursement(&admin, &fund_id, &empty, &approvers);
    }

    #[test]
    #[should_panic(expected = "Insufficient funds in pool")]
    fn test_batch_insufficient_funds_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 100), // only 100 available
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        // Try to disburse 3 × 100 = 300 from a 100-unit fund
        let entries = make_entries(&env, 3, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer);
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
    }

    #[test]
    #[should_panic(expected = "Insufficient signatures")]
    fn test_batch_insufficient_signatures_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &2u32, // require 2 sigs
        );

        let entries = make_entries(&env, 1, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer); // only 1 approver, need 2
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
    }

    #[test]
    #[should_panic(expected = "Unauthorized approver")]
    fn test_batch_unauthorized_approver_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        let entries = make_entries(&env, 1, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(Address::generate(&env)); // random, not in release_triggers
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
    }

    #[test]
    #[should_panic(expected = "Duplicate beneficiary in batch")]
    fn test_batch_duplicate_beneficiary_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        let dup = Address::generate(&env);
        let mut entries: Vec<(Address, U256, String)> = Vec::new(&env);
        entries.push_back((dup.clone(), U256::from_u64(&env, 100), String::from_str(&env, "p1")));
        entries.push_back((dup.clone(), U256::from_u64(&env, 100), String::from_str(&env, "p2")));

        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer);
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
    }

    #[test]
    #[should_panic(expected = "Fund is not active")]
    fn test_batch_inactive_fund_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        // Create fund that is already expired
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );
        // Archive it to make it inactive
        client.archive_fund(&admin, &fund_id, &String::from_str(&env, "test"));

        let entries = make_entries(&env, 1, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer);
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);
    }

    #[test]
    fn test_batch_disbursement_records_stored() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        let entries = make_entries(&env, 2, 50);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer);
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);

        let records = client.get_disbursements(&fund_id);
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn test_single_disbursement_still_works_after_batch() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, signer, fund_id) = setup_fund(&env);

        let contract_id = env.register_contract(None, AidRegistry);
        let client = crate::AidRegistryClient::new(&env, &contract_id);

        let mut signers: Vec<Address> = Vec::new(&env);
        signers.push_back(signer.clone());
        client.create_fund(
            &admin, &fund_id,
            &String::from_str(&env, "F"), &String::from_str(&env, "D"),
            &U256::from_u64(&env, 10_000),
            &String::from_str(&env, "manual"), &String::from_str(&env, "global"),
            &(env.ledger().timestamp() + 86_400), &signers, &1u32,
        );

        // Batch first
        let entries = make_entries(&env, 2, 100);
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(signer.clone());
        client.submit_batch_disbursement(&admin, &fund_id, &entries, &approvers);

        // Then single
        let beneficiary = Address::generate(&env);
        let mut single_approvers: Vec<Address> = Vec::new(&env);
        single_approvers.push_back(signer.clone());
        client.submit_disbursement(
            &admin, &fund_id, &beneficiary,
            &U256::from_u64(&env, 50),
            &String::from_str(&env, "single"),
            &single_approvers,
        );

        let (_, _, released, _, _) = client.get_fund_status(&fund_id);
        assert_eq!(released, U256::from_u64(&env, 250)); // 200 batch + 50 single
    }
}
