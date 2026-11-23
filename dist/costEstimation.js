"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostEstimationClient = void 0;
exports.estimateContractCost = estimateContractCost;
exports.estimateMultipleContractCosts = estimateMultipleContractCosts;
exports.estimateTotalCost = estimateTotalCost;
const stellar_sdk_1 = require("stellar-sdk");
// Soroban resource fee multipliers relative to BASE_FEE.
// These are conservative estimates based on operation complexity.
const RESOURCE_FEE_MULTIPLIERS = {
    deployEmergencyFund: 10,
    triggerDisbursement: 8,
    registerMerchant: 6,
    processPayment: 5,
    createTransfer: 7,
    spend: 5,
    createShipment: 8,
    updateCheckpoint: 4,
    registerBeneficiary: 6,
    verifyBeneficiary: 4,
};
// Operations that require multiple signers by default.
const MULTI_SIG_OPERATIONS = {
    processPayment: 2, // merchant + beneficiary
    triggerDisbursement: 2, // requester + approver
};
const STROOPS_PER_XLM = 10000000n;
/**
 * Validates that the interaction type is supported.
 */
function validateInteractionType(interactionType) {
    const valid = [
        'deployEmergencyFund',
        'triggerDisbursement',
        'registerMerchant',
        'processPayment',
        'createTransfer',
        'spend',
        'createShipment',
        'updateCheckpoint',
        'registerBeneficiary',
        'verifyBeneficiary',
    ];
    if (!valid.includes(interactionType)) {
        throw new Error(`Unsupported contract interaction type: "${interactionType}". ` +
            `Supported types: ${valid.join(', ')}`);
    }
}
/**
 * Converts stroops (as bigint) to XLM string with 7 decimal places.
 */
function stroopsToXLM(stroops) {
    const whole = stroops / STROOPS_PER_XLM;
    const remainder = stroops % STROOPS_PER_XLM;
    const decimals = remainder.toString().padStart(7, '0');
    return `${whole}.${decimals}`;
}
/**
 * Estimates the cost of a contract interaction.
 *
 * @param interactionType - The type of contract interaction
 * @param options - Optional overrides for signer count and base fee
 * @returns A CostEstimate with fee breakdown
 * @throws Error if interactionType is not supported or options are invalid
 */
function estimateContractCost(interactionType, options = {}) {
    validateInteractionType(interactionType);
    const baseFeeStr = options.baseFeeStroops ?? stellar_sdk_1.BASE_FEE;
    const baseFeeNum = parseInt(baseFeeStr, 10);
    if (isNaN(baseFeeNum) || baseFeeNum < 0) {
        throw new Error(`Invalid baseFeeStroops: "${baseFeeStr}". Must be a non-negative integer string.`);
    }
    const defaultSignerCount = MULTI_SIG_OPERATIONS[interactionType] ?? 1;
    const signerCount = options.signerCount !== undefined
        ? options.signerCount
        : defaultSignerCount;
    if (!Number.isInteger(signerCount) || signerCount < 1) {
        throw new Error(`Invalid signerCount: ${signerCount}. Must be a positive integer.`);
    }
    const requiresMultiSig = signerCount > 1;
    // Base fee scales with number of signers (each signer adds one signature to the tx).
    const baseFeeStroops = BigInt(baseFeeNum) * BigInt(signerCount);
    // Resource fee is an estimate based on operation complexity.
    const multiplier = RESOURCE_FEE_MULTIPLIERS[interactionType];
    const resourceFeeStroops = BigInt(baseFeeNum) * BigInt(multiplier);
    const totalFeeStroops = baseFeeStroops + resourceFeeStroops;
    return {
        baseFeeStroops: baseFeeStroops.toString(),
        resourceFeeStroops: resourceFeeStroops.toString(),
        totalFeeStroops: totalFeeStroops.toString(),
        totalFeeXLM: stroopsToXLM(totalFeeStroops),
        requiresMultiSig,
        signerCount,
        description: getInteractionDescription(interactionType),
    };
}
/**
 * Estimates costs for multiple contract interactions at once.
 *
 * @param interactions - Array of interaction types with optional per-interaction options
 * @returns Array of CostEstimates in the same order as inputs
 */
function estimateMultipleContractCosts(interactions) {
    if (!Array.isArray(interactions) || interactions.length === 0) {
        throw new Error('interactions must be a non-empty array');
    }
    return interactions.map(({ interactionType, options }) => estimateContractCost(interactionType, options));
}
/**
 * Returns the total estimated cost across multiple interactions.
 *
 * @param interactions - Array of interaction types with optional per-interaction options
 * @returns Aggregated cost with total fees
 */
function estimateTotalCost(interactions) {
    const breakdown = estimateMultipleContractCosts(interactions);
    const totalStroops = breakdown.reduce((sum, est) => sum + BigInt(est.totalFeeStroops), 0n);
    return {
        totalFeeStroops: totalStroops.toString(),
        totalFeeXLM: stroopsToXLM(totalStroops),
        breakdown,
    };
}
/**
 * Returns a human-readable description for each interaction type.
 */
function getInteractionDescription(type) {
    const descriptions = {
        deployEmergencyFund: 'Deploy emergency fund with multi-sig configuration',
        triggerDisbursement: 'Trigger fund disbursement with multi-sig approval',
        registerMerchant: 'Register local merchant in the relief network',
        processPayment: 'Process payment from beneficiary to merchant (multi-sig)',
        createTransfer: 'Create conditional cash transfer with spending rules',
        spend: 'Spend from conditional transfer at merchant',
        createShipment: 'Create supply chain shipment record',
        updateCheckpoint: 'Update shipment checkpoint with location and status',
        registerBeneficiary: 'Register beneficiary with identity verification factors',
        verifyBeneficiary: 'Verify beneficiary identity and update trust score',
    };
    return descriptions[type];
}
/**
 * CostEstimationClient provides cost estimation as a class,
 * consistent with the rest of the SDK's client pattern.
 */
class CostEstimationClient {
    // Config is accepted for API consistency but not required for pure estimation.
    constructor(_config) { }
    /**
     * Estimate the cost of a single contract interaction.
     */
    estimateContractCost(interactionType, options) {
        return estimateContractCost(interactionType, options);
    }
    /**
     * Estimate costs for multiple contract interactions.
     */
    estimateMultipleContractCosts(interactions) {
        return estimateMultipleContractCosts(interactions);
    }
    /**
     * Estimate total cost across multiple interactions.
     */
    estimateTotalCost(interactions) {
        return estimateTotalCost(interactions);
    }
}
exports.CostEstimationClient = CostEstimationClient;
//# sourceMappingURL=costEstimation.js.map