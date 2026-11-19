# Requirements Document

## Introduction

This spec covers four fixes for the beneficiary registration flow of the Stellar Disaster Relief Payments platform — a system that facilitates emergency fund disbursements to displaced persons via blockchain-based transfers. All four items target the same surface, `ui/src/components/BeneficiaryRegistration.tsx`, and correspond to GitHub issues #205–#208:

1. **#205** — secret keys are held in browser component state (`registrarKey` prop, `verifierKey` form field) and passed into browser client calls.
2. **#206** — the verification handler hardcodes `factorType: 'possession'` for every provided factor.
3. **#207** — the USSD demo is a stub with a hardcoded phone number and no indication that it is a demo.
4. **#208** — recovery codes are displayed once with no export/print option.

The work is implemented as changes to the existing React + TypeScript + Tailwind CSS component and small, additive helper surfaces in the SDK (`sdk/src/beneficiaryClient.ts`). No changes to the on-chain contracts are in scope.

## Glossary

- **Registration_Flow**: The UI flow that creates a beneficiary profile (`handleRegistration`, `BeneficiaryRegistration.tsx:69–118`).
- **Verification_Flow**: The UI flow that verifies a beneficiary against provided identity factors (`handleVerification`, `BeneficiaryRegistration.tsx:120–159`).
- **BeneficiaryClient**: The existing SDK client (`sdk/src/beneficiaryClient.ts`) used to register and verify beneficiaries.
- **Signing_Backend**: A delegate supplied to the component that owns key material and performs transaction signing on behalf of the UI. Suggested shape: `{ getPublicKey(): Promise<string>; signTransaction(xdr: string): Promise<string> }` — an adapter over a server-side signing service, an HSM/KMS, the Freighter wallet, or the existing air-gapped `OfflineSigner` flow (`sdk/src/offlineSigner.ts`).
- **Secret_Key**: A Stellar secret seed (`S...` string) capable of authorizing transactions. Must never be held in UI state, props, DOM, logs, or alerts.
- **Verifier_Credential**: The non-secret handle by which the current verifier is identified (`{ publicKey: string; label: string }`), obtained from the Signing_Backend, replacing the raw `verifierKey` form field.
- **FactorType**: The category of an identity factor: `possession`, `behavioral`, or `social` (`VerificationFactor.factorType`, `sdk/src/types.ts:16–21`).
- **Factor_Input**: The user-entered value list for one FactorType (e.g. `phone_number, id_card`).
- **USSD_Demo**: The feature-phone simulation in the registration UI (`BeneficiaryRegistration.tsx:44–50`, `:180–212`, `:439–466`).
- **Demo_Mode**: Explicit, visible state indicating the USSD path is a local simulation not connected to any USSD gateway.
- **Recovery_Codes**: The one-time codes generated after registration (`generateRecoveryCodes`, `sdk/src/beneficiaryClient.ts:304–318`) used to restore wallet access.
- **Recovery_Code_Panel**: The UI block that displays recovery codes (`BeneficiaryRegistration.tsx:469–483`), extended by this spec with export/print/acknowledgement.
- **Export_Action**: A client-side copy/download/print operation over the displayed Recovery_Codes.

---

## Requirements

### Requirement 1: Delegated signing — no raw secret keys in UI state (#205)

**User Story:** As a relief coordinator operating a shared field device, I want registration and verification transactions to be signed by a dedicated signing backend, so that raw secret keys are never held in the browser UI.

#### Acceptance Criteria

1. THE `BeneficiaryRegistration` component SHALL NOT declare, accept, or store a Secret_Key. The `registrarKey` prop SHALL be removed from `BeneficiaryRegistrationProps` (`BeneficiaryRegistration.tsx:4–8`).
2. THE component SHALL receive a Signing_Backend (or an equivalent signer handle exposing no secret material) via props, and SHALL use it for both the Registration_Flow and the Verification_Flow.
3. WHEN the Registration_Flow is submitted, THE component SHALL obtain an unsigned transaction, request its signature from the Signing_Backend, and submit the signed envelope — it SHALL NOT pass a Secret_Key to `BeneficiaryClient.registerBeneficiary`.
4. THE Verification_Flow SHALL NOT contain a secret-key input field. `verificationForm.verifierKey` (`BeneficiaryRegistration.tsx:40`, `:397–404`) SHALL be replaced by a Verifier_Credential derived from the Signing_Backend.
5. THE component SHALL NOT store Secret_Keys in component state, refs, the DOM, `console.*` output, or `alert()`/`prompt()` calls.
6. IF the Signing_Backend is unavailable, rejects, or returns an error, THEN THE component SHALL disable signing-required actions and SHALL display a user-safe error message that does not echo key material.
7. WHEN the component renders in an environment with no Signing_Backend configured, THE registration and verification buttons SHALL be disabled with an explanatory notice instead of silently failing at submit time.

### Requirement 2: Factor-type preservation in verification (#206)

**User Story:** As a field verifier, I want the identity factors I submit to keep their intended type (possession, behavioral, social), so that verification evaluates the factors I actually provided.

