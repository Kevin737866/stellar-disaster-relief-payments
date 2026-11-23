import { OfflineEnvelope } from './offlineSigner';
import { EmergencyFund, DisbursementRecord, NetworkConfig } from './types';
import { ReadCache } from './readCache';
/**
 * Maximum number of entries accepted by the on-chain batch disbursement
 * contract. Keep this in sync with `MAX_BATCH_SIZE` in `src/aid_registry.rs`.
 */
export declare const MAX_BATCH_SIZE = 100;
/** A batch must contain at least one entry. */
export declare const MIN_BATCH_SIZE = 1;
export declare class AidClient {
    private server;
    private contract;
    private config;
    readonly cache: ReadCache;
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
     * Submit multiple disbursements atomically in a single transaction.
     * All entries succeed or all fail — no partial state.
     *
     * Batches are limited to `MAX_BATCH_SIZE` (100) entries, matching the
     * on-chain limit. Split larger requests into multiple atomic batches.
     *
     * @param requesterKey  Secret key of the requester
     * @param fundId        Fund to draw from
     * @param entries       Array of { beneficiary, amount, purpose }
     * @param approvers     Secret keys of multi-sig approvers
     * @returns Array of disbursement IDs created on-chain
     */
    triggerBatchDisbursement(requesterKey: string, fundId: string, entries: Array<{
        beneficiary: string;
        amount: string;
        purpose: string;
    }>, approvers: string[]): Promise<string[]>;
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
     * Generate a minimised QR code for fund information (offline access).
     *
     * Payload contains only the fields a scanner needs to look up and display
     * the fund.  Financial amounts and internal state are intentionally omitted
     * — the scanner should query the contract for live details after verifying
     * `fundId`.
     *
     * The QR carries its own `qrExpiresAt` expiry (default 24 h) that is
     * independent of the fund's own `expiresAt`, so a QR printed for a field
     * agent cannot be replayed indefinitely even if the fund is still active.
     *
     * @param fundId  - Opaque fund identifier.
     * @param fund    - Fund record to generate the QR for.
     * @param qrTtlMs - Optional QR-specific TTL in milliseconds (default 24 h).
     * @returns JSON string representing the minimised QR payload.
     *
     * @see docs/QR_PAYLOADS.md for full field documentation and scanner guidance.
     */
    generateFundQRCode(fundId: string, fund: EmergencyFund, qrTtlMs?: number): string;
    /**
     * Validate a fund QR code.
     *
     * Checks both the QR-specific expiry (`qrExpiresAt`) and confirms the fund
     * still exists on-chain.  Returns `false` for any expired or invalid QR.
     */
    validateFundQRCode(qrCodeData: string): Promise<boolean>;
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
    /**
     * Build an unsigned transaction for deploying an emergency fund.
     * Returns an OfflineEnvelope that can be signed offline and submitted later.
     */
    buildOfflineDeployFund(sourcePublicKey: string, fundId: string, name: string, description: string, totalAmount: string, disasterType: string, geographicScope: string, expiresAt: number, releaseTriggers: string[], requiredSignatures: number): Promise<OfflineEnvelope>;
    /**
     * Build an unsigned transaction for triggering a disbursement.
     */
    buildOfflineDisbursement(sourcePublicKey: string, fundId: string, beneficiary: string, amount: string, purpose: string, approvers: string[]): Promise<OfflineEnvelope>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=aidClient.d.ts.map