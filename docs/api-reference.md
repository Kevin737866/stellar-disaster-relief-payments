# API Reference

Complete reference for all smart contract functions and TypeScript SDK methods.

---

## Smart Contracts

### AidRegistry

Manages emergency fund pools with multi-signature authorization and oracle-triggered automatic releases.

---

#### `create_fund`

Creates a new emergency fund pool.

```rust
pub fn create_fund(
    env: Env,
    admin: Address,
    fund_id: String,
    name: String,
    description: String,
    total_amount: U256,
    disaster_type: String,
    geographic_scope: String,
    expires_at: u64,
    release_triggers: Vec<Address>,
    required_signatures: u32,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Authorized admin address (must sign) |
| `fund_id` | `String` | Unique fund identifier |
| `name` | `String` | Human-readable fund name |
| `description` | `String` | Fund purpose description |
| `total_amount` | `U256` | Total fund amount in stroops |
| `disaster_type` | `String` | One of: `earthquake`, `flood`, `hurricane`, `wildfire`, `drought`, `pandemic`, `conflict`, `tsunami` |
| `geographic_scope` | `String` | Affected region identifier |
| `expires_at` | `u64` | Ledger timestamp for fund expiry |
| `release_triggers` | `Vec<Address>` | Authorized multi-sig signer addresses |
| `required_signatures` | `u32` | Minimum signatures needed (e.g. `2` for 2-of-3) |

**Errors:** Panics if admin is not authorized.

---

#### `get_fund`

Returns fund details by ID.

```rust
pub fn get_fund(env: Env, fund_id: String) -> Option<EmergencyFund>
```

Returns `None` if fund does not exist.

---

#### `list_active_funds`

Returns all currently active funds.

```rust
pub fn list_active_funds(env: Env) -> Vec<EmergencyFund>
```

---

#### `submit_disbursement`

Submits a multi-sig disbursement request.

```rust
pub fn submit_disbursement(
    env: Env,
    requester: Address,
    fund_id: String,
    beneficiary: Address,
    amount: U256,
    purpose: String,
    approvers: Vec<Address>,
)
```

**Errors:** Panics if fund is inactive, insufficient funds remain, approver count below threshold, or any approver is not in `release_triggers`.

---

#### `execute_multi_sig_release`

Executes a manual fund release with multi-sig authorization. Each approver must sign.

```rust
pub fn execute_multi_sig_release(
    env: Env,
    fund_id: String,
    beneficiary: Address,
    amount: U256,
    purpose: String,
    approvers: Vec<Address>,
) -> bool
```

Returns `true` on success.

---

#### `add_trigger`

Adds an automated trigger (oracle-based or manual) to a fund.

```rust
pub fn add_trigger(
    env: Env,
    admin: Address,
    fund_id: String,
    trigger_id: String,
    trigger_type: String,       // "seismic" | "weather" | "conflict" | "health" | "manual"
    threshold: String,
    oracle_source: String,      // "usgs" | "weather_api" | "acled" | "who" | "manual"
    auto_release_amount: U256,
    geofence_latitude: i64,     // degrees × 1e6
    geofence_longitude: i64,    // degrees × 1e6
    geofence_radius_km: u64,
    min_oracle_confirmations: u32,
)
```

---

#### `submit_oracle_data`

Submits oracle data for trigger verification.

```rust
pub fn submit_oracle_data(
    env: Env,
    oracle: Address,
    fund_id: String,
    trigger_id: String,
    data_type: String,
    value: String,
    location: String,
    confidence: u64,            // 0–100; records with < 80 are ignored
)
```

---

#### `execute_trigger`

Executes an automated trigger release when oracle conditions are met. Requires `min_oracle_confirmations` records with `confidence >= 80` within the last hour.

```rust
pub fn execute_trigger(
    env: Env,
    fund_id: String,
    trigger_id: String,
) -> U256
```

Returns the amount released.

---

#### `allocate_funds`

Allocates fund portions to specific sectors with proof of need.

```rust
pub fn allocate_funds(
    env: Env,
    admin: Address,
    fund_id: String,
    sector: String,
    amount: U256,
    beneficiaries: Vec<Address>,
    proof_of_need: String,
)
```

---

#### `recall_unused_funds`

Recalls unspent funds after the recall period (default 12 months). Requires recall to be enabled via `enable_recall`.

```rust
pub fn recall_unused_funds(
    env: Env,
    donor: Address,
    fund_id: String,
) -> U256
```

Returns the amount recalled.

---

#### `cleanup_expired_funds`

Deactivates all funds past their `expires_at` timestamp.

```rust
pub fn cleanup_expired_funds(env: Env)
```

---

#### `get_fund_status`

Returns key metrics for a fund.

```rust
pub fn get_fund_status(
    env: Env,
    fund_id: String,
) -> (String, U256, U256, U256, u64)
// returns: (status, total_amount, released_amount, available_amount, allocation_count)
```

---

#### `EmergencyFund` struct

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String` | Unique fund ID |
| `total_amount` | `U256` | Total funded amount |
| `released_amount` | `U256` | Amount disbursed to date |
| `current_status` | `String` | `active` \| `triggered` \| `released` \| `recalled` \| `expired` |
| `is_active` | `bool` | Whether fund accepts disbursements |
| `required_signatures` | `u32` | Multi-sig threshold |
| `auto_release_enabled` | `bool` | Whether oracle triggers are active |
| `recall_enabled` | `bool` | Whether donor recall is permitted |

