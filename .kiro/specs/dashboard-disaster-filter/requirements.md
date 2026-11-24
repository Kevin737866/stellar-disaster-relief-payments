# Requirements Document

## Introduction

This feature adds a disaster filter to the Relief Operations Dashboard (`ui/src/components/Dashboard.tsx`) in the Stellar Disaster Relief Payments platform — a system that facilitates emergency fund disbursements to displaced persons via blockchain-based transfers.

Relief operators currently see funds from every disaster response program mixed together. Because `EmergencyFund` records carry a `disasterType` field (e.g. "earthquake", "flood", "hurricane") but no `disasterId`, the existing `query.disasterId` prop only scopes beneficiary data — funds, fund-derived KPIs, charts, and the fund table remain unfiltered. Operators need to focus on one disaster operation at a time to review its financials without unrelated programs polluting the view.

The enhancement introduces a `<select>` dropdown that lists unique `disasterType` values extracted from the loaded funds. Selecting a disaster type filters the funds array before all fund-derived stats, charts, financial summaries, and the fund table are computed. Beneficiary, merchant, and transfer data continue to use the existing `query.disasterId` / `query.beneficiaryId` props, which are already scoped. Clearing the selection restores the full unfiltered view.

The work is implemented entirely in `ui/src/components/Dashboard.tsx` and its associated UI tests. No changes to SDK clients, on-chain contracts, or the `EmergencyFund` type are in scope.

## Glossary

- **Dashboard**: The React component (`ui/src/components/Dashboard.tsx`) that renders the Relief Operations Dashboard — KPI cards, charts, financial summaries, and the active funds table.
- **Disaster_Filter**: The new `<select>` dropdown element on the Dashboard that lists unique `disasterType` values extracted from loaded funds and filters fund-derived data when a selection is made.
- **disasterType**: The `EmergencyFund` field (`sdk/src/types.ts`) categorising a fund's disaster response (e.g. "earthquake", "flood", "hurricane"). It is a free-text string, not an enum, and funds sharing the same `disasterType` belong to the same category of response program.
- **EmergencyFund**: The existing SDK type representing an emergency relief fund. Does not contain a `disasterId`; the closest disaster-related field is `disasterType`.
- **DashboardQuery**: The existing optional prop passed to the Dashboard that supplies `disasterId`, `beneficiaryId`, `merchantCenter`, and `merchantRadiusKm` for scoping beneficiary, merchant, and transfer queries.
- **Fund-Derived Stats**: All Dashboard metrics computed from the funds array, including: `totalFunds`, `activeFunds`, `totalFundAmount`, `releasedAmount`, the Fund Overview bar chart data, the Funds Released donut chart, and the Total Fund Amount / Released to Date financial summary cards.
- **Active Funds Table**: The table on the Dashboard that lists each `EmergencyFund` with its name, disaster type, geographic scope, total amount, released amount, and utilization percentage.
- **Unfiltered View**: The Dashboard state in which no disaster type is selected and all loaded funds contribute to every stat, chart, summary, and table row.
- **Filtered View**: The Dashboard state in which a disaster type is selected and only funds whose `disasterType` matches the selection contribute to fund-derived stats, charts, summaries, and table rows.
- **Empty-Result State**: The condition in which the filtered funds array contains zero matching funds after a disaster type is selected.
- **Loading State**: The condition in which the Dashboard is fetching data from SDK clients and has not yet rendered stats or the fund table.

---

## Requirements

### Requirement 1: Disaster filter dropdown UI

**User Story:** As a relief operator, I want a dropdown on the dashboard that lists the disaster types of all loaded funds, so that I can select a single disaster type to scope my view.

#### Acceptance Criteria

1. THE Dashboard SHALL render a `<select>` element (Disaster_Filter) populated with one `<option>` per unique `disasterType` value extracted from the loaded funds array, plus a leading empty option representing the unfiltered view.
2. THE Disaster_Filter SHALL be visible whenever the Dashboard has finished loading and funds are present, positioned within the Dashboard header area alongside the existing Refresh button.
3. WHEN the Dashboard is in the loading state, THE Disaster_Filter SHALL NOT be rendered, because no fund data is available to populate options.
4. THE Disaster_Filter SHALL display the empty option as the default selected value on initial load, indicating the unfiltered view.
5. THE Disaster_Filter SHALL deduplicate `disasterType` values so that each disaster type appears at most once in the dropdown regardless of how many funds share that type.

---

### Requirement 2: Filtering funds and recalculating fund-derived stats

**User Story:** As a relief operator, I want selecting a disaster type to update every fund-derived summary, chart, and table on the dashboard, so that I see a consistent scoped view of that single response program.

#### Acceptance Criteria

