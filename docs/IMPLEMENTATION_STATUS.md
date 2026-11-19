# Implemented vs. Stubbed Features

This document is the single source of truth for **what is shipped, what is
partial, and what is still a stub or placeholder** across the Soroban
contracts, TypeScript SDK, and React UI.

It exists so contributors and integrators do not mistake a demo helper or a
placeholder response for production behaviour. Update this matrix in the same
pull request that changes a feature's status.

## Legend

| Status | Meaning |
| --- | --- |
| **Implemented** | Production code path exists and is the default for clients. Automated coverage is called out where it exists; integration coverage may still be required. |
| **Partial** | Happy path exists, but a documented gap remains (for example a simplified heuristic, a missing external integration, or a demo-only default). |
| **Stub / Placeholder** | Deliberately returns a placeholder value or performs no real work. Must not be presented to operators as a live feature. |
| **Planned** | Described in an issue/design note; no implementation yet. |

## Soroban contracts (`src/`)

| Area | Feature | Status | Notes / source |
| --- | --- | --- | --- |
| `aid_registry` | Fund creation, activation, expiry cleanup | Implemented | `create_fund`, `cleanup_expired_funds`; covered in `src/test.rs`. |
| `aid_registry` | Multi-sig disbursement and manual release | Implemented | `submit_disbursement`, `execute_multi_sig_release`; approver list is validated. |
| `aid_registry` | Batch disbursement | Partial | `submit_batch_disbursement` is atomic, but a maximum batch size is not yet enforced (tracked by the batch-limits work). |
| `aid_registry` | Purpose handling | Implemented | Free text is retained for audit; `categorize_purpose` maps it to canonical reporting categories. See `docs/purpose-taxonomy.md`. |
| `aid_registry` | Oracle/trigger evaluation helpers | Partial | Trigger storage and validation helpers exist; external oracle ingestion is an integration responsibility. |
| `aid_registry` | Disbursement history | Implemented | `get_disbursements` uses bounded `offset`/`limit`. |
| `beneficiary_manager` | Registration, verification, recovery codes | Implemented | Core flows are present; covered in `src/test.rs`. |
| `beneficiary_manager` | Beneficiary listing | Implemented | Cursor-based `list_beneficiaries_paginated` is the preferred path. The legacy `list_beneficiaries_by_disaster` is an unbounded scan. |
| `merchant_network` | Onboarding, vouching, trial review | Implemented | Includes pending/trial/active lifecycle. |
| `merchant_network` | Online and offline payments, sync, settlement | Implemented | Offline records are marked synced in `sync_offline_transactions`. Production guarantees and limits are tracked by the offline documentation work. |
| `merchant_network` | Merchant discovery | Implemented | Paginated location/category listing added; legacy unbounded helpers remain for compatibility. See `docs/pagination.md`. |
| `merchant_network` | Fraud detection | Partial | `fraud_detection` uses simple threshold/similarity heuristics, not a trained model. |
| `cash_transfer` | Conditional transfers and spending rules | Implemented | Core rules are present; policy coverage is documented in code comments. |
| `supply_chain_tracker` | Shipment tracking and geolocation updates | Implemented | Core flow is present. |
| `anti_fraud` | Pattern checks and similarity scoring | Partial | Similarity checks are intentionally simple; see `src/anti_fraud.rs`. |

## TypeScript SDK (`sdk/src/`)

