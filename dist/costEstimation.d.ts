import { NetworkConfig } from './types';
/**
 * Supported contract interaction types for cost estimation.
 */
export type ContractInteractionType = 'deployEmergencyFund' | 'triggerDisbursement' | 'registerMerchant' | 'processPayment' | 'createTransfer' | 'spend' | 'createShipment' | 'updateCheckpoint' | 'registerBeneficiary' | 'verifyBeneficiary';
/**
 * Result of a cost estimation.
 */
export interface CostEstimate {
    /** Base transaction fee in stroops (1 XLM = 10,000,000 stroops) */
    baseFeeStroops: string;
    /** Estimated Soroban resource fee in stroops */
    resourceFeeStroops: string;
    /** Total estimated fee in stroops */
    totalFeeStroops: string;
    /** Total estimated fee in XLM */
    totalFeeXLM: string;
    /** Whether this interaction requires multiple signers */
    requiresMultiSig: boolean;
    /** Number of signers required */
    signerCount: number;
    /** Human-readable description of the interaction */
    description: string;
}
/**
 * Options for cost estimation.
 */
export interface CostEstimationOptions {
    /** Number of signers (overrides default for multi-sig operations) */
    signerCount?: number;
    /** Custom base fee in stroops (defaults to BASE_FEE from stellar-sdk) */
    baseFeeStroops?: string;
}
/**
 * Estimates the cost of a contract interaction.
 *
 * @param interactionType - The type of contract interaction
 * @param options - Optional overrides for signer count and base fee
 * @returns A CostEstimate with fee breakdown
 * @throws Error if interactionType is not supported or options are invalid
 */
export declare function estimateContractCost(interactionType: ContractInteractionType, options?: CostEstimationOptions): CostEstimate;
/**
 * Estimates costs for multiple contract interactions at once.
 *
 * @param interactions - Array of interaction types with optional per-interaction options
 * @returns Array of CostEstimates in the same order as inputs
 */
export declare function estimateMultipleContractCosts(interactions: Array<{
    interactionType: ContractInteractionType;
    options?: CostEstimationOptions;
}>): CostEstimate[];
/**
 * Returns the total estimated cost across multiple interactions.
 *
 * @param interactions - Array of interaction types with optional per-interaction options
 * @returns Aggregated cost with total fees
 */
export declare function estimateTotalCost(interactions: Array<{
    interactionType: ContractInteractionType;
    options?: CostEstimationOptions;
}>): {
    totalFeeStroops: string;
    totalFeeXLM: string;
    breakdown: CostEstimate[];
};
/**
 * CostEstimationClient provides cost estimation as a class,
 * consistent with the rest of the SDK's client pattern.
 */
export declare class CostEstimationClient {
    constructor(_config?: NetworkConfig | Record<string, unknown>);
    /**
     * Estimate the cost of a single contract interaction.
     */
    estimateContractCost(interactionType: ContractInteractionType, options?: CostEstimationOptions): CostEstimate;
    /**
     * Estimate costs for multiple contract interactions.
     */
    estimateMultipleContractCosts(interactions: Array<{
        interactionType: ContractInteractionType;
        options?: CostEstimationOptions;
    }>): CostEstimate[];
    /**
     * Estimate total cost across multiple interactions.
     */
    estimateTotalCost(interactions: Array<{
        interactionType: ContractInteractionType;
        options?: CostEstimationOptions;
    }>): {
        totalFeeStroops: string;
        totalFeeXLM: string;
        breakdown: CostEstimate[];
    };
}
//# sourceMappingURL=costEstimation.d.ts.map