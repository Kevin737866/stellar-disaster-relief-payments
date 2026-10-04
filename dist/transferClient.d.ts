import { ConditionalTransfer, SpendingRule, TransferTransaction, PaymentRequest } from './types';
export declare class TransferClient {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Create conditional cash transfer
     */
    createTransfer(creatorKey: string, transferId: string, beneficiaryId: string, amount: string, token: string, expiresAt: number, spendingRules: SpendingRule[], purpose: string): Promise<string>;
    /**
     * Attempt to spend from conditional transfer
     */
    spend(beneficiaryKey: string, transferId: string, merchantId: string, amount: string, category: string, location: string): Promise<boolean>;
    /**
     * Get transfer details
     */
    getTransfer(transferId: string): Promise<ConditionalTransfer | null>;
    /**
     * Get transaction history for a transfer
     */
    getTransactions(transferId: string): Promise<TransferTransaction[]>;
    /**
     * Recall unspent funds after expiry
     */
    recallFunds(creatorKey: string, transferId: string): Promise<string>;
    /**
     * List active transfers for a beneficiary
     */
    listBeneficiaryTransfers(beneficiaryId: string): Promise<ConditionalTransfer[]>;
    /**
     * Extend transfer expiry
     */
    extendExpiry(creatorKey: string, transferId: string, newExpiry: number): Promise<string>;
    /**
     * Create spending rules for conditional transfers
     */
    createSpendingRules(rules: Array<{
        type: 'category_limit' | 'merchant_whitelist' | 'time_window' | 'location_based';
        parameters: Record<string, string>;
        limit: string;
    }>): SpendingRule[];
    /**
     * Create category limit rule
     */
    createCategoryLimitRule(category: string, limit: string): SpendingRule;
    /**
     * Create time window rule
     */
    createTimeWindowRule(startTime: number, endTime: number): SpendingRule;
    /**
     * Create location-based rule
     */
    createLocationRule(allowedLocation: string): SpendingRule;
    /**
     * Generate QR code for conditional transfer
     */
    generateTransferQRCode(transferId: string, transfer: ConditionalTransfer): string;
    /**
     * Validate transfer QR code
     */
    validateTransferQRCode(qrCodeData: string): Promise<boolean>;
    /**
     * Create emergency transfer template
     */
    createEmergencyTransfer(beneficiaryId: string, amount: string, disasterType: string): {
        transferId: string;
        transfer: ConditionalTransfer;
    };
    /**
     * Process payment request with validation
     */
    processPaymentRequest(request: PaymentRequest, beneficiaryKey: string): Promise<{
        success: boolean;
        transactionId?: string;
        error?: string;
    }>;
    /**
     * Get transfer statistics
     */
    getTransferStatistics(transferId: string): Promise<{
        totalSpent: string;
        remainingAmount: string;
        utilizationRate: number;
        transactionCount: number;
        averageTransaction: string;
        isExpired: boolean;
    }>;
    /**
     * Batch create transfers for disaster response
     */
    batchCreateTransfers(creatorKey: string, beneficiaryIds: string[], amount: string, purpose: string, spendingRules: SpendingRule[]): Promise<string[]>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=transferClient.d.ts.map