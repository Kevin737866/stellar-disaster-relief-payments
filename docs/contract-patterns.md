# Shared Contract Patterns

Several contracts perform the same jobs: reject duplicates, record an auditable
history, and page through records. The implementations currently differ. This note
defines the shared patterns those contracts should converge on and records the
inconsistencies that still exist. It is the architecture reference for issue #220.

## Where the patterns appear

| Concern | `aid_registry.rs` | `merchant_network.rs` | `cash_transfer.rs` | `beneficiary_manager.rs` |
| --- | --- | --- | --- | --- |
| Duplicate key | `beneficiary + purpose` scanned across a fund's records | existence of `merchant_id` | existence of `transfer_id` | existence of `beneficiary_id` / identity hash |
| Duplicate check | full map scan on every submission | key lookup | key lookup | key lookup |
| Audit record | `DisbursementRecord` plus an optional event | `Transaction` / `Settlement` structs | `Transaction` struct | profile plus identity factors |
| Pagination | offset/limit over a map | unbounded list helpers | none | cursor/offset helpers in the SDK |
| Failure style | `panic_with_error!` / `panic!` | `panic_with_error!` | boolean return and panic mix | panic |

The differences are not cosmetic. A full map scan for duplicate detection gets
more expensive as a fund grows, and an unbounded list cannot be used safely from a
client with a fixed ledger budget.

## Pattern 1: deterministic deduplication

### Canonical rule

Build a deterministic key from the values that define uniqueness, then
check-and-insert that key **inside the same operation** that records the value.

```
dedup_key = "<domain>:<scope>:<subject>:<purpose>"
```

Examples:

- disbursement: `disbursement:<fund_id>:<beneficiary>:<purpose>`
- conditional transfer: `transfer:<transfer_id>`
- merchant: `merchant:<merchant_id>`
- beneficiary: `beneficiary:<beneficiary_id>`

Do not use the ledger timestamp as part of the uniqueness key. Two calls in the
same ledger must not both succeed because they share a timestamp. Do not use a
check-then-record split across separate calls; another invocation can interleave.

### Required behaviour

1. Normalize inputs before building the key (trim, and use the same case rules for
   every contract).
2. Look up the key directly rather than scanning a map.
3. If the key exists, reject with a typed error that identifies the duplicate.
4. Write the key and the record in one operation. For multi-record operations, do
   all writes before any externally visible effect.
5. Persist the key for as long as the record it protects. A duplicate key that
   expires earlier than the record reopens the duplicate window.

### Current inconsistencies to remove

- `aid_registry::submit_disbursement` scans every record in the fund looking for a
  matching beneficiary and purpose. It should index by a deterministic key.
- `aid_registry` has a second duplicate path (`record_disbursement` /
  `check_duplicate_disbursement`) using a different key shape from the scan above.
  There should be one implementation.
- `aid_registry::record_disbursement` derives the stored beneficiary from ledger
  data instead of the supplied beneficiary address, so the record cannot be used
  to answer "who received this?" reliably.
- `beneficiary_manager` checks an identity hash in `create_identity` and a
  beneficiary ID in `register_beneficiary`. Both are valid, but they should share
  the same key-builder and error vocabulary.

## Pattern 2: audit recording

### Canonical rule

Every action that moves value or changes eligibility writes **both**:

1. a durable record that can be queried later, and
2. a contract event for real-time indexers and monitoring.

An event is not a substitute for a durable record. Logs are not queryable state,
and a temporary record is not an audit trail.

### Required fields

A financial audit record must include:

- a stable record ID,
- the scope (fund/transfer/merchant/campaign),
- the subject (beneficiary, merchant, or recipient),
- the amount and token,
- the ledger timestamp,
- the authorization evidence (approvers, signatures, or rule ID),
- the purpose/category, and
- a transaction or correlation hash where one exists.

### Event shape

Use one event topic per domain, with the record ID and the scope as topics, and
the record as data. Keep the event schema stable and version it if fields are
added. The same event names and field ordering should be used across contracts so
that a single indexer can consume all of them.

### Current inconsistencies to remove

- `aid_registry` stores disbursements but does not consistently emit an event for
  every release path.
- `merchant_network` records transactions and settlements in different storage
  classes and with different ID schemes.
- `cash_transfer::spend` records rejected attempts alongside accepted ones. That is
  useful, but the record must make the outcome explicit and must not be mistaken
  for a transfer of value.
- `beneficiary_manager` has no common audit record for verification and recovery
  actions.

## Pattern 3: bounded pagination

### Canonical rule

Every list endpoint takes a bounded `offset` and `limit` and returns:

```
{
  records: Vec<T>,
  total_count: u64,
  has_more: bool
}
```

Defaults and maximums are part of the contract, not a client convention. A
request above the maximum is clamped, not rejected, so a malformed client cannot
force an unbounded scan. Ordering must be stable across calls; if the underlying
map has no natural order, maintain an ordered index.

### Current inconsistencies to remove

- `aid_registry::get_disbursements` implements bounds but scans the whole map to
  count and skip.
- `merchant_network` exposes unbounded list helpers that the UI can call.
- `cash_transfer` has no paginated history endpoint.
- The SDK and the UI should use the same `PaginatedResponse` shape for every
  domain; `BeneficiaryProfile` and merchant pages currently differ in detail.

## Proposed shared abstraction

Create a small contract-local module (for example `src/records.rs`) containing:

- `DedupKey` builders for the four domains above,
- a `Page<T>` result type and a `paginate` helper with clamping rules,
- event-emission helpers that take a domain and record, and
- a typed `DuplicateRecord` / `InvalidPage` error set.

The module should not depend on a specific contract type. Each contract keeps its
own storage keys and TTL policy; the module only standardizes the shape and the
ordering of operations.

## Migration order

1. Add the shared module and its unit tests without changing existing call sites.
2. Move `aid_registry` disbursement deduplication to a direct key lookup.
3. Move financial records to durable storage as described in
   [storage-architecture.md](./storage-architecture.md).
4. Add the same event shape to merchant and cash-transfer value paths.
5. Convert merchant and cash-transfer lists to the bounded page shape.
6. Remove the legacy unbounded helpers once the SDK and UI use the paged forms.

## Consistency tests

Add table-driven tests that run the same scenarios against every domain:

- the same input produces the same dedup key,
- a second identical request is rejected and changes no balance,
- two requests with different purposes/periods are both accepted,
- a limit of `0` returns an empty page and `has_more` is correct,
- a limit above the maximum is clamped,
- the last page reports `has_more = false`,
- accepted and rejected value movements produce distinguishable audit records,
- events contain the record ID and scope.

These tests belong beside the existing contract tests so a change to one contract
cannot silently drift from the shared pattern.
