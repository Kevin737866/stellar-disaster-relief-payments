# Design Document: Dashboard Disaster Filter

## Overview

This design adds a client-side disaster-type filter to the Relief Operations Dashboard (`ui/src/components/Dashboard.tsx`). A `<select>` dropdown in the header area lists unique `disasterType` values extracted from already-loaded funds. Selecting a disaster type filters the funds array before all fund-derived stats, charts, financial summaries, and the fund table are computed. Clearing the selection restores the unfiltered view without re-fetching data.

The filter is entirely client-side: no SDK client calls, on-chain contract interactions, or type changes are involved. Beneficiary, merchant, and transfer data continue to use the existing `query` prop and are not affected by the filter. Only `Dashboard.tsx` needs code changes; a new test file provides component test coverage.

## Architecture

```
Dashboard.tsx
│
├── State (existing)
│   ├── stats: DashboardStats | null         ← computed on load
│   ├── funds: EmergencyFund[]               ← raw funds from aidClient.listActiveFunds()
│   ├── loading: boolean
│   └── error: string | null
│
├── State (new)
│   └── selectedDisasterType: string          ← "" = unfiltered, otherwise the selected type
│
├── Derived (new, useMemo)
│   ├── uniqueDisasterTypes: string[]         ← [...new Set(funds.map(f => f.disasterType))]
│   └── filteredFunds: EmergencyFund[]        ← selectedDisasterType === ""
│                                                  ? funds
│                                                  : funds.filter(f => f.disasterType === selectedDisasterType)
│
├── Stats Recomputation (new, useMemo)
│   └── fundStats: { totalFunds, activeFunds, totalFundAmount, releasedAmount }
│         ← computed from filteredFunds instead of funds
│
├── Data Flow
│   aidClient.listActiveFunds() ──→ funds (state)
│                                    │
│                          selectedDisasterType (state)
│                                    │
│                              filteredFunds (useMemo)
│                                    │
│                    ┌───────────────┼───────────────┐
│                    │               │               │
│              KPI cards        Bar chart       Fund table
│           (fund-derived)   (fund bars only)   (filtered rows)
│                    │               │
│             Financial summary   Donut chart
│              (fund-derived)   (Funds Released)
│
│   beneficiaryClient ──→ beneficiaries (unchanged by filter)
│   merchantClient    ──→ merchants    (unchanged by filter)
│   transferClient    ──→ transfers    (unchanged by filter)
│
└── Render
    ├── loading === true  → "Loading dashboard…" (no filter, no stats)
    ├── loading === false → header + filter <select> + stats + charts + table
    └── filteredFunds.length === 0 && selectedDisasterType !== "" → empty-state message
```

## Components and Interfaces

### Dashboard Component (`ui/src/components/Dashboard.tsx`)

**Changes to state:**

Add one new state variable:

```typescript
const [selectedDisasterType, setSelectedDisasterType] = useState<string>('');
```

**Changes to derived data:**

Add `useMemo` hooks that derive `uniqueDisasterTypes` and `filteredFunds` from `funds` and `selectedDisasterType`:

```typescript
import { useState, useEffect, useMemo } from 'react';

const uniqueDisasterTypes = useMemo(
  () => [...new Set(funds.map((f) => f.disasterType))],
  [funds]
);

const filteredFunds = useMemo(
  () => selectedDisasterType === ''
    ? funds
    : funds.filter((f) => f.disasterType === selectedDisasterType),
  [funds, selectedDisasterType]
);
```

**Changes to stat computation:**

The fund-derived portion of `DashboardStats` (`totalFunds`, `activeFunds`, `totalFundAmount`, `releasedAmount`) must be recomputed from `filteredFunds` instead of `funds`. Two approaches:

- **Option A (preferred):** Compute a `fundStats` object via `useMemo` from `filteredFunds`, and use it wherever the existing render reads `stats.totalFunds`, `stats.activeFunds`, `stats.totalFundAmount`, and `stats.releasedAmount`. The beneficiary, merchant, and transfer fields of `stats` remain as loaded.

- **Option B:** Keep `stats` as loaded from `loadDashboardData()` and override the four fund fields at render time using `filteredFunds`.

Option A is cleaner because it separates the server-loaded stats from the client-filtered stats, avoiding confusion about which source feeds which view. The implementation:

```typescript
const fundStats = useMemo(() => {
  const total = sumAmounts(filteredFunds.map((f) => f.totalAmount));
  const released = sumAmounts(filteredFunds.map((f) => f.releasedAmount));
  return {
    totalFunds: filteredFunds.length,
    activeFunds: filteredFunds.filter((f) => f.isActive).length,
    totalFundAmount: total.total,
    releasedAmount: released.total,
    invalidAmountFields: total.invalid + released.invalid,
  };
}, [filteredFunds]);
```

