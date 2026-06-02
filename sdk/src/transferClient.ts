import {
  Server,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
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

export class TransferClient {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.cashTransfer);
  }

  /**
   * Create conditional cash transfer
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
    const creatorKeypair = Keypair.fromSecret(creatorKey);
    const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());

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
            nativeToScVal(amount),
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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Conditional transfer ${transferId} created successfully`;
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'create transfer' });
    }
  }

  /**
   * Attempt to spend from conditional transfer
   */
  async spend(
    beneficiaryKey: string,
    transferId: string,
    merchantId: string,
    amount: string,
    category: string,
    location: string
  ): Promise<boolean> {
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    const beneficiaryAccount = await this.server.getAccount(beneficiaryKeypair.publicKey());

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
            nativeToScVal(amount),
            nativeToScVal(category),
            nativeToScVal(location)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(beneficiaryKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new TransactionError(transferId, result.status, { operation: 'spend', merchantId });
    }
  }

  /**
   * Get transfer details
   */
  async getTransfer(transferId: string): Promise<ConditionalTransfer | null> {
    try {
      const result = await this.contract.call("get_transfer", nativeToScVal(transferId));
      const transfer = scValToNative(result.result.retval);
      return transfer;
    } catch (error) {
      console.error('Failed to get transfer:', error);
      return null;
    }
  }

  /**
   * Get transaction history for a transfer
   */
  async getTransactions(transferId: string): Promise<TransferTransaction[]> {
    try {
      const result = await this.contract.call("get_transactions", nativeToScVal(transferId));
      const transactions = scValToNative(result.result.retval);
      return transactions;
    } catch (error) {
      console.error('Failed to get transactions:', error);
      return [];
    }
  }

  /**
   * Recall unspent funds after expiry
   */
  async recallFunds(creatorKey: string, transferId: string): Promise<string> {
    const creatorKeypair = Keypair.fromSecret(creatorKey);
    const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
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
    try {
      const result = await this.contract.call("list_beneficiary_transfers", nativeToScVal(beneficiaryId));
      const transfers = scValToNative(result.result.retval);
      return transfers;
    } catch (error) {
      console.error('Failed to list beneficiary transfers:', error);
      return [];
    }
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
    const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());

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
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
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
   * Create emergency transfer template
   */
  createEmergencyTransfer(
    beneficiaryId: string,
    amount: string,
    disasterType: string
  ): {
    transferId: string;
    transfer: ConditionalTransfer;
  } {
    const transferId = `emergency_${beneficiaryId}_${Date.now()}`;
    const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

    // Default emergency spending rules
    const spendingRules = [
      this.createCategoryLimitRule('food', (BigInt(amount) * BigInt(60) / BigInt(100)).toString()),
      this.createCategoryLimitRule('medicine', (BigInt(amount) * BigInt(30) / BigInt(100)).toString()),
      this.createCategoryLimitRule('shelter', (BigInt(amount) * BigInt(10) / BigInt(100)).toString()),
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
   * Process payment request with validation
   */
  async processPaymentRequest(
    request: PaymentRequest,
    beneficiaryKey: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      // Find active transfer for beneficiary
      const transfers = await this.listBeneficiaryTransfers(request.beneficiaryId);
      
      if (transfers.length === 0) {
        return {
          success: false,
          error: 'No active transfers found for beneficiary'
        };
      }

      // Try to spend from the first available transfer
      const transfer = transfers[0];
      const success = await this.spend(
        beneficiaryKey,
        transfer.id,
        request.merchantId,
        request.amount,
        'general', // Default category
        request.location || 'unknown'
      );

      if (success) {
        return {
          success: true,
          transactionId: `txn_${transfer.id}_${Date.now()}`
        };
      } else {
        return {
          success: false,
          error: 'Payment rejected by spending rules'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Payment processing failed: ${error}`
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
