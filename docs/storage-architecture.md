# Storage Classes and Retention

This note records why each kind of contract data uses `instance`, `persistent`, or
`temporary` storage, and what retention each kind requires. It is the architecture
reference for issue #221.

## Why the choice matters

Soroban storage classes have different lifetimes and cost profiles:

| Class | Lifetime | Intended use |
| --- | --- | --- |
| `instance` | Tied to the contract instance entry. Restored with the instance when it is bumped. | Configuration and small aggregate state that every invocation needs. |
| `persistent` | Independent entry with its own TTL. Can outlive the contract instance and is read by key. | Records that must survive across long periods: identity, financial history, audit trails. |
| `temporary` | Independent entry with a short TTL. Cheap, but data **can disappear** without a read. | Caches, in-flight data, and high-churn data whose loss is recoverable. |

A financial record in `temporary` storage is not a retention policy; it is a data
loss policy. A financial record in `instance` storage is safer than `temporary`,
but it inherits the instance TTL and is not independently renewable.

## Current usage

Counts are from `master` at the time of writing.

| Contract | `instance` | `persistent` | `temporary` |
| --- | --- | --- | --- |
| `aid_registry.rs` | 51 | 0 | 0 |
| `beneficiary_manager.rs` | 20 | 13 | 0 |
| `cash_transfer.rs` | 16 | 0 | 0 |
| `merchant_network.rs` | 32 | 0 | 10 |
| `anti_fraud.rs` | 17 | 0 | 0 |
| `supply_chain_tracker.rs` | 6 | 0 | 0 |
| `lib.rs` | 10 | 0 | 0 |

Key observations:

- `beneficiary_manager.rs` already puts identity material (`identities`) and
  recovery state in `persistent` storage. That is the right model for
  durable personal records.
- `aid_registry.rs` keeps funds, disbursements, triggers, oracle readings, and
  duplicate-check records in `instance` storage. These are financial and audit
  records and should not depend on the instance TTL.
- `cash_transfer.rs` keeps transfers and their transaction history in `instance`
  storage. Transaction history is an audit record.
- `merchant_network.rs` stores completed transactions and offline transaction
  queues in `temporary` storage. Temporary storage is appropriate for the
  *queue*, but not for a transaction that has already moved value.

## Rationale by data type

### Contract configuration and active aggregates

**Use `instance`.** Examples: RBAC roles, admin addresses, active network
configuration, small counters or maps that every call needs.

Instance storage is justified when:

- the value is read on nearly every invocation,
- losing it would make the contract unusable, and
- the data is small and bounded.

The instance TTL must still be extended by operations that depend on it. A
contract that never bumps its instance can lose its own configuration.

### Identity and personal records

**Use `persistent`.** Examples: `BeneficiaryIdentity`, recovery codes,
recovery requests, wallet bindings, and verification attestations.

These records must remain readable across months or years, after periods of
inactivity, and independently of the contract instance. They also carry privacy
requirements: store hashes or opaque identifiers rather than raw personal data
where the contract allows it, and never store secrets in cleartext.

### Financial records and audit history

**Use `persistent`.** Examples: emergency funds, disbursement records, fund
allocations, conditional transfers, completed merchant transactions, settlement
records, oracle confirmations used to release funds, and duplicate-prevention
records.

Financial history must be durable because it is the source of truth for:

- balances and remaining allocations,
- duplicate/replay prevention,
- donor and auditor reporting,
- dispute resolution, and
- incident reconstruction.

A completed transaction cannot be moved back into a queue and replayed later. If
a financial record is only `temporary`, an expired entry becomes an accounting
gap and may allow the same disbursement to be made twice.

### Recoverable in-flight data

**`temporary` is acceptable only when the loss is recoverable.** The offline
transaction queue in `merchant_network.rs` is the clearest valid case: if an
entry is lost before sync, the merchant still has the signed payload off-chain
and can resubmit it. On sync, the durable transaction record must be written to
`persistent` storage before the queue entry is removed.

Other valid temporary use cases are caches, simulation results, and short-lived
nonces. None of them may be the only copy of a value transfer.

## Retention review

| Data | Current class | Required class | Action |
| --- | --- | --- | --- |
| `aid_registry`: `fund` map | `instance` | `persistent` | Move fund records to persistent keys; extend TTL on read/write. |
| `aid_registry`: `disbursements_*` | `instance` | `persistent` | Persist each disbursement record; keep the fund index as a bounded secondary index. |
| `aid_registry`: `triggers_*` | `instance` | `persistent` | Triggers control releases and must survive instance expiry. |
| `aid_registry`: `oracle_*` and replay markers | `instance` | `persistent` | Evidence for a release and replay protection must be durable. |
| `aid_registry`: `duplicate_check_records` | `instance` | `persistent` | Duplicate prevention is a financial control. |
| `cash_transfer`: `transfers` | `instance` | `persistent` | Transfer state and remaining balance must be durable. |
| `cash_transfer`: `transactions_*` | `instance` | `persistent` | Spending history is audit evidence. |
| `merchant_network`: `merchants` and `settlements` | `instance` | `persistent` | Merchant identity and settlement history outlive the current campaign. |
| `merchant_network`: `transactions` | `temporary` | `persistent` | A completed payment is not a cache entry. |
| `merchant_network`: `offline_transactions` | `temporary` | `temporary` | Acceptable while queued; the synced transaction must be persisted first. |
| `merchant_network`: `fraud_alerts` | `instance` | `persistent` | Alerts are audit and safeguarding evidence. |
| `beneficiary_manager`: `identities` | `persistent` | `persistent` | Correct as-is. |
| `beneficiary_manager`: `beneficiaries` | `instance` | `persistent` | Registration records must be durable. |

Until the code changes land, operators should treat instance-only financial data
as **at risk of expiry** and include the contract instance in their TTL
monitoring. Contract upgrades must not assume that all history is persistent.

## Migration guidance

1. Introduce per-record persistent keys instead of one large map where the map
   can grow without bound. A single persistent map still has one TTL.
2. Add an `extend_ttl` call on every read/write path for durable records, and
   define a retention horizon (for example, the fund expiry plus the audit
   window required by the operator).
3. Write the durable transaction record before deleting any temporary queue
   entry. Never acknowledge a sync until the persistent write succeeds.
4. Keep duplicate keys deterministic and persist them in the same operation that
   records the disbursement. A separate check followed by a later write is not
   atomic.
5. Emit an event for every class migration so the change is visible in the
   contract's history.

## Review checklist

- [ ] Every value that can move funds has a durable record.
- [ ] Every duplicate/replay key is durable.
- [ ] Every temporary entry has a documented recovery path.
- [ ] Every durable entry has an owner, a TTL policy, and a retention horizon.
- [ ] Instance TTL extension is part of the operational runbook.
- [ ] Audit/reporting queries do not depend on temporary data.
