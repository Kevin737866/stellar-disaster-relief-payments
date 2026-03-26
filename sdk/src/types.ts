export interface BeneficiaryProfile {
  id: string;
  name: string;
  disasterId: string;
  location: string;
  registrationDate: number;
  lastVerified: number;
  verificationFactors: VerificationFactor[];
  walletAddress: string;
  isActive: boolean;
  familySize: number;
  specialNeeds: string[];
  trustScore: number;
}

export interface VerificationFactor {
  factorType: string; // "possession", "behavioral", "social"
  value: string;
  weight: number;
  verifiedAt: number;
}

export interface RecoveryCode {
  beneficiaryId: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  isUsed: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  owner: string;
  businessType: string;
  location: Location;
  contactInfo: string;
  registrationDate: number;
  isVerified: boolean;
  verificationDocuments: string[];
  stellarTomlUrl: string;
  acceptedTokens: string[];
  dailyLimit: string;
  monthlyLimit: string;
  currentMonthVolume: string;
  reputationScore: number;
  isActive: boolean;
}

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  country: string;
  postalCode: string;
}

export interface Transaction {
  id: string;
  merchantId: string;
  beneficiaryId: string;
  amount: string;
  token: string;
  timestamp: number;
  purpose: string;
  merchantSignature: string;
  beneficiarySignature: string;
  isSettled: boolean;
}

export interface EmergencyFund {
  id: string;
  name: string;
  description: string;
  totalAmount: string;
  releasedAmount: string;
  createdAt: number;
  expiresAt: number;
  disasterType: string;
  geographicScope: string;
  isActive: boolean;
  releaseTriggers: string[];
  requiredSignatures: number;
}

export interface DisbursementRecord {
  id: string;
  fundId: string;
  beneficiary: string;
  amount: string;
  timestamp: number;
  purpose: string;
  approvedBy: string[];
  transactionHash: string;
}

export interface ConditionalTransfer {
  id: string;
  beneficiaryId: string;
  amount: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  spendingRules: SpendingRule[];
  isActive: boolean;
  spentAmount: string;
  remainingAmount: string;
  creator: string;
  purpose: string;
}

export interface SpendingRule {
  ruleType: string; // "category_limit", "merchant_whitelist", "time_window", "location_based"
  parameters: Record<string, string>;
  limit: string;
  currentUsage: string;
}

export interface TransferTransaction {
  id: string;
  transferId: string;
  merchantId: string;
  amount: string;
  category: string;
  timestamp: number;
  location: string;
  isApproved: boolean;
  rejectionReason: string;
}

export interface SupplyShipment {
  id: string;
  donorId: string;
  supplyType: string;
  quantity: string;
  unit: string;
  origin: Location;
  destination: Location;
  createdAt: number;
  estimatedArrival: number;
  currentStatus: string; // "in_transit", "at_checkpoint", "delivered", "lost"
  checkpoints: Checkpoint[];
  assignedTransporter?: string;
  temperatureRequirements?: TemperatureRequirements;
  specialHandling: string[];
}

export interface Checkpoint {
  id: string;
  location: Location;
  timestamp: number;
  verifiedBy: string;
  quantityVerified: string;
  condition: string; // "good", "damaged", "partial_loss"
  photos: string[]; // IPFS hashes
  notes: string;
  temperature?: number;
}

export interface TemperatureRequirements {
  minTemp: number;
  maxTemp: number;
  critical: boolean;
}

export interface RecipientConfirmation {
  shipmentId: string;
  recipientId: string;
  receivedQuantity: string;
  receivedAt: number;
  conditionReport: string;
  confirmedBy: string;
  photos: string[];
}

export interface FraudPattern {
  id: string;
  patternType: string; // "duplicate_registration", "suspicious_transactions", "velocity_check"
  severity: string; // "low", "medium", "high", "critical"
  description: string;
  detectedAt: number;
  entitiesInvolved: string[];
  confidenceScore: number;
  status: string; // "detected", "investigating", "resolved", "false_positive"
  resolutionNotes: string;
}

export interface RiskProfile {
  entityId: string;
  entityType: string; // "beneficiary", "merchant", "donor"
  riskScore: number;
  lastUpdated: number;
  riskFactors: RiskFactor[];
  flaggedTransactions: number;
  totalTransactions: number;
}

