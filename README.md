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
