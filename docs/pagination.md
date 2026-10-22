# Pagination and Scan Limits

Large disaster deployments can contain thousands of beneficiaries and
merchants. Listing everything in a single contract call or UI render is
expensive, slow, and can exceed Soroban resource limits. Paginated access is
therefore the **default** for production clients.

## Defaults and hard limits

| Resource | Default page size | Maximum page size | Ordering |
| --- | --- | --- | --- |
| Beneficiaries | 20 | 100 | `(registration_date ASC, id ASC)` |
| Merchants (all / location / category) | 20 | 100 | Contract map iteration order |

The contract clamps a page size of `0` to the default and caps values above
the maximum. Clients should still validate before calling so operators receive
a clear error instead of silently clipped results.

## Beneficiaries — cursor pagination

The beneficiary contract uses a cursor because it is stable when new records
are inserted between requests.

```ts
import { BeneficiaryClient } from 'stellar-disaster-relief-sdk';

const client = new BeneficiaryClient(config);
let cursor: string | undefined;

do {
  const page = await client.listBeneficiariesPaginated('disaster-2026', {
    cursor,
    limit: 50,
  });

  render(page.items);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

Rust entry point:

```rust
list_beneficiaries_paginated(
    env,
    disaster_id,
    cursor_ts: u64,
    cursor_id: String,
    limit: u32,
) -> (Vec<BeneficiaryProfile>, u64, String)
```

Pass `cursor_ts = 0` and `cursor_id = ""` for the first page. The returned
`(next_ts, next_id)` pair is the cursor for the next call; `next_ts == 0` and
an empty `next_id` mean the end of the dataset.

## Merchants — offset pagination

Merchant discovery returns `(merchants, total_count, has_more)`.

```ts
const page = await merchantClient.findMerchantsByLocationPaginated(
  6.5244, // latitude
  3.3792, // longitude
  25,     // radius in km
  { offset: 0, limit: 50 }
);

render(page.merchants);
// page.totalCount is the number of matching merchants
// page.hasMore tells you whether another page exists
```

Available methods:

- `findMerchantsPaginated({ offset, limit })`
- `findMerchantsByLocationPaginated(lat, lon, radiusKm, { offset, limit })`
- `findMerchantsByCategoryPaginated(category, { offset, limit })`

Offset pagination is used for compatibility with existing clients. If a
merchant registers while an operator is paging, later offsets can shift.
De-duplicate accumulated results by `merchant.id`.

## UI behaviour

- `BeneficiaryRegistration` loads the first 20 beneficiaries and shows a
  **Load More** button while `hasMore` is true. Pages are merged by `id`, so a
  record returned twice is rendered once.
- The dashboard requests a bounded page (maximum 100 records) for aggregate
  metrics instead of scanning the whole dataset. The UI states that the
  beneficiary metrics are page-scoped; use the dedicated views for full data.

## Legacy unbounded helpers

The following helpers remain for backwards compatibility and small datasets.
Do **not** use them as the default listing path:

| Contract function | SDK method | Why it is legacy |
| --- | --- | --- |
| `list_beneficiaries_by_disaster` | `listBeneficiariesByDisaster` | Loads every beneficiary for a disaster into memory. |
| `find_merchants_by_location` | `findMerchantsByLocation` | Loads every merchant within the radius. |
| `find_merchants_by_category` | — | Loads every merchant in the category. |

If you must use one of these for an export or migration, bound the dataset
before calling (for example by disaster or a small radius) and document the
expected maximum.

## Operational guidance

1. Prefer 20–50 records per page for interactive UI; reserve 100 for exports or
   aggregate jobs.
2. Never request more than 100 records per call; the contract will cap it.
3. Always handle the empty page case and the last-page case (`hasMore === false`).
4. De-duplicate by stable IDs when accumulating offset-paginated results.
5. If you need a true total for beneficiaries, count the records in your
   off-chain index rather than paging the entire contract on every render.
