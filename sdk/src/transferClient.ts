import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
import { ReadCache } from './readCache';
import {
  ConditionalTransfer,
  SpendingRule,
  TransferTransaction,
  PaymentRequest
} from './types';
import {
  TransactionError,
  NetworkError,
  ValidationError,
} from './errors';
import { OfflineSigner, OfflineEnvelope } from './offlineSigner';
import { withRetry } from './retry';
import { NetworkConfig } from './types';
import { categorizePurpose } from './purposeTaxonomy';

/** Maximum 256-bit unsigned integer value: 2^256 - 1. */
export const MAX_U256 = (1n << 256n) - 1n;

/**
 * Validates and formats an amount string strictly as a U256-compatible decimal integer string.
 *
 * The contract expects a Soroban U256 integer. Amounts must be represented as non-negative
 * integer decimal strings (no decimal points, fractions, negative signs, or non-numeric characters)
 * and must not exceed 2^256 - 1.
 *
 * @param amount - The amount string to validate and normalize.
 * @param field - Field name for error reporting (defaults to 'amount').
 * @returns The normalized decimal integer string.
 * @throws {ValidationError} If the format is invalid or exceeds U256 bounds.
 */
export function validateU256Amount(amount: string, field: string = 'amount'): string {
  if (typeof amount !== 'string') {
    throw new ValidationError(field, 'Amount must be a string');
  }
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new ValidationError(field, 'Amount string must not be empty');
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new ValidationError(
      field,
      'Amount must be a non-negative decimal integer string without decimals, fractions, or signs'
    );
  }
  try {
    const val = BigInt(trimmed);
    if (val < 0n || val > MAX_U256) {
      throw new ValidationError(
        field,
        'Amount must fit within a 256-bit unsigned integer (0 <= amount <= 2^256 - 1)'
      );
    }
    return val.toString();
  } catch (err: any) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(field, `Failed to parse amount as U256: ${err?.message || err}`);
  }
}

