# Stellar Disaster Relief & Emergency Payments Platform

A comprehensive blockchain-based disaster relief platform built on Stellar, providing secure, transparent, and efficient emergency payments and aid distribution for humanitarian organizations.

## 🚀 Overview

The Stellar Disaster Relief Platform leverages Stellar's fast, low-cost blockchain technology to deliver:
- **Rapid emergency fund deployment** with multi-signature security
- **Biometric-free identity verification** for displaced persons
- **Conditional cash transfers** with spending rules and location restrictions
- **Supply chain tracking** for medical and essential supplies
- **Merchant network development** for local economic recovery
- **Multi-sig emergency release** mechanisms for critical situations
- **Offline QR code access** for areas with limited connectivity
- **USSD/SMS fallback** for feature phone users

## 🏗️ Architecture

### Core Components

1. **Soroban Smart Contracts** (Rust)
   - `aid_registry.rs` - Emergency fund management and multi-sig disbursement
   - `beneficiary_manager.rs` - Self-sovereign identity and verification
   - `merchant_network.rs` - Local merchant onboarding and payments
   - `cash_transfer.rs` - Conditional transfers with spending rules
   - `supply_chain_tracker.rs` - Aid shipment tracking with geolocation
   - `anti_fraud.rs` - Pattern detection and fraud prevention

2. **TypeScript SDK**
   - Client libraries for all contract interactions
   - Type-safe interfaces and utilities
   - Network configuration and helper functions

3. **React UI Components**
   - Emergency deployment interface
   - Beneficiary registration and management
   - Merchant network mapping
   - Transfer cards and spending controls
   - Supply tracking dashboard
   - Fraud alert monitoring

4. **Example Implementations**
   - Earthquake response scenarios
   - Refugee camp cash-for-work programs
   - Drought relief water distribution
   - Medical supply chain management
   - Merchant network onboarding

## 🛠️ Installation & Setup

### Prerequisites

- Rust 1.70+ with Soroban CLI
- Node.js 18+ and npm/yarn
- Stellar CLI tools
- Docker (for local testing)

### 1. Clone Repository

```bash
git clone https://github.com/your-org/stellar-disaster-relief-payments.git
cd stellar-disaster-relief-payments
```

### 2. Install Dependencies

```bash
# Install Rust dependencies
cargo build

# Install Node.js dependencies
cd sdk && npm install
cd ../ui && npm install
cd ..
```

### 3. Environment Configuration

Create `.env` files for each component:

```bash
# For contracts
cp .env.example .env

# For SDK
cp sdk/.env.example sdk/.env

# For UI
cp ui/.env.example ui/.env
```

Configure your Stellar network settings:

```env
# Stellar Network Configuration
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Admin Keys (replace with your actual keys)
ADMIN_SECRET_KEY=SADMIN_KEY_HERE
NGO_SECRET_KEY=SNGO_KEY_HERE
GOV_SECRET_KEY=SGOV_KEY_HERE
UN_SECRET_KEY=SUN_KEY_HERE
```

## 🚀 Deployment Guide

### 1. Deploy Smart Contracts

```bash
# Build contracts
soroban contract build

# Deploy to testnet
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/stellar_disaster_relief.wasm --source ADMIN_SECRET_KEY

# Initialize contracts
soroban contract invoke \
  --id CONTRACT_ID \
  --source ADMIN_SECRET_KEY \
  --function initialize \
  --arg ADMIN_PUBLIC_KEY \
  --arg NGO_PUBLIC_KEY \
  --arg GOV_PUBLIC_KEY \
  --arg UN_PUBLIC_KEY
```

### 2. Configure SDK

```bash
cd sdk
npm run build
npm run test
```

### 3. Deploy UI

```bash
cd ui
npm run build
npm run start
```

### 4. Run Examples

```bash
# Earthquake response
npx ts-node examples/earthquake-response.ts

# Refugee camp payments
npx ts-node examples/refugee-camp-payments.ts

# Drought relief
npx ts-node examples/drought-relief.ts

# Medical supply chain
npx ts-node examples/medical-supply-chain.ts

# Merchant onboarding
npx ts-node examples/merchant-onboarding.ts
```

## 📖 Usage Examples

### Emergency Fund Deployment