#### Acceptance Criteria

1. THE Verification_Flow SHALL provide separate inputs (or an equivalent unambiguous typed syntax) for possession, behavioral, and social factors, matching the Registration_Flow's three Input parameters (`BeneficiaryRegistration.tsx:327–361`).
2. WHEN the Verification_Flow builds `providedFactors`, THE `factorType` of each factor SHALL match the category of the input it came from; the hardcoded `factorType: 'possession'` (`BeneficiaryRegistration.tsx:128`) SHALL be removed.
3. THE Verification_Flow SHALL use `BeneficiaryClient.createVerificationFactors(possessionFactors, behavioralFactors, socialFactors)` (or an equivalent mapping helper) so factor weights follow the SDK's per-type weights (possession 30, behavioral 40, social 30; `sdk/src/beneficiaryClient.ts:323–360`).
4. WHEN a typed free-text syntax is offered, THE parser SHALL accept `type:value` tokens (e.g. `behavioral:signature_pattern, social:community_vouch`) and SHALL surface a validation error for unknown types instead of silently defaulting to `possession`.
5. WHEN only one factor category is provided, THE submission SHALL still preserve that category's type end to end.
6. THE verification submission SHALL forward the exact factor list the UI assembled — no re-mapping between form state and client call.

### Requirement 3: Honest USSD demo labeling and documented integration gaps (#207)

**User Story:** As a relief coordinator, I want the USSD feature clearly marked as a simulation, so that field staff are not misled about a live gateway capability.

#### Acceptance Criteria

1. THE USSD_Demo entry point (`BeneficiaryRegistration.tsx:245–250`) SHALL be visibly labeled as a demo/simulation (e.g. "USSD Demo (Simulation)") with a badge or equivalent persistent indicator.
2. THE hardcoded phone number `'+1234567890'` (`BeneficiaryRegistration.tsx:246`) SHALL be removed from the invocation. The demo SHALL either accept a user-entered phone number in a clearly labeled demo field or display the placeholder phone persistently alongside the demo label.
3. WHEN a USSD session panel is open, THE panel SHALL display a persistent disclaimer stating that no USSD gateway is connected and that responses are simulated locally (`BeneficiaryRegistration.tsx:439–466`).
4. THE demo SHALL NOT imply delivery of SMS/USSD traffic: simulated responses SHALL be rendered in the panel and SHALL NOT claim completion of a real registration ("USSD registration completed!" — `BeneficiaryRegistration.tsx:204` — SHALL be reworded to a demo-completion message).
5. THE repository documentation SHALL record the integration requirements for a real USSD provider, covering at least: gateway/webhook endpoint and session callback contract, provider credentials and callback authentication, session-to-beneficiary mapping, menu flow parity with `processUSSDInput` (`sdk/src/beneficiaryClient.ts:421+`), rate limiting and abuse controls, and the cost/consent implications for beneficiaries.
6. WHEN production USSD integration is absent, THE demo affordances SHALL remain clearly separated from the production registration path.

### Requirement 4: Recovery code export and print (#208)

**User Story:** As a newly registered beneficiary, I want to copy, download, or print my recovery codes before dismissing them, so that I can restore access if I lose my device.

#### Acceptance Criteria

1. THE Recovery_Code_Panel SHALL offer, at minimum: copy-to-clipboard, download as a text file, and print.
2. WHEN export is requested, THE Export_Action SHALL include every displayed Recovery_Code exactly once and SHALL clearly associate the export with the beneficiary ID.
3. THE Recovery_Code_Panel SHALL display strong warnings, including: store offline; do not share; each code is single-use; loss means loss of access.
4. THE panel SHALL require an explicit acknowledgement (e.g. "I have saved my recovery codes") before it can be dismissed or cleared.
5. ALL Export_Actions SHALL run client-side: Recovery_Codes SHALL NOT be transmitted to any server, analytics, logging, or clipboard service beyond the local clipboard API.
6. WHEN the clipboard or print APIs are unavailable, THE panel SHALL fall back to a selectable text block and still display the codes until acknowledged.
7. THE printed output SHALL contain the warnings of criterion 3 alongside the codes, and SHALL NOT include unrelated UI chrome.

---

## Out of scope

- Implementing a production USSD gateway or the production signing service itself. This spec defines the UI contract, the Signing_Backend interface, and the integration documentation requirements only.
- Changes to on-chain contracts or the transaction payloads they accept.
- Biometric factors (the platform is explicitly biometric-free).

## Testing requirements

- **#205:** security review confirming no Secret_Key appears in props, state, DOM, or logs; a UI test asserting the component renders and operates with a Signing_Backend and without any key input.
- **#206:** UI test submitting mixed possession/behavioral/social factors and asserting the outgoing `verifyBeneficiary` payload preserves each `factorType` and weight.
- **#207:** UI review test asserting the demo badge, disclaimer, and demo-completion wording are present whenever the USSD panel is open.
- **#208:** UI test covering the export flow (codes present exactly once, acknowledgement gating, panel retention before acknowledgement) and a print-layout check.