---

### BeneficiaryManager

Biometric-free identity system for displaced persons.

---

#### `register_beneficiary`

Registers a displaced person without traditional ID documents.

```rust
pub fn register_beneficiary(
    env: Env,
    registrar: Address,
    beneficiary_id: String,
    name: String,
    disaster_id: String,
    location: String,
    wallet_address: Address,
    family_size: u32,
    special_needs: Vec<String>,
    verification_factors: Vec<VerificationFactor>,
)
```

**VerificationFactor:**

```rust
pub struct VerificationFactor {
    pub factor_type: String,  // "possession" | "behavioral" | "social"
    pub value: String,
    pub weight: u32,          // relative importance (e.g. 30)
    pub verified_at: u64,
}
```

Generates 3 recovery codes (30 / 60 / 90 day expiry) automatically on registration.

**Errors:** Panics if `beneficiary_id` is already registered.

---

#### `verify_beneficiary`

Verifies identity using provided behavioral/possession factors. Raises trust score by 10 on success (≥70% factor match), lowers by 5 on failure.

```rust
pub fn verify_beneficiary(
    env: Env,
    verifier: Address,
    beneficiary_id: String,
    provided_factors: Vec<VerificationFactor>,
) -> bool
```

Returns `true` if verification score ≥ 70%.

---

#### `restore_access`

Restores account access using a recovery code.

```rust
pub fn restore_access(
    env: Env,
    beneficiary_id: String,
    recovery_code: BytesN<32>,
    new_wallet: Address,
) -> bool
```

---

#### `get_beneficiary`

Returns beneficiary profile.

```rust
pub fn get_beneficiary(env: Env, beneficiary_id: String) -> Option<BeneficiaryProfile>
```

---

#### `list_beneficiaries_by_disaster`

Returns all beneficiaries linked to a disaster event.

```rust
pub fn list_beneficiaries_by_disaster(
    env: Env,
    disaster_id: String,
) -> Vec<BeneficiaryProfile>
```

---

### CashTransfer

Conditional cash transfers with category limits, time windows, and location rules.

---

#### `create_transfer`

Creates a conditional cash transfer for a beneficiary.

```rust
pub fn create_transfer(
    env: Env,
    creator: Address,
    transfer_id: String,
    beneficiary_id: String,
    amount: U256,
    token: String,
    expires_at: u64,
    spending_rules: Vec<SpendingRule>,
    purpose: String,
)
```

**SpendingRule:**

```rust
pub struct SpendingRule {
    pub rule_type: String,           // "category_limit" | "merchant_whitelist" | "time_window" | "location_based"
    pub parameters: Map<String, String>,
    pub limit: U256,
    pub current_usage: U256,
}
```

**Rule type parameters:**