```typescript
import { createDisasterReliefSDK, TESTNET_CONFIG } from './sdk/src/index';

const sdk = createDisasterReliefSDK(TESTNET_CONFIG);

// Deploy emergency funds
await sdk.aidClient.deployEmergencyFund(
  adminKey,
  'earthquake_response_2024',
  'Earthquake Emergency Response',
  'Rapid response funding for earthquake victims',
  '1000000', // 1M XLM
  'earthquake',
  'Santo Domingo, Dominican Republic',
  Date.now() + (90 * 24 * 60 * 60 * 1000), // 90 days
  [adminKey, ngoKey, govKey],
  2 // 2-of-3 multi-sig
);
```

### Caching Read Operations

The SDK includes a built-in caching layer that reduces redundant blockchain queries and improves response latency:

```typescript
import { ReadCache, TESTNET_CONFIG } from './sdk/src/index';

// Create a cache instance with default 30-second TTL
const cache = new ReadCache(TESTNET_CONFIG);

// Cache a read operation
const beneficiary = await cache.get(
  'beneficiary_DP_001', // cache key
  () => sdk.beneficiaryClient.getBeneficiary('DP_001'), // loader function
  60000 // optional: override TTL to 60 seconds
);

// Invalidate specific cache entry after a state-changing operation
uwait sdk.beneficiaryClient.updateBeneficiary(adminKey, 'DP_001', updates);
cache.invalidate('beneficiary_DP_001');

// Invalidate all entries with a given prefix
cache.invalidatePrefix('beneficiary_'); // clears all beneficiary cache entries

// Clear entire cache
cache.clear();
```

#### Cache Features:
- **Automatic TTL expiration**: Entries automatically expire after TTL (default 30s, configurable)
- **Prefix-based invalidation**: Invalidate multiple related entries efficiently
- **Lazy loading**: Cache only stores requested data on-demand
- **Error resilience**: Loader errors propagate normally; storage failures are silent
- **Per-call TTL override**: Different operations can use different cache durations

#### Best Practices:
- Cache read-heavy operations (e.g., fetching beneficiary info, checking merchant status)
- Invalidate cache entries after write operations that modify cached data
- Use prefix invalidation for related data (e.g., all entries for a disaster)
- Adjust TTL based on data staleness tolerance and query frequency

### Beneficiary Registration

```typescript
// Register displaced person with biometric-free identity
await sdk.beneficiaryClient.registerBeneficiary(
  adminKey,
  'DP_001_FAMILY',
  'Maria Rodriguez Family',
  'earthquake_response_2024',
  'Santo Domingo Centro',
  'GD5...BENEFICIARY1',
  4, // family size
  ['medical', 'elderly_care'],
  [
    { factorType: 'possession', value: 'family_photo_2024', weight: 30 },
    { factorType: 'behavioral', value: 'signature_pattern_001', weight: 40 },
    { factorType: 'social', value: 'neighbor_vouch_juan_garcia', weight: 30 }
  ]
);
```

### Conditional Cash Transfer

```typescript
// Create conditional transfer with spending rules
await sdk.transferClient.createTransfer(
  adminKey,
  'CT_EMERGENCY_001',
  'DP_001_FAMILY',
  '1000', // XLM
  'XLM',
  Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
  [
    sdk.transferClient.createCategoryLimitRule('food', '400'),
    sdk.transferClient.createCategoryLimitRule('medical', '300'),
    sdk.transferClient.createCategoryLimitRule('shelter', '200'),
    sdk.transferClient.createCategoryLimitRule('transport', '100')
  ],
  'Emergency earthquake relief - family of 4'
);
```

### Supply Chain Tracking

```typescript
// Track medical supplies with temperature monitoring
const request = sdk.trackerClient.createSupplyChainRequest(
  'WHO_MEDICAL',
  'medicine',
  '50000',
  'units',
  originLocation,
  destinationLocation,
  Date.now() + (7 * 24 * 60 * 60 * 1000),
  { minTemp: 2, maxTemp: 8, critical: true },
  ['refrigerated', 'medical_supplies']
);

await sdk.trackerClient.createShipment(adminKey, request);
```

## 🔐 Security Features

### Multi-Signature Protection

