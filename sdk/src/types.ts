export interface BeneficiaryProfile {
  id: string;
  name: string;
  disasterId: string;
  location: string;
  registrationDate: number;
  lastVerified: number;
  /** Reference to the canonical identity (Some if identity created, None if not yet) */
  identityHash: string | null;
  /** Only operational factors for spending/transfers (not full identity factors) */
  verificationFactors: VerificationFactor[];
  isActive: boolean;
  familySize: number;
  specialNeeds: string[];
  /** @deprecated Use identity.trustScore via getIdentity(identityHash) */
  trustScore: number;
  /** @deprecated Use identity.walletAddress via getIdentity(identityHash) */
  walletAddress: string;
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
  facilityName?: string;
  contactPerson?: string;
}

/** Offset pagination options for merchant listing endpoints. */
export interface MerchantPaginationOptions {
  /** Number of matching records to skip. Defaults to 0. */
  offset?: number;
  /** Page size (1–100). Defaults to 20. */
  limit?: number;
}

/** A bounded page of merchants plus the total matching count. */
export interface PaginatedMerchants {
  merchants: Merchant[];
  totalCount: number;
  hasMore: boolean;
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
  metadata: Record<string, string>;
}

// ─── Disbursement purpose taxonomy ───────────────────────────────────────────

/**
 * Canonical reporting categories for disbursement purposes.
 *
 * The contract continues to store the operator-entered `purpose` string for
 * auditability, but every purpose is mapped to one of these categories so that
 * reporting, duplicate-intent detection and guardrails do not depend on
 * free-text spelling.
 */
export const DISBURSEMENT_PURPOSE_CATEGORIES = [
  'food',
  'water',
  'shelter',
  'medical',
  'education',
  'livelihoods',
  'protection',
  'logistics',
  'administration',
  'other',
] as const;

export type DisbursementPurposeCategory =
  (typeof DISBURSEMENT_PURPOSE_CATEGORIES)[number];

/** Maximum accepted length of the free-text purpose field. */
export const PURPOSE_MAX_LENGTH = 120;

/** Result of classifying a free-text purpose. */
export interface PurposeClassification {
  /** The original, untrimmed value supplied by the caller. */
  raw: string;
  /** Lower-cased, underscore-normalised value. */
  normalized: string;
  /** Canonical category used for aggregation and policy. */
  category: DisbursementPurposeCategory;
  /** True when `normalized` is itself a canonical category name. */
  isCanonical: boolean;
}

export interface DisbursementRecord {
  id: string;
  fundId: string;
  beneficiary: string;
  amount: string;
  timestamp: number;
  purpose: string;
  /** Derived classification; not required to be persisted on-chain. */
  purposeCategory?: DisbursementPurposeCategory;
  approvedBy: string[];
  transactionHash: string;
}

/**
 * Maximum number of operations in one batch transaction and entries in one
 * batch disbursement. Matches Stellar's 100-operation limit and the on-chain
 * `MAX_BATCH_SIZE` in `src/aid_registry.rs`.
 */
export const BATCH_MAX_SIZE = 100;

/** A single entry within a batch disbursement request */
export interface BatchDisbursementEntry {
  beneficiary: string;
  amount: string;
  purpose: string;
  /** Optional explicit category; defaults to the classifier result. */
  purposeCategory?: DisbursementPurposeCategory;
}

/** Result returned after submitting a batch disbursement */
export interface BatchDisbursementResult {
  success: boolean;
  fundId: string;
  disbursementIds: string[];
  totalAmount: string;
  count: number;
  transactionHash?: string;
  error?: string;
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
  /** Default TTL in milliseconds for cached read results. Defaults to 30 000. */
  cacheTtlMs?: number;
  contractIds: {
    platform: string;
    aidRegistry: string;
    beneficiaryManager: string;
    merchantNetwork: string;
    cashTransfer: string;
    supplyChainTracker: string;
    antiFraud: string;
  };
  /** Optional logging configuration. Defaults to level='info', destination='console'. */
  logging?: import('./logger').LoggingConfig;
}

/** Contract slots that can be targeted by batch/upgrade clients. */
export type ContractTarget = keyof NetworkConfig['contractIds'];

/** A single contract invocation within a batch. */
export interface BatchContractCall {
  contractTarget: ContractTarget;
  method: string;
  args: any[];
}

/** Request to execute multiple contract calls atomically. */
export interface BatchExecuteRequest {
  calls: BatchContractCall[];
  signerKey: string;
}

/** Per-call result returned by BatchClient. */
export interface BatchCallResult {
  index: number;
  success: boolean;
  returnValue?: unknown;
  error?: string;
}

