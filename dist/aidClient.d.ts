import { EmergencyFund, DisbursementRecord, NetworkConfig } from './types';
export declare class AidClient {
    private server;
    private contract;
    private config;
    constructor(config: NetworkConfig);
    /**
     * Deploy emergency fund for disaster response
     */
    deployEmergencyFund(adminKey: string, fundId: string, name: string, description: string, totalAmount: string, disasterType: string, geographicScope: string, expiresAt: number, releaseTriggers: string[], requiredSignatures: number): Promise<string>;
    /**
     * Trigger disbursement with multi-sig approval
     */
    triggerDisbursement(requesterKey: string, fundId: string, beneficiary: string, amount: string, purpose: string, approvers: string[]): Promise<string>;
    /**
     * Get fund details
     */
    getFund(fundId: string): Promise<EmergencyFund | null>;
    /**
     * List all active emergency funds
     */
    listActiveFunds(): Promise<EmergencyFund[]>;
    /**
     * Get disbursement history for a fund
     */
    getDisbursements(fundId: string): Promise<DisbursementRecord[]>;
    /**
     * Monitor fund pool status
     */
    monitorFundPool(fundId: string): Promise<{
        totalAmount: string;
        releasedAmount: string;
        remainingAmount: string;
        isActive: boolean;
        expiresAt: number;
    }>;
    /**
     * Cleanup expired funds
     */
    cleanupExpiredFunds(adminKey: string): Promise<string>;
    /**
     * Create multiple funds for large-scale disaster response
     */
    deployRapidResponse(adminKey: string, disasterId: string, disasterType: string, affectedArea: string, totalBudget: string, fundCategories: Array<{
        name: string;
        percentage: number;
        description: string;
    }>): Promise<string[]>;
    /**
     * Generate QR code for fund information (offline access)
     */
    generateFundQRCode(fundId: string, fund: EmergencyFund): string;
    /**
     * Validate fund QR code
     */
    validateFundQRCode(qrCodeData: string): boolean;
    /**
     * Get fund statistics for reporting
     */
    getFundStatistics(fundId: string): Promise<{
        totalDisbursements: number;
        totalAmountDisbursed: string;
        averageDisbursement: string;
        lastDisbursement: number | null;
        beneficiariesReached: number;
    }>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=aidClient.d.ts.map