- **2-of-3 NGO/Government/UN** signatures for fund release
- **3-of-4** for critical medical supplies
- **Time-locked** emergency releases with 24-hour delay

### Identity Verification

- **Biometric-free** verification using behavioral and possession factors
- **Social verification** through community vouching
- **Recovery codes** for account restoration
- **Trust scoring** system based on transaction history

### Fraud Prevention

- **Duplicate registration** detection across regions
- **Suspicious transaction** pattern monitoring
- **Geolocation verification** for merchant and beneficiary access
- **Spending rule enforcement** with category limits

### Access Control

- **Location-based** restrictions for spending
- **Category-based** spending rules
- **Time-based** transfer expiry
- **Multi-factor** authentication for sensitive operations

## 🔒 Privacy Model

This section documents exactly what data is stored on-chain, what is kept off-chain or minimised, who can read each data element, and how the UI export layer handles sensitive fields. Operators and integrators **must** read this before deploying to production.

### Data Classification

| Data Element | Storage Location | Readable By | Notes |
|---|---|---|---|
| Beneficiary ID (opaque string) | On-chain (ledger key) | Any ledger reader | Never contains real name; app-defined opaque token |
| Beneficiary display name | On-chain (`BeneficiaryProfile.name`) | Any ledger reader | Consider using pseudonym or family-unit code in production |
| Disaster ID | On-chain | Any ledger reader | Non-identifying programme identifier |
| Location (camp / city) | On-chain (`BeneficiaryProfile.location`) | Any ledger reader | Use camp-level granularity; avoid precise coordinates |
| Wallet address | On-chain | Any ledger reader | Stellar public key — pseudonymous but linkable |
| Family size | On-chain | Any ledger reader | Aggregated statistic; not personally identifying alone |
| Special needs tags | On-chain | Any ledger reader | Use category codes (e.g. `medical`, `elderly`) not free text |
| Trust score (0–100) | On-chain | Any ledger reader | Computed from behavioural patterns; no raw behaviour stored |
| Verification factor **types & weights** | On-chain (`VerificationFactor`) | Any ledger reader | Only factor type (`possession`, `behavioral`, `social`) and weight |
| Verification factor **raw values** | **Off-chain only** | Registrar / NGO worker | Never stored on-chain; hashed before contract call |
| Identity factor **hash** (`BytesN<32>`) | On-chain (`IdentityFactor.factor_hash`) | Any ledger reader | SHA-256 hash via `sha2` crate; not reversible |
| `id_hash` (`BytesN<32>`) | On-chain (`BeneficiaryIdentity`) | Any ledger reader | SHA-256 of a stable identifier; pseudonymous |
| `duress_pin_hash` | On-chain (optional) | Any ledger reader | SHA-256 hash; raw PIN never stored |
| `device_fingerprint` | On-chain (`TemporaryCredential`) | Any ledger reader | String identifying a shared device; rotate regularly |
| Recovery codes (raw) | **Off-chain only** | Beneficiary | Generated client-side via `crypto-js` SHA-256; only the hash is sent on-chain |
| Recovery code hash | On-chain (`RecoveryCode.code_hash`) | Any ledger reader | SHA-256; expires after use or TTL |
| Merchant name, business type, contact | On-chain (`Merchant`) | Any ledger reader | Merchant data is intentionally public for network discovery |
| Merchant location (lat/lng) | On-chain (`Merchant.location`) | Any ledger reader | Precision stored as integer × 1e6; consider rounding for privacy |
| Transfer ID, amount, token | On-chain (`ConditionalTransfer`) | Any ledger reader | Transfer IDs should be opaque; amounts are public |
| Spending rules (category limits) | On-chain | Any ledger reader | Category codes only; not free-text descriptions |
| Transaction history (per transfer) | On-chain | Any ledger reader | Merchant ID + amount + category are permanently visible |
| Donor name / email (tax receipts) | **Off-chain only** | `DonorTransparencyClient` caller | Never submitted on-chain; stored by caller in local state |
| IPFS media hash (`ProofOfImpact`) | On-chain reference | Any IPFS gateway | Ensure media does not contain identifying images of beneficiaries |
| Export CSV / JSON (UI) | Client-side only | Operator browser session | See Export Privacy section below |

