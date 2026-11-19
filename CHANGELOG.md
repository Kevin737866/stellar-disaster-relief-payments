# Changelog

All notable changes to this project are documented in this file.
For the complete deployment status and issue ledger, see [`docs/shipped-features.md`](docs/shipped-features.md).

## [v0.2.0] - Staged (Next Release)

### Added
- **RBAC Enforcement (#223)**:
  - Role-based authorization across `beneficiary_manager` (`ROLE_NGO` on registration/identity, `ROLE_ADMIN` on deactivation).
  - Role-based authorization across `cash_transfer` (`ROLE_NGO` on transfer creation, `ROLE_OPERATOR` on expired transfer cleanup).
  - Role-based authorization across `merchant_network` (`ROLE_ADMIN` on trial review, `ROLE_OPERATOR` on balance settlement and volume reset).
  - Documented role matrix and policy exceptions in `src/rbac.rs`.
- **Financial Operation Event Logging (#222)**:
  - Structured Soroban events emitted on `create_fund`, `submit_disbursement`, `submit_batch_disbursement`, and `archive_fund` in `aid_registry`.
  - Structured events on beneficiary registration, deactivation, and identity creation in `beneficiary_manager`.
  - Structured events on transfer creation, spending, and fund recalls in `cash_transfer`.
  - Structured events on merchant registration, payment processing, settlement, and trial review in `merchant_network`.
- **Toolchain Updates (#231)**:
  - Validated and updated README deployment instructions for Stellar/Soroban CLI v22.0.0+ with modern `--` parameter syntax and network flags.
- **Shipped-Feature Ledger (#230)**:
  - Added [`docs/shipped-features.md`](docs/shipped-features.md) mapping issues to releases and deployment states.

## [v0.1.1] - Deployed (Testnet)

### Added
- `sdk/src/costEstimation.ts`: Cost estimation module for Soroban contract interactions (#210)
  - `estimateContractCost()` — fee breakdown for a single interaction
  - `estimateMultipleContractCosts()` — batch estimation
  - `estimateTotalCost()` — aggregate cost with breakdown
  - `CostEstimationClient` — class wrapper matching SDK client pattern
  - Supports all 10 contract interaction types
  - Multi-sig awareness, custom fee overrides, stroop/XLM conversion
- `sdk/src/__tests__/costEstimation.test.ts`: 35 unit tests
- Incident pause controls for emergency response (#239)
- Multi-sig authorization enforcement with `require_auth` (#241)
- Off-chain fetch security policy and URL validation (#238)
- `jest.config.js`: Jest + ts-jest project configuration

## [v0.1.0] - Initial Testnet Deployment

### Added
- Core Soroban smart contracts (`aid_registry`, `beneficiary_manager`, `merchant_network`, `cash_transfer`, `supply_chain_tracker`).
- TypeScript SDK and React UI dashboard.
