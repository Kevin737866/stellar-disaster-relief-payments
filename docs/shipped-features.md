# Shipped Feature Ledger & Issue Deployment Tracker

This document tracks all completed, staged, and closed issues across releases to provide visibility into what is deployed on Testnet/Mainnet, staged in current releases, or abandoned/superseded.

## Release & Deployment Status Overview

| Status | Meaning |
|---|---|
| **Deployed (Mainnet / Testnet)** | Verified and running live on the network |
| **Staged** | Merged into main branch, included in staging candidate release |
| **In Progress** | Active development in open PR/branch |
| **Abandoned / Superseded** | Closed without deployment or replaced by a newer architecture |

---

## Issue-to-Release Mapping

| Issue # | Title | Category | Target Release | Deployment State | Shipped Artifacts / Notes |
|---|---|---|---|---|---|
| **#171** | TransferClient U256 amount validation | SDK | v0.1.0 | **Deployed (Testnet)** | `sdk/src/transferClient.ts`, `transferClient.test.ts` |
| **#173** | TransferClient processPaymentRequest selection | SDK | v0.1.0 | **Deployed (Testnet)** | `sdk/src/transferClient.ts` |
| **#176** | Merchant payment method parameter alignment | Contract / SDK | v0.1.0 | **Deployed (Testnet)** | `src/merchant_network.rs`, `sdk/src/merchantClient.ts` |
| **#200** | Expiry date parsing and bounds validation | UI / Form | v0.1.0 | **Deployed (Testnet)** | `ui/src/validation/expiry.ts`, `EmergencyDeployer.tsx` |
| **#201** | Emergency deployer fund QR code visualization | UI | v0.1.0 | **Deployed (Testnet)** | `ui/src/components/EmergencyDeployer.tsx` |
| **#202** | Dashboard sample query bounded scoping | UI / Dashboard | v0.1.0 | **Deployed (Testnet)** | `ui/src/components/Dashboard.tsx` |
| **#203** | Dashboard BigInt sum and safe precision | UI / Dashboard | v0.1.0 | **Deployed (Testnet)** | `ui/src/components/Dashboard.tsx`, `amounts.test.ts` |
| **#210** | Soroban interaction cost estimation module | SDK | v0.1.1 | **Deployed (Testnet)** | `sdk/src/costEstimation.ts`, Jest suite |
| **#220** | Shared contract patterns (deduplication & bounds) | Architecture | v0.2.0 | **Staged** | `docs/contract-patterns.md`, storage architecture |
| **#222** | Structured event logging for financial operations | Auditability | v0.2.0 | **Staged** | `src/aid_registry.rs`, `src/beneficiary_manager.rs`, `src/cash_transfer.rs`, `src/merchant_network.rs` |
| **#223** | Consistent RBAC role enforcement & exception docs | Security / RBAC | v0.2.0 | **Staged** | `src/rbac.rs`, `src/beneficiary_manager.rs`, `src/merchant_network.rs`, `src/cash_transfer.rs` |
| **#230** | CI/CD shipped-feature ledger and release notes | Process / CI | v0.2.0 | **Staged** | `docs/shipped-features.md`, `CHANGELOG.md` |
| **#231** | Toolchain validation for README deployment steps | Documentation | v0.2.0 | **Staged** | `README.md`, Stellar/Soroban CLI v22+ docs |
| **#238** | Off-chain fetch security policy & TOML verification | Security / SDK | v0.1.1 | **Deployed (Testnet)** | `sdk/src/offchainFetch.ts`, `offchainFetch.test.ts` |
| **#239** | Emergency incident pause control mechanism | Safety / Emergency | v0.1.1 | **Deployed (Testnet)** | `src/aid_registry.rs`, `src/cash_transfer.rs` |
| **#241** | Two-phase multi-sig authorization enforcement | Security | v0.1.1 | **Deployed (Testnet)** | `src/aid_registry.rs` (`require_auth` enforcement) |

---

## Release History

### Release v0.2.0 (Staged / Current Pre-release)
- **#223**: Consistent RBAC role enforcement across all contract modules with documented self-service exceptions.
- **#222**: Structured Soroban event logging (`env.events().publish`) across all key financial operations and state changes.
- **#231**: Deployment guide validated and updated for Stellar/Soroban CLI v22.0.0+ and modern `--` parameter syntax.
- **#230**: Shipped-feature ledger and release-issue mapping tracking deployments.

### Release v0.1.1
- **#239**: Emergency incident pause mechanism in `aid_registry` and `cash_transfer`.
- **#241**: Multi-sig authorization `require_auth` enforcement on all approvers.
- **#238**: SSRF-safe off-chain fetch policy for merchant discovery and Stellar TOML parsing.
- **#210**: Cost estimation SDK module for calculating stroop/XLM fees before submitting transactions.

### Release v0.1.0 (Initial Testnet Deployment)
- Core Soroban smart contracts (`aid_registry`, `beneficiary_manager`, `merchant_network`, `cash_transfer`, `supply_chain_tracker`).
- TypeScript SDK clients and React UI dashboard.