### On-Chain Hashing Algorithms

The following table describes every hashing operation in the stack and the algorithm used:

| Location | Operation | Algorithm | Implementation |
|---|---|---|---|
| `beneficiary_manager.rs` | `IdentityFactor.factor_hash` | SHA-256 | Rust `sha2` crate (`sha2::Sha256`) |
| `beneficiary_manager.rs` | `BeneficiaryIdentity.id_hash` | SHA-256 | Rust `sha2` crate |
| `beneficiary_manager.rs` | `duress_pin_hash` | SHA-256 | Rust `sha2` crate |
| `beneficiary_manager.rs` | `RecoveryCode.code_hash` | SHA-256 | Rust `sha2` crate |
| `sdk/src/beneficiaryClient.ts` | `generateRecoveryCode()` | SHA-256 | `crypto-js` `createHash('sha256')` |
| `sdk/src/beneficiaryClient.ts` | `generateSessionId()` | SHA-256 (truncated) | `crypto-js` `createHash('sha256')` |
| `sdk/src/beneficiaryIdentity.ts` | `hashFactor(value)` | SHA-256 | `crypto-js` `SHA256` |
| `sdk/src/offlineAuth.ts` | QR time-based signature | SHA-256 | `crypto-js` `SHA256` |
| `sdk/src/offlineAuth.ts` | Paper backup code | SHA-256 | `crypto-js` `SHA256` |

> **Alignment note:** All client-side hashing uses SHA-256 via `crypto-js`, matching the SHA-256 algorithm used in the Soroban contracts via the `sha2` crate. Both produce the same digest for identical inputs when encoding is consistent (hex string). No MD5 is used for any security-sensitive operation (only `offlineAuth` imports it but it is not used in live code paths).

### Beneficiary Name Privacy

The `BeneficiaryProfile.name` field is stored as plain text on-chain and is readable by any ledger observer. Operators **should**:

1. Use a family-unit code (e.g. `FAM-DR-0042`) instead of a real full name where local law or programme policy requires it.
2. Store the real name mapping in an off-chain encrypted registry linked to the beneficiary ID.
3. Instruct field agents never to enter birth dates, national ID numbers, or biometric descriptions in the `name` or `location` fields.

The contract's `BeneficiaryIdentity.id_hash` field (`BytesN<32>`) is the pseudonymous on-chain anchor. The raw identifier that was hashed is **never** stored on-chain.

### Device Fingerprint Privacy

`TemporaryCredential.device_fingerprint` is a freeform string stored on-chain and is readable by any ledger observer. Operators **must**:

1. Use a non-identifying device token (e.g. a randomly generated UUID assigned at registration) rather than any hardware serial number, IMEI, or user-agent string.
2. Rotate the device fingerprint when a credential expires or a device is shared.
3. Never include user location, IP address, or browser details in this field.

### QR Payload Privacy

Three distinct QR payload types exist in this codebase. The table below documents what each reveals:

| QR Type | Generator | Fields in Payload | Expiry | Reveals to Scanner |
|---|---|---|---|---|
| **Beneficiary ID QR** (`beneficiaryClient.generateBeneficiaryQRCode`) | `BeneficiaryClient` | `beneficiaryId`, `name`, `disasterId`, `trustScore`, factor types/weights, `timestamp` | None (no expiry field) | Name + trust score readable by anyone with the QR |
| **Offline Auth QR** (`offlineAuth.generateQRCode`) | `OfflineAuthClient` | Shortened `idHash` (16 chars), `timestamp`, `expiresAt`, `trustScore`, `campLocation`, truncated SHA-256 signature | Configurable (default 30 min) | Trust score + camp location; idHash is pseudonymous |
| **Fund QR** (`aidClient.generateFundQRCode`) | `AidClient` | `fundId`, fund `name`, `totalAmount`, `disasterType`, `expiresAt`, `timestamp` | Inherits fund expiry | Fund financial details readable by anyone |
| **Transfer QR** (`transferClient.generateTransferQRCode`) | `TransferClient` | `transferId`, `beneficiaryId`, `amount`, `remainingAmount`, `token`, `purpose`, spending rule types/limits, `expiresAt`, `timestamp` | Transfer expiry | Remaining balance + beneficiary ID visible to scanner |
| **Merchant static QR** (`merchantNetwork.generateQRCode`) | `MerchantNetworkSDK` | `merchantId`, `category`, `latitude`, `longitude`, `name` | None | Merchant location + identity; intentionally public |
| **Transaction QR** (`merchantNetwork.generateTransactionQR`) | `MerchantNetworkSDK` | `merchantId`, `amount`, `transferCode`, `timestamp` | Short-lived (use immediately) | Payment amount visible to anyone scanning |