| `rule_type` | Required `parameters` keys |
|-------------|---------------------------|
| `category_limit` | `"category"` → category name |
| `merchant_whitelist` | `"merchant_id"` → allowed merchant |
| `time_window` | `"start_time"`, `"end_time"` → unix timestamps as strings |
| `location_based` | `"location"` → allowed location string |

---

#### `spend`

Attempts to spend from a transfer. Validates all spending rules before approving.

```rust
pub fn spend(
    env: Env,
    beneficiary: Address,
    transfer_id: String,
    merchant_id: String,
    amount: U256,
    category: String,
    location: String,
) -> bool
```

Returns `true` if approved. Returns `false` if transfer is expired, insufficient balance, or any rule is violated.

---

#### `recall_funds`

Recalls unspent funds from an expired transfer.

```rust
pub fn recall_funds(
    env: Env,
    creator: Address,
    transfer_id: String,
) -> U256
```

Returns `0` if the transfer has not yet expired.

---

#### `get_transfer`

Returns transfer details.

```rust
pub fn get_transfer(env: Env, transfer_id: String) -> Option<ConditionalTransfer>
```

---

#### `get_transactions`

Returns spending transaction history for a transfer.

```rust
pub fn get_transactions(env: Env, transfer_id: String) -> Vec<Transaction>
```

---

### MerchantNetwork

Local merchant onboarding (target < 15 minutes) with community vouching and multi-method payment acceptance.

---

#### `register_merchant`

Registers a local merchant. No traditional business documents required.

```rust
pub fn register_merchant(
    env: Env,
    owner: Address,
    merchant_id: String,
    name: String,
    business_type: String,
    category: u32,
    location: Location,
    contact_info: String,
    accepted_tokens: Vec<String>,
    vouchers: Vec<String>,
    emergency_fast_track: bool,
)
```

**Category constants:**

| Constant | Value | Meaning |
|----------|-------|---------|
| `CATEGORY_FOOD` | `0` | Food vendor |
| `CATEGORY_WATER` | `1` | Water supplier |
| `CATEGORY_SHELTER` | `2` | Shelter/housing |
| `CATEGORY_MEDICAL` | `3` | Pharmacy/clinic |
| `CATEGORY_CLOTHING` | `4` | Clothing |
| `CATEGORY_FUEL` | `5` | Fuel station |

**`emergency_fast_track = true`:** Skips trial, activates immediately with $10,000/day limit.  
**`emergency_fast_track = false`:** Starts in trial with $100/day limit for 7 days.

---

#### `add_vouch`

Adds a community vouch. 3 beneficiary vouches OR 1 NGO vouch activates a pending merchant.

```rust
pub fn add_vouch(
    env: Env,
    voucher: Address,
    merchant_id: String,
    voucher_type: u32,   // 0 = beneficiary, 1 = ngo (counts as 3)
)
```

---

#### `process_payment`

Processes a beneficiary-to-merchant payment. Both parties must authorize.

```rust
pub fn process_payment(
    env: Env,
    merchant: Address,
    beneficiary: Address,
    merchant_id: String,
    beneficiary_id: String,
    amount: U256,
    token: String,
    purpose: String,
    payment_method: u32,
) -> String
```

**Payment method constants:**

| Constant | Value |
|----------|-------|
| `PAYMENT_QR` | `0` |
| `PAYMENT_USSD` | `1` |
| `PAYMENT_NFC` | `2` |
| `PAYMENT_OFFLINE` | `3` |
| `PAYMENT_ONLINE` | `4` |

Returns transaction ID string.

---

#### `settle_balances`

Settles pending merchant balances. Typically called daily.

```rust
pub fn settle_balances(env: Env, admin: Address, merchant_id: String) -> U256
```

Returns settled amount.

---

#### **Merchant status lifecycle**

```
PENDING (0) → TRIAL (1) → ACTIVE (2) → GRADUATED (4)
                       ↘ SUSPENDED (3)
```

---

### SupplyChainTracker

End-to-end shipment tracking with checkpoint verification and temperature monitoring.

---

#### `create_shipment`

Creates a new supply shipment record.

