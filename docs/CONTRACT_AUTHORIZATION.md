# Contract authorization model

The Soroban modules each have their own contract instance and therefore their own instance storage. Initialize RBAC on **every deployed module contract**, not only on `DisasterReliefPlatform`.

## Bootstrap sequence

1. Deploy the platform and each module contract.
2. Call `initialize_access_control(admin, ngo, gov, un)` once on each module contract. The admin address must authorize the call.
3. Use `assign_role(caller, target, role_mask)` to grant additional roles. Only an address with `ROLE_ADMIN` can grant or revoke roles.
4. Keep the admin key offline and grant only the minimum role bits needed by each operator.

The platform's own `initialize(admin, ngo, gov, un)` seeds its local registry. It does not initialize separately deployed module instances.

## Role map

| Role | Intended permissions |
| --- | --- |
| Admin | Fund administration, merchant review, role management |
| NGO | Beneficiary registration, fund requests, supply-chain operations |
| Government / UN | Multi-signature fund releases |
| Auditor | Fraud review and trust-score maintenance |
| Oracle | Submit verified oracle observations |
| Operator | Scheduled cleanup and maintenance |
| Merchant | Merchant-initiated payment and offline sync |
| Recipient | Beneficiary-initiated actions and recovery |

Role checks are additive to Soroban `require_auth`: callers must both authorize the transaction and hold the required role. Multi-signature release checks each approver's authorization and an eligible signer role.

## API compatibility

Some maintenance and fraud-monitoring entry points now accept an explicit actor address so the contract can verify its signature and role. Update SDK call sites to pass the authenticated operator/merchant/beneficiary address. The cleanup, offline-payment, offline-sync, trust-score and fraud-monitoring signatures are intentionally not anonymous.

Read-only methods that expose public operational data remain read-only. Do not treat public ledger data as confidential: Soroban contract storage is publicly observable. Keep real-world beneficiary PII off-chain or store only pseudonymous references/hashes.

## Operational requirements

- Initialize each contract before enabling its UI or API routes.
- Grant `ROLE_MERCHANT`, `ROLE_RECIPIENT`, `ROLE_AUDITOR`, `ROLE_ORACLE`, and `ROLE_OPERATOR` explicitly as needed; these are not granted to the initial admin/NGO/Gov/UN signers automatically.
- Test authorization failures as well as successful role paths before deploying to mainnet.
