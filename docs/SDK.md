# Stellar Disaster Relief SDK — API Documentation

**Version:** 1.0.0  
**Network:** Stellar / Soroban (testnet & mainnet)  
**Language:** TypeScript

---

## Table of Contents

1. [Overview](#overview)
2. [Installation & Setup](#installation--setup)
3. [Network Configuration](#network-configuration)
4. [SDK Architecture](#sdk-architecture)
5. [Transaction Lifecycle](#transaction-lifecycle)
6. [AidClient](#aidclient)
7. [BeneficiaryClient](#beneficiaryclient)
8. [MerchantClient](#merchantclient)
9. [TransferClient](#transferclient)
10. [TrackerClient](#trackerclient)
11. [Multi-Signature Signing](#multi-signature-signing)
12. [Retry Behavior](#retry-behavior)
13. [Error Handling](#error-handling)
14. [Types Reference](#types-reference)
15. [Security Best Practices](#security-best-practices)
16. [Changelog](#changelog)

---

## Overview

The Stellar Disaster Relief SDK provides TypeScript clients for interacting with Soroban smart contracts deployed on the Stellar network. It covers the full lifecycle of humanitarian aid operations:

- **Emergency fund deployment** with multi-sig release controls
- **Beneficiary registration** using biometric-free identity verification
- **Merchant onboarding** and payment processing
- **Conditional cash transfers** with spending rules
- **Supply chain tracking** with geolocation and temperature monitoring
- **Multi-signature transaction signing** for high-value operations
- **Automatic retry** with exponential backoff for transient network errors

---

## Installation & Setup

```bash
npm install stellar-disaster-relief-sdk
# or
yarn add stellar-disaster-relief-sdk
```

**Peer dependencies:**

```bash
npm install stellar-sdk@^12.0.0
```

**Environment variables** (`.env`):

```env
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Contract IDs (replace after deployment)
CONTRACT_AID_REGISTRY=CXXX...
CONTRACT_BENEFICIARY_MANAGER=CXXX...
CONTRACT_MERCHANT_NETWORK=CXXX...
CONTRACT_CASH_TRANSFER=CXXX...
CONTRACT_SUPPLY_CHAIN_TRACKER=CXXX...
CONTRACT_ANTI_FRAUD=CXXX...

# Never commit secret keys — load from a secrets manager
ADMIN_SECRET_KEY=SXXX...
```

> **Security:** Never hardcode secret keys. Load them from environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.). See [Security Best Practices](#security-best-practices).

---

## Network Configuration

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

### Pre-built configurations

```typescript
import { TESTNET_CONFIG, MAINNET_CONFIG } from 'stellar-disaster-relief-sdk';

// Testnet (development / staging)
const sdk = createDisasterReliefSDK(TESTNET_CONFIG);

// Mainnet (production)
const sdk = createDisasterReliefSDK(MAINNET_CONFIG);
```

### Custom configuration

```typescript
import { createDisasterReliefSDK } from 'stellar-disaster-relief-sdk';

const sdk = createDisasterReliefSDK({
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform:             'CPLATFORM...',
    aidRegistry:          'CAID...',
    beneficiaryManager:   'CBENEFICIARY...',
    merchantNetwork:      'CMERCHANT...',
    cashTransfer:         'CTRANSFER...',
    supplyChainTracker:   'CTRACKER...',
    antiFraud:            'CFRAUD...',
  },
});
```

### `createDisasterReliefSDK(config)`

Factory that returns all clients pre-configured for the given network.

**Returns:**

```typescript
{
  aidClient:         AidClient;
  beneficiaryClient: BeneficiaryClient;
  merchantClient:    MerchantClient;
  transferClient:    TransferClient;
  trackerClient:     TrackerClient;
}
```

---

## SDK Architecture

```
createDisasterReliefSDK(config)
├── AidClient          — Emergency fund management & disbursements
├── BeneficiaryClient  — Beneficiary registration & verification
├── MerchantClient     — Merchant onboarding & payments
├── TransferClient     — Conditional cash transfers & spending rules
└── TrackerClient      — Supply chain shipment tracking
```

Each client:
- Holds a `stellar-sdk` `Server` instance pointed at the configured RPC URL
- Holds a `Contract` instance for the relevant Soroban contract
- Exposes **read methods** (query contract state via `contract.call()`)
- Exposes **write methods** (build → sign → submit via `server.sendTransaction()`)
- Exposes **`buildMultiSig*` methods** that return a `MultiSigManager` for multi-party signing

---

## Transaction Lifecycle

Every write operation follows this lifecycle:

```
1. Fetch source account sequence number
   └─ server.getAccount(publicKey)

2. Build transaction
   └─ new TransactionBuilder(account, { fee, networkPassphrase })
        .addOperation(contract.call(...))
        .setTimeout(30)
        .build()

3a. Single-sig: sign immediately
    └─ tx.sign(keypair)
    └─ server.sendTransaction(tx)

3b. Multi-sig: collect signatures via MultiSigManager
    └─ MultiSigManager.create(tx, passphrase, signers, threshold)
    └─ mgr.addSignature(key1)  // repeat until threshold met
    └─ mgr.submit(server)

4. Check result
   └─ result.status === 'SUCCESS' → return value
   └─ result.status !== 'SUCCESS' → throw Error
```

**Soroban specifics:**
- All contract arguments are encoded with `nativeToScVal()` before being passed to `contract.call()`
- Return values are decoded with `scValToNative(result.result.retval)`
- Transactions use a 30-second timeout by default
- Base fee is `100` stroops for standard operations; `200` for multi-party payments

---

## AidClient

Manages emergency fund deployment, disbursements, and fund monitoring.

```typescript
import { AidClient } from 'stellar-disaster-relief-sdk';
const client = new AidClient(config);
// or via factory:
const { aidClient } = createDisasterReliefSDK(config);
```

---

### `deployEmergencyFund()`

Deploy a new emergency fund to the `aid_registry` contract.

```typescript
async deployEmergencyFund(
  adminKey: string,          // Secret key of the fund administrator
  fundId: string,            // Unique fund identifier
  name: string,              // Human-readable fund name
  description: string,       // Fund purpose description
  totalAmount: string,       // Total XLM amount (as string, in stroops)
  disasterType: string,      // e.g. 'earthquake', 'flood', 'hurricane'
  geographicScope: string,   // Affected region description
  expiresAt: number,         // Unix timestamp (ms) when fund expires
  releaseTriggers: string[], // Authorized signer public keys for release
  requiredSignatures: number // Minimum signatures needed for disbursement
): Promise<string>           // Returns fundId on success
```

**Example:**

```typescript
const fundId = await aidClient.deployEmergencyFund(
  process.env.ADMIN_SECRET_KEY!,
  'earthquake_dr_2024',
  'Dominican Republic Earthquake Response',
  'Rapid response funding for earthquake victims',
  '1000000',                          // 1M XLM in stroops
  'earthquake',
  'Santo Domingo, Dominican Republic',
  Date.now() + 90 * 24 * 60 * 60 * 1000, // 90 days
  [ngoPublicKey, govPublicKey, unPublicKey],
  2                                   // 2-of-3 multi-sig
);
// Returns: 'earthquake_dr_2024'
```

**Throws:** `Error` if transaction fails or network is unreachable.

---

### `triggerDisbursement()`

Submit a disbursement request from an active fund.

```typescript
async triggerDisbursement(
  requesterKey: string,  // Secret key of the requester
  fundId: string,
  beneficiary: string,   // Beneficiary Stellar public key
  amount: string,        // Amount in stroops
  purpose: string,       // Disbursement purpose description
  approvers: string[]    // Public keys of approving signers
): Promise<string>       // Confirmation message
```

**Example:**

```typescript
const result = await aidClient.triggerDisbursement(
  process.env.NGO_SECRET_KEY!,
  'earthquake_dr_2024',
  'GBENE...FICIARY',
  '5000',
  'Emergency food and shelter',
  [ngoPublicKey, govPublicKey]
);
// Returns: 'Disbursement submitted for fund earthquake_dr_2024'
```

---

### `getFund()`

Fetch details of a specific fund.

```typescript
async getFund(fundId: string): Promise<EmergencyFund | null>
```

Returns `null` if the fund does not exist.

---

### `listActiveFunds()`

List all currently active emergency funds.

```typescript
async listActiveFunds(): Promise<EmergencyFund[]>
```

---

### `getDisbursements()`

Get the disbursement history for a fund.

```typescript
async getDisbursements(fundId: string): Promise<DisbursementRecord[]>
```

---

### `monitorFundPool()`

Get a real-time snapshot of fund utilization.

```typescript
async monitorFundPool(fundId: string): Promise<{
  totalAmount: string;
  releasedAmount: string;
  remainingAmount: string;
  isActive: boolean;
  expiresAt: number;
}>
```

**Throws:** `Error` if fund is not found.

---

### `getFundStatistics()`

Aggregate statistics for reporting.

```typescript
async getFundStatistics(fundId: string): Promise<{
  totalDisbursements: number;
  totalAmountDisbursed: string;
  averageDisbursement: string;
  lastDisbursement: number | null;
  beneficiariesReached: number;
}>
```

---

### `deployRapidResponse()`

Deploy multiple categorized funds in a single call for large-scale disaster response.

```typescript
async deployRapidResponse(
  adminKey: string,
  disasterId: string,
  disasterType: string,
  affectedArea: string,
  totalBudget: string,
  fundCategories: Array<{
    name: string;
    percentage: number; // 0–100, must sum to 100
    description: string;
  }>
): Promise<string[]>  // Returns array of created fundIds
```

**Example:**

```typescript
const fundIds = await aidClient.deployRapidResponse(
  process.env.ADMIN_SECRET_KEY!,
  'haiti_eq_2024',
  'earthquake',
  'Port-au-Prince, Haiti',
  '5000000',
  [
    { name: 'Food',    percentage: 40, description: 'Emergency food supplies' },
    { name: 'Medical', percentage: 35, description: 'Medical aid and supplies' },
    { name: 'Shelter', percentage: 25, description: 'Temporary shelter' },
  ]
);
// Returns: ['haiti_eq_2024_food', 'haiti_eq_2024_medical', 'haiti_eq_2024_shelter']
```

---

### `cleanupExpiredFunds()`

Remove expired funds from active state on-chain.

```typescript
async cleanupExpiredFunds(adminKey: string): Promise<string>
```

---

### `generateFundQRCode()` / `validateFundQRCode()`

Generate and validate offline QR codes for fund access.

```typescript
generateFundQRCode(fundId: string, fund: EmergencyFund): string
validateFundQRCode(qrCodeData: string): boolean
```

---

### `buildMultiSigDeployFund()`

Build a multi-sig transaction for fund deployment. Returns a `MultiSigManager` — see [Multi-Signature Signing](#multi-signature-signing).

```typescript
async buildMultiSigDeployFund(
  sourceKey: string,
  fundId: string,
  name: string,
  description: string,
  totalAmount: string,
  disasterType: string,
  geographicScope: string,
  expiresAt: number,
  releaseTriggers: string[],
  requiredSignatures: number,
  authorizedSigners: string[], // Public keys allowed to sign
  threshold: number            // Minimum signatures required
): Promise<MultiSigManager>
```

---

### `buildMultiSigDisbursement()`

Build a multi-sig transaction for disbursement approval.

```typescript
async buildMultiSigDisbursement(
  sourceKey: string,
  fundId: string,
  beneficiary: string,
  amount: string,
  purpose: string,
  approvers: string[],
  authorizedSigners: string[],
  threshold: number
): Promise<MultiSigManager>
```

---

## BeneficiaryClient

Manages displaced person registration, verification, and access recovery.

```typescript
import { BeneficiaryClient } from 'stellar-disaster-relief-sdk';
const client = new BeneficiaryClient(config);
```

---

### `registerBeneficiary()`

Register a displaced person using biometric-free identity verification.

```typescript
async registerBeneficiary(
  registrarKey: string,                    // NGO field worker secret key
  beneficiaryId: string,                   // Unique beneficiary identifier
  name: string,                            // Full name
  disasterId: string,                      // Associated disaster ID
  location: string,                        // Current camp/location
  walletAddress: string,                   // Stellar public key for payments
  familySize: number,                      // Number of family members
  specialNeeds: string[],                  // e.g. ['medical', 'elderly_care']
  verificationFactors: VerificationFactor[] // Identity factors (no biometrics)
): Promise<string>                         // Confirmation message
```

**Example:**

```typescript
const factors = beneficiaryClient.createVerificationFactors(
  ['family_photo_hash_2024'],              // possession factors
  ['signature_pattern_001'],              // behavioral factors
  ['neighbor_vouch_juan_garcia']          // social factors
);

await beneficiaryClient.registerBeneficiary(
  process.env.NGO_WORKER_KEY!,
  'DP_001_RODRIGUEZ',
  'Maria Rodriguez',
  'earthquake_dr_2024',
  'Santo Domingo Centro Camp A',
  'GBENE...WALLET',
  4,
  ['elderly_care'],
  factors
);
```

---

### `verifyBeneficiary()`

Verify a beneficiary's identity factors.

```typescript
async verifyBeneficiary(
  verifierKey: string,
  beneficiaryId: string,
  providedFactors: VerificationFactor[]
): Promise<boolean>
```

---

### `restoreAccess()`

Restore wallet access using a recovery code (for lost devices).

```typescript
async restoreAccess(
  beneficiaryId: string,
  recoveryCode: string,
  newWalletAddress: string
): Promise<boolean>
```

---

### `getBeneficiary()`

Fetch a beneficiary profile.

```typescript
async getBeneficiary(beneficiaryId: string): Promise<BeneficiaryProfile | null>
```

---

### `listBeneficiariesByDisaster()`

List all beneficiaries registered under a disaster.

```typescript
async listBeneficiariesByDisaster(disasterId: string): Promise<BeneficiaryProfile[]>
```

---

### `updateLocation()`

Update a beneficiary's current location.

```typescript
async updateLocation(
  beneficiaryKey: string,
  beneficiaryId: string,
  newLocation: string
): Promise<string>
```

---

### `createVerificationFactors()`

Helper to build `VerificationFactor[]` from raw values.

```typescript
createVerificationFactors(
  possessionFactors: string[],  // Items the person has (photo hash, document)
  behavioralFactors: string[],  // Patterns unique to the person
  socialFactors: string[]       // Community vouches
): VerificationFactor[]
```

---

### `generateRecoveryCodes()`

Generate one-time recovery codes for account restoration.

```typescript
generateRecoveryCodes(beneficiaryId: string): string[]
// Returns array of 5 recovery codes
```

---

### `generateBeneficiaryQRCode()` / `validateBeneficiaryQRCode()`

Offline QR code generation and validation.

```typescript
generateBeneficiaryQRCode(beneficiaryId: string, profile: BeneficiaryProfile): string
async validateBeneficiaryQRCode(qrCodeData: string): Promise<boolean>
```

---

### `createUSSDSession()` / `processUSSDInput()`

USSD/SMS support for feature phone users.

```typescript
createUSSDSession(phoneNumber: string): { sessionId: string; menu: string }

processUSSDInput(
  sessionId: string,
  input: string,
  currentStep: string
): { nextStep: string; message: string; isComplete: boolean }
```

**Example:**

```typescript
const session = beneficiaryClient.createUSSDSession('+254712345678');
const response = beneficiaryClient.processUSSDInput(
  session.sessionId,
  '1',           // user pressed 1 for "Check Balance"
  'main_menu'
);
```

---

### `getBeneficiaryStatistics()`

Aggregate statistics for a disaster's beneficiary population.

```typescript
async getBeneficiaryStatistics(disasterId: string): Promise<{
  totalBeneficiaries: number;
  verifiedBeneficiaries: number;
  totalFamilyMembers: number;
  averageFamilySize: number;
  averageTrustScore: number;
  activeBeneficiaries: number;
  specialNeedsCount: number;
}>
```

---

### `buildMultiSigRegister()` / `buildMultiSigVerify()`

Multi-sig variants for registration and verification.

```typescript
async buildMultiSigRegister(
  sourceKey: string, beneficiaryId: string, name: string,
  disasterId: string, location: string, walletAddress: string,
  familySize: number, specialNeeds: string[], verificationFactors: VerificationFactor[],
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>

async buildMultiSigVerify(
  sourceKey: string, beneficiaryId: string,
  verified: boolean, notes: string,
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>
```

---

## MerchantClient

Manages local merchant onboarding, verification, and payment processing.

```typescript
import { MerchantClient } from 'stellar-disaster-relief-sdk';
const client = new MerchantClient(config);
```

---

### `registerMerchant()`

Register a local merchant for the relief payment network.

```typescript
async registerMerchant(
  ownerKey: string,                    // Merchant owner secret key
  merchantId: string,                  // Unique merchant identifier
  request: MerchantOnboardingRequest   // Onboarding details
): Promise<string>                     // Confirmation message
```

**Example:**

```typescript
const request = merchantClient.createOnboardingRequest(
  'Farmacia Central',
  'pharmacy',
  { latitude: 18.4861, longitude: -69.9312, address: 'Calle El Conde 45',
    city: 'Santo Domingo', country: 'Dominican Republic', postalCode: '10210' },
  '+1-809-555-0123',
  'GMERCHANT...PUBLICKEY'
);

await merchantClient.registerMerchant(
  process.env.MERCHANT_SECRET_KEY!,
  'merchant_farmacia_central',
  request
);
```

---

### `verifyMerchant()`

Approve or reject a merchant registration (NGO/admin only).

```typescript
async verifyMerchant(
  verifierKey: string,
  merchantId: string,
  approved: boolean,
  notes: string
): Promise<string>
```

---

### `processPayment()`

Process a payment from a beneficiary to a merchant. Requires both merchant and beneficiary signatures.

```typescript
async processPayment(
  merchantKey: string,
  beneficiaryKey: string,
  merchantId: string,
  beneficiaryId: string,
  amount: string,   // In stroops
  token: string,    // e.g. 'XLM'
  purpose: string
): Promise<string>  // Transaction ID
```

**Example:**

```typescript
const txId = await merchantClient.processPayment(
  process.env.MERCHANT_SECRET_KEY!,
  process.env.BENEFICIARY_SECRET_KEY!,
  'merchant_farmacia_central',
  'DP_001_RODRIGUEZ',
  '2500',
  'XLM',
  'Medical supplies purchase'
);
```

> **Note:** This method requires both keys to be available at call time. For flows where keys are held by separate parties, use `buildMultiSigPayment()` instead.

---

### `getMerchant()`

Fetch merchant details.

```typescript
async getMerchant(merchantId: string): Promise<Merchant | null>
```

---

### `findMerchantsByLocation()`

Geographic search for nearby merchants.

```typescript
async findMerchantsByLocation(
  latitude: number,
  longitude: number,
  radiusKm: number
): Promise<Merchant[]>
```

---

### `getMerchantTransactions()`

Get transaction history for a merchant.

```typescript
async getMerchantTransactions(merchantId: string): Promise<Transaction[]>
```

---

### `updateReputation()`

Adjust a merchant's reputation score based on feedback.

```typescript
async updateReputation(
  adminKey: string,
  merchantId: string,
  feedbackScore: number  // -10 to +10
): Promise<string>
```

---

### `getVerificationQueue()`

List merchant IDs awaiting verification.

```typescript
async getVerificationQueue(): Promise<string[]>
```

---

### `getMerchantStatistics()`

Aggregate statistics for a merchant.

```typescript
async getMerchantStatistics(merchantId: string): Promise<{
  totalTransactions: number;
  totalVolume: string;
  averageTransaction: string;
  reputationScore: number;
  monthlyUtilization: number; // 0–100 percentage
}>
```

---

### `batchVerifyMerchants()`

Verify multiple merchants in a single call.

```typescript
async batchVerifyMerchants(
  verifierKey: string,
  merchantIds: string[],
  approved: boolean,
  notes: string
): Promise<string[]>
```

---

### `createOnboardingRequest()`

Helper to build a `MerchantOnboardingRequest`.

```typescript
createOnboardingRequest(
  name: string,
  businessType: string,
  location: Location,
  contactInfo: string,
  stellarAddress: string
): MerchantOnboardingRequest
```

---

### `generateMerchantQRCode()` / `validateMerchantQRCode()`

```typescript
generateMerchantQRCode(merchantId: string, merchant: Merchant): string
async validateMerchantQRCode(qrCodeData: string): Promise<boolean>
```

---

### `discoverMerchantsFromStellarToml()`

Discover merchants via Stellar TOML federation.

```typescript
async discoverMerchantsFromStellarToml(domain: string): Promise<Merchant[]>
```

---

### `buildMultiSigRegisterMerchant()` / `buildMultiSigApproveMerchant()` / `buildMultiSigPayment()`

Multi-sig variants for merchant operations.

```typescript
async buildMultiSigRegisterMerchant(
  sourceKey: string, merchantId: string, request: MerchantOnboardingRequest,
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>

async buildMultiSigApproveMerchant(
  sourceKey: string, merchantId: string, approved: boolean, notes: string,
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>

async buildMultiSigPayment(
  merchantKey: string, beneficiaryKey: string,
  merchantId: string, beneficiaryId: string,
  amount: string, token: string, purpose: string,
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>
```

---

## TransferClient

Manages conditional cash transfers with spending rules and category limits.

```typescript
import { TransferClient } from 'stellar-disaster-relief-sdk';
const client = new TransferClient(config);
```

---

### `createTransfer()`

Create a conditional cash transfer for a beneficiary.

```typescript
async createTransfer(
  creatorKey: string,
  transferId: string,
  beneficiaryId: string,
  amount: string,           // Total amount in stroops
  token: string,            // e.g. 'XLM'
  expiresAt: number,        // Unix timestamp (ms)
  spendingRules: SpendingRule[],
  purpose: string
): Promise<string>          // Confirmation message
```

**Example:**

```typescript
const rules = [
  transferClient.createCategoryLimitRule('food',      '4000'),
  transferClient.createCategoryLimitRule('medical',   '3000'),
  transferClient.createCategoryLimitRule('shelter',   '2000'),
  transferClient.createCategoryLimitRule('transport', '1000'),
];

await transferClient.createTransfer(
  process.env.NGO_SECRET_KEY!,
  'CT_DP001_001',
  'DP_001_RODRIGUEZ',
  '10000',
  'XLM',
  Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  rules,
  'Monthly emergency assistance'
);
```

---

### `spend()`

Execute a spend from a conditional transfer at a merchant.

```typescript
async spend(
  beneficiaryKey: string,
  transferId: string,
  merchantId: string,
  amount: string,
  category: string,   // Must match a spending rule category
  location: string
): Promise<boolean>   // true if approved by spending rules
```

---

### `getTransfer()`

Fetch transfer details.

```typescript
async getTransfer(transferId: string): Promise<ConditionalTransfer | null>
```

---

### `getTransactions()`

Get spending history for a transfer.

```typescript
async getTransactions(transferId: string): Promise<TransferTransaction[]>
```

---

### `listBeneficiaryTransfers()`

List all active transfers for a beneficiary.

```typescript
async listBeneficiaryTransfers(beneficiaryId: string): Promise<ConditionalTransfer[]>
```

---

### `recallFunds()`

Recall unspent funds after transfer expiry.

```typescript
async recallFunds(creatorKey: string, transferId: string): Promise<string>
```

---

### `extendExpiry()`

Extend the expiry date of an active transfer.

```typescript
async extendExpiry(
  creatorKey: string,
  transferId: string,
  newExpiry: number   // Unix timestamp (ms)
): Promise<string>
```

---

### `createCategoryLimitRule()`

Create a spending rule that limits spending in a category.

```typescript
createCategoryLimitRule(category: string, limit: string): SpendingRule
```

**Categories:** `'food'`, `'medical'`, `'shelter'`, `'transport'`, `'clothing'`, `'hygiene'`

---

### `createTimeWindowRule()`

Restrict spending to a specific time window.

```typescript
createTimeWindowRule(startTime: number, endTime: number): SpendingRule
```

---

### `createLocationRule()`

Restrict spending to a specific location.

```typescript
createLocationRule(allowedLocation: string): SpendingRule
```

---

### `processPaymentRequest()`

Process a `PaymentRequest` against the first available active transfer.

```typescript
async processPaymentRequest(
  request: PaymentRequest,
  beneficiaryKey: string
): Promise<{
  success: boolean;
  transactionId?: string;
  error?: string;
}>
```

---

### `getTransferStatistics()`

```typescript
async getTransferStatistics(transferId: string): Promise<{
  totalSpent: string;
  remainingAmount: string;
  utilizationRate: number;  // 0–100
  transactionCount: number;
  averageTransaction: string;
  isExpired: boolean;
}>
```

---

### `batchCreateTransfers()`

Create identical transfers for multiple beneficiaries.

```typescript
async batchCreateTransfers(
  creatorKey: string,
  beneficiaryIds: string[],
  amount: string,
  purpose: string,
  spendingRules: SpendingRule[]
): Promise<string[]>
```

---

### `createEmergencyTransfer()`

Build a pre-configured emergency transfer with default spending rules (60% food, 30% medicine, 10% shelter, 7-day expiry). Does **not** submit to the network — call `createTransfer()` with the returned data.

```typescript
createEmergencyTransfer(
  beneficiaryId: string,
  amount: string,
  disasterType: string
): { transferId: string; transfer: ConditionalTransfer }
```

---

### `generateTransferQRCode()` / `validateTransferQRCode()`

```typescript
generateTransferQRCode(transferId: string, transfer: ConditionalTransfer): string
async validateTransferQRCode(qrCodeData: string): Promise<boolean>
```

---

### `buildMultiSigCreateTransfer()`

```typescript
async buildMultiSigCreateTransfer(
  sourceKey: string, transferId: string, beneficiaryId: string,
  amount: string, token: string, expiresAt: number,
  spendingRules: SpendingRule[], purpose: string,
  authorizedSigners: string[], threshold: number
): Promise<MultiSigManager>
```

---

## TrackerClient

Tracks supply shipments with geolocation, temperature monitoring, and delivery confirmation.

```typescript
import { TrackerClient } from 'stellar-disaster-relief-sdk';
const client = new TrackerClient(config);
```

---

### `createShipment()`

Register a new supply shipment on-chain.

```typescript
async createShipment(
  donorKey: string,
  request: SupplyChainRequest
): Promise<string>  // Returns generated shipmentId
```

**Example:**

```typescript
const request = trackerClient.createSupplyChainRequest(
  'WHO_DONOR_001',
  'medicine',
  '50000',
  'units',
  originLocation,
  destinationLocation,
  Date.now() + 7 * 24 * 60 * 60 * 1000,
  { minTemp: 2, maxTemp: 8, critical: true },
  ['refrigerated', 'fragile']
);

const shipmentId = await trackerClient.createShipment(
  process.env.DONOR_SECRET_KEY!,
  request
);
```

---

### `addCheckpoint()`

Record a verified checkpoint along the shipment route.

```typescript
async addCheckpoint(
  verifierKey: string,
  shipmentId: string,
  location: Location,
  quantityVerified: string,
  condition: string,       // 'good' | 'damaged' | 'partial_loss'
  photos: string[],        // IPFS hashes
  notes: string,
  temperature?: number     // Required for cold-chain shipments
): Promise<string>
```

---

### `assignTransporter()`

Assign a transporter to a shipment.

```typescript
async assignTransporter(
  donorKey: string,
  shipmentId: string,
  transporterAddress: string  // Stellar public key
): Promise<string>
```

---

### `confirmDelivery()`

Record final delivery confirmation from the recipient.

```typescript
async confirmDelivery(
  recipientKey: string,
  shipmentId: string,
  recipientId: string,
  receivedQuantity: string,
  conditionReport: string,
  photos: string[]
): Promise<string>
```

---

### `getShipment()`

```typescript
async getShipment(shipmentId: string): Promise<SupplyShipment | null>
```

---

### `getShipmentHistory()`

```typescript
async getShipmentHistory(shipmentId: string): Promise<{
  shipment: SupplyShipment;
  checkpoints: Checkpoint[];
  totalDistance: number;
  onTimeStatus: boolean;
}>
```

---

### `trackByLocation()`

Find shipments currently within a geographic radius.

```typescript
async trackByLocation(
  latitude: number,
  longitude: number,
  radiusKm: number
): Promise<SupplyShipment[]>
```

---

### `getActiveShipments()`

```typescript
async getActiveShipments(): Promise<SupplyShipment[]>
```

---

### `reportLost()`

```typescript
async reportLost(
  reporterKey: string,
  shipmentId: string,
  reason: string
): Promise<string>
```

---

### `getTemperatureAlerts()`

Returns shipments with temperature violations.

```typescript
async getTemperatureAlerts(): Promise<Array<{ shipmentId: string; alert: string }>>
```

---

### `getShipmentsByDonor()`

```typescript
async getShipmentsByDonor(donorId: string): Promise<SupplyShipment[]>
```

---

### `getShipmentStatistics()`

```typescript
async getShipmentStatistics(shipmentId: string): Promise<{
  totalCheckpoints: number;
  quantityLoss: string;
  deliveryStatus: string;
  onTimeDelivery: boolean;
  temperatureCompliance: boolean;
}>
```

---

### Helper methods

```typescript
// Build a Location object
createLocation(
  latitude: number, longitude: number, address: string,
  facilityName: string, contactPerson: string,
  city: string, country: string, postalCode: string
): Location

// Build temperature requirements
createTemperatureRequirements(
  minTemp: number, maxTemp: number, critical: boolean
): TemperatureRequirements

// Build a full SupplyChainRequest
createSupplyChainRequest(
  donorId: string, supplyType: string, quantity: string, unit: string,
  origin: Location, destination: Location, estimatedArrival: number,
  temperatureRequirements?: TemperatureRequirements,
  specialHandling?: string[]
): SupplyChainRequest

// Estimate arrival time based on transport method
calculateEstimatedArrival(
  origin: Location,
  destination: Location,
  transportMethod: 'air' | 'ground' | 'sea'
): number  // Unix timestamp (ms)
```

---

### `generateShipmentQRCode()` / `validateShipmentQRCode()`

```typescript
generateShipmentQRCode(shipmentId: string, shipment: SupplyShipment): string
async validateShipmentQRCode(qrCodeData: string): Promise<boolean>
```

---

### `buildMultiSigCreateShipment()`

```typescript
async buildMultiSigCreateShipment(
  sourceKey: string,
  request: SupplyChainRequest,
  authorizedSigners: string[],
  threshold: number
): Promise<MultiSigManager>
```

---

## Multi-Signature Signing

`MultiSigManager` coordinates multi-party signing for a single transaction. It is returned by all `buildMultiSig*` methods on every client.

```typescript
import { MultiSigManager } from 'stellar-disaster-relief-sdk';
import type { MultiSigState, MultiSigStatus, MultiSigProgress } from 'stellar-disaster-relief-sdk';
```

---

### `MultiSigManager.create()`

Wrap a built (unsigned) transaction for multi-sig collection.

```typescript
static create(
  tx: Transaction,
  networkPassphrase: string,
  authorizedSigners: string[], // Public keys allowed to sign
  threshold: number            // Minimum signatures required (1 ≤ threshold ≤ signers.length)
): MultiSigManager
```

**Throws:**
- `'authorizedSigners must not be empty'`
- `'threshold must be between 1 and N'`

---

### `addSignature(signerSecretKey)`

Add one signature. Validates authorization and rejects duplicates.

```typescript
addSignature(signerSecretKey: string): MultiSigProgress
```

**Returns** current progress after signing.

**Throws:**
- `'Signer <key> is not authorized for this transaction'`
- `'Signer <key> has already signed this transaction'`
- `'Transaction has already been submitted'`

---

### `isReady()`

Returns `true` when the signature threshold has been met.

```typescript
isReady(): boolean
```

---

### `getProgress()`

Returns UI-ready signing status.

```typescript
getProgress(): MultiSigProgress
```

```typescript
interface MultiSigProgress {
  status: 'pending' | 'ready' | 'submitted';
  collectedSigners: string[];   // Public keys that have signed
  remainingSigners: string[];   // Public keys that have not yet signed
  signaturesRequired: number;
  signaturesCollected: number;
  signaturesRemaining: number;
}
```

---

### `submit(server)`

Submit the fully-signed transaction. Enforces threshold before calling `sendTransaction`.

```typescript
async submit(server: { sendTransaction: (tx: Transaction) => Promise<any> }): Promise<any>
```

**Throws:**
- `'Cannot submit: N more signature(s) required'` — threshold not met
- `'Transaction has already been submitted'` — prevents double-submission

---

### `toState()` / `MultiSigManager.fromState()`

Serialize and restore state for multi-round signing across sessions (e.g. store in a database between signer approvals).

```typescript
toState(): MultiSigState
static fromState(state: MultiSigState): MultiSigManager
```

---

### Full multi-sig example

```typescript
// Step 1: NGO initiates — builds tx and adds first signature
const mgr = await aidClient.buildMultiSigDisbursement(
  process.env.NGO_SECRET_KEY!,
  'earthquake_dr_2024',
  'GBENE...FICIARY',
  '5000',
  'Emergency food',
  [ngoPublicKey, govPublicKey, unPublicKey],
  [ngoPublicKey, govPublicKey, unPublicKey],
  2  // 2-of-3 threshold
);

let progress = mgr.addSignature(process.env.NGO_SECRET_KEY!);
console.log(`${progress.signaturesCollected}/${progress.signaturesRequired} signatures collected`);
// → "1/2 signatures collected"

// Persist state for the next signer
const state = mgr.toState();
await db.save('pending_tx_001', state);

// Step 2: Government signer approves (separate session)
const restored = MultiSigManager.fromState(await db.load('pending_tx_001'));
progress = restored.addSignature(process.env.GOV_SECRET_KEY!);
// → status: 'ready'

// Step 3: Submit
const result = await restored.submit(server);
// result.status === 'SUCCESS'
```

---

## Retry Behavior

All network calls (`server.getAccount`, `server.sendTransaction`, `contract.call`) are automatically retried on transient failures using exponential backoff with full jitter.

> **Note:** Retry is available on the `feat/retry-logic-exponential-backoff` branch and will be merged to `master` in v1.1.0.

### Default configuration

| Parameter     | Default  | Description                          |
|---------------|----------|--------------------------------------|
| `maxAttempts` | `4`      | Total attempts (1 initial + 3 retries) |
| `baseDelayMs` | `200 ms` | Base delay for first retry           |
| `maxDelayMs`  | `10 000 ms` | Maximum delay cap                 |

Delay formula: `random(0, min(baseDelay × 2^attempt, maxDelay))`

### Transient errors (retried)

- Network timeouts, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`
- HTTP `429 Too Many Requests`
- HTTP `5xx` server errors
- Stellar `try_again_later`

### Non-retryable errors (thrown immediately)

- HTTP `401 Unauthorized`, `403 Forbidden`
- HTTP `400 Bad Request`, `404 Not Found`
- Stellar `tx_bad_auth`, `tx_bad_seq`, `op_not_authorized`, `op_no_trust`, `op_underfunded`
- Validation errors, malformed requests

### `RetryExhaustedError`

Thrown when all attempts are exhausted.

```typescript
import { RetryExhaustedError } from 'stellar-disaster-relief-sdk';

try {
  await aidClient.deployEmergencyFund(...);
} catch (err) {
  if (err instanceof RetryExhaustedError) {
    console.error(`Failed after ${err.attempts} attempts:`, err.lastError);
  }
}
```

### Custom retry options (advanced)

```typescript
import { withRetry } from 'stellar-disaster-relief-sdk';

const result = await withRetry(
  () => server.sendTransaction(tx),
  { maxAttempts: 6, baseDelayMs: 500, maxDelayMs: 30_000 }
);
```

---

## Error Handling

All write methods throw `Error` when the transaction fails. Read methods return `null` or `[]` on failure (logged to `console.error`).

### Common error patterns

```typescript
// Write method — throws on failure
try {
  await aidClient.deployEmergencyFund(...);
} catch (err) {
  // err.message contains the Stellar result code, e.g.:
  // "Failed to deploy emergency fund: FAILED"
  // "Failed to deploy emergency fund: tx_bad_auth"
}

// Read method — returns null on failure
const fund = await aidClient.getFund('nonexistent_id');
// fund === null  (error logged internally)

// Multi-sig — throws descriptive errors
try {
  mgr.addSignature(unauthorizedKey);
} catch (err) {
  // "Signer GXXX... is not authorized for this transaction"
}
```

### Stellar result codes

| Code | Meaning | Retryable |
|------|---------|-----------|
| `tx_bad_auth` | Invalid signature | No |
| `tx_bad_seq` | Wrong sequence number (duplicate tx) | No |
| `op_not_authorized` | Signer lacks permission | No |
| `op_underfunded` | Insufficient balance | No |
| `try_again_later` | Network congestion | Yes |

---

## Types Reference

All types are exported from the package root.

```typescript
import type {
  NetworkConfig, EmergencyFund, DisbursementRecord,
  BeneficiaryProfile, VerificationFactor,
  Merchant, MerchantOnboardingRequest, Location,
  ConditionalTransfer, SpendingRule, TransferTransaction, PaymentRequest,
  SupplyShipment, SupplyChainRequest, Checkpoint, TemperatureRequirements,
  MultiSigState, MultiSigStatus, MultiSigProgress,
} from 'stellar-disaster-relief-sdk';
```

### Key types

```typescript
interface NetworkConfig {
  network: 'testnet' | 'mainnet' | 'standalone';
  rpcUrl: string;
  horizonUrl: string;
  contractIds: { platform: string; aidRegistry: string; beneficiaryManager: string;
                 merchantNetwork: string; cashTransfer: string;
                 supplyChainTracker: string; antiFraud: string; };
}

interface EmergencyFund {
  id: string; name: string; description: string;
  totalAmount: string; releasedAmount: string;
  createdAt: number; expiresAt: number;
  disasterType: string; geographicScope: string;
  isActive: boolean; releaseTriggers: string[]; requiredSignatures: number;
}

interface BeneficiaryProfile {
  id: string; name: string; disasterId: string; location: string;
  registrationDate: number; lastVerified: number;
  verificationFactors: VerificationFactor[];
  walletAddress: string; isActive: boolean;
  familySize: number; specialNeeds: string[]; trustScore: number;
}

interface VerificationFactor {
  factorType: string;  // 'possession' | 'behavioral' | 'social'
  value: string;
  weight: number;      // 0–100
  verifiedAt: number;
}

interface ConditionalTransfer {
  id: string; beneficiaryId: string; amount: string; token: string;
  createdAt: number; expiresAt: number;
  spendingRules: SpendingRule[];
  isActive: boolean; spentAmount: string; remainingAmount: string;
  creator: string; purpose: string;
}

interface SpendingRule {
  ruleType: string;                    // 'category_limit' | 'time_window' | 'location_based'
  parameters: Record<string, string>;
  limit: string;
  currentUsage: string;
}

interface SupplyShipment {
  id: string; donorId: string; supplyType: string;
  quantity: string; unit: string;
  origin: Location; destination: Location;
  createdAt: number; estimatedArrival: number;
  currentStatus: string;               // 'in_transit' | 'at_checkpoint' | 'delivered' | 'lost'
  checkpoints: Checkpoint[];
  temperatureRequirements?: TemperatureRequirements;
  specialHandling: string[];
}

interface Location {
  latitude: number; longitude: number; address: string;
  city: string; country: string; postalCode: string;
}
```

### Constants

```typescript
import { DISASTER_TYPES, SUPPLY_TYPES, BUSINESS_TYPES } from 'stellar-disaster-relief-sdk';

DISASTER_TYPES.EARTHQUAKE  // 'earthquake'
DISASTER_TYPES.FLOOD       // 'flood'
DISASTER_TYPES.HURRICANE   // 'hurricane'
DISASTER_TYPES.WILDFIRE    // 'wildfire'
DISASTER_TYPES.DROUGHT     // 'drought'
DISASTER_TYPES.PANDEMIC    // 'pandemic'
DISASTER_TYPES.CONFLICT    // 'conflict'
DISASTER_TYPES.TSUNAMI     // 'tsunami'

SUPPLY_TYPES.FOOD | SUPPLY_TYPES.WATER | SUPPLY_TYPES.MEDICINE | SUPPLY_TYPES.SHELTER
BUSINESS_TYPES.GROCERY | BUSINESS_TYPES.PHARMACY | BUSINESS_TYPES.HARDWARE
```

---

## Security Best Practices

### Private key handling

```typescript
// ✅ Load from environment variables
const adminKey = process.env.ADMIN_SECRET_KEY!;

// ✅ Load from a secrets manager at runtime
const adminKey = await secretsManager.getSecretValue('admin-stellar-key');

// ❌ Never hardcode keys
const adminKey = 'SADMIN_KEY_HERE';  // DO NOT DO THIS

// ❌ Never log keys
console.log('Key:', adminKey);       // DO NOT DO THIS
```

### Multi-sig for high-value operations

Always use multi-sig for fund deployment and disbursements above a threshold:

```typescript
// Single-sig: acceptable for low-value operations (< 1000 XLM)
await transferClient.createTransfer(workerKey, ...);

// Multi-sig: required for fund deployment and large disbursements
const mgr = await aidClient.buildMultiSigDeployFund(
  sourceKey, ..., [ngoKey, govKey, unKey], 2  // 2-of-3
);
```

### Transaction replay protection

Stellar transactions include a sequence number tied to the source account. A transaction cannot be replayed once submitted — the sequence number advances. `MultiSigManager` prevents double-submission by tracking `status: 'submitted'`.

### Key rotation

Rotate signing keys periodically and update the `authorizedSigners` list on-chain via the admin account.

### Testnet vs mainnet

Always test on testnet before mainnet. Use `TESTNET_CONFIG` in development and `MAINNET_CONFIG` only in production. Never use mainnet keys in test environments.

### Spending rule enforcement

Always set spending rules on conditional transfers to prevent misuse:

```typescript
// ✅ Enforce category limits
const rules = [
  transferClient.createCategoryLimitRule('food', '6000'),
  transferClient.createCategoryLimitRule('medical', '3000'),
  transferClient.createTimeWindowRule(Date.now(), expiresAt),
];

// ❌ Avoid unrestricted transfers
const rules = [];  // No limits — avoid in production
```

---

## Changelog

### v1.0.0 (current)

- Initial release with `AidClient`, `BeneficiaryClient`, `MerchantClient`, `TransferClient`, `TrackerClient`
- Soroban smart contract integration via `stellar-sdk` v12
- Biometric-free identity verification
- Conditional cash transfers with spending rules
- Supply chain tracking with temperature monitoring
- QR code and USSD/SMS offline access
- `TESTNET_CONFIG` and `MAINNET_CONFIG` pre-built configurations

### v1.1.0 (planned — `feat/retry-logic-exponential-backoff`)

- Automatic retry with exponential backoff and jitter for all network calls
- `withRetry()` utility for custom retry logic
- `RetryExhaustedError` with attempt count and last error
- Transient vs non-retryable error classification

### v1.2.0 (planned — `feat/multi-sig-transaction-signing`)

- `MultiSigManager` for flexible multi-party transaction signing
- `buildMultiSig*` methods on all write-action clients
- State serialization (`toState` / `fromState`) for multi-round signing
- 2-of-3, 3-of-5, and arbitrary M-of-N threshold support
