# Design Document: Beneficiary Registration Hardening

## Overview

This design resolves four issues (#205–#208) in the beneficiary registration flow of the Stellar Disaster Relief Payments platform. All four affect `ui/src/components/BeneficiaryRegistration.tsx`; three also touch the SDK surface in `sdk/src/beneficiaryClient.ts`.

| Issue | Theme | Primary change |
| --- | --- | --- |
| #205 | Security | Remove secret keys from UI state and props; delegate signing to an injected Signing_Backend |
| #206 | Logic | Preserve factor types (possession / behavioral / social) in the verification submission |
| #207 | UX | Label the USSD simulation honestly; document real USSD integration requirements |
| #208 | UX | Add secure export/print for recovery codes with acknowledgement gating |

### Current-state audit (against `master`)

- `BeneficiaryRegistrationProps` takes a raw `registrarKey: string` (`BeneficiaryRegistration.tsx:4–8`) and forwards it to `beneficiaryClient.registerBeneficiary(registrarKey, …)` (`:81–91`), which signs with `Keypair.fromSecret` in the browser (`sdk/src/beneficiaryClient.ts:58`).
- The verification form keeps `verifierKey` in component state (`:40`, `:398–404`), passed to `verifyBeneficiary` (`:134–138`), which also signs from a raw secret in the browser (`sdk/src/beneficiaryClient.ts:104`).
- `handleVerification` hardcodes `factorType: 'possession'` for every factor (`:128`).
- The USSD demo calls `handleUSSDSession('+1234567890')` — a literal fake number (`:246`) — and completes with `alert('USSD registration completed!')` (`:204`).
- Recovery codes render once (`:469–483`) with a text hint only; no copy, download, or print affordance.

## Architecture

Current data flow (secrets in the browser):

```
BeneficiaryRegistration
  ├── props.registrarKey ──────────► registerBeneficiary(key, …) ─► Keypair.fromSecret (browser)
  ├── state.verificationForm.verifierKey ─► verifyBeneficiary(key, …) ─► Keypair.fromSecret (browser)
  ├── handleUSSDSession('+1234567890') ─► local simulation (no gateway)
  └── recoveryCodes state ─► display once (no export)
```

Target data flow (no key material crosses the UI boundary):

```
BeneficiaryRegistration
  ├── props.signingBackend ─► build *Tx (SDK) ─► signingBackend.signTransaction(xdr)
  │                                               └─► submitSignedTransaction(xdr) (SDK)
  ├── props.ussdDemo (config) ─► UssdDemoPanel — labeled simulation + disclaimer
  └── recoveryCodes state ─► RecoveryCodePanel — copy / download / print + acknowledgement
                                └── codes retained until acknowledged
```

### Key Design Decisions

1. **Signing is injected, not performed.** The component receives a `SigningBackend` delegate. The backend can be a browser wallet adapter (Freighter), an HTTP client for a server-side signing service (HSM/KMS), or the existing air-gapped `OfflineSigner` (`sdk/src/offlineSigner.ts`). The component only ever handles: unsigned transaction, signed envelope, public key.
2. **SDK grows a build/submit split; legacy secret-key methods remain for Node consumers.** `sdk/src/beneficiaryClient.ts` gains `buildRegisterBeneficiaryTx` / `buildVerifyBeneficiaryTx` / `submitSignedTransaction`. The existing `registerBeneficiary(registrarKey, …)` and `verifyBeneficiary(verifierKey, …)` methods stay for the server-side examples (`examples/*.ts` use them) and are documented as Node-only; the browser component no longer calls them.
3. **One factor-input pattern for both forms.** The registration form already separates possession/behavioral/social inputs (`:327–361`). The verification form gets the same three inputs, mapped through `createVerificationFactors` (weights: possession 30, behavioral 40, social 30 — `sdk/src/beneficiaryClient.ts:323–360`). A typed-syntax parser (`type:value` tokens) is the supported alternative where a single field is preferred.
4. **The USSD panel is a simulator, so it says so.** Labeling, disclaimer, and a configurable demo phone number replace the implied-phone stub. Real integration requirements are documented instead of implied by the UI.
5. **Recovery codes are handled like one-time secrets.** All export actions are client-side; nothing is persisted or transmitted; the panel cannot be dismissed before acknowledgement.

## Components and Interfaces

### SigningBackend (new, `sdk/src/types.ts` or `sdk/src/signing.ts`)

```ts
export interface SigningBackend {
  /** Address that will authorize the transaction; safe to display. */
  getPublicKey(): Promise<string>;
  /** Sign an unsigned transaction envelope (base64 XDR) and return the signed envelope XDR. */
  signTransaction(xdr: string): Promise<string>;
}

export interface VerifierCredential {
  publicKey: string;
  label: string; // e.g. "Field officer – Zone 4"
}
```

Reference adapters (one required for production wiring; the spec supports all three):

- `FreighterSigningBackend` — wraps `window.freighter` / `@stellar/freighter-api`.
- `HttpSigningBackend` — `POST /sign` to a backend that owns the key (authentication/session behaviour is a security-review item).
- `OfflineSignerBackend` — wraps `OfflineSigner` (`sdk/src/offlineSigner.ts`) for air-gapped devices.

### BeneficiaryClient additions (additive, SDK)

```ts
/** Build (do not sign) a registration transaction. */
async buildRegisterBeneficiaryTx(
  registrarPublicKey: string,
  beneficiaryId: string, name: string, disasterId: string,
  location: string, walletAddress: string, familySize: number,
  specialNeeds: string[], verificationFactors: VerificationFactor[]
): Promise<Transaction>;

/** Build (do not sign) a verification transaction. */
async buildVerifyBeneficiaryTx(
  verifierPublicKey: string,
  beneficiaryId: string,
  providedFactors: VerificationFactor[]
): Promise<Transaction>;

/** Submit a signed envelope and resolve to the transaction hash. */
async submitSignedTransaction(signedXdr: string): Promise<string>;
```

### BeneficiaryRegistration props (target)

```ts
interface BeneficiaryRegistrationProps {
  beneficiaryClient: BeneficiaryClient;
  config: StellarNetworkConfig | NetworkConfig;
  signingBackend?: SigningBackend;      // replaces registrarKey
  ussdDemo?: UssdDemoConfig;            // demo phone handling and labeling
}
```

When `signingBackend` is absent, the register/verify buttons are disabled and an explanatory notice renders (Requirement 1.7).

### RecoveryCodePanel (new sub-component in the same file, or `ui/src/components/RecoveryCodePanel.tsx`)

Behavioural contract:

- Props: `codes: string[]`, `beneficiaryId: string`, `onAcknowledged(): void`.
- Renders codes, warnings, and three actions: Copy, Download `.txt`, Print.
- Copy: `navigator.clipboard.writeText` with a selectable-text fallback when unavailable.
- Download: `Blob` + `URL.createObjectURL`; filename `recovery-codes-<beneficiaryId>.txt`; revoked after click.
- Print: dedicated print block styled with `@media print` (codes + warnings only; no app chrome).
- Acknowledgement checkbox gates `onAcknowledged()`; the parent keeps `recoveryCodes` state until acknowledged.

### UssdDemoPanel (renamed from the inline USSD block)

- Persistent badge: `Demo — simulation, no gateway connected`.
- Demo phone: read from `ussdDemo.phoneNumber` (a placeholder such as `+1 555 000 0000` or user-entered), never the bare literal `'+1234567890'` presented as real.
- Completion message: "Demo session complete — no registration was submitted."
- Static disclaimer: "Responses are generated locally for demonstration. A production deployment requires a USSD gateway integration (see docs/ussd-integration.md)."

### Factor parsing helper

```ts
export function parseFactorInput(
  raw: string, defaultType: FactorType
): { factors: Array<{ factorType: FactorType; value: string }>; errors: string[] };
```

- Accepts comma-separated tokens; `type:value` sets the type explicitly; bare tokens take `defaultType` (the input field's category); unknown types produce an error entry and are not silently defaulted (Requirement 2.4).

## Data Models

```ts
type FactorType = 'possession' | 'behavioral' | 'social';

interface FactorInputs {
  possession: string;
  behavioral: string;
  social: string;
}

interface UssdDemoConfig {
  phoneNumber?: string;      // placeholder/demo value; default "+1 555 000 0000"
  enabled?: boolean;         // default true in non-production builds
}

interface RecoveryCodeExportOptions {
  beneficiaryId: string;
  codes: string[];
  includeWarnings: true;     // invariant, not configurable off
}
```

## Correctness Properties

*(Properties are stated for property-based tests of the pure helpers and for invariant tests of the component.)*

1. **Factor type round-trip.** For any set of `FactorInputs`, `parseFactorInput` followed by the weight mapping yields factors whose `factorType` set equals the categories provided, and `createVerificationFactors` assigns the SDK weights (possession 30, behavioral 40, social 30).
2. **Unknown type rejection.** For any token `x:value` where `x ∉ {possession, behavioral, social}`, the parser reports an error and produces no factor for that token.
3. **No secret retention.** The rendered component tree, component state, and captured `console` calls contain no substring matching a Stellar secret seed pattern (`/S[A-Z2-7]{55}/`) in any flow.
4. **Export completeness.** For any non-empty recovery code list, the exported text contains each code exactly once and includes the beneficiary ID.
5. **Export warnings invariant.** Every Export_Action output (clipboard text, downloaded file, print view) contains the warning text.
6. **Acknowledgement gating.** The panel cannot call `onAcknowledged()` (and the parent retains `recoveryCodes`) unless the acknowledgement control is set.
7. **Demo labeling invariant.** Whenever a USSD session panel is rendered, the demo badge and disclaimer are present in the same tree.
8. **Demo completion honesty.** The demo completion path emits no success-alert text claiming a real registration.
9. **Signing failure safety.** For any signing backend rejection, no `submitSignedTransaction` call occurs and the error surfaced contains no key material.

## Testing Plan

Test harness: React Testing Library in jsdom, following the existing pattern (`ui/src/__tests__/beneficiaryPagination.test.tsx` — `@jest-environment jest-environment-jsdom`, `@testing-library/react`, mock `BeneficiaryClient` object).

| Area | Test file (suggested) | Key cases |
| --- | --- | --- |
| #205 | `ui/src/__tests__/beneficiarySigning.test.tsx` | renders with `signingBackend`; no key input present; register/verify flows call `build*` → `sign` → `submit`; disabled state without backend; rejection path (property 9) |
| #206 | `ui/src/__tests__/verificationFactors.test.tsx` | mixed-category submission preserves types and weights; unknown-type error surfaced; single-category preservation |
| #207 | `ui/src/__tests__/ussdDemo.test.tsx` | badge + disclaimer present; no `'+1234567890'` literal; completion wording; configurable phone |
| #208 | `ui/src/__tests__/recoveryCodes.test.tsx` | copy/download/print actions (mock APIs); export completeness (property 4); acknowledgement gating (property 6); warning presence (property 5) |
| — | existing tests | update `beneficiaryPagination.test.tsx` and `searchFilter.test.tsx` which currently pass `registrarKey="key"` to pass a mock `signingBackend` instead |

Security review checklist for #205 (manual, recorded in the PR):

- `grep -rn "registrarKey\|verifierKey" ui/src` returns no secret-typed props/state.
- No `Keypair.fromSecret` is reachable from any `ui/` code path (SDK call sites in `ui/` use only the build/submit methods).
- Component error paths do not echo transaction envelopes or key material.

## Risks and Tradeoffs

- **Breaking prop change.** Removing `registrarKey` breaks the two existing UI test suites and any external embedder. Mitigation: update tests in the same change; document the new prop in the SDK docs.
- **Signer UX.** A hardware/remote signer introduces a user prompt per transaction. This is the point of the change and should be reflected in copy ("Waiting for signature…").
- **Print fidelity.** Browsers differ in `@media print` support; the print block must be tested in Chromium and Firefox at minimum, with the download path as the universal fallback.
- **Clipboard permissions.** Clipboard writes can be rejected in insecure contexts; the selectable-text fallback (Requirement 4.6) is mandatory, not optional.

## Suggested Implementation Order

1. Add `SigningBackend`/`VerifierCredential` types and the SDK build/submit methods (additive; no behaviour change).
2. Rework registration/verification handlers to the build → sign → submit flow; remove `registrarKey` and `verifierKey`.
3. Split verification factor inputs and wire `createVerificationFactors`.
4. USSD labeling, disclaimer, configurable demo phone.
5. `RecoveryCodePanel` with export/print/acknowledgement.
6. Update existing tests; add the new test files; write `docs/ussd-integration.md`.