/** Result of a batch execution. */
export interface BatchExecuteResult {
  transactionHash: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  results: BatchCallResult[];
  ledger?: number;
}

/** Request to upgrade an already-deployed contract. */
export interface ContractUpgradeRequest {
  target: ContractTarget;
  /** 32-byte WASM hash encoded as 64 hex chars or base64. */
  newWasmHash: string;
  adminKey: string;
}

/** Result of a contract upgrade. */
export interface ContractUpgradeResult {
  contractId: string;
  transactionHash: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  ledger?: number;
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
  category?: string;
}

export interface VerificationRequest {
  beneficiaryId: string;
  providedFactors: VerificationFactor[];
  verifierId: string;
}

export interface MerchantOnboardingRequest {
  name: string;
  businessType: string;
  /** Merchant category numeric code (e.g. 0 = food, 1 = water, 2 = shelter, 3 = medical). */
  category: number;
  /** Geographic coordinates as a "lat,lng" string, e.g. "18.4861,-69.9312". */
  locationLatLng: string;
  locationAddress: string;
  locationCity: string;
  locationCountry: string;
  locationPostalCode: string;
  contactInfo: string;
  acceptedTokens: string[];
  /**
   * Community vouching references: three beneficiary IDs or one NGO field-worker ID.
   * Required for standard onboarding; can be empty for emergency fast-track.
   */
  vouchers: string[];
  /**
   * When true the merchant is pre-approved from an existing network and
   * receives immediate STATUS_ACTIVE with a higher daily limit.
   */
  emergencyFastTrack: boolean;
}

export interface SupplyChainRequest {
  donorId: string;
  supplyType: string;
  quantity: string;
  unit: string;
  /** Origin coordinates as "lat,lng" string, e.g. "18.4861,-69.9312". */
  originLatLng: string;
  originAddress: string;
  originFacility: string;
  originContact: string;
  /** Destination coordinates as "lat,lng" string. */
  destinationLatLng: string;
  destinationAddress: string;
  destinationFacility: string;
  destinationContact: string;
  estimatedArrival: number;
  /**
   * Temperature requirements for cold-chain shipments.
   * Pass `null` or `undefined` when not required; the SDK serialises it to
   * the Soroban `Option::None` / `Option::Some(...)` shape accordingly.
   */
  temperatureRequirements?: TemperatureRequirements | null;
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
  /** Associated disbursement IDs for audit trail */
  disbursementIds: string[];
  /** Associated transfer IDs for audit trail */
  transferIds: string[];
}

/** Complete beneficiary view combining profile + identity (single source of truth) */
export interface BeneficiaryComplete {
  profile: BeneficiaryProfile;
  identity: BeneficiaryIdentity | null;
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
  challengeId?: string; // Explicit challenge identifier for single-use replay prevention (#323)
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

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Opaque cursor string returned by paginated endpoints. */
export type PaginationCursor = string;

/** Generic paginated response wrapper. */
export interface PaginatedResponse<T> {
  /** Items in this page. */
  items: T[];
  /**
   * Cursor to pass as `cursor` in the next request.
   * `null` means there are no more pages.
   */
  nextCursor: PaginationCursor | null;
  /** Convenience flag – true when `nextCursor` is non-null. */
  hasMore: boolean;
}

/** Options accepted by paginated list methods. */
export interface PaginationOptions {
  /** Cursor from the previous page's `nextCursor`. Omit for the first page. */
  cursor?: PaginationCursor;
  /**
   * Maximum number of items to return.
   * Must be between 1 and 100 (inclusive). Defaults to 20.
   */
  limit?: number;
}

/** Options for `BeneficiaryClient.searchBeneficiaries`. */
export interface BeneficiarySearchOptions extends PaginationOptions {
  /** Free-text search across name / location (max 200 chars). */
  search?: string;
  /** Restrict results to a location substring. */
  locationFilter?: string;
  /** When true (default), only active beneficiaries are returned. */
  activeOnly?: boolean;
  /** Minimum trust score (0–100). */
  minTrustScore?: number;
}

/** Options for `BeneficiaryClient.searchFunds`. */
export interface FundSearchOptions {
  /** Free-text search across name / description (max 200 chars). */
  search?: string;
  /** Restrict to a disaster type. */
  disasterType?: string;
  /** When true, only active funds are returned. */
  activeOnly?: boolean;
  /** Lower bound (unix seconds); 0 means unbounded. */
  createdAfter?: number;
  /** Upper bound (unix seconds); 0 means unbounded. */
  createdBefore?: number;
}