The render then uses `fundStats.totalFunds`, `fundStats.activeFunds`, `fundStats.totalFundAmount`, and `fundStats.releasedAmount` for the four KPI cards that are fund-derived, the Fund Overview bar chart (Active/Inactive bars), the Funds Released donut chart, and the Total Fund Amount / Released to Date financial summary cards. The remaining KPI cards (Beneficiaries, Verified Merchants, Active Transfers) and their corresponding bar-chart and donut values continue to use `stats`.

**Changes to JSX:**

1. **Filter `<select>`** — Add to the header `<div>` alongside the Refresh button:

```jsx
<select
  aria-label="Filter by disaster type"
  value={selectedDisasterType}
  onChange={(e) => setSelectedDisasterType(e.target.value)}
  className="border border-gray-300 rounded px-3 py-2 text-sm"
>
  <option value="">All disaster types</option>
  {uniqueDisasterTypes.map((type) => (
    <option key={type} value={type}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </option>
  ))}
</select>
```

2. **Empty-state message** — Replace the fund table's `funds.length > 0` guard with a conditional that checks `filteredFunds`:

```jsx
{filteredFunds.length > 0 ? (
  <div className="bg-white rounded-lg border border-gray-200 p-5">
    {/* existing table markup, mapping over filteredFunds instead of funds */}
  </div>
) : (
  <div className="bg-white rounded-lg border border-gray-200 p-5 text-gray-500">
    No funds match the selected disaster type.
  </div>
)}
```

3. **Loading guard** — The existing `if (loading)` early return already prevents the filter, stats, charts, and table from rendering during load. No change needed.

**No changes to `DashboardProps`, `DashboardQuery`, `ResolvedQuery`, or `DashboardStats` interfaces.**

## Data Models

### State additions

| Variable | Type | Initial Value | Purpose |
|---|---|---|---|
| `selectedDisasterType` | `string` | `''` | Current filter; empty string means unfiltered |

### Derived values (useMemo)

| Variable | Type | Source | Recomputes when |
|---|---|---|---|
| `uniqueDisasterTypes` | `string[]` | `funds` | `funds` changes |
| `filteredFunds` | `EmergencyFund[]` | `funds`, `selectedDisasterType` | `funds` or `selectedDisasterType` changes |
| `fundStats` | `{ totalFunds, activeFunds, totalFundAmount, releasedAmount, invalidAmountFields }` | `filteredFunds` | `filteredFunds` changes |

### No type changes

The `EmergencyFund` interface in `sdk/src/types.ts` already has `disasterType: string`. No new types, interfaces, or SDK modifications are required.

## Error Handling

### Empty-result state (filtered funds is empty)

When `selectedDisasterType !== ''` and `filteredFunds.length === 0`:
- KPI cards for Emergency Funds show `0` (total) and `0` (active) — `fundStats.totalFunds` and `fundStats.activeFunds` are both 0.
- Financial summary cards for Total Fund Amount and Released to Date show `0` — `formatAmount(0n)` renders as `0`.
- Funds Released donut chart shows `0%` — `percentageOf(0n, 0n)` returns `0` (handled by the `whole <= 0n` guard in `amounts.ts`).
- The fund table is replaced by the empty-state message: "No funds match the selected disaster type."

### Loading state

The existing `if (loading)` early return shows "Loading dashboard…" and renders nothing else. The filter `<select>`, KPI cards, charts, and fund table are all absent. No change needed — this is already correct behavior.

### No data-load errors from filtering

The filter is pure client-side computation on the `funds` array already in state. No SDK calls are made when the filter changes, so no network errors can result from filtering or clearing.

## Correctness Properties

### Property 1: Dropdown options match unique disaster types

**Validates: Requirements 1.1, 1.4, 1.5**

**Property:** After loading, the `<select>` with `aria-label="Filter by disaster type"` contains exactly one `<option>` per unique `disasterType` in the loaded funds, plus a leading empty option. The empty option is selected by default.

**How to test:** Render Dashboard with funds of known `disasterType` values (including duplicates). Query the select by aria-label, assert the option count and values match the unique set plus the empty option. Assert the select's default value is `''`.

**Test type:** Example test (deterministic setup, exact assertions).

### Property 2: Filter visibility follows loading state

**Validates: Requirements 1.2, 1.3, 4.4**

**Property:** The filter `<select>` is absent while `loading` is true and present after data has loaded. The "Loading dashboard…" message is shown during loading.

**How to test:** Render with a mock that never resolves `listActiveFunds()` and assert the select is not in the document and "Loading dashboard…" is present. Then resolve the mock and assert the select appears.

**Test type:** Example test.

### Property 3: Filtering recomputes fund-derived views

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

**Property:** When a disaster type is selected, every fund-derived view (KPI cards for Emergency Funds, Fund Overview bar chart Active/Inactive bars, Funds Released donut, Total Fund Amount and Released to Date summary cards, and the fund table) reflects only funds whose `disasterType` matches. Non-fund views (Beneficiaries, Verified Merchants, Active Transfers and their corresponding bars and donuts) remain unchanged.