export interface RiskFactor {
  factorType: string;
  weight: number;
  value: string;
  detectedAt: number;
}

export interface SuspiciousTransaction {
  id: string;
  transactionHash: string;
  beneficiaryId: string;
  merchantId: string;
  amount: string;
  timestamp: number;
  riskScore: number;
  alertReasons: string[];
  status: string; // "flagged", "reviewed", "cleared", "blocked"
  reviewer?: string;
  reviewNotes: string;
}

export interface DisasterResponseConfig {
  disasterId: string;
  disasterType: string;
  affectedArea: string;
  estimatedAffected: number;
  responseTeam: string[];
  budget: string;
  duration: number; // days
}

export interface QRCodeData {
  type: string; // "beneficiary_id", "transfer", "recovery"
  data: string;
  expiresAt: number;
  signature: string;
}

export interface USSDSession {
  sessionId: string;
  phoneNumber: string;
  beneficiaryId?: string;
  currentStep: string;
  data: Record<string, string>;
  lastActivity: number;
}

export interface NetworkConfig {
  network: "testnet" | "mainnet" | "standalone";
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

export interface DeploymentOptions {
  network: "testnet" | "mainnet";
  adminKey: string;
  ngoSigner: string;
  govSigner: string;
  unSigner: string;
}

export interface PaymentRequest {
  beneficiaryId: string;
  merchantId: string;
  amount: string;
  token: string;
  purpose: string;
  location?: string;
}

export interface VerificationRequest {
  beneficiaryId: string;
  providedFactors: VerificationFactor[];
  verifierId: string;
}

export interface MerchantOnboardingRequest {
  name: string;
  businessType: string;
  location: Location;
  contactInfo: string;
  stellarTomlUrl: string;
  acceptedTokens: string[];
  dailyLimit: string;
  monthlyLimit: string;
  verificationDocuments: string[];
}

export interface SupplyChainRequest {
  donorId: string;
  supplyType: string;
  quantity: string;
  unit: string;
  origin: Location;
  destination: Location;
  estimatedArrival: number;
  temperatureRequirements?: TemperatureRequirements;
  specialHandling: string[];
}

// Biometric-Free Identity System Types

export interface BeneficiaryIdentity {
  idHash: string; // Pseudonymous identifier (never real name)
  creationFactors: IdentityFactor[];
  recoveryContacts: string[]; // Stellar addresses
  trustScore: number; // 0-100 based on behavioral patterns
  campLocation: string;
  createdAt: number;
  lastVerified: number;
  walletAddress: string;
  isActive: boolean;
  duressPinHash?: string; // Fake PIN for safety
  geofenceZones: GeofenceZone[];
  temporaryCredentials: TemporaryCredential[];
}

export interface IdentityFactor {
  factorType: 'knowledge' | 'possession' | 'social' | 'behavioral' | 'institutional';
  value: string; // Actual value (hashed before storage)
  factorHash: string; // Hashed value for privacy
  weight: number; // Importance weight (0-100)
  verifiedAt: number;
  verifier: string | null; // NGO worker or community member address
}

export interface TemporaryCredential {
  credentialHash: string;
  createdAt: number;
  expiresAt: number;
  deviceFingerprint: string; // For shared device tracking
  isActive: boolean;
}

export interface GeofenceZone {
  zoneName: string;
  latitude: number; // Scaled by 1e6 for precision
  longitude: number;
  radiusMeters: number;
  isSafe: boolean;
}

export interface SocialRecoveryRequest {
  beneficiaryIdHash: string;
  newWallet: string;
  approvals: string[]; // Addresses of approving contacts
  requiredApprovals: number; // Threshold (e.g., 3 of 5)
  createdAt: number;
  expiresAt: number;
  isCompleted: boolean;
}

export interface OfflineAuthCode {
  type: 'qr' | 'paper' | 'sms';
  code: string;
  idHash: string;
  expiresAt: number;
  signature: string;
  checksum?: string; // For paper codes
}

export interface BluetoothMeshNode {
  nodeId: string;
  publicKey: string;
  lastSeen: number;
  trustScore: number;
  location: string;
}

export interface PaperBackupCode {
  code: string;
  checksum: string;
  createdAt: number;
  instructions: string;
}
