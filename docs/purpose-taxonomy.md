# Disbursement Purpose Taxonomy

## Why this exists

Fund allocations and disbursements store a free-text `purpose` string. Free
text is useful for audit notes, but it makes reporting and guardrails fragile:

- `"food"`, `"Food supplies"`, `"meals"` and `"ration"` describe the same
  category but sort into different buckets.
- Duplicate-intent detection cannot reliably compare spelling variants.
- Policy rules ("no more than 30% for administration") cannot be enforced on
  arbitrary strings.

The platform therefore keeps the original free text **and** maps it to a small,
stable set of reporting categories. The mapping is deterministic and does not
require a schema migration.

## Canonical categories

| Category | Typical keywords |
| --- | --- |
| `food` | food, meal(s), nutrition, groceries, ration(s), feeding |
| `water` | water, hydration, sanitation, hygiene, wash, latrine(s) |
| `shelter` | shelter, housing, tent(s), blanket(s), bedding, accommodation |
| `medical` | medical, health, medicine(s), hospital, clinic, treatment, first aid, vaccination |
| `education` | education, school, books, tuition, learning, teacher(s) |
| `livelihoods` | livelihood(s), cash for work, employment, income, business, agriculture, seed(s), tools, training, grant |
| `protection` | protection, safety, legal, psychosocial, PSS, GBV, child protection |
| `logistics` | logistics, transport, fuel, delivery, warehouse, storage, fleet |
| `administration` | administration, admin, staff, salaries, overhead, operations, coordination |
| `other` | anything not recognised |

The canonical list is exported as `DISBURSEMENT_PURPOSE_CATEGORIES` in
`sdk/src/types.ts` and as `DISBURSEMENT_PURPOSE_CATEGORIES` in
`src/aid_registry.rs`.

## How classification works

1. **Normalise** the free text: trim, lower-case, replace whitespace/hyphens/
   slashes with `_`, remove other punctuation, and collapse repeated
   underscores. Example: `"Food supplies"` → `"food_supplies"`.
2. **Canonical match**: if the normalised value is already a category name,
   use it.
3. **Keyword match**: scan the normalised value for a known keyword as a whole
   token (or a known phrase such as `first_aid` / `cash_for_work`).
4. **Fallback**: unrecognised values classify as `other`.

Classification is intentionally permissive. A new purpose string is not
rejected; it simply lands in `other` until the keyword map or the operator's
choice is updated.

## Contract behaviour

- The free-text `purpose` is stored on the `DisbursementRecord` for audit.
- `submit_disbursement`, `submit_batch_disbursement`,
  `execute_multi_sig_release` and `record_disbursement` validate that the
  purpose is non-empty and no longer than `PURPOSE_MAX_LEN` (120 bytes).
- `get_purpose_taxonomy()` returns the canonical list for client dropdowns.
- `classify_disbursement_purpose(purpose)` returns the category for a value.

The contract does **not** reject unknown purposes. This preserves
backwards compatibility with existing records and lets operators add context
without a contract upgrade.

## SDK helpers

```ts
import {
  categorizePurpose,
  classifyPurpose,
  validatePurpose,
} from 'stellar-disaster-relief-sdk';

categorizePurpose('Food supplies'); // 'food'
categorizePurpose('cash-for-work'); // 'livelihoods'
categorizePurpose('mystery grant'); // 'other'

classifyPurpose('Food supplies');
// {
//   raw: 'Food supplies',
//   normalized: 'food_supplies',
//   category: 'food',
//   isCanonical: false,
// }

validatePurpose('   '); // 'Purpose is required.'
validatePurpose('x'.repeat(121)); // 'Purpose must be 120 characters or fewer.'
```

Use `validatePurpose` before submitting a disbursement so the operator sees a
clear message before the transaction is built.

## Reporting guidance

- Group by `category` for dashboards, not by raw `purpose`.
- Keep the raw `purpose` in exports for audit and qualitative review.
- If a policy needs a hard boundary, store an explicit category alongside the
  free text (the SDK's batch entry type accepts an optional
  `purposeCategory`) and validate it at the application layer.
- Treat `other` as a signal: review frequent `other` values and either add a
  keyword or introduce a new canonical category through a documented change.

## Limitations

- The classifier is keyword-based, not semantic. Local-language purposes,
  misspellings, or novel programme names may fall into `other`.
- Keywords are matched case-insensitively but are English-centric. Add
  local-language keywords in the same PR that introduces a new programme.
- Classification is derived, not authoritative. If a donor agreement requires a
  specific reporting bucket, capture that decision explicitly rather than
  relying on the heuristic.
- The free-text field remains in storage. Do not put secrets or personal data
  in a purpose string; it is visible to anyone who can read the ledger.

## Change process

1. Add new keywords or categories to both the Rust and TypeScript maps.
2. Add a test case for each new keyword/category.
3. Update the table above.
4. Note the change in the release notes so reporting dashboards can be
   re-run against historical data if necessary.
