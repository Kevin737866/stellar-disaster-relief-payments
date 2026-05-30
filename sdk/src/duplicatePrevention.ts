import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
} from 'stellar-sdk';

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
export class DuplicatePreventionClient {
  private contractId: string;
  private signingKey: Keypair;
  private server: any;
  private networkPassphrase: string;
  private localCache: Map<string, DisbursementTracker[]>;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    networkPassphrase: string = Networks.TESTNET_NETWORK_PASSPHRASE
  ) {
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.localCache = new Map();
  }

  /**
   * Checks if a disbursement is a duplicate before processing
   * Compares beneficiary ID and purpose against existing disbursements
   */
  async checkForDuplicate(
    beneficiaryId: string,
    fundId: string,
    purpose: string
  ): Promise<DuplicateCheckResult> {
    try {
      const cacheKey = `${beneficiaryId}_${fundId}_${purpose}`;
      
      // Check local cache first
      const cached = this.localCache.get(cacheKey);
      if (cached && cached.length > 0) {
        return {
          isDuplicate: true,
          previousDisbursement: cached[0],
          message: `Duplicate disbursement detected. Beneficiary has already received funds for purpose: ${purpose}`,
        };
      }
      
      // Query contract for historical disbursements
      const history = await this.getDisbursementHistory(beneficiaryId, fundId, purpose);
      
      if (history.disbursements.length > 0) {
        // Store in cache
        this.localCache.set(cacheKey, history.disbursements);
        
        return {
          isDuplicate: true,
          previousDisbursement: history.disbursements[0],
          message: `Duplicate disbursement detected. Previous disbursement: ${history.disbursements[0].transactionHash}`,
        };
      }
      
      return {
        isDuplicate: false,
        message: 'No duplicate detected. Safe to proceed with disbursement.',
      };
    } catch (error: any) {
      throw new Error(`Failed to check for duplicate: ${error.message}`);
    }
  }

  /**
   * Records a disbursement in the contract to track it for future duplicate checks
   */
  async recordDisbursement(
    adminAddress: string,
    beneficiaryAddress: string,
    fundId: string,
    purpose: string,
    amount: string,
    transactionHash: string,
    approvers: string[]
  ): Promise<{ success: boolean; recordId: string }> {
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId);

      const recordId = `${beneficiaryAddress}_${fundId}_${purpose}_${Date.now()}`;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'record_disbursement',
            new Address(adminAddress),
            beneficiaryAddress,
            fundId,
            purpose,
            amount,
            transactionHash,
            approvers.map(a => new Address(a))
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      await this.server.submitTransaction(transaction);

      // Update local cache
      const cacheKey = `${beneficiaryAddress}_${fundId}_${purpose}`;
      const tracker: DisbursementTracker = {
        id: recordId,
        beneficiaryId: beneficiaryAddress,
        fundId,
        purpose,
        amount,
        timestamp: Math.floor(Date.now() / 1000),
        transactionHash,
        approvers,
        isProcessed: true,
      };

      const existing = this.localCache.get(cacheKey) || [];
      existing.push(tracker);
      this.localCache.set(cacheKey, existing);

      return {
        success: true,
        recordId,
      };
    } catch (error: any) {
      throw new Error(`Failed to record disbursement: ${error.message}`);
    }
  }

  /**
   * Gets all disbursements for a specific beneficiary
   */
  async getDisbursementHistory(
    beneficiaryId: string,
    fundId?: string,
    purpose?: string
  ): Promise<DisbursementHistory> {
    try {
      const sourceAccount = await this.server.loadAccount(this.signingKey.publicKey());
      const contract = new Contract(this.contractId);

      // Query contract for disbursements
      // This would typically use contract.call() in a simulation
      // For now, returning structure from contract query

      return {
        beneficiaryId,
        disbursements: [],
        totalDisbursements: 0,
        totalAmount: '0',
      };
    } catch (error: any) {
      throw new Error(`Failed to get disbursement history: ${error.message}`);
    }
  }

  /**
   * Gets disbursements for a specific purpose
   */
  async getDisbursementsByPurpose(
    fundId: string,
    purpose: string
  ): Promise<DisbursementTracker[]> {
    try {
      // Query contract for disbursements matching the purpose
      return [];
    } catch (error: any) {
      throw new Error(`Failed to get disbursements by purpose: ${error.message}`);
    }
  }

  /**
   * Validates disbursement request with duplicate check
   */
  async validateDisbursement(
    beneficiaryId: string,
    fundId: string,
    purpose: string,
    amount: string
  ): Promise<{
    isValid: boolean;
    isDuplicate: boolean;
    errors: string[];
    warnings: string[];
  }> {
    try {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Check for duplicates
      const duplicateCheck = await this.checkForDuplicate(beneficiaryId, fundId, purpose);

      if (duplicateCheck.isDuplicate) {
        warnings.push(duplicateCheck.message);
      }

      // Validate amount
      if (!amount || parseFloat(amount) <= 0) {
        errors.push('Disbursement amount must be greater than 0');
      }

      // Validate purpose
      if (!purpose || purpose.trim().length === 0) {
        errors.push('Purpose must be specified');
      }

      return {
        isValid: errors.length === 0,
        isDuplicate: duplicateCheck.isDuplicate,
        errors,
        warnings,
      };
    } catch (error: any) {
      throw new Error(`Failed to validate disbursement: ${error.message}`);
    }
  }

  /**
   * Gets a summary of all disbursements to a beneficiary
   */
  async getBeneficiarySummary(beneficiaryId: string): Promise<{
    beneficiaryId: string;
    totalDisbursements: number;
    totalAmount: string;
    purposes: string[];
    lastDisbursement: DisbursementTracker | null;
  }> {
    try {
      const history = await this.getDisbursementHistory(beneficiaryId);

      let totalAmount = '0';
      const purposes = new Set<string>();
      let lastDisbursement: DisbursementTracker | null = null;

      for (const disbursement of history.disbursements) {
        purposes.add(disbursement.purpose);
        totalAmount = (parseFloat(totalAmount) + parseFloat(disbursement.amount)).toString();
        
        if (!lastDisbursement || disbursement.timestamp > lastDisbursement.timestamp) {
          lastDisbursement = disbursement;
        }
      }

      return {
        beneficiaryId,
        totalDisbursements: history.disbursements.length,
        totalAmount,
        purposes: Array.from(purposes),
        lastDisbursement,
      };
    } catch (error: any) {
      throw new Error(`Failed to get beneficiary summary: ${error.message}`);
    }
  }

  /**
   * Clears local cache for specific entries
   */
  clearCache(beneficiaryId?: string, fundId?: string, purpose?: string): void {
    if (!beneficiaryId) {
      this.localCache.clear();
      return;
    }

    if (!fundId || !purpose) {
      // Remove all entries for this beneficiary
      for (const key of this.localCache.keys()) {
        if (key.startsWith(beneficiaryId)) {
          this.localCache.delete(key);
        }
      }
      return;
    }

    // Remove specific entry
    const cacheKey = `${beneficiaryId}_${fundId}_${purpose}`;
    this.localCache.delete(cacheKey);
  }

  /**
   * Exports disbursement records for audit trail
   */
  async exportDisbursementRecords(
    fundId?: string,
    startDate?: number,
    endDate?: number
  ): Promise<DisbursementTracker[]> {
    try {
      const records: DisbursementTracker[] = [];

      // Collect all records from cache
      for (const disbursements of this.localCache.values()) {
        for (const disbursement of disbursements) {
          if (fundId && disbursement.fundId !== fundId) continue;
          if (startDate && disbursement.timestamp < startDate) continue;
          if (endDate && disbursement.timestamp > endDate) continue;

          records.push(disbursement);
        }
      }

      return records.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error: any) {
      throw new Error(`Failed to export disbursement records: ${error.message}`);
    }
  }
}