**Recommended minimisation actions:**
- `generateBeneficiaryQRCode`: Remove `name` from the payload; the scanner should look up the name on-chain after verifying the beneficiary ID. Add a short expiry (`expiresAt`) to prevent stale QR reuse.
- `generateTransferQRCode`: Remove `remainingAmount` from the payload; it exposes current balance. The merchant should query the contract after scanning.
- `offlineAuth.generateQRCode`: Already minimised and expiry-scoped — this is the reference implementation.

### Export Privacy

The UI export layer (`ui/src/export/`) writes data to CSV or JSON files downloaded to the operator's browser. The following fields in exported datasets contain sensitive information:

| Export Dataset | Sensitive Fields | Risk | Recommendation |
|---|---|---|---|
| `conditionalTransferFields` | `beneficiaryId`, `amount`, `remainingAmount` | Links individual to balance | Restrict export to authorised NGO staff only; log all export events |
| `transferTransactionFields` | `merchantId`, `beneficiaryId`, `amount`, `location` | Full spending history per person | Treat as PII under GDPR/humanitarian data standards |
| `disbursementFields` | `beneficiary`, `amount`, `approvedBy` | Identifies who received what | Same as above |
| `merchantFields` | `latitude`, `longitude`, `contactInfo`, `owner` | Precise merchant location | Round lat/lng to 2 decimal places for public exports |
| `emergencyFundFields` | `totalAmount`, `releasedAmount` | Fund depletion timing | Low risk; suitable for donor reports |

Operators **must** ensure export files are:
1. Transmitted only over encrypted channels (TLS 1.2+).
2. Stored in access-controlled systems with audit logging.
3. Deleted after the retention period required by applicable humanitarian data standards (e.g. ICRC Data Protection Rules, OCHA Data Responsibility Guidelines).
4. Never published publicly or shared with unauthorised third parties.

### Off-Chain Data Responsibilities

The following data is explicitly **not** stored on-chain and must be managed by the operator in a secure off-chain system:

- Real names mapped to beneficiary IDs
- Raw verification factor values (possession items, social voucher identities)
- Donor names, emails, and tax receipt details
- Field worker credentials and login sessions
- Media files referenced by IPFS hashes in `ProofOfImpact`
- SMS phone numbers used for USSD sessions

---

## 🌍 Humanitarian Principles

This platform is designed with core humanitarian principles:

1. **Humanity** - Prioritizing human dignity and needs
2. **Impartiality** - Providing aid based on need alone
3. **Neutrality** - Remaining independent of political, economic, or military objectives
4. **Independence** - Maintaining autonomy from political pressures

### Do No Harm

- **Privacy protection** for beneficiary data
- **Cultural sensitivity** in identity verification
- **Local economic support** through merchant networks
- **Environmental consideration** in supply chain choices

### Participation & Protection

- **Community involvement** in verification processes
- **Beneficiary consent** for data collection
- **Child protection** protocols in registration
- **Gender-sensitive** approach to aid distribution

## 📱 Mobile & Offline Access

### USSD/SMS Support

```typescript
// Create USSD session for feature phone users
const session = sdk.beneficiaryClient.createUSSDSession('+254-7-123-4567');

// Process USSD transaction
await sdk.beneficiaryClient.processUSSDTransaction(
  sessionId,
  'CHECK_BALANCE',
  'DP_001_FAMILY'
);
```

### QR Code Generation

```typescript
// Generate offline QR code for beneficiary
const qrCode = sdk.beneficiaryClient.generateBeneficiaryQRCode(
  'DP_001_FAMILY',
  beneficiaryData
);

// QR code contains: beneficiary ID, verification factors, balance, spending rules
```

### SMS Notifications

