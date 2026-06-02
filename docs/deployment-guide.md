# Deployment Guide

How to deploy the Stellar Disaster Relief Platform to Testnet and Mainnet.

---

## Prerequisites

Complete the [Installation Guide](./installation-guide.md) first.

You will need:
- Stellar CLI installed and on PATH
- Funded keypairs for admin and all multi-sig signers
- The compiled WASM artifact

---

## 1. Build the Contracts

```bash
cargo build --target wasm32-unknown-unknown --release
```

Artifact path:

```
target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm
```

Optimize the WASM (reduces contract size and deployment fee):

```bash
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm
```

---

## 2. Configure Your Identity

### Create Identities

```bash
stellar keys generate admin --network testnet
stellar keys generate ngo-signer --network testnet
stellar keys generate gov-signer --network testnet
stellar keys generate un-signer --network testnet
```

### Fund on Testnet

```bash
stellar keys fund admin --network testnet
stellar keys fund ngo-signer --network testnet
stellar keys fund gov-signer --network testnet
stellar keys fund un-signer --network testnet
```

### View Addresses

```bash
stellar keys address admin
stellar keys address ngo-signer
stellar keys address gov-signer
stellar keys address un-signer
```

Store the output addresses — you will need them for the `initialize` call.

---

## 3. Deploy to Testnet

### Deploy Each Contract

```bash
# Aid Registry
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias aid-registry

# Beneficiary Manager
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias beneficiary-manager

# Merchant Network
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias merchant-network

# Cash Transfer
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias cash-transfer

# Supply Chain Tracker
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias supply-chain-tracker

# Anti Fraud
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias anti-fraud

# Platform (main contract)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet \
  --alias disaster-relief-platform
```

Each command outputs a contract ID. Save all seven IDs.

### Initialize the Platform

```bash
stellar contract invoke \
  --id <PLATFORM_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  initialize \
  --admin $(stellar keys address admin) \
  --ngo_signer $(stellar keys address ngo-signer) \
  --gov_signer $(stellar keys address gov-signer) \
  --un_signer $(stellar keys address un-signer)
```

### Verify Initialization

```bash
stellar contract invoke \
  --id <PLATFORM_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  is_initialized
```

Expected output: `true`

---

## 4. Post-Deployment: SDK Configuration

Update the SDK with your deployed contract IDs. Create `config/testnet.json`:

```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "contractIds": {
    "platform": "<PLATFORM_CONTRACT_ID>",
    "aidRegistry": "<AID_REGISTRY_CONTRACT_ID>",
    "beneficiaryManager": "<BENEFICIARY_MANAGER_CONTRACT_ID>",
    "merchantNetwork": "<MERCHANT_NETWORK_CONTRACT_ID>",
    "cashTransfer": "<CASH_TRANSFER_CONTRACT_ID>",
    "supplyChainTracker": "<SUPPLY_CHAIN_TRACKER_CONTRACT_ID>",
    "antiFraud": "<ANTI_FRAUD_CONTRACT_ID>"
  }
}
```

---

## 5. Smoke Test on Testnet

### Create a Fund

```bash
stellar contract invoke \
  --id <AID_REGISTRY_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  create_fund \
  --admin $(stellar keys address admin) \
  --fund_id "test_fund_001" \
  --name "Test Relief Fund" \
  --description "Smoke test fund" \
  --total_amount 1000000 \
  --disaster_type "earthquake" \
  --geographic_scope "Test Region" \
  --expires_at 9999999999 \
  --release_triggers '["'$(stellar keys address ngo-signer)'","'$(stellar keys address gov-signer)'"]' \
  --required_signatures 2
```

### Verify Fund Creation

```bash
stellar contract invoke \
  --id <AID_REGISTRY_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  get_fund \
  --fund_id "test_fund_001"
```

### Register a Test Beneficiary

```bash
stellar contract invoke \
  --id <BENEFICIARY_MANAGER_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  register_beneficiary \
  --registrar $(stellar keys address admin) \
  --beneficiary_id "ben_001" \
  --name "Test Beneficiary" \
  --disaster_id "disaster_001" \
  --location "Test Camp, Region A" \
  --wallet_address $(stellar keys address admin) \
  --family_size 4 \
  --special_needs '[]' \
  --verification_factors '[{"factor_type":"possession","value":"item_hash_abc","weight":40,"verified_at":0}]'
```

---

## 6. Deploy to Mainnet

> **Warning:** Mainnet transactions cost real XLM and are irreversible. Complete thorough testnet validation before proceeding.