| Area | Feature | Status | Notes / source |
| --- | --- | --- | --- |
| Clients | `AidClient`, `BeneficiaryClient`, `MerchantClient`, `TransferClient`, `TrackerClient` | Implemented | Contract calls, validation, and error types are present. |
| Pagination | Beneficiary listing | Implemented | `listBeneficiariesPaginated` (cursor, default 20, max 100). |
| Pagination | Merchant listing | Implemented | `findMerchantsPaginated`, `findMerchantsByLocationPaginated`, `findMerchantsByCategoryPaginated` (offset, default 20, max 100). |
| Purpose taxonomy | Classification and validation | Implemented | `categorizePurpose`, `classifyPurpose`, `validatePurpose` in `purposeTaxonomy.ts`. |
| Offline | Offline signing and envelopes | Implemented | `offlineSigner.ts`; production guarantees are tracked by the offline documentation work. |
| Offline | Recovery codes and USSD helpers | Partial | Helpers exist, but production rate limiting and SMS gateway integration are deployment concerns. |
| `emergencyFunds` | Placeholder aggregate structures | Stub / Placeholder | Three methods return placeholder structures with a `// For now` comment (lines ~519, ~568, ~740). |
| `fundExpiryNotifications` | Pending notifications | Stub / Placeholder | Returns an empty array with a placeholder comment (line ~129). |
| `merchantApp` | Local storage and offline signature | Partial | Simplified implementations; suitable for demos, not a hardened wallet. |
| `networkConfig` | Contract IDs | Partial | Defaults use `CONTRACT_ID_HERE` placeholders until a deployment populates them. |

## React UI (`ui/src/`)

| Area | Feature | Status | Notes / source |
| --- | --- | --- | --- |
| `Dashboard` | Fund/beneficiary/merchant/transfer overview | Partial | Uses a bounded first page (max 100) for aggregates and sample beneficiary/disaster IDs. A production deployment should supply real IDs and server-side aggregates. |
| `BeneficiaryRegistration` | Registration, verification, detail view | Partial | Core flow is present; the USSD panel is a demo and some identifiers are hard-coded to `sample_disaster_001`. Beneficiary listing is paginated with a **Load More** control. |
| `BeneficiaryRegistration` | Modal accessibility | Implemented | Detail dialog traps focus, supports Escape, and restores focus (`useFocusTrap`). |
| `EmergencyDeployer` | Fund creation and rapid response | Partial | Core forms are present; multi-sig uses a single admin key in the demo path (comment at line ~76). |
| `ConfirmDialog` | Confirmation modal | Implemented | Focus trap, Escape-to-cancel, `aria-modal`, labelled/described dialog. |
| `NotificationSystem`, `ErrorMessage`, `LoadingPrimitives` | Shared UI primitives | Implemented | Reusable components; `ErrorMessage` exposes `friendlyError`. |
| Forms | Accessible labels and error associations | Planned | Tracked by the form-accessibility work; `FieldError` and `useFormValidation` exist and are wired in the relevant forms. |
| Status display | Non-colour status cues | Planned | Tracked by the status-accessibility work; status badges should include text/icon cues, not colour alone. |
| Demos | `alert()` / `prompt()` usage | Placeholder | 29 browser dialogs are used for demo feedback. Replace with `NotificationSystem` / inline errors before production. |

## Tests and documentation

| Area | Status | Notes |
| --- | --- | --- |
| Contract unit tests | Implemented | `src/test.rs` (module-scoped tests). |
| SDK unit tests | Implemented | `sdk/src/*.test.ts` (run with `npm test`). |
| UI tests | Partial | `ui/src/__tests__/*.test.tsx`; the root Jest config only discovers `tests/`, so UI tests need an explicit runner configuration. |
| Deployment and SDK docs | Implemented | `docs/deployment-guide.md`, `docs/SDK.md`, `docs/api-reference.md`. |
| Pagination guidance | Implemented | `docs/pagination.md`. |
| Purpose taxonomy | Implemented | `docs/purpose-taxonomy.md`. |
| Offline guarantees | Planned | Tracked by the offline QR/USSD documentation work. |

## Keeping this matrix current

1. When a PR changes a feature's status, update the relevant row **in the same
   PR**. A status change without a matrix update should be treated as an
   incomplete change.
2. Prefer evidence over adjectives: link the function, test, or doc that proves
   the status.
3. If a feature is demo-only, mark it **Partial** or **Stub / Placeholder** and
   state the missing production step explicitly.
4. Review this file at every release and before onboarding a new implementing
   partner.
