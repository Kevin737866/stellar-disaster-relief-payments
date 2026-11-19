# UI Privacy, Registration Configuration, Recovery & Accessibility — Resolutions for Issues #204, #209, #210, #212

Documentation-only resolution of the four open UI issues assigned to this work. Every
finding below was verified against `master` at commit `b28cd5e` (current head at the
time of writing). No code files are touched by this change: each section records the
verified current behaviour with exact file/line references, the agreed fix, the
acceptance criteria mapping, and the UI tests that make the follow-up implementation
PRs mechanical.

| Issue | Component | Category | Priority |
| ----- | --------- | -------- | -------- |
| [#212](https://github.com/Kevin737866/stellar-disaster-relief-payments/issues/212) | `ui/src/components/MerchantMap.tsx` | Privacy | P2 |
| [#210](https://github.com/Kevin737866/stellar-disaster-relief-payments/issues/210) | `ui/src/components/BeneficiaryRegistration.tsx` | UX | P3 |
| [#209](https://github.com/Kevin737866/stellar-disaster-relief-payments/issues/209) | `ui/src/components/BeneficiaryRegistration.tsx` | UX | P2 |
| [#204](https://github.com/Kevin737866/stellar-disaster-relief-payments/issues/204) | `ui/src/components/Dashboard.tsx` | Accessibility | P2 |

Existing conventions the designs below follow:

- Functional components with hooks, SDK client instances injected as props
  (`ui/src/components/`).
- Form validation via `ui/src/validation/` (`validators.ts` already exports a
  `stellarAddress` validator; `useFormValidation` + `FieldError` provide inline errors).
- UI tests are React Testing Library + `jest-environment-jsdom`, declared with a
  `@jest-environment jest-environment-jsdom` docblock, as in
  `ui/src/__tests__/beneficiaryPagination.test.tsx` and `searchFilter.test.tsx`.

---

## #204 — `BarChart` and `DonutChart` lack accessible text alternatives and keyboard behaviour

### Verified state

`ui/src/components/Dashboard.tsx` renders two hand-rolled SVG charts:

- **`BarChart`** (`Dashboard.tsx:44-91`): the `<svg>` has `role="img"` and a generic
  `aria-label="Bar chart"` (`:54-58`) that conveys none of the data. Per-bar and axis
  `<text>` labels exist (`:66`, `:80-85`) but are not structured into a machine-readable
  alternative. There is no `<title>`/`<desc>`, no `aria-describedby`, no data table
  alternative, and nothing is keyboard-focusable (no `tabIndex`).
- **`DonutChart`** (`Dashboard.tsx:102-132`): `aria-label={`${label}: ${value}%`}`
  (`:111`) announces a bare percentage with no context ("Funds Released: 12%" — 12% of
  what?). No `<title>`/`<desc>`, no focusability.
- Axis label colour `#9ca3af` on white (`:66`) is ≈2.8:1 contrast — below the WCAG AA
  4.5:1 requirement for small text. `#6b7280` (≈4.8:1) is already used for the x-axis
  (`:80`) and would pass.

Screen-reader users currently get a chart labelled "Bar chart" with no numbers, and a
donut whose percentage has no denominator. The acceptance criterion ("adequate
accessible descriptions and keyboard behavior") is not met.

### Proposed fix

1. **Descriptive summaries per chart.** Build a summary sentence from the same data the
   chart renders, e.g. for the fund overview bars:

   > "Fund overview bar chart. Active: 4. Inactive: 1. Transfers: 2. Merchants: 5.
   > Beneficiaries: 12. Largest value: Beneficiaries at 12."

   ```tsx
   const summarizeBars = (data: BarChartProps['data']) => {
     const entries = data.map((d) => `${d.label}: ${d.value}`).join('. ');
     const top = data.reduce((a, b) => (b.value > a.value ? b : a));
     return `Bar chart. ${entries}. Largest value: ${top.label} at ${top.value}.`;
   };
   ```

2. **`<title>` + `<desc>` wired to the SVG.** Give each chart a `title`/`description`
   prop and render them as the first children of the `<svg>`, using `useId()` for stable
   ids (React 18.3.1 is in `package.json`, so `useId` is available):

   ```tsx
   const titleId = useId();
   const descId = useId();
   <svg role="img" aria-labelledby={titleId} aria-describedby={descId} tabIndex={0}
        className="w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
     <title id={titleId}>Fund overview</title>
     <desc id={descId}>{summarizeBars(data)}</desc>
     {/* …existing gridlines, bars, labels… */}
   </svg>
   ```

3. **Keyboard/AT-reachable data table.** Render a visually-hidden `<table>` next to (or
   replacing) the visual chart content for AT users — one row per data point with
   `<caption>` and `<th scope="col">` — so every value is reachable without interpreting
   the graphic:

   ```tsx
   <table className="sr-only">
     <caption>{title}</caption>
     <thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead>
     <tbody>
       {data.map((d) => (
         <tr key={d.label}><th scope="row">{d.label}</th><td>{d.value}</td></tr>
       ))}
     </tbody>
   </table>
   ```

   `sr-only` utilities can be added in the component file if not already present in the
   Tailwind setup.

4. **`DonutChart` context.** Extend the props with `description` (e.g. "7 of 9
   merchants verified") and render `<title>`/`<desc>` the same way, passing the
   numerator/denominator from the dashboard call sites (`Dashboard.tsx:295-314` already
   has both numbers via `pct(...)` inputs).

5. **Contrast.** Bump axis-text fill from `#9ca3af` to `#6b7280` (already used
   elsewhere in the same chart).

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Charts have adequate accessible descriptions" | `<title>`/`<desc>` + summary sentence + sr-only data table (points 1–4) |
| "…and keyboard behavior" | `tabIndex={0}` with visible focus ring on the chart figure (point 2) |
| "Accessibility audit and test for chart a11y" | Test plan below |

### Test plan

New `ui/src/__tests__/dashboardChartAccessibility.test.tsx` (RTL + jsdom docblock,
mocking the four SDK clients with fixed data as in `beneficiaryPagination.test.tsx`):

- `getByRole('img', { name: /fund overview/i })` succeeds for the bar chart; its
  accessible description matches the summary built from the mock data.
- Each expected `label: value` pair appears in the chart's sr-only table.
- Both charts expose `tabIndex={0}` and receive focus via `userEvent.tab()`.
- Donut accessible name includes label, percentage **and** the context counts.
- Snapshot of the `<desc>` text so data changes cannot silently drop the summary.

---

## #209 — Recovery flow uses `prompt()` for wallet address and recovery code

### Verified state

`ui/src/components/BeneficiaryRegistration.tsx` collects both recovery secrets through
browser `prompt()` dialogs:

- `:163` — `const newWalletAddress = prompt('Enter new wallet address:');` inside
  `handleRestoreAccess` (`:161-178`).
- `:584` — `const code = prompt('Enter recovery code:');` in the "Restore Access" button
  of the details modal (`:580-593`).

Problems confirmed by reading the flow:

- Values are typed into an unstyled, unmaskable browser prompt — plaintext on screen, no
  password-style masking, and visible to anyone over the user's shoulder.
- No client-side validation: a malformed wallet address or empty code is submitted to
  `beneficiaryClient.restoreAccess` (`:166`), which only then fails (the SDK internally
  rejects a bad address at `sdk/src/beneficiaryClient.ts:144`, but the user sees only a
  generic `alert('Failed to restore access. Check recovery code.')` at `:172`).
- There is no warning that a recovery code grants full account access, no confirmation
  step, and error UX is limited to `alert()`.

### Proposed fix — dedicated `RestoreAccessDialog` component

Add `ui/src/components/RestoreAccessDialog.tsx` and use it from the details modal
button (`:582-592`) instead of the nested `prompt()` calls:

```tsx
interface RestoreAccessDialogProps {
  beneficiary: BeneficiaryProfile;
  open: boolean;
  onClose: () => void;
  onRestored: () => void; // parent refreshes the list, replaces alert()
}
```

Requirements:

1. **Masked secret input.** Recovery code field is `type="password"` with a show/hide
   toggle, `autoComplete="off"`, `spellCheck={false}`, and is never rendered into logs
   or the DOM after submission (state is cleared on close/unmount).
2. **Validated wallet address.** Reuse `stellarAddress` from
   `ui/src/validation/validators.ts` via `useFormValidation` + `FieldError`; submit is
   disabled until both fields pass validation, so bad input never reaches the SDK.
3. **Warnings and confirmation.** Persistent warning copy ("A recovery code restores
   full access to this beneficiary's wallet and can only be used once"), then a
   confirmation step summarising the new wallet address before calling
   `beneficiaryClient.restoreAccess` (`beneficiaryClient.ts:138`).
4. **Inline status handling.** Loading state on submit; failures render inline (wrong
   code vs. network error) rather than `alert()`; success calls `onRestored()` which
   triggers `loadBeneficiaries()`.
5. **No `prompt()` anywhere.** Both `:163` and `:584` call sites are removed; the
   component-level props (`beneficiaryId`, `recoveryCode`) are no longer collected via
   browser modals.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Recovery uses a dedicated secure UI instead of plaintext prompts" | `RestoreAccessDialog` (points 1–5); zero `prompt(` call sites remain |

### Test plan

New `ui/src/__tests__/restoreAccessDialog.test.tsx`:

- `window.prompt` spy is **never called** when exercising the restore flow (regression
  guard for this issue).
- Recovery code input is masked (`type="password"`), toggle switches type.
- Invalid wallet address → inline `FieldError`, `restoreAccess` not called.
- `restoreAccess` resolving `false` → inline failure message, dialog stays open.
- Success → `onRestored` fired, dialog closes, no `alert` spy call.
- Closing/reopening clears both fields.

---

## #210 — Registration UI depends on hardcoded `'sample_disaster_001'`

### Verified state

- `loadBeneficiaries` (`BeneficiaryRegistration.tsx:56-67`) is called once on mount
  (`:52-54`) and hardcodes the sample id:
  `beneficiaryClient.listBeneficiariesByDisaster('sample_disaster_001')` (`:60`).
  In a real deployment the list renders "No beneficiaries found" with no way to fix it
  from the UI.
- The registration form separately asks for a free-text `Disaster ID`
  (`:278-285`) that is unrelated to the loaded context, so a user can register against a
  different disaster than the one being displayed.
- The same sample-data coupling exists in `Dashboard.tsx:173` (`'sample_disaster_001'`)
  and `:175` (`'sample_beneficiary_001'`) — flagged here as a sibling for a follow-up
  PR, not fixed by this issue's scope.

### Proposed fix

1. **Configurable context via props** (`BeneficiaryRegistrationProps`, `:4-8`):

   ```tsx
   interface BeneficiaryRegistrationProps {
     beneficiaryClient: BeneficiaryClient;
     config: StellarNetworkConfig | NetworkConfig;
     registrarKey: string;
     /** Disaster whose beneficiaries are listed/registered. */
     disasterId?: string;
     /** Selector options; when omitted the experience is read-only for the id above. */
     disasterOptions?: { id: string; label: string }[];
   }
   ```

   Resolution order for the effective id: explicit `disasterId` prop → an optional
   `defaultDisasterId?: string` added to `NetworkConfig` (`sdk/src/types.ts:265`) →
   `undefined`.

2. **Disaster selector.** When `disasterOptions` is provided, render a labelled
   `<select>` above the list; changing it updates local `selectedDisasterId` state and
   re-runs `loadBeneficiaries` with that id. `useEffect` depends on the selected id
   (replacing the mount-only effect). When no options and no id are supplied, show an
   explicit empty-state prompt ("Select a disaster to load beneficiaries") instead of
   silently querying sample data — the current failure mode.

3. **Registration form context.** The form's `disasterId` field is initialised from the
   active selection and kept in sync while the form is closed, so displayed list and
   new registrations share the same disaster context (the field stays editable for the
   rare cross-disaster registration case).

4. **Document the sample-data dependency.** Add a short "Sample data" note to the
   component docstring and README: `sample_disaster_001` / `sample_beneficiary_001`
   exist only for demos/tests; production deployments must pass
   `disasterId`/`defaultDisasterId`.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Registration UI works with configurable disaster context" | Props + selector + sync (points 1–3); no hardcoded query remains |

### Test plan

New `ui/src/__tests__/beneficiaryRegistrationDisasterContext.test.tsx`:

- Rendered with `disasterId="flood-2026-01"` → `listBeneficiariesByDisaster` called
  with exactly that id (assert `'sample_disaster_001'` never appears).
- Changing the selector re-invokes the loader with the new id and renders the new page.
- Rendered without any ids → context prompt visible and **no** loader call with the
  sample id.
- Registering a beneficiary submits the currently selected `disasterId`.

---

## #212 — `MerchantMap` exposes merchant data without consent or minimisation

### Verified state

`ui/src/components/MerchantMap.tsx` renders a merchant **list** (no map widget or map
library exists in the project — `package.json` has no mapping dependency), and:

- Loads nearby merchants with a fixed NYC default centre and radius
  (`:20`, `:47-66`).
- The card list displays `merchant.location.address`, city/country and
  `merchant.contactInfo` to every viewer (`:492-494`), and the details modal additionally
  exposes the merchant owner address (`:551`) and **exact coordinates**
  (`:563` — `{latitude}, {longitude}`).
- The `Merchant`/`Location` types (`sdk/src/types.ts:31-58`) have no consent or
  precision fields, so "show everything" is the only possible behaviour.
- Beneficiary location data: verified **not** to flow into this component —
  `BeneficiaryProfile.location` (`types.ts:5`) is a free-form string and no beneficiary
  client is referenced here. The privacy gap is merchant data only; a regression test
  should pin that invariant.

### Proposed fix

1. **Consent/precision on the data model** (additive, optional fields on `Merchant`):

   ```ts
   locationConsent?: 'granted' | 'denied' | 'unknown'; // default 'unknown'
   locationPrecision?: 'precise' | 'approximate' | 'city'; // default 'city'
   contactVisible?: boolean; // default false
   ```

2. **Display resolver** (`resolveMerchantDisplay(merchant, viewer)` helper):

   | Condition | Shown |
   | --------- | ----- |
   | consent `granted` AND `precise` AND viewer is admin (`adminKey` flow) | exact coordinates, marker eligible |
   | consent `granted`, precision `approximate` | coordinates snapped to a ~0.05° grid (≈5 km), no street address |
   | consent `denied`/`unknown` or default precision `city` | city/country only; coordinates omitted entirely |
   | `contactVisible` false | contact info masked (`j•••@•••`), full value only after an explicit **Reveal** action |

3. **Need-to-know gating.** Precise coordinates and contact info default to hidden;
   revealing requires an explicit action and calls an `onRevealSensitive(merchantId,
   field)` callback prop so deployments can audit reveals. City-level rendering needs no
   consent (already public in the fund's geographic scope).

4. **No beneficiary data.** Add a documented component invariant — this component only
   receives `merchantClient`; never join with beneficiary locations and never pass
   beneficiary identifiers into map/card rendering.

### Acceptance criteria mapping

| Criterion | Where satisfied |
| --------- | --------------- |
| "Map display minimizes sensitive location exposure" | City/approximate defaults, masked contact, precise gated (points 2–3) |
| "…and respects consent" | `locationConsent` drives the resolver; denied/unknown never yields precise data |
| "Privacy review and test for map data minimization" | Test plan below |

### Test plan

New `ui/src/__tests__/merchantMapPrivacy.test.tsx`:

- Default render (consent `unknown`) → city/country only; `getByText('40.7128')`-style
  coordinate assertions fail; contact info not present in clear text.
- Consent `granted` + `precise` + admin reveal action → coordinates appear only after
  clicking Reveal, and `onRevealSensitive` is called.
- Consent `denied` → coordinates never rendered, even after a reveal attempt.
- Regression: the component is rendered without any beneficiary client prop and no
  beneficiary-related SDK method is invoked.

---

## Scope and sequencing

This change is documentation-only, per the agreed approach. The implementation follows
mechanically in four small PRs, one per issue, each containing the tests listed above:

1. `fix(ui): accessible chart summaries and keyboard focus (#204)`
2. `feat(ui): secure restore-access dialog (#209)`
3. `feat(ui): configurable disaster context for registration (#210)`
4. `feat(ui): consent-aware merchant location minimisation (#212)`

Sibling follow-ups flagged while verifying (out of scope here): the hardcoded sample
ids in `Dashboard.tsx:173-175`, the plaintext `alert()` usage across these three
components, and the free-text `Disaster ID` input on the registration form.
