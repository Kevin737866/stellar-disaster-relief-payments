# Changelog

## [Unreleased]

### Added
- `sdk/src/costEstimation.ts`: Cost estimation module for Soroban contract interactions
  - `estimateContractCost()` — fee breakdown for a single interaction
  - `estimateMultipleContractCosts()` — batch estimation
  - `estimateTotalCost()` — aggregate cost with breakdown
  - `CostEstimationClient` — class wrapper matching SDK client pattern
  - Supports all 10 contract interaction types
  - Multi-sig awareness, custom fee overrides, stroop/XLM conversion
- `sdk/src/__tests__/costEstimation.test.ts`: 35 unit tests (all passing)
- `jest.config.js`: Jest + ts-jest project configuration
