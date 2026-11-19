# Batch size limits

Batch disbursements let an operator pay many beneficiaries atomically. This
document defines the enforced limits, why they exist, and how clients should
split larger workloads.

## Limits

| Layer | Constant | Value | Meaning |
| --- | --- | --- | --- |
| Contract | `MAX_BATCH_SIZE` (`src/aid_registry.rs`) | `100` | Maximum entries in one `submit_batch_disbursement` call |
| SDK | `MAX_BATCH_SIZE` (`sdk/src/aidClient.ts`) | `100` | Client-side guard before building a transaction |
| SDK | `MIN_BATCH_SIZE` (`sdk/src/aidClient.ts`) | `1` | Empty batches are rejected |
| Shared types | `BATCH_MAX_SIZE` (`sdk/src/types.ts`) | `100` | Shared limit for batch contract calls and disbursement entries |

The contract and SDK constants must stay in sync. `MAX_BATCH_SIZE` in the SDK
is defined as `BATCH_MAX_SIZE`, so there is one source of truth on the client.

## Why 100?

- Stellar transactions support at most 100 operations. Keeping a batch
  disbursement at or below that ceiling leaves room for the contract
  invocation, signature operations, and fee-bump or wrapper operations.
- Soroban meters CPU instructions, memory, ledger reads, and ledger writes. A
  large recipient list multiplies the work done per entry (address validation,
  duplicate checks, record writes, event data).
- A single oversized invocation can fail late, after doing most of the work,
  which wastes fees and gives the operator a poor failure mode.

The limit is a safety ceiling, not a target. A batch of 100 may still fail if
the fund balance, approver set, or ledger resource limits are insufficient.

## Enforcement

### On-chain

`submit_batch_disbursement` checks the batch in this order:

1. The requester is authorised (`require_auth`).
2. The batch is non-empty; otherwise it panics with
   `"Batch must contain at least one entry"`.
3. The batch has at most 100 entries; otherwise it panics with
   `"Batch exceeds maximum of 100 entries"`.
4. The fund exists and is active.
5. The approver count and approver allow-list satisfy the fund's
   `required_signatures`.
6. Every amount is greater than zero.
7. No beneficiary appears twice in the same batch.
8. The fund has enough unreleased, unreserved balance.

Any failure reverts the **entire** batch. There is no partial success.

### SDK

`AidClient.triggerBatchDisbursement` rejects an empty batch and a batch larger
than `MAX_BATCH_SIZE` before it parses the signing key or contacts the
network. This gives a fast, deterministic error and avoids paying a fee for a
request that the contract will reject.

```ts
import { MAX_BATCH_SIZE } from '@stellar-disaster-relief/sdk';

for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
  const chunk = entries.slice(i, i + MAX_BATCH_SIZE);
  await aidClient.triggerBatchDisbursement(requesterKey, fundId, chunk, approvers);
}
```

Each chunk is its own atomic transaction. If chunk 3 fails, chunks 1 and 2
remain committed. Record the chunk IDs so a retry does not double-pay.

## Operational guidance

- **Chunk by 100 or fewer.** Use a smaller size (for example 25–50) when
  entries have large purpose strings or when the transaction also carries
  many approver signatures.
- **Keep beneficiary IDs unique within a chunk.** The contract rejects
  duplicates inside one batch. The same beneficiary may appear in different
  chunks if policy allows it; enforce any cross-batch uniqueness in the
  operator workflow.
- **Do not blindly retry a failed chunk.** A failed chunk is reverted, so a
  retry is usually safe, but a timeout can leave the transaction status
  unknown. Check the transaction hash before resubmitting.
- **Fund the fee.** Each chunk is a separate transaction and needs its own
  fee and sequence number.
- **Use idempotent batch identifiers.** Disbursement IDs are derived from the
  fund, ledger timestamp, and entry index. Two chunks submitted in the same
  ledger with the same fund could collide in the record map; include a unique
  batch label in the operator log and reconcile before retrying.
- **Reconcile counts and totals.** Compare the number of requested entries,
  returned disbursement IDs, and the fund's released amount.

## Error messages

| Message | Cause | Action |
| --- | --- | --- |
| `Batch must contain at least one entry` | Empty `entries` | Add at least one recipient |
| `Batch exceeds maximum of 100 entries` | More than 100 entries | Split into chunks of ≤100 |
| `Duplicate beneficiary in batch` | Same address twice in one chunk | Deduplicate or move to another chunk |
| `Amount must be greater than zero` | Zero amount | Fix the entry |
| `Insufficient funds in pool` | Total exceeds available balance | Reduce the batch or top up the fund |
| `Insufficient signatures` | Approver count below threshold | Collect more approvals |
| `Unauthorized approver` | Approver not in `release_triggers` | Use an authorised approver |

## Tests

- `src/test.rs::aid_registry_tests::test_submit_batch_accepts_max_size` submits
  exactly 100 entries and asserts 100 IDs are returned.
- `src/test.rs::aid_registry_tests::test_submit_batch_rejects_oversized_batch`
  submits 101 entries and expects a panic.
- `sdk/src/aidClient.batchLimits.test.ts` covers the empty batch, the
  oversized batch, and the exact-maximum boundary.
- `sdk/src/batchClient.test.ts` covers the same 100-operation ceiling for the
  generic `BatchClient`.

## Future work

- Make the limit configurable by governance if Soroban resource limits or
  Stellar operation limits change.
- Add a per-fund or per-disaster batch cap if operators need tighter limits.
- Return a structured error code instead of a panic string so clients can
  branch without parsing messages.
