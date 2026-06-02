import { BASE_FEE } from 'stellar-sdk';
import { NetworkConfig } from './types';

/**
 * Supported contract interaction types for cost estimation.
 */
export type ContractInteractionType =
  | 'deployEmergencyFund'
  | 'triggerDisbursement'
  | 'registerMerchant'
  | 'processPayment'
  | 'createTransfer'
  | 'spend'
  | 'createShipment'
  | 'updateCheckpoint'
  | 'registerBeneficiary'
  | 'verifyBeneficiary';

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

// Soroban resource fee multipliers relative to BASE_FEE.
// These are conservative estimates based on operation complexity.
const RESOURCE_FEE_MULTIPLIERS: Record<ContractInteractionType, number> = {
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
const MULTI_SIG_OPERATIONS: Partial<Record<ContractInteractionType, number>> = {
  processPayment: 2,    // merchant + beneficiary
  triggerDisbursement: 2, // requester + approver
};

const STROOPS_PER_XLM = 10_000_000n;

/**
 * Validates that the interaction type is supported.
 */
function validateInteractionType(interactionType: string): asserts interactionType is ContractInteractionType {
  const valid: ContractInteractionType[] = [
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
  if (!valid.includes(interactionType as ContractInteractionType)) {
    throw new Error(
      `Unsupported contract interaction type: "${interactionType}". ` +
      `Supported types: ${valid.join(', ')}`
    );
  }
}

/**
 * Converts stroops (as bigint) to XLM string with 7 decimal places.
 */
function stroopsToXLM(stroops: bigint): string {
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
export function estimateContractCost(
  interactionType: ContractInteractionType,
  options: CostEstimationOptions = {}
): CostEstimate {
  validateInteractionType(interactionType);

  const baseFeeStr = options.baseFeeStroops ?? BASE_FEE;
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
export function estimateMultipleContractCosts(
  interactions: Array<{
    interactionType: ContractInteractionType;
    options?: CostEstimationOptions;
  }>
): CostEstimate[] {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    throw new Error('interactions must be a non-empty array');
  }
  return interactions.map(({ interactionType, options }) =>
    estimateContractCost(interactionType, options)
  );
}

/**
 * Returns the total estimated cost across multiple interactions.
 *
 * @param interactions - Array of interaction types with optional per-interaction options
 * @returns Aggregated cost with total fees
 */
export function estimateTotalCost(
  interactions: Array<{
    interactionType: ContractInteractionType;
    options?: CostEstimationOptions;
  }>
): { totalFeeStroops: string; totalFeeXLM: string; breakdown: CostEstimate[] } {
  const breakdown = estimateMultipleContractCosts(interactions);
  const totalStroops = breakdown.reduce(
    (sum, est) => sum + BigInt(est.totalFeeStroops),
    0n
  );
  return {
    totalFeeStroops: totalStroops.toString(),
    totalFeeXLM: stroopsToXLM(totalStroops),
    breakdown,
  };
}

/**
 * Returns a human-readable description for each interaction type.
 */
function getInteractionDescription(type: ContractInteractionType): string {
  const descriptions: Record<ContractInteractionType, string> = {
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
export class CostEstimationClient {
  // Config is accepted for API consistency but not required for pure estimation.
  constructor(_config?: NetworkConfig | Record<string, unknown>) {}

  /**
   * Estimate the cost of a single contract interaction.
   */
  estimateContractCost(
    interactionType: ContractInteractionType,
    options?: CostEstimationOptions
  ): CostEstimate {
    return estimateContractCost(interactionType, options);
  }

  /**
   * Estimate costs for multiple contract interactions.
   */
  estimateMultipleContractCosts(
    interactions: Array<{
      interactionType: ContractInteractionType;
      options?: CostEstimationOptions;
    }>
  ): CostEstimate[] {
    return estimateMultipleContractCosts(interactions);
  }

  /**
   * Estimate total cost across multiple interactions.
   */
  estimateTotalCost(
    interactions: Array<{
      interactionType: ContractInteractionType;
      options?: CostEstimationOptions;
    }>
  ): { totalFeeStroops: string; totalFeeXLM: string; breakdown: CostEstimate[] } {
    return estimateTotalCost(interactions);
  }
}
