import { Keypair } from 'stellar-sdk';
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
    requiredSignatures: number;
    autoReleaseEnabled: boolean;
    recallEnabled: boolean;
    recallAfterMonths: number;
    currentStatus: 'active' | 'triggered' | 'released' | 'recalled' | 'expired';
    fundAllocation: FundAllocation[];
    reservedForRecall: string;
}
export interface Trigger {
    id: string;
    fundId: string;
    triggerType: 'seismic' | 'weather' | 'conflict' | 'health' | 'manual';
    threshold: string;
    oracleSource: string;
    autoReleaseAmount: string;
    geofenceLatitude: number;
    geofenceLongitude: number;
    geofenceRadiusKm: number;
    minOracleConfirmations: number;
    isActive: boolean;
    lastTriggered: number;
    triggerCount: number;
    lastVerified: number;
}
export interface FundAllocation {
    sector: string;
    amount: string;
    beneficiaries: string[];
    proofOfNeed: string;
    allocatedAt: number;
}
export interface OracleData {
    source: string;
    dataType: string;
    value: string;
    timestamp: number;
    location: string;
    confidence: number;
    isVerified: boolean;
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
    triggerId?: string;
    isAutoReleased: boolean;
}
export interface TriggerExecutionResult {
    success: boolean;
    fundId: string;
    triggerId: string;
    amountReleased: string;
    timestamp: number;
    transactionHash?: string;
    error?: string;
}
export interface FundStatus {
    status: string;
    totalAmount: string;
    releasedAmount: string;
    availableAmount: string;
    beneficiaryCount: number;
}
/**
 * Emergency Fund SDK Client
 * Manages creation, deployment, monitoring, and execution of emergency funds
 * with multi-sig releases and automated trigger execution
 */
export declare class EmergencyFundsClient {
    private contractId;
    private signingKey;
    private server;
    private networkPassphrase;
    constructor(contractId: string, signingKey: Keypair, server: any, networkPassphrase?: string);
    /**
     * Creates an emergency fund with pre-positioned capital and defined triggers
     * Enables rapid response to disasters
     */
    createFund(adminAddress: string, fundId: string, name: string, description: string, totalAmount: string, disasterType: string, geographicScope: string, expiresAt: number, signersArray: string[], requiredSignatures: number): Promise<{
        success: boolean;
        transactionHash: string;
        fundId: string;
    }>;
    /**
     * Adds an automated trigger to a fund
     * Trigger can be based on seismic, weather, conflict, or health events
     */
    addTrigger(adminAddress: string, fundId: string, triggerId: string, triggerType: string, threshold: string, oracleSource: string, autoReleaseAmount: string, geofenceLatitude: number, geofenceLongitude: number, geofenceRadiusKm: number, minOracleConfirmations: number): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Submits oracle data to trigger verification
     * Multi-source verification prevents manipulation
     */
    submitOracleData(oracleAddress: string, fundId: string, triggerId: string, dataType: string, value: string, location: string, confidence: number): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Executes automated trigger release
     * Called when oracle conditions are met and confirmations received
     */
    executeTrigger(fundId: string, triggerId: string, signerAddress: string): Promise<TriggerExecutionResult>;
    /**
     * Executes multi-sig manual release requiring 2-of-3 approvals
     * Requires authorization from NGO, government, or UN representatives
     */
    executeMultiSigRelease(fundId: string, beneficiary: string, amount: string, purpose: string, approvers: Keypair[]): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Allocates funds to specific sectors with beneficiary tracking
     */
    allocateFunds(adminAddress: string, fundId: string, sector: string, amount: string, beneficiaries: string[], proofOfNeed: string): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Retrieves current status and metrics of an emergency fund
     */
    getFundStatus(fundId: string): Promise<FundStatus>;
    /**
     * Gets all triggers configured for a fund
     */
    getFundTriggers(fundId: string): Promise<Trigger[]>;
    /**
     * Gets all allocations for a fund
     */
    getFundAllocations(fundId: string): Promise<FundAllocation[]>;
    /**
     * Gets disbursement history for a fund
     */
    getDisbursementHistory(fundId: string): Promise<DisbursementRecord[]>;
    /**
     * Recalls unused funds after 12 month period
     */
    recallUnusedFunds(donorAddress: string, fundId: string): Promise<{
        success: boolean;
        recalledAmount: string;
        transactionHash: string;
    }>;
    /**
     * Enables recall capability for a fund
     */
    enableRecall(adminAddress: string, fundId: string): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Deactivates a trigger
     */
    deactivateTrigger(adminAddress: string, fundId: string, triggerId: string): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
    /**
     * Monitors oracle data feeds for trigger validation
     * Implements multi-source verification to prevent manipulation
     */
    monitorOracleFeeds(fundId: string, triggerId: string): Promise<OracleData[]>;
    /**
     * Generates impact report with beneficiary count and sector breakdown
     */
    generateImpactReport(fundId: string): Promise<{
        fundId: string;
        totalBeneficiaries: number;
        sectorBreakdown: Record<string, number>;
        amountDistributed: string;
        transactionCount: number;
    }>;
}
//# sourceMappingURL=emergencyFunds.d.ts.map