```rust
pub fn create_shipment(
    env: Env,
    donor: Address,
    shipment_id: String,
    donor_id: String,
    supply_type: String,
    quantity: U256,
    unit: String,
    origin: Location,
    destination: Location,
    estimated_arrival: u64,
    temperature_requirements: Option<TemperatureRequirements>,
    special_handling: Vec<String>,
)
```

**TemperatureRequirements:**

```rust
pub struct TemperatureRequirements {
    pub min_temp: f64,   // Celsius
    pub max_temp: f64,
    pub critical: bool,  // true = reject checkpoint if temp out of range
}
```

---

#### `add_checkpoint`

Logs a transit checkpoint with condition and optional temperature.

```rust
pub fn add_checkpoint(
    env: Env,
    verifier: Address,
    shipment_id: String,
    location: Location,
    quantity_verified: U256,
    condition: String,          // "good" | "damaged" | "partial_loss"
    photos: Vec<String>,        // IPFS hashes
    notes: String,
    temperature: Option<f64>,
)
```

**Errors:** Panics if temperature is outside `critical` range when `TemperatureRequirements.critical = true`.

---

#### `assign_transporter`

Assigns a transporter address to a shipment.

```rust
pub fn assign_transporter(
    env: Env,
    donor: Address,
    shipment_id: String,
    transporter: Address,
)
```

---

#### `confirm_delivery`

Records final delivery confirmation from recipient.

```rust
pub fn confirm_delivery(
    env: Env,
    recipient: Address,
    shipment_id: String,
    recipient_id: String,
    received_quantity: U256,
    condition_report: String,
    photos: Vec<String>,
)
```

Sets shipment status to `"delivered"`.

---

#### `get_shipment`

Returns shipment details.

```rust
pub fn get_shipment(env: Env, shipment_id: String) -> Option<SupplyShipment>
```

#### `get_shipment_history`

Returns full shipment history including delivery confirmation.

```rust
pub fn get_shipment_history(
    env: Env,
    shipment_id: String,
) -> (Option<SupplyShipment>, Option<RecipientConfirmation>)
```

---

#### **Shipment status values**

| Status | Meaning |
|--------|---------|
| `"in_transit"` | Initial state after creation |
| `"at_checkpoint"` | More than 2 checkpoints logged |
| `"delivered"` | `confirm_delivery` called |
| `"lost"` | Manually marked lost |

---

### AntiFraud

Pattern-based fraud detection with risk scoring and velocity checks.

---

#### `register_beneficiary_check`

Screens a new registration for duplicate or suspicious patterns.

```rust
pub fn register_beneficiary_check(
    env: Env,
    beneficiary_id: String,
    verification_factors: Vec<String>,
    location: String,
    device_fingerprint: String,
) -> (bool, String)
```

Returns `(true, "Registration approved")` or `(false, "Registration flagged for review")`. Risk score > 70 triggers a fraud alert and blocks registration.

---

#### `monitor_transaction`

Monitors a transaction for suspicious patterns in real time.

```rust
pub fn monitor_transaction(
    env: Env,
    beneficiary_id: String,
    merchant_id: String,
    amount: U256,
    timestamp: u64,
    transaction_hash: String,
) -> (bool, Vec<String>)
```

Returns `(is_clean, risk_factors)`. Risk score > 60 flags the transaction and creates a `SuspiciousTransaction` record.

**Checks performed:**
- **Velocity** — > 10 transactions per hour adds 30 points
- **Amount anomaly** — unusual amounts add 25 points
- **Pattern analysis** — suspicious merchant-beneficiary pattern adds 35 points
- **Geographic anomaly** — unusual location adds 20 points

---

## TypeScript SDK

### Network Configs

```typescript
import { TESTNET_CONFIG, MAINNET_CONFIG } from './sdk/src';
// NetworkConfig { network, rpcUrl, horizonUrl, contractIds }
```

### AidRegistryClient