```typescript
// Configure SMS alerts
await sdk.beneficiaryClient.configureSMSAlerts(
  'DP_001_FAMILY',
  '+254-7-123-4567',
  ['payment_received', 'balance_low', 'transfer_expiry']
);
```

## 🏢 NGO Integration Guide

### Step 1: Organization Setup

1. **Register your organization** on the platform
2. **Configure multi-sig keys** for fund management
3. **Set up verification procedures** for staff
4. **Configure reporting requirements**

### Step 2: Staff Training

- **Field agent training** for beneficiary registration
- **Merchant onboarding** procedures
- **Fraud detection** protocols
- **Emergency response** procedures

### Step 3: Program Implementation

1. **Deploy emergency funds** for your target region
2. **Register beneficiaries** using biometric-free verification
3. **Onboard local merchants** for economic recovery
4. **Set up supply chain tracking** for essential supplies
5. **Configure monitoring** and reporting systems

### Step 4: Monitoring & Reporting

```typescript
// Generate NGO reports
const report = await sdk.aidClient.generateNGOReport(
  ngoId,
  startDate,
  endDate,
  ['funds_deployed', 'beneficiaries_served', 'merchants_active']
);
```

## 📊 Analytics & Reporting

### Real-time Dashboards

- **Fund deployment** tracking
- **Beneficiary registration** statistics
- **Merchant network** activity
- **Supply chain** visibility
- **Fraud detection** alerts

### Custom Reports

```typescript
// Custom beneficiary impact report
const impactReport = await sdk.beneficiaryClient.generateImpactReport(
  regionId,
  {
    demographics: true,
    spending_patterns: true,
    satisfaction_scores: true,
    economic_impact: true
  }
);
```

### Data Export

- **CSV export** for financial reporting
- **PDF reports** for donor communication
- **API access** for integration with existing systems
- **Scheduled reports** for regular monitoring

## 🌐 Network Configuration

### Testnet Configuration

```typescript
import { TESTNET_CONFIG } from './sdk/src/index';

// Testnet is pre-configured for development
const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
```

### Mainnet Configuration

```typescript
import { MAINNET_CONFIG } from './sdk/src/index';

// Mainnet configuration for production
const sdk = createDisasterReliefSDK(MAINNET_CONFIG);
```

### Custom Network

```typescript
const customConfig = {
  network: 'custom',
  rpcUrl: 'https://your-soroban-node.com',
  horizonUrl: 'https://your-horizon-instance.com',
  networkPassphrase: 'Your Custom Network',
  contracts: {
    aidRegistry: 'YOUR_AID_REGISTRY_CONTRACT_ID',
    beneficiaryManager: 'YOUR_BENEFICIARY_CONTRACT_ID',
    merchantNetwork: 'YOUR_MERCHANT_CONTRACT_ID',
    cashTransfer: 'YOUR_TRANSFER_CONTRACT_ID',
    supplyChainTracker: 'YOUR_TRACKER_CONTRACT_ID',
    antiFraud: 'YOUR_ANTIFRAUD_CONTRACT_ID'
  }
};

const sdk = createDisasterReliefSDK(customConfig);
```

## 🧪 Testing

### Unit Tests

```bash
# Run contract tests
cargo test

# Run SDK tests
cd sdk && npm test

# Run UI tests
cd ui && npm test
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e
```

### Test Scenarios

- **Emergency fund deployment** and multi-sig release
- **Beneficiary registration** and verification
- **Conditional transfers** with spending rules
- **Supply chain tracking** with temperature alerts
- **Fraud detection** and prevention
- **Offline access** via QR codes
- **USSD/SMS fallback** functionality

## 📚 API Documentation

### Core SDK Methods

#### Aid Registry Client

```typescript
// Deploy emergency fund
deployEmergencyFund(adminKey, fundId, name, description, amount, disasterType, location, expiresAt, signers, threshold)

// Trigger multi-sig disbursement
triggerDisbursement(signerKey, fundId, amount, recipient, purpose)

// Get fund statistics
getFundStatistics(fundId)

// List active funds
listActiveFunds()
```

#### Beneficiary Client