export class TransferClient {
  private server: any;
  private contract: any;
  private config: NetworkConfig;
  readonly cache: ReadCache;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.cashTransfer);
    this.cache = new ReadCache(config);
  }

  /**
   * Create conditional cash transfer
   *
   * @param creatorKey - Secret key of transfer creator
   * @param transferId - Unique transfer ID
   * @param beneficiaryId - Beneficiary identifier
   * @param amount - U256 decimal integer string representing transfer amount
   * @param token - Token symbol/address
   * @param expiresAt - Expiry timestamp
   * @param spendingRules - Spending rule restrictions
   * @param purpose - Purpose of transfer
   * @throws {ValidationError} If amount is not a valid U256 decimal string
   */
  async createTransfer(
    creatorKey: string,
    transferId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    expiresAt: number,
    spendingRules: SpendingRule[],
    purpose: string
  ): Promise<string> {
    const validAmount = validateU256Amount(amount, 'amount');
    const creatorKeypair = Keypair.fromSecret(creatorKey);
    const creatorAccount = await withRetry<any>(() => this.server.getAccount(creatorKeypair.publicKey()));

    const tx = new TransactionBuilder(creatorAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "create_transfer",
          ...[
            new Address(creatorKeypair.publicKey()).toScVal(),
            nativeToScVal(transferId),
            nativeToScVal(beneficiaryId),
            nativeToScVal(validAmount),
            nativeToScVal(token),
            nativeToScVal(expiresAt),
            nativeToScVal(spendingRules),
            nativeToScVal(purpose)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(creatorKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidatePrefix(`transfer:beneficiary:${beneficiaryId}`);
      return `Conditional transfer ${transferId} created successfully`;
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'create transfer' });
    }
  }

  /**
   * Attempt to spend from conditional transfer
   *
   * @param beneficiaryKey - Beneficiary secret key
   * @param transferId - Transfer identifier
   * @param merchantId - Merchant identifier
   * @param amount - U256 integer decimal string representing spend amount (0 to 2^256 - 1)
   * @param category - Spending category
   * @param location - Spend location
   * @throws {ValidationError} If amount is not a valid U256 decimal string
   */
  async spend(
    beneficiaryKey: string,
    transferId: string,
    merchantId: string,
    amount: string,
    category: string,
    location: string
  ): Promise<boolean> {
    const validAmount = validateU256Amount(amount, 'amount');
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    const beneficiaryAccount = await withRetry<any>(() => this.server.getAccount(beneficiaryKeypair.publicKey()));

    const tx = new TransactionBuilder(beneficiaryAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "spend",
          ...[
            new Address(beneficiaryKeypair.publicKey()).toScVal(),
            nativeToScVal(transferId),
            nativeToScVal(merchantId),
            nativeToScVal(validAmount),
            nativeToScVal(category),
            nativeToScVal(location)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(beneficiaryKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`transfer:${transferId}`);
      this.cache.invalidate(`transfer:transactions:${transferId}`);
      return scValToNative(result.result.retval);
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'spend', merchantId });
    }
  }

  /**
   * Get transfer details
   */
  async getTransfer(transferId: string): Promise<ConditionalTransfer | null> {
    return this.cache.get(`transfer:${transferId}`, async () => {
      try {
        const result = await this.contract.call("get_transfer", nativeToScVal(transferId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get transfer:', error);
        return null;
      }
    });
  }

  /**
   * Get transaction history for a transfer
   */
  async getTransactions(transferId: string): Promise<TransferTransaction[]> {
    return this.cache.get(`transfer:transactions:${transferId}`, async () => {
      try {
        const result = await this.contract.call("get_transactions", nativeToScVal(transferId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get transactions:', error);
        return [];
      }
    });
  }

  /**
   * Recall unspent funds after expiry
   */
  async recallFunds(creatorKey: string, transferId: string): Promise<string> {
    const creatorKeypair = Keypair.fromSecret(creatorKey);
    const creatorAccount = await withRetry<any>(() => this.server.getAccount(creatorKeypair.publicKey()));

    const tx = new TransactionBuilder(creatorAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "recall_funds",
          ...[
            new Address(creatorKeypair.publicKey()).toScVal(),
            nativeToScVal(transferId)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(creatorKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`transfer:${transferId}`);
      this.cache.invalidate(`transfer:transactions:${transferId}`);
      const recalledAmount = scValToNative(result.result.retval);
      return `Recalled ${recalledAmount} units from transfer ${transferId}`;
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'recall funds' });
    }
  }

  /**
   * List active transfers for a beneficiary
   */
  async listBeneficiaryTransfers(beneficiaryId: string): Promise<ConditionalTransfer[]> {
    return this.cache.get(`transfer:beneficiary:${beneficiaryId}`, async () => {
      try {
        const result = await this.contract.call("list_beneficiary_transfers", nativeToScVal(beneficiaryId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to list beneficiary transfers:', error);
        return [];
      }
    });
  }

  /**
   * Extend transfer expiry
   */
  async extendExpiry(
    creatorKey: string,
    transferId: string,
    newExpiry: number
  ): Promise<string> {
    const creatorKeypair = Keypair.fromSecret(creatorKey);
    const creatorAccount = await withRetry<any>(() => this.server.getAccount(creatorKeypair.publicKey()));

    const tx = new TransactionBuilder(creatorAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "extend_expiry",
          ...[
            new Address(creatorKeypair.publicKey()).toScVal(),
            nativeToScVal(transferId),
            nativeToScVal(newExpiry)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(creatorKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`transfer:${transferId}`);
      return `Transfer ${transferId} expiry extended to ${new Date(newExpiry).toISOString()}`;
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'extend expiry' });
    }
  }

  /**
   * Create spending rules for conditional transfers
   */
  createSpendingRules(
    rules: Array<{
      type: 'category_limit' | 'merchant_whitelist' | 'time_window' | 'location_based';
      parameters: Record<string, string>;
      limit: string;
    }>
  ): SpendingRule[] {
    return rules.map(rule => ({
      ruleType: rule.type,
      parameters: rule.parameters,
      limit: rule.limit,
      currentUsage: '0'
    }));
  }

  /**
   * Create category limit rule
   */
  createCategoryLimitRule(category: string, limit: string): SpendingRule {
    return {
      ruleType: 'category_limit',
      parameters: {
        category
      },
      limit,
      currentUsage: '0'
    };
  }

  /**
   * Create time window rule
   */
  createTimeWindowRule(startTime: number, endTime: number): SpendingRule {
    return {
      ruleType: 'time_window',
      parameters: {
        start_time: startTime.toString(),
        end_time: endTime.toString()
      },
      limit: '0', // No limit, just time restriction
      currentUsage: '0'
    };
  }

  /**
   * Create location-based rule
   */
  createLocationRule(allowedLocation: string): SpendingRule {
    return {
      ruleType: 'location_based',
      parameters: {
        location: allowedLocation
      },
      limit: '0', // No limit, just location restriction
      currentUsage: '0'
    };
  }

  /**
   * Generate QR code for conditional transfer
   */
  generateTransferQRCode(transferId: string, transfer: ConditionalTransfer): string {
    const qrData = {
      type: 'transfer',
      transferId,
      beneficiaryId: transfer.beneficiaryId,
      amount: transfer.amount,
      remainingAmount: transfer.remainingAmount,
      token: transfer.token,
      purpose: transfer.purpose,
      spendingRules: transfer.spendingRules.map(rule => ({
        type: rule.ruleType,
        limit: rule.limit
      })),
      expiresAt: transfer.expiresAt,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate transfer QR code
   */
  async validateTransferQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'transfer') {
        return false;
      }

      // Verify transfer exists and is active
      const transfer = await this.getTransfer(data.transferId);
      return transfer !== null && transfer.isActive;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create emergency transfer template.
   *
   * Computes category limits using BigInt arithmetic:
   * - Medicine: 30% (`amount * 30 / 100`)
   * - Shelter: 10% (`amount * 10 / 100`)
   * - Food: receives the remaining balance (`amount - medicine - shelter`, ~60%)
   *
   * This guarantees that default category limit allocations sum exactly to the
   * total disbursement amount without losing units to integer division truncation.
   *
   * @param beneficiaryId - The recipient's beneficiary identifier.
   * @param amount - Total transfer amount as an integer string.
   * @param disasterType - Description of disaster for purpose labeling.
   */
  createEmergencyTransfer(
    beneficiaryId: string,
    amount: string,
    disasterType: string
  ): {
    transferId: string;
    transfer: ConditionalTransfer;
  } {
    const total = BigInt(amount);
    if (total < 0n) {
      throw new Error('Transfer amount must be non-negative');
    }

    const transferId = `emergency_${beneficiaryId}_${Date.now()}`;
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

    // Default emergency spending rules
    // Medicine (30%) and Shelter (10%) computed via integer division;
    // Food gets the remaining balance so total category limits sum exactly to 100%.
    const medicineLimit = (total * 30n) / 100n;
    const shelterLimit = (total * 10n) / 100n;
    const foodLimit = total - medicineLimit - shelterLimit;

    const spendingRules = [
      this.createCategoryLimitRule('food', foodLimit.toString()),
      this.createCategoryLimitRule('medicine', medicineLimit.toString()),
      this.createCategoryLimitRule('shelter', shelterLimit.toString()),
      this.createTimeWindowRule(
        Date.now(),
        Date.now() + (7 * 24 * 60 * 60 * 1000)
      )
    ];

    const transfer: ConditionalTransfer = {
      id: transferId,
      beneficiaryId,
      amount,
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt,
      spendingRules,
      isActive: true,
      spentAmount: '0',
      remainingAmount: amount,
      creator: 'emergency_system',
      purpose: `Emergency assistance for ${disasterType}`
    };

    return { transferId, transfer };
  }

  /**
   * Process payment request with category and transfer selection logic.
   *
   * Selects an appropriate active transfer for the beneficiary based on:
   * 1. Active status and non-expired time window.
   * 2. Matching token (if specified).
   * 3. Sufficient remaining balance for the requested amount.
   * 4. Compatibility with spending rules:
   *    - Category limits: prioritizes transfers with matching category allowances.
   *    - Merchant whitelist: verifies merchant is allowed if whitelisting is configured.
   *    - Time windows: verifies current time falls within active window.
   *    - Location restrictions: verifies location matches if restricted.
   *
   * Category resolution:
   * - Uses explicit `request.category` if provided.
   * - Otherwise maps `request.purpose` via the disbursement purpose taxonomy (`categorizePurpose`).
   * - Falls back to `'general'` if purpose does not map to a recognized category.
   *
   * Limitations:
   * - Atomic single-transfer spend: does not split payment across multiple transfers if no single
   *   transfer has sufficient balance.
   * - Spending rule pre-checks are client-side heuristics to select the most suitable transfer;
   *   definitive rule verification and state transitions are enforced on-chain.
   *
   * @param request - Payment request details
   * @param beneficiaryKey - Secret key of the beneficiary
   * @returns Success status with transactionId and transferId or descriptive error
   */
  async processPaymentRequest(
    request: PaymentRequest,
    beneficiaryKey: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    transferId?: string;
    error?: string;
  }> {
    try {
      const validAmount = validateU256Amount(request.amount, 'amount');
      const requestAmountBigInt = BigInt(validAmount);

      // 1. Resolve category
      let category = (request.category || '').trim().toLowerCase();
      if (!category && request.purpose) {
        const classified = categorizePurpose(request.purpose);
        if (classified && classified !== 'other') {
          category = classified;
        }
      }
      if (!category) {
        category = 'general';
      }

      // 2. Fetch transfers for beneficiary
      const transfers = await this.listBeneficiaryTransfers(request.beneficiaryId);
      if (!transfers || transfers.length === 0) {
        return {
          success: false,
          error: 'No active transfers found for beneficiary',
        };
      }

      const now = Date.now();

      // 3. Filter for active and non-expired transfers
      const activeTransfers = transfers.filter(
        t => t.isActive && now <= t.expiresAt
      );

      if (activeTransfers.length === 0) {
        return {
          success: false,
          error: 'All transfers for beneficiary are inactive or expired',
        };
      }

      // 4. Filter for token match and sufficient remaining amount
      const fundedTransfers = activeTransfers.filter(t => {
        if (request.token && t.token && t.token !== request.token) {
          return false;
        }
        try {
          return BigInt(t.remainingAmount) >= requestAmountBigInt;
        } catch {
          return false;
        }
      });

      if (fundedTransfers.length === 0) {
        return {
          success: false,
          error: `No active transfers found with sufficient remaining balance (required: ${request.amount} ${request.token || ''})`.trim(),
        };
      }

      // 5. Evaluate spending rules and score candidates
      interface ScoredCandidate {
        transfer: ConditionalTransfer;
        score: number;
        eligible: boolean;
        reason?: string;
      }

      const scoredCandidates: ScoredCandidate[] = fundedTransfers.map(transfer => {
        let score = 0;
        let eligible = true;
        let reason = '';

        for (const rule of transfer.spendingRules || []) {
          const ruleType = rule.ruleType;
          const params = rule.parameters || {};

          if (ruleType === 'merchant_whitelist') {
            const allowed = params.merchant_id || params.merchantId || params.merchants || '';
            const allowedList = allowed.split(',').map(s => s.trim());
            if (allowed && !allowedList.includes(request.merchantId)) {
              eligible = false;
              reason = `Merchant ${request.merchantId} not in whitelist`;
              break;
            }
            score += 10;
          } else if (ruleType === 'time_window') {
            const start = params.start_time ? Number(params.start_time) : 0;
            const end = params.end_time ? Number(params.end_time) : Infinity;
            if (now < start || now > end) {
              eligible = false;
              reason = 'Current time outside transfer spending window';
              break;
            }
            score += 5;
          } else if (ruleType === 'location_based') {
            if (request.location && params.location) {
              if (params.location !== request.location) {
                eligible = false;
                reason = `Location ${request.location} does not match required location ${params.location}`;
                break;
              }
              score += 10;
            }
          } else if (ruleType === 'category_limit') {
            const ruleCategory = (params.category || '').toLowerCase();
            if (ruleCategory === category) {
              try {
                const limit = BigInt(rule.limit);
                const usage = BigInt(rule.currentUsage || '0');
                const remainingAllowance = limit - usage;
                if (remainingAllowance < requestAmountBigInt) {
                  eligible = false;
                  reason = `Category limit exceeded for category '${category}'`;
                  break;
                }
                score += 50; // High preference for matching category rule with available limit
              } catch {
                // Ignore parse errors in heuristic
              }
            }
          }
        }

        // Favor transfers expiring sooner so funds are utilized before expiry
        score += Math.max(0, 100 - Math.floor((transfer.expiresAt - now) / (1000 * 60 * 60 * 24)));

        return { transfer, score, eligible, reason };
      });

      const eligibleCandidates = scoredCandidates
        .filter(c => c.eligible)
        .sort((a, b) => b.score - a.score);

      if (eligibleCandidates.length === 0) {
        const rejectionReason = scoredCandidates[0]?.reason || 'Spending rule restrictions';
        return {
          success: false,
          error: `No eligible transfer found matching category '${category}' and merchant '${request.merchantId}': ${rejectionReason}`,
        };
      }

      // 6. Attempt spend on best matching transfer
      const selectedTransfer = eligibleCandidates[0].transfer;
      const success = await this.spend(
        beneficiaryKey,
        selectedTransfer.id,
        request.merchantId,
        validAmount,
        category,
        request.location || 'unknown'
      );

      if (success) {
        return {
          success: true,
          transactionId: `txn_${selectedTransfer.id}_${Date.now()}`,
          transferId: selectedTransfer.id,
        };
      } else {
        return {
          success: false,
          error: 'Payment rejected by spending rules',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Payment processing failed: ${error}`,
      };
    }
  }

  /**
   * Get transfer statistics
   */
  async getTransferStatistics(transferId: string): Promise<{
    totalSpent: string;
    remainingAmount: string;
    utilizationRate: number;
    transactionCount: number;
    averageTransaction: string;
    isExpired: boolean;
  }> {
    const transfer = await this.getTransfer(transferId);
    const transactions = await this.getTransactions(transferId);

    if (!transfer) {
      throw new TransactionError(transferId, 'Transfer not found', { operation: 'get transfer stats' });
    }

    const totalSpent = transfer.spentAmount;
    const remainingAmount = transfer.remainingAmount;
    const totalAmount = transfer.amount;
    const utilizationRate = Number((BigInt(totalSpent) * BigInt(100)) / BigInt(totalAmount));
    const transactionCount = transactions.length;
    const averageTransaction = transactionCount > 0
      ? (BigInt(totalSpent) / BigInt(transactionCount)).toString()
      : '0';
    const isExpired = Date.now() > transfer.expiresAt;

    return {
      totalSpent,
      remainingAmount,
      utilizationRate,
      transactionCount,
      averageTransaction,
      isExpired
    };
  }

  /**
   * Batch create transfers for disaster response
   */
  async batchCreateTransfers(
    creatorKey: string,
    beneficiaryIds: string[],
    amount: string,
    purpose: string,
    spendingRules: SpendingRule[]
  ): Promise<string[]> {
    const results: string[] = [];

    for (const beneficiaryId of beneficiaryIds) {
      const transferId = `batch_${beneficiaryId}_${Date.now()}`;
      const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

      try {
        const result = await this.createTransfer(
          creatorKey,
          transferId,
          beneficiaryId,
          amount,
          'XLM',
          expiresAt,
          spendingRules,
          purpose
        );
        results.push(result);
      } catch (error) {
        results.push(`Failed to create transfer for ${beneficiaryId}: ${error}`);
      }
    }

    return results;
  }


  /**
   * Build an unsigned transaction for creating a conditional transfer.
   *
   * @param sourcePublicKey - Source account public key
   * @param transferId - Unique transfer identifier
   * @param beneficiaryId - Beneficiary identifier
   * @param amount - U256 integer decimal string representing transfer amount
   * @param token - Token symbol/address
   * @param expiresAt - Expiry timestamp
   * @param spendingRules - Typed spending rules configuring transfer restrictions
   * @param purpose - Purpose of transfer
   * @throws {ValidationError} If amount is not a valid U256 decimal string
   */
  async buildOfflineCreateTransfer(
    sourcePublicKey: string,
    transferId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    expiresAt: number,
    spendingRules: SpendingRule[],
    purpose: string
  ): Promise<OfflineEnvelope> {
    const validAmount = validateU256Amount(amount, 'amount');
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'create_transfer',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(transferId), nativeToScVal(beneficiaryId),
            nativeToScVal(validAmount), nativeToScVal(token), nativeToScVal(expiresAt),
            nativeToScVal(spendingRules), nativeToScVal(purpose),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
  }
  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return 'Test SDF Network ; September 2015';
      case 'mainnet':
        return 'Public Global Stellar Network ; September 2015';
      case 'standalone':
        return 'Standalone Network ; February 2017';
      default:
        throw new Error('Unsupported network');
    }
  }
}
