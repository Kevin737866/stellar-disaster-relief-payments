export declare const CATEGORY_FOOD = 0;
export declare const CATEGORY_WATER = 1;
export declare const CATEGORY_SHELTER = 2;
export declare const CATEGORY_MEDICAL = 3;
export declare const CATEGORY_CLOTHING = 4;
export declare const CATEGORY_FUEL = 5;
export declare const STATUS_PENDING = 0;
export declare const STATUS_TRIAL = 1;
export declare const STATUS_ACTIVE = 2;
export declare const STATUS_SUSPENDED = 3;
export declare const STATUS_GRADUATED = 4;
export declare const PAYMENT_QR = 0;
export declare const PAYMENT_USSD = 1;
export declare const PAYMENT_NFC = 2;
export declare const PAYMENT_OFFLINE = 3;
export declare const PAYMENT_ONLINE = 4;
export interface MerchantProfile {
    name: string;
    businessType: string;
    category: number;
    location: Location;
    contactInfo: string;
    acceptedTokens: string[];
    emergencyFastTrack: boolean;
}
export interface Location {
    latitude: number;
    longitude: number;
    address: string;
    city: string;
    country: string;
    postalCode: string;
}
export interface Merchant {
    id: string;
    name: string;
    owner: string;
    businessType: string;
    category: number;
    location: Location;
    contactInfo: string;
    registrationDate: number;
    status: number;
    isVerified: boolean;
    verificationDocuments: string[];
    vouchers: string[];
    vouchingThreshold: number;
    currentVouches: number;
    trialStartDate: number;
    trialEndDate: number;
    trialDailyLimit: string;
    dailyVolumeLimit: string;
    monthlyLimit: string;
    currentMonthVolume: string;
    currentDayVolume: string;
    lastResetDate: number;
    reputationScore: number;
    isActive: boolean;
    emergencyFastTrack: boolean;
    acceptsQr: boolean;
    acceptsUssd: boolean;
    acceptsNfc: boolean;
    acceptsOffline: boolean;
    pendingSettlement: string;
    lastSettlementDate: number;
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
    paymentMethod: number;
}
export interface OfflineTransaction {
    id: string;
    merchantId: string;
    beneficiaryId: string;
    amount: string;
    token: string;
    timestamp: number;
    purpose: string;
    signature: string;
    isSynced: boolean;
}
export interface FraudAlert {
    id: string;
    merchantId: string;
    alertType: string;
    severity: number;
    description: string;
    timestamp: number;
    isResolved: boolean;
}
export interface Settlement {
    id: string;
    merchantId: string;
    amount: string;
    token: string;
    timestamp: number;
    transactionCount: number;
}
export interface MerchantStats {
    reputationScore: number;
    currentDayVolume: string;
    currentMonthVolume: string;
    currentVouches: number;
}
export interface QRCodeData {
    merchantId: string;
    category: number;
    latitude: number;
    longitude: number;
    name: string;
}
export interface TransactionQRData {
    merchantId: string;
    amount: string;
    transferCode: string;
    timestamp: number;
}
export declare class MerchantNetworkSDK {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Register a merchant with simplified onboarding (community vouching)
     * Target: < 15 minutes onboarding time
     */
    registerMerchant(ownerKey: string, merchantId: string, profile: MerchantProfile, references: string[]): Promise<string>;
    /**
     * Add community vouches for merchant (3 beneficiaries or 1 NGO worker)
     */
    addVouch(voucherKey: string, merchantId: string, voucherType: number): Promise<string>;
    /**
     * Process payment from beneficiary to merchant
     * Sub-3 second processing for online, < 1 hour for offline sync
     */
    processPayment(merchantKey: string, beneficiaryKey: string, merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string, paymentMethod?: number): Promise<string>;
    /**
     * Process offline payment (batched and synced when connectivity returns)
     */
    processOfflinePayment(merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string, signature: string): Promise<string>;
    /**
     * Sync offline transactions (when connectivity returns)
     */
    syncOfflineTransactions(merchantKey: string, merchantId: string, offlineTransactionIds: string[]): Promise<number>;
    /**
     * Get fraud alerts for a merchant
     */
    getFraudAlerts(merchantId: string): Promise<FraudAlert[]>;
    /**
     * Daily automatic settlement to merchant wallets
     */
    settleBalances(adminKey: string): Promise<number>;
    /**
     * Review trial merchant for graduation
     */
    reviewTrialMerchant(adminKey: string, merchantId: string, approve: boolean): Promise<string>;
    /**
     * Generate static QR code for shop
     */
    generateQRCode(merchantId: string): Promise<QRCodeData>;
    /**
     * Generate dynamic QR code for transaction
     */
    generateTransactionQR(merchantId: string, amount: string, transferCode: string): Promise<TransactionQRData>;
    /**
     * Parse USSD code: *merchant_code*amount#
     */
    parseUSSDCode(code: string): {
        merchantCode: string;
        amount: string;
    };
    /**
     * Get merchant details
     */
    getMerchant(merchantId: string): Promise<Merchant | null>;
    /**
     * Find merchants by location (geographic search)
     * Beneficiary discovery
     */
    findNearbyMerchants(gpsCoords: {
        latitude: number;
        longitude: number;
    }, radiusKm: number): Promise<Merchant[]>;
    /**
     * Find merchants by category
     */
    findMerchantsByCategory(category: number): Promise<Merchant[]>;
    /**
     * Get merchant transaction history
     */
    getMerchantTransactions(merchantId: string): Promise<Transaction[]>;
    /**
     * Get settlement history for a merchant
     * Daily payout tracking
     */
    getSettlementHistory(merchantId: string): Promise<Settlement[]>;
    /**
     * Get merchant statistics
     */
    getMerchantStats(merchantId: string): Promise<MerchantStats>;
    /**
     * Get onboarding queue
     */
    getOnboardingQueue(): Promise<string[]>;
    /**
     * Reset daily volumes
     */
    resetDailyVolumes(adminKey: string): Promise<void>;
    /**
     * Create merchant onboarding request
     */
    createOnboardingRequest(name: string, businessType: string, category: number, location: Location, contactInfo: string, emergencyFastTrack?: boolean): MerchantProfile;
    /**
     * Get category name
     */
    getCategoryName(category: number): string;
    /**
     * Get status name
     */
    getStatusName(status: number): string;
    /**
     * Get payment method name
     */
    getPaymentMethodName(method: number): string;
    private getNetworkPassphrase;
}
export default MerchantNetworkSDK;
//# sourceMappingURL=merchantNetwork.d.ts.map