```typescript
// Register beneficiary
registerBeneficiary(adminKey, beneficiaryId, name, disasterId, location, walletAddress, familySize, specialNeeds, verificationFactors)

// Verify beneficiary
verifyBeneficiary(adminKey, beneficiaryId, verified, notes)

// Get beneficiary details
getBeneficiary(beneficiaryId)

// Generate QR code
generateBeneficiaryQRCode(beneficiaryId, beneficiaryData)
```

#### Transfer Client

```typescript
// Create conditional transfer
createTransfer(adminKey, transferId, beneficiaryId, amount, token, expiresAt, spendingRules, purpose)

// Process spending
spend(beneficiaryKey, transferId, merchantId, amount, category, location)

// Get transfer details
getTransfer(transferId)

// List beneficiary transfers
listBeneficiaryTransfers(beneficiaryId)
```

#### Transaction Poller

```typescript
// Wait for a transaction to reach a terminal completion state
pollTransactionStatus(hash, { intervalMs, timeoutMs })

// Alias for pollTransaction
pollTransaction(hash, { intervalMs, timeoutMs })
```

#### Merchant Client

```typescript
// Register merchant
registerMerchant(adminKey, merchantId, onboardingRequest)

// Verify merchant
verifyMerchant(adminKey, merchantId, verified, notes)

// Process payment
processPayment(merchantKey, transferId, amount, category)

// Get merchant details
getMerchant(merchantId)
```

#### Tracker Client

```typescript
// Create shipment
createShipment(adminKey, supplyChainRequest)

// Update checkpoint
updateCheckpoint(adminKey, shipmentId, location, status, notes)

// Confirm delivery
confirmDelivery(adminKey, shipmentId, recipientId, condition, notes)

// Get shipment history
getShipmentHistory(shipmentId)
```

## 🤝 Contributing

We welcome contributions from the humanitarian and blockchain communities!

### Development Setup

1. **Fork the repository**
2. **Create a feature branch**
3. **Write tests for your changes**
4. **Ensure all tests pass**
5. **Submit a pull request**

### Code Guidelines

- **Rust**: Follow `rustfmt` and `clippy` recommendations
- **TypeScript**: Use ESLint and Prettier configurations
- **React**: Follow React best practices and accessibility guidelines
- **Documentation**: Update README and API docs for all changes

### Security Considerations

- **Never commit private keys** or sensitive configuration
- **Use environment variables** for all secrets
- **Follow security best practices** for blockchain development
- **Audit smart contracts** before mainnet deployment

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Technical Support

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Check the API documentation
- **Community**: Join our Discord server

### Humanitarian Support

- **NGO Onboarding**: Contact our partnerships team
- **Training Programs**: Request staff training sessions
- **Emergency Response**: 24/7 support for active deployments

### Contact Information

- **Email**: support@stellar-disaster-relief.org
- **Discord**: https://discord.gg/stellar-relief
- **Documentation**: https://docs.stellar-disaster-relief.org
- **Emergency Hotline**: +1-555-RELIEF-HELP

## 🌟 Acknowledgments

- **Stellar Development Foundation** for blockchain infrastructure
- **UN OCHA** for humanitarian guidance and principles
- **WHO** for medical supply chain standards
- **UNICEF** for child protection protocols
- **Red Cross** for emergency response best practices
- **Humanitarian OpenStreetMap Team** for mapping integration

## 🚀 Roadmap

### Q1 2024
- [x] Core smart contract development
- [x] TypeScript SDK implementation
- [x] React UI components
- [x] Example implementations
- [ ] Mainnet deployment
- [ ] Mobile app development

### Q2 2024
- [ ] Advanced fraud detection AI
- [ ] Predictive analytics for disaster response
- [ ] Integration with UN OCHA systems
- [ ] Multi-language support
- [ ] Advanced reporting dashboards

### Q3 2024
- [ ] Satellite connectivity integration
- [ ] Biometric integration (optional)
- [ ] Advanced supply chain optimization
- [ ] NGO partnership program
- [ ] Certification program

### Q4 2024
- [ ] Global disaster response network
- [ ] AI-powered beneficiary matching
- [ ] Advanced economic recovery tools
- [ ] Climate resilience integration
- [ ] Impact measurement framework

---

**Built with ❤️ for the global humanitarian community**

*Using blockchain technology to deliver aid more efficiently, transparently, and securely to those who need it most.*