```typescript
const client = new AidRegistryClient(config);

await client.createFund(params)          // Create emergency fund
await client.getFund(fundId)             // Get fund details
await client.listActiveFunds()           // List active funds
await client.submitDisbursement(params)  // Submit multi-sig disbursement
await client.executeMultiSigRelease(p)   // Execute manual release
await client.addTrigger(params)          // Add oracle trigger
await client.submitOracleData(params)    // Submit oracle data
await client.executeTrigger(fundId, triggerId) // Execute trigger
await client.allocateFunds(params)       // Sector allocation
await client.recallUnusedFunds(fundId)   // Recall after 12 months
await client.cleanupExpiredFunds()       // Deactivate expired funds
await client.getFundStatus(fundId)       // Status and metrics
```

### BeneficiaryClient

```typescript
const client = new BeneficiaryClient(config);

await client.registerBeneficiary(params)           // Register without ID
await client.verifyBeneficiary(id, factors)        // Verify identity
await client.restoreAccess(id, code, newWallet)    // Account recovery
await client.getBeneficiary(id)                    // Fetch profile
await client.listByDisaster(disasterId)            // List by event
```

### MerchantClient

```typescript
const client = new MerchantClient(config);

await client.registerMerchant(params)              // Onboard merchant
await client.addVouch(merchantId, type)            // Community vouch
await client.processPayment(params)                // Execute payment
await client.settleBalances(merchantId)            // Daily settlement
await client.getMerchant(merchantId)               // Fetch profile
```

### TransferClient

```typescript
const client = new TransferClient(config);

await client.createTransfer(params)               // Create conditional transfer
await client.spend(transferId, params)            // Attempt spend
await client.recallFunds(transferId)              // Recall after expiry
await client.getTransfer(transferId)              // Fetch details
await client.getTransactions(transferId)          // Spending history
```

### TrackerClient

```typescript
const client = new TrackerClient(config);

await client.createShipment(params)               // Create shipment
await client.addCheckpoint(shipmentId, params)    // Log checkpoint
await client.assignTransporter(shipmentId, addr)  // Assign transporter
await client.confirmDelivery(shipmentId, params)  // Confirm receipt
await client.getShipment(shipmentId)              // Fetch shipment
await client.getShipmentHistory(shipmentId)       // Full history
```

---

## Common Types

### `Location`

```typescript
interface Location {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  country: string;
  postalCode: string;
}
```

### `NetworkConfig`

```typescript
interface NetworkConfig {
  network: 'testnet' | 'mainnet' | 'standalone';
  rpcUrl: string;
  horizonUrl: string;
  contractIds: {
    platform: string;
    aidRegistry: string;
    beneficiaryManager: string;
    merchantNetwork: string;
    cashTransfer: string;
    supplyChainTracker: string;
    antiFraud: string;
  };
}
```

### `DisasterResponseConfig`

```typescript
interface DisasterResponseConfig {
  disasterId: string;
  disasterType: string;
  affectedArea: string;
  estimatedAffected: number;
  responseTeam: string[];
  budget: string;
  duration: number; // days
}
```

---

## Error Reference

| Error Message | Contract | Cause |
|---------------|----------|-------|
| `Fund is not active` | AidRegistry | Fund is expired or recalled |
| `Insufficient funds in pool` | AidRegistry | Release exceeds remaining balance |
| `Insufficient signatures` | AidRegistry | Approver count below threshold |
| `Unauthorized approver` | AidRegistry | Approver not in `release_triggers` |
| `Fund does not exist` | AidRegistry | Invalid `fund_id` |
| `Invalid trigger type` | AidRegistry | Unsupported trigger type string |
| `Insufficient oracle confirmations` | AidRegistry | Not enough high-confidence oracle records |
| `Recall not enabled for this fund` | AidRegistry | `enable_recall` not called |
| `Fund is not yet eligible for recall` | AidRegistry | Recall period not reached |
| `Beneficiary already registered` | BeneficiaryManager | Duplicate `beneficiary_id` |
| `Transfer already exists` | CashTransfer | Duplicate `transfer_id` |
| `Merchant already registered` | MerchantNetwork | Duplicate `merchant_id` |
| `Shipment already exists` | SupplyChainTracker | Duplicate `shipment_id` |
| `Shipment not found` | SupplyChainTracker | Invalid `shipment_id` |
| `Temperature outside required range` | SupplyChainTracker | Cold chain violation |
| `Registration flagged for review` | AntiFraud | Risk score > 70 |
