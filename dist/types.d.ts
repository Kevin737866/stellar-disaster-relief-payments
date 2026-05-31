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
    factorType: string;
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
    ruleType: string;
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
    currentStatus: string;
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
    condition: string;
    photos: string[];
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
    patternType: string;
    severity: string;
    description: string;
    detectedAt: number;
    entitiesInvolved: string[];
    confidenceScore: number;
    status: string;
    resolutionNotes: string;
}
export interface RiskProfile {
    entityId: string;
    entityType: string;
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
    status: string;
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
    duration: number;
}
export interface QRCodeData {
    type: string;
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
export interface BeneficiaryIdentity {
    idHash: string;
    creationFactors: IdentityFactor[];
    recoveryContacts: string[];
    trustScore: number;
    campLocation: string;
    createdAt: number;
    lastVerified: number;
    walletAddress: string;
    isActive: boolean;
    duressPinHash?: string;
    geofenceZones: GeofenceZone[];
    temporaryCredentials: TemporaryCredential[];
}
export interface IdentityFactor {
    factorType: 'knowledge' | 'possession' | 'social' | 'behavioral' | 'institutional';
    value: string;
    factorHash: string;
    weight: number;
    verifiedAt: number;
    verifier: string | null;
}
export interface TemporaryCredential {
    credentialHash: string;
    createdAt: number;
    expiresAt: number;
    deviceFingerprint: string;
    isActive: boolean;
}
export interface GeofenceZone {
    zoneName: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    isSafe: boolean;
}
export interface SocialRecoveryRequest {
    beneficiaryIdHash: string;
    newWallet: string;
    approvals: string[];
    requiredApprovals: number;
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
    checksum?: string;
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
//# sourceMappingURL=types.d.ts.map