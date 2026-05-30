import { Merchant, Transaction, Location, MerchantOnboardingRequest } from './types';
export declare class MerchantClient {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Register local merchant for relief network
     */
    registerMerchant(ownerKey: string, merchantId: string, request: MerchantOnboardingRequest): Promise<string>;
    /**
     * Verify merchant (by authorized verifier)
     */
    verifyMerchant(verifierKey: string, merchantId: string, approved: boolean, notes: string): Promise<string>;
    /**
     * Process payment from beneficiary to merchant
     */
    processPayment(merchantKey: string, beneficiaryKey: string, merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string): Promise<string>;
    /**
     * Get merchant details
     */
    getMerchant(merchantId: string): Promise<Merchant | null>;
    /**
     * Find merchants by location (geographic search)
     */
    findMerchantsByLocation(latitude: number, longitude: number, radiusKm: number): Promise<Merchant[]>;
    /**
     * Get merchant transaction history
     */
    getMerchantTransactions(merchantId: string): Promise<Transaction[]>;
    /**
     * Update merchant reputation based on feedback
     */
    updateReputation(adminKey: string, merchantId: string, feedbackScore: number): Promise<string>;
    /**
     * Get verification queue
     */
    getVerificationQueue(): Promise<string[]>;
    /**
     * Generate QR code for merchant identification
     */
    generateMerchantQRCode(merchantId: string, merchant: Merchant): string;
    /**
     * Validate merchant QR code
     */
    validateMerchantQRCode(qrCodeData: string): Promise<boolean>;
    /**
     * Discover merchants using Stellar TOML
     */
    discoverMerchantsFromStellarToml(domain: string): Promise<Merchant[]>;
    /**
     * Create merchant onboarding request template
     */
    createOnboardingRequest(name: string, businessType: string, location: Location, contactInfo: string, stellarAddress: string): MerchantOnboardingRequest;
    /**
     * Get merchant statistics
     */
    getMerchantStatistics(merchantId: string): Promise<{
        totalTransactions: number;
        totalVolume: string;
        averageTransaction: string;
        reputationScore: number;
        monthlyUtilization: number;
    }>;
    /**
     * Batch verify merchants
     */
    batchVerifyMerchants(verifierKey: string, merchantIds: string[], approved: boolean, notes: string): Promise<string[]>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=merchantClient.d.ts.map