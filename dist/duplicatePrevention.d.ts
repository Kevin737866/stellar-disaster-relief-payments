import { Keypair } from 'stellar-sdk';
export interface DisbursementTracker {
    id: string;
    beneficiaryId: string;
    fundId: string;
    purpose: string;
    amount: string;
    timestamp: number;
    transactionHash: string;
    approvers: string[];
    isProcessed: boolean;
}
export interface DuplicateCheckResult {
    isDuplicate: boolean;
    previousDisbursement?: DisbursementTracker;
    message: string;
}
export interface DisbursementHistory {
    beneficiaryId: string;
    disbursements: DisbursementTracker[];
    totalDisbursements: number;
    totalAmount: string;
}
/**
 * Duplicate Disbursement Prevention Client
 * Ensures beneficiaries don't receive duplicate disbursements for the same purpose
 */
export declare class DuplicatePreventionClient {
    private contractId;
    private signingKey;
    private server;
    private networkPassphrase;
    private localCache;
    constructor(contractId: string, signingKey: Keypair, server: any, networkPassphrase?: string);
    /**
     * Checks if a disbursement is a duplicate before processing
     * Compares beneficiary ID and purpose against existing disbursements
     */
    checkForDuplicate(beneficiaryId: string, fundId: string, purpose: string): Promise<DuplicateCheckResult>;
    /**
     * Records a disbursement in the contract to track it for future duplicate checks
     */
    recordDisbursement(adminAddress: string, beneficiaryAddress: string, fundId: string, purpose: string, amount: string, transactionHash: string, approvers: string[]): Promise<{
        success: boolean;
        recordId: string;
    }>;
    /**
     * Gets all disbursements for a specific beneficiary
     */
    getDisbursementHistory(beneficiaryId: string, fundId?: string, purpose?: string): Promise<DisbursementHistory>;
    /**
     * Gets disbursements for a specific purpose
     */
    getDisbursementsByPurpose(fundId: string, purpose: string): Promise<DisbursementTracker[]>;
    /**
     * Validates disbursement request with duplicate check
     */
    validateDisbursement(beneficiaryId: string, fundId: string, purpose: string, amount: string): Promise<{
        isValid: boolean;
        isDuplicate: boolean;
        errors: string[];
        warnings: string[];
    }>;
    /**
     * Gets a summary of all disbursements to a beneficiary
     */
    getBeneficiarySummary(beneficiaryId: string): Promise<{
        beneficiaryId: string;
        totalDisbursements: number;
        totalAmount: string;
        purposes: string[];
        lastDisbursement: DisbursementTracker | null;
    }>;
    /**
     * Clears local cache for specific entries
     */
    clearCache(beneficiaryId?: string, fundId?: string, purpose?: string): void;
    /**
     * Exports disbursement records for audit trail
     */
    exportDisbursementRecords(fundId?: string, startDate?: number, endDate?: number): Promise<DisbursementTracker[]>;
}
//# sourceMappingURL=duplicatePrevention.d.ts.map