1. WHEN a disaster type is selected from the Disaster_Filter, THE Dashboard SHALL filter the loaded funds array to only those funds whose `disasterType` matches the selected value before computing all fund-derived stats.
2. WHEN the filter is applied, THE Dashboard SHALL recompute and display updated values for: total funds count, active funds count, total fund amount, and released amount in the KPI cards and financial summary cards.
3. WHEN the filter is applied, THE Fund Overview bar chart SHALL reflect only the filtered funds' active and inactive counts, and the other bars (transfers, merchants, beneficiaries) SHALL remain unchanged because they are sourced from separate queries.
4. WHEN the filter is applied, THE Funds Released donut chart SHALL reflect the percentage of released amount to total fund amount computed from only the filtered funds, and SHALL display 0% when the filtered total fund amount is zero.
5. WHEN the filter is applied, THE Active Funds Table SHALL display only rows whose `disasterType` matches the selected value, and all per-fund totals, released amounts, and utilization percentages SHALL be computed from the filtered set.

---

### Requirement 3: Clearing the filter to restore the unfiltered view

**User Story:** As a relief operator, I want to clear the disaster filter and return to the full unfiltered view, so that I can review all response programs together again.

#### Acceptance Criteria

1. WHEN the empty option is selected from the Disaster_Filter, THE Dashboard SHALL restore the unfiltered view by using the complete loaded funds array for all fund-derived stats, charts, summaries, and the fund table.
2. WHEN the filter is cleared, THE Dashboard SHALL NOT re-fetch data from the SDK clients; it SHALL recompute all fund-derived metrics from the already-loaded funds stored in component state.
3. WHEN the filter is cleared after having been applied, THE Active Funds Table SHALL display all funds again, matching the set shown on initial load.

---

### Requirement 4: Empty-result and loading states when filtered

**User Story:** As a relief operator, I want the dashboard to remain understandable when a filtered view has no matching funds or when data is still loading, so that I am not confused by missing or blank sections.

#### Acceptance Criteria

1. WHEN a disaster type is selected and the filtered funds array is empty, THE Dashboard SHALL display an empty-state message in place of the Active Funds Table indicating that no funds match the selected disaster type.
2. WHEN a disaster type is selected and the filtered funds array is empty, THE fund-derived KPI cards SHALL display zero values (total funds: 0, active funds: 0, total fund amount: 0, released amount: 0) rather than blank or stale values.
3. WHEN a disaster type is selected and the filtered funds array is empty, THE Funds Released donut chart SHALL display 0% rather than `NaN` or a stale percentage from the unfiltered set.
4. WHEN the Dashboard is in the loading state, THE Dashboard SHALL display the existing "Loading dashboard…" message and SHALL NOT render the Disaster_Filter, stats, charts, or fund table until data has loaded.

---

### Requirement 5: Component test coverage

**User Story:** As a developer maintaining the Dashboard, I want component tests covering disaster filter selection, clearing, and consistent totals across views, so that regressions in the filter logic are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a test that renders the Dashboard with funds of multiple `disasterType` values, selects a disaster type from the Disaster_Filter, and asserts that KPI card values, chart data, financial summary cards, and the Active Funds Table reflect only matching funds.
2. THE test suite SHALL include a test that selects a disaster type, then clears the selection by choosing the empty option, and asserts that all fund-derived stats, charts, summaries, and table rows return to their unfiltered values.
3. THE test suite SHALL include a test that selects a disaster type with no matching funds and asserts the empty-result state: zero-value KPI cards, 0% Funds Released donut, and the empty-state message in place of the fund table.
4. THE test suite SHALL include a test that verifies totals remain consistent across views — that the sum of individual fund amounts in the Active Funds Table equals the Total Fund Amount shown in the financial summary card, both before and after a filter is applied.
5. THE tests SHALL follow the existing project patterns: `@testing-library/react` with `render`, `screen`, `fireEvent`, `waitFor`, and `act`; mock clients as plain objects with `jest.fn()` methods; and the `makeFund()` helper to create `EmergencyFund` objects with defaults.

---

## Out of scope

- Adding a `disasterId` field to the `EmergencyFund` type or SDK contracts.
- Filtering beneficiary, merchant, or transfer data by disaster type — these continue to use the existing `query.disasterId` / `query.beneficiaryId` props.
- Server-side or SDK-level fund filtering by disaster type (the filter is a client-side operation on already-loaded data).
- Persisting the selected disaster type across page reloads or browser sessions.
- Multi-select filtering (the Disaster_Filter supports a single disaster type at a time).

## Testing requirements

- Component tests using `@testing-library/react` covering: selecting a disaster type and verifying all fund-derived views update consistently; clearing the filter and verifying the unfiltered view is restored; the empty-result state when no funds match; and cross-view total consistency (table sum equals summary card) before and after filtering.
- Tests shall use the existing `makeFund()` test helper pattern and mock SDK clients with `jest.fn()` methods, matching the conventions in `ui/src/__tests__/searchFilter.test.tsx`.