### Pre-Mainnet Checklist

- [ ] All smoke tests pass on testnet
- [ ] Multi-sig signers have mainnet XLM
- [ ] Admin key is secured (hardware wallet or HSM recommended)
- [ ] Contract source has been audited
- [ ] Emergency contact list prepared for each signer org

### Fund Mainnet Identities

Mainnet accounts must be funded by transferring XLM from an exchange or another mainnet account. There is no Friendbot on mainnet.

```bash
stellar keys generate admin --network mainnet
stellar keys generate ngo-signer --network mainnet
stellar keys generate gov-signer --network mainnet
stellar keys generate un-signer --network mainnet
```

Transfer at least **10 XLM** to each account to cover base reserve and deployment fees.

### Deploy to Mainnet

Replace `--network testnet` with `--network mainnet` in all deploy commands:

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network mainnet \
  --alias aid-registry-mainnet
```

Repeat for all contracts.

### Initialize on Mainnet

```bash
stellar contract invoke \
  --id <MAINNET_PLATFORM_CONTRACT_ID> \
  --source admin \
  --network mainnet \
  -- \
  initialize \
  --admin $(stellar keys address admin) \
  --ngo_signer $(stellar keys address ngo-signer) \
  --gov_signer $(stellar keys address gov-signer) \
  --un_signer $(stellar keys address un-signer)
```

### Create Mainnet SDK Config

```json
{
  "network": "mainnet",
  "rpcUrl": "https://soroban-mainnet.stellar.org",
  "horizonUrl": "https://horizon.stellar.org",
  "contractIds": {
    "platform": "<MAINNET_PLATFORM_CONTRACT_ID>",
    "aidRegistry": "<MAINNET_AID_REGISTRY_CONTRACT_ID>",
    "beneficiaryManager": "<MAINNET_BENEFICIARY_MANAGER_CONTRACT_ID>",
    "merchantNetwork": "<MAINNET_MERCHANT_NETWORK_CONTRACT_ID>",
    "cashTransfer": "<MAINNET_CASH_TRANSFER_CONTRACT_ID>",
    "supplyChainTracker": "<MAINNET_SUPPLY_CHAIN_TRACKER_CONTRACT_ID>",
    "antiFraud": "<MAINNET_ANTI_FRAUD_CONTRACT_ID>"
  }
}
```

---

## 7. Contract Upgrades

Soroban contracts are upgradeable by uploading a new WASM and calling the upgrade function.

```bash
# Upload new WASM, get WASM hash
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief_payments.wasm \
  --source admin \
  --network testnet

# Upgrade contract to new WASM hash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  upgrade \
  --new_wasm_hash <WASM_HASH>
```

> Upgrades require admin authorization. Test on testnet before upgrading mainnet contracts.

---

## 8. Monitoring

### Check Contract State

```bash
stellar contract invoke \
  --id <AID_REGISTRY_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  list_active_funds
```

### View Ledger Events (Horizon)

```
https://horizon-testnet.stellar.org/accounts/<ADMIN_ADDRESS>/transactions
```

For mainnet:

```
https://horizon.stellar.org/accounts/<ADMIN_ADDRESS>/transactions
```

### Fund Status

```bash
stellar contract invoke \
  --id <AID_REGISTRY_CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  get_fund_status \
  --fund_id "fund_001"
```

---

## 9. Security Hardening for Mainnet

- **Admin key:** Store in hardware wallet (Ledger) or HSM. Never in plain text.
- **Multi-sig signers:** Each signer org should control their own key independently.
- **Secret keys in CI/CD:** Use GitHub Secrets, Vault, or AWS Secrets Manager. Never commit to repo.
- **RPC access:** Use authenticated RPC endpoints for production — do not rely solely on public nodes.
- **Emergency recall:** Enable `recall_enabled` on critical funds so donors can retrieve unspent funds after 12 months.

---

## 10. Troubleshooting

### `HostError: insufficient balance`

The deploying account does not have enough XLM. Fund the account and retry.

### `HostError: contract already exists`

The contract was already deployed under that WASM hash. Use `stellar contract deploy` without `--alias` to deploy a fresh instance, or use the existing contract ID.

### `Error: invalid signature`

Ensure the correct `--source` key is used and that the account has been funded on the correct network.

### Deploy succeeded but `is_initialized` returns `false`

The `initialize` invocation was not executed or failed. Rerun the `initialize` command.

### Fees too high

The default fee may be insufficient during high-traffic periods. Increase with `--fee`:

```bash
stellar contract invoke ... --fee 1000000
```
