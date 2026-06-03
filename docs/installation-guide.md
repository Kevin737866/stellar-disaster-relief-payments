# Installation Guide

Complete installation guide for the Stellar Disaster Relief Payments Platform.

## Prerequisites

### System Requirements

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Rust | 1.74+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 18+ | https://nodejs.org |
| npm | 9+ | Included with Node.js |
| Stellar CLI (`stellar`) | 21+ | See below |
| Git | 2.38+ | https://git-scm.com |

### Install Stellar CLI

```bash
cargo install --locked stellar-cli --features opt
```

Verify:

```bash
stellar --version
```

### Add Soroban/WASM Target

```bash
rustup target add wasm32-unknown-unknown
```

---

## Repository Setup

```bash
git clone https://github.com/Kevin737866/stellar-disaster-relief-payments.git
cd stellar-disaster-relief-payments
```

---

## Smart Contract Setup (Rust)

### Install Rust Dependencies

```bash
cargo build
```

### Build for Deployment (WASM)

```bash
cargo build --target wasm32-unknown-unknown --release
```

Compiled WASM files land in:

```
target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm
```

### Run Contract Tests

```bash
cargo test
```

Run tests with output:

```bash
cargo test -- --nocapture
```

---

## TypeScript SDK Setup

### Install Node Dependencies

```bash
npm install
```

### Build the SDK

```bash
npm run build
```

The compiled SDK lands in `dist/`.

### Run SDK Tests

```bash
npm test
```

### Lint

```bash
npm run lint
```

---

## Environment Configuration

Create a `.env` file in the project root:

```env
# Network selection: testnet | mainnet
STELLAR_NETWORK=testnet

# RPC endpoints
TESTNET_RPC_URL=https://soroban-testnet.stellar.org
MAINNET_RPC_URL=https://soroban-mainnet.stellar.org

# Horizon endpoints
TESTNET_HORIZON_URL=https://horizon-testnet.stellar.org
MAINNET_HORIZON_URL=https://horizon.stellar.org

# Admin keys (never commit real keys — use secrets manager in production)
ADMIN_SECRET_KEY=S...
NGO_SIGNER_SECRET_KEY=S...
GOV_SIGNER_SECRET_KEY=S...
UN_SIGNER_SECRET_KEY=S...

# Deployed contract IDs (populated after deployment)
CONTRACT_ID_PLATFORM=
CONTRACT_ID_AID_REGISTRY=
CONTRACT_ID_BENEFICIARY_MANAGER=
CONTRACT_ID_MERCHANT_NETWORK=
CONTRACT_ID_CASH_TRANSFER=
CONTRACT_ID_SUPPLY_CHAIN_TRACKER=
CONTRACT_ID_ANTI_FRAUD=
```

---

## Stellar Identity Setup

### Generate Keypairs

```bash
# Admin
stellar keys generate admin --network testnet

# Multi-sig signers
stellar keys generate ngo-signer --network testnet
stellar keys generate gov-signer --network testnet
stellar keys generate un-signer --network testnet
```

### Fund on Testnet (Friendbot)

```bash
stellar keys fund admin --network testnet
stellar keys fund ngo-signer --network testnet
stellar keys fund gov-signer --network testnet
stellar keys fund un-signer --network testnet
```

### View Public Address

```bash
stellar keys address admin
```

---

## UI Setup (React)

```bash
cd ui
npm install
npm start
```

The UI runs at `http://localhost:3000` by default.

---

## SDK Usage (Quick Start)

```typescript
import { AidRegistryClient, TESTNET_CONFIG } from './sdk/src';

const client = new AidRegistryClient(TESTNET_CONFIG);

// Create an emergency fund
await client.createFund({
  fundId: 'fund_001',
  name: 'Haiti Earthquake Relief',
  totalAmount: '1000000',
  disasterType: 'earthquake',
  geographicScope: 'Haiti',
  expiresAt: Math.floor(Date.now() / 1000) + 86400 * 365,
  releaseTriggers: [ngoAddress, govAddress, unAddress],
  requiredSignatures: 2,
});
```

---

## Troubleshooting

### `error[E0463]: can't find crate for 'std'`

Add the wasm32 target:

```bash
rustup target add wasm32-unknown-unknown
```

### `stellar: command not found`

Ensure `~/.cargo/bin` is on your PATH:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Add to `~/.bashrc` or `~/.zshrc` to persist.

### `Insufficient funds` on testnet

Re-run Friendbot funding:

```bash
stellar keys fund <key-name> --network testnet
```

### TypeScript build errors

Ensure Node 18+ is installed, then:

```bash
rm -rf node_modules dist
npm install
npm run build
```

### Contract invocation fails

Confirm the correct network and contract IDs are set in `.env`, and that the deploying account has XLM for fees.

---

## Verifying Installation

```bash
# Rust build passes
cargo build --target wasm32-unknown-unknown --release

# Tests pass
cargo test

# SDK builds
npm run build

# Stellar CLI works
stellar --version
```

All four commands should complete without errors.