**How to test:** Render with funds of multiple disaster types with distinct amounts. Select one type via `fireEvent.change`. Assert KPI card values, bar chart aria-label, donut percentage, summary card values, and table rows reflect only matching funds. Assert beneficiary/merchant/transfer values are unchanged.

**Test type:** Example test with representative data.

### Property 4: Clearing restores the unfiltered view without re-fetching

**Validates: Requirements 3.1, 3.2, 3.3**

**Property:** Selecting the empty option restores all funds to every fund-derived view. No SDK client methods are called during the filter or clear operation (the mock call count does not increase).

**How to test:** Render, select a type, record mock client call counts, select the empty option, assert all fund-derived views return to unfiltered values and mock call counts are unchanged.

**Test type:** Example test with mock call assertions.

### Property 5: Empty-result state displays correctly

**Validates: Requirements 4.1, 4.2, 4.3**

**Property:** When a disaster type is selected and no funds match, KPI cards show 0, the Funds Released donut shows 0%, and an empty-state message replaces the fund table.

**How to test:** Render with funds all of one `disasterType`. Select a different `disasterType` that has no matching funds. Assert the empty-state message is present, the fund table is absent, KPI Emergency Funds card shows 0, and the donut shows 0%.

**Test type:** Edge-case example test.

### Property 6: Cross-view total consistency

**Validates: Requirements 5.4**

**Property:** The sum of individual `totalAmount` values across all rows in the Active Funds Table equals the Total Fund Amount shown in the financial summary card, both in the unfiltered view and after a filter is applied.

**How to test:** Render with funds of known amounts across multiple disaster types. Parse the Total Fund Amount from the summary card. Sum the individual fund amounts shown in the table rows. Assert equality. Apply a filter and repeat the assertion on the filtered subset.

**Test type:** Example test. The invariant is a direct consequence of both values being derived from the same `filteredFunds` array via `sumAmounts`, so property-based testing would only re-test the summation.

## Testing Strategy

| Requirement | Test Name | Type |
|---|---|---|
| 1.1, 1.4, 1.5, 1.3 | `disaster filter dropdown renders unique disaster types with empty default` | Example |
| 1.2, 4.4 | `filter is hidden during loading and shown after load` | Example |
| 2.1–2.5 | `selecting a disaster type filters all fund-derived views` | Example |
| 3.1–3.3 | `clearing the filter restores unfiltered view without re-fetch` | Example |
| 4.1–4.3 | `empty-result state shows zero KPIs, 0% donut, and empty message` | Edge case |
| 5.4 | `cross-view total consistency: table sum equals summary card before and after filter` | Example (consistency) |

### Why not property-based testing

The filter logic is a single `Array.filter` call on an in-memory array, and the stat recomputation is `sumAmounts` and `Array.length` on the filtered result. These are deterministic operations on finite data with no randomized inputs that would benefit from property-based testing. The correctness properties are better validated by carefully constructed example tests with known fund amounts and disaster types, which give exact, readable assertions.

### Test file

A new test file `ui/src/__tests__/dashboardDisasterFilter.test.tsx` will be created, following the patterns in `searchFilter.test.tsx`:
- `@jest-environment jest-environment-jsdom`
- `@testing-library/react` with `render`, `screen`, `fireEvent`, `waitFor`, `act`
- Mock clients as plain objects with `jest.fn()` methods
- A `makeFund(id, overrides)` helper to create `EmergencyFund` objects with defaults
- Mock `aidClient.listActiveFunds()` to return test funds
- Mock `beneficiaryClient.listBeneficiariesByDisaster()`, `merchantClient.findMerchantsByLocation()`, and `transferClient.listBeneficiaryTransfers()` to return empty or minimal data (they are not affected by the filter)

## Files to Modify

### `ui/src/components/Dashboard.tsx`
- Add `useMemo` to the React import.
- Add `selectedDisasterType` state variable.
- Add `uniqueDisasterTypes`, `filteredFunds`, and `fundStats` `useMemo` hooks.
- Add the filter `<select>` to the header area with `aria-label="Filter by disaster type"`.
- Replace fund-derived stat references (`stats.totalFunds`, `stats.activeFunds`, `stats.totalFundAmount`, `stats.releasedAmount`) with `fundStats.*` equivalents in the KPI cards, bar chart, donut chart, and financial summary cards.
- Change the fund table to map over `filteredFunds` instead of `funds`.
- Add the empty-state message when `filteredFunds.length === 0`.

### `ui/src/__tests__/dashboardDisasterFilter.test.tsx` (new file)
- Component tests covering all six correctness properties above.

### No other files require changes
- `sdk/src/types.ts` — `EmergencyFund.disasterType` already exists.
- SDK clients, on-chain contracts, and `DashboardQuery` / `DashboardProps` interfaces are unchanged.
- The filter is client-side only; no server roundtrips are added.
