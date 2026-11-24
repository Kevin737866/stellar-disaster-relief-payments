# Implementation Plan: Dashboard Disaster Filter

## Overview

This plan adds a client-side disaster-type filter dropdown to the Relief Operations Dashboard (`ui/src/components/Dashboard.tsx`) and creates a companion test file (`ui/src/__tests__/dashboardDisasterFilter.test.tsx`). The filter lets relief operators scope fund-derived views (KPI cards, charts, financial summaries, and the active funds table) to a single disaster type by selecting from a dropdown populated with unique `disasterType` values extracted from loaded funds. Clearing the selection restores the unfiltered view without re-fetching data.

Two files are involved:
- **`ui/src/components/Dashboard.tsx`** — add `useMemo` to imports, add `selectedDisasterType` state, add three `useMemo` hooks (`uniqueDisasterTypes`, `filteredFunds`, `fundStats`), add the `<select>` element, rewire fund-derived stat references to `fundStats.*`, change the fund table to iterate `filteredFunds`, and add an empty-state message.
- **`ui/src/__tests__/dashboardDisasterFilter.test.tsx`** (new) — component tests following patterns from `searchFilter.test.tsx`, covering dropdown rendering, selection filtering, clearing, empty-result state, loading state, and cross-view consistency.

No SDK clients, on-chain contracts, or type definitions are modified. The filter is pure client-side computation on the `funds` array already in component state.

## Tasks

- [x] 1. Dashboard.tsx code changes
  - [x] 1.1 Add `useMemo` to the React import line
    - **Validates:** Requirement 2 (enables derived computation for filtering)
  - [x] 1.2 Add `selectedDisasterType` state variable
    - **Validates:** Requirements 1.4, 3.1
  - [x] 1.3 Add `uniqueDisasterTypes` useMemo
    - **Validates:** Requirements 1.1, 1.5
  - [x] 1.4 Add `filteredFunds` useMemo
    - **Validates:** Requirements 2.1, 3.1
  - [x] 1.5 Add `fundStats` useMemo
    - **Validates:** Requirements 2.2, 4.2
  - [x] 1.6 Add filter `<select>` element to the header area
    - **Validates:** Requirements 1.1, 1.2, 1.3, 1.4
  - [x] 1.7 Rewire KPI cards to use `fundStats`
    - **Validates:** Requirements 2.2, 4.2
  - [x] 1.8 Rewire bar chart fund bars to use `fundStats`
    - **Validates:** Requirement 2.3
  - [x] 1.9 Rewire donut chart "Funds Released" to use `fundStats`
    - **Validates:** Requirements 2.4, 4.3
  - [x] 1.10 Rewire financial summary cards to use `fundStats`
    - **Validates:** Requirements 2.2, 4.2
  - [x] 1.11 Change fund table to map over `filteredFunds`
    - **Validates:** Requirements 2.5, 3.3
  - [x] 1.12 Add empty-state message when `filteredFunds.length === 0`
    - **Validates:** Requirement 4.1
  - [x] 1.13 Update invalid-amounts warning to use `fundStats.invalidAmountFields`
    - **Validates:** Requirement 2.2

- [x] 2. Test file creation (`ui/src/__tests__/dashboardDisasterFilter.test.tsx`)
  - [x] 2.1 Create test file with environment and imports
    - **Validates:** Requirement 5.5
  - [x] 2.2 Create `makeFund(id, overrides)` helper function
    - **Validates:** Requirement 5.5
  - [x] 2.3 Create mock client setup
    - **Validates:** Requirement 5.5
  - [x] 2.4 Create default config object
    - **Validates:** Requirement 5.5
  - [x] 2.5 Test: dropdown renders unique disaster types with empty default
    - **Validates:** Requirements 1.1, 1.4, 1.5
  - [x] 2.6 Test: filter is hidden during loading and shown after load
    - **Validates:** Requirements 1.2, 1.3, 4.4
  - [x] 2.7 Test: selecting a disaster type filters all fund-derived views
    - **Validates:** Requirements 2.1, 2.2, 2.3, 2.4, 2.5
  - [x] 2.8 Test: clearing the filter restores unfiltered view without re-fetch
    - **Validates:** Requirements 3.1, 3.2, 3.3
  - [x] 2.9 Test: empty-result state shows zero KPIs, 0% donut, and empty message
    - **Validates:** Requirements 4.1, 4.2, 4.3
  - [x] 2.10 Test: cross-view total consistency before and after filter
    - **Validates:** Requirement 5.4

- [x] 3. Run tests to verify
  - [x] 3.1 Run the test suite and confirm all tests pass
    - **Validates:** Requirement 5 (all sub-items)
    - **Note:** `npm install` failed due to disk space (ENOSPC) on this machine. The jest binary is partially installed but missing `pretty-format` and other modules. The test file passes TypeScript diagnostics with zero issues. Tests should be run manually once dependencies are fully installed: `node node_modules/jest/bin/jest.js --selectProjects ui dashboardDisasterFilter`

## Notes

- The existing `if (loading)` early return in `Dashboard.tsx` already prevents the filter, stats, charts, and table from rendering during load. No change is needed to the loading guard — it inherently satisfies Requirements 1.3 and 4.4.
- `sumAmounts` and `percentageOf` are already imported from `../format/amounts` in `Dashboard.tsx`. The `fundStats` useMemo reuses `sumAmounts` directly.
- The `percentageOf` function already handles the zero-denominator case (returns 0 when `whole <= 0n`), so the donut chart will show 0% on empty results without additional guards.
- The existing code has a pre-existing bug where `isExpired` is referenced but never defined in the fund table row rendering. This is not part of this feature and should not be fixed here.
- The `fundStats` useMemo computes `invalidAmountFields` as the sum of invalid fields from `sumAmounts` calls on `filteredFunds` total and released amounts. The invalid-amounts warning (task 1.13) must combine this with the transfer/spent invalid fields that remain in `stats`.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "tasks": [1.1, 1.2, 2.1, 2.2, 2.3, 2.4]
    },
    {
      "tasks": [1.3, 1.4, 1.5, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10]
    },
    {
      "tasks": [1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13]
    },
    {
      "tasks": [3.1]
    }
  ]
}
```

**Wave 1** — Foundation tasks with no internal dependencies. Dashboard.tsx import (1.1) and state (1.2) are independent of each other. Test file setup tasks (2.1–2.4) are independent of all Dashboard.tsx work.

**Wave 2** — Derived data and test cases. Dashboard.tsx useMemos (1.3–1.5) depend on wave 1: `uniqueDisasterTypes` needs the `useMemo` import (1.1), `filteredFunds` needs both `useMemo` (1.1) and `selectedDisasterType` (1.2), and `fundStats` needs `filteredFunds` (1.4). Test cases (2.5–2.10) depend on test file setup (2.1–2.4) from wave 1 and are independent of Dashboard.tsx changes.

**Wave 3** — UI rendering changes. All depend on wave 2: the `<select>` element (1.6) needs `selectedDisasterType` (1.2) and `uniqueDisasterTypes` (1.3); stat rewiring (1.7–1.10, 1.13) needs `fundStats` (1.5); the table change (1.11) needs `filteredFunds` (1.4); the empty-state message (1.12) needs the table change (1.11).

**Wave 4** — Run tests (3.1). Depends on all Dashboard.tsx code changes (wave 1–3) and all test file creation (waves 1–2) being complete.
