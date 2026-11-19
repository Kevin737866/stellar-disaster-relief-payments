# Accessibility audit: forms and status cues

Scope: `Dashboard`, `BeneficiaryRegistration`, `EmergencyDeployer`, and the
shared `FormField` / `FieldError` components. The goal is to make critical
status information understandable without colour and to make validation errors
programmatically associated with the field that caused them.

## Status cues

Every status now carries explicit text and an icon. Colour is a redundant cue,
never the only cue. Icons are `aria-hidden` so screen readers hear the label
rather than a symbol name.

| Surface | Values | Text | Icon |
| --- | --- | --- | --- |
| Beneficiary list/detail | Active / Inactive | `Status: Active` / `Status: Inactive` | check / cross |
| Beneficiary trust score | High / Medium / Low | `Trust score: 90/100 (High)` | check / bang / bang |
| Emergency fund list/detail | Active / Inactive / Expired / Expiring soon | `Status: <label>` | check / circle / cross / bang |
| Dashboard funds table | Expired / Expiring soon | `Expired` / `Expiring soon` | cross / bang |

Implementation notes:

- `EmergencyDeployer.getFundStatus` derives the label from `isActive` and
  `expiresAt`; expired funds are never labelled "Expiring soon".
- `Dashboard` applies the same expiry rule before rendering the badge and
  normalises second- and millisecond-based timestamps.
- The dashboard bar chart has a descriptive `aria-label` that lists each label
  and value instead of the generic "Bar chart".
- The dashboard table has a screen-reader-only `<caption>` and `scope="col"`
  on every column header.
- Error banners use `role="alert"`; success/status updates use
  `role="status"` with `aria-live="polite"`.

## Forms

`FormField` renders a real `<label htmlFor>` and a `FieldError` with
`role="alert"`. Controls opt in to the association with:

```tsx
<FormField id="fund-name" label="Fund name" required error={error('name')}>
  <input
    id="fund-name"
    name="name"
    value={value}
    onChange={onChange}
    onBlur={validate}
    aria-invalid={error('name') ? true : undefined}
    aria-describedby={error('name') ? 'fund-name-error' : undefined}
    required
  />
</FormField>
```

Covered forms:

- Beneficiary registration (10 fields, including comma-separated factor lists)
- Beneficiary verification (beneficiary ID, verifier key, provided factors)
- USSD response input (label, Enter key, explicit Send button,
  `role="status"` response area, `aria-describedby` help text)
- Emergency fund creation (8 fields)
- Rapid disaster response (4 fields; planned categories exposed as a list)

All forms use `noValidate` so the app's own messages are shown instead of
browser bubbles, and validate on blur plus on submit. Failed submits move focus
only through normal reading order; the first invalid field is announced by its
`role="alert"` message.

## Keyboard and modal behaviour

- All controls are native `input`, `select`, `textarea`, and `button` elements.
- Toggle/action buttons are explicitly `type="button"` so they cannot submit a
  sibling form accidentally.
- The emergency-fund details modal has `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`, moves focus to Close on open, and closes on Escape.
- The USSD input submits on Enter and also has a Send button.

> Other dialogs (for example `ConfirmDialog`) are covered by the separate
> focus-trap work. This audit does not claim a full trap for every overlay.

## WCAG mapping

| Criterion | Where addressed |
| --- | --- |
| 1.3.1 Info and relationships | `label htmlFor`, `aria-describedby`, table `caption`/`scope`, list semantics for categories |
| 1.4.1 Use of colour | Text + icon statuses, trust labels, non-colour error messages |
| 2.1.1 Keyboard | Native controls, Enter/Send, Escape on fund modal |
| 3.3.1 Error identification | Inline `FieldError` text with `role="alert"` |
| 3.3.2 Labels or instructions | Visible labels, required marker, hints for signatures |
| 4.1.3 Status messages | `role="status"`, `aria-live="polite"` for async results |

## Automated coverage

`ui/src/__tests__/formAccessibility.test.tsx` covers:

- required-field error association (`aria-invalid`, `aria-describedby`, error
  `id`/`role`);
- verification-form labels, password input, and error association;
- trust/active status text and icon presence.

Run it with a jsdom-capable Jest invocation; the repository's root Jest config
only collects `sdk/src/**/*.test.ts`, so UI tests must be run with a UI project
or a one-off config (see the repository test notes).

## Remaining audit items

- Audit every remaining `alert()` call and colour-only badge outside the three
  components above.
- Add automated axe checks once a jsdom/devDependency test project exists for
  `ui/src`.
- Verify contrast ratios for the yellow/green/red badge palettes against WCAG
  AA at the actual font sizes used.
- Add a skip link and verify focus order on very small screens.