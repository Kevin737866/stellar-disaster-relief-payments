import {
  Address,
  Contract,
  Signer,
  Networks,
  TransactionBuilder,
  FeeBumpTransaction,
  Operation,
  xdr,
  Keypair,
  BASE_FEE,
  scValToNative,
} from 'stellar-sdk';
import {
  FundCreationError,
  TriggerExecutionError,
  InsufficientApprovalsError,
  UnauthorizedApproverError,
  AllocationError,
  AllocationBelowMinimumError,
  AllocationExceedsMaximumError,
  NetworkError,
  ValidationError,
  UnauthorizedError,
} from './errors';
import { withRetry } from './retry';
import { validateAddress, validateAddressList } from './validation';

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
  metadata: Record<string, string>;
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
  minAmount: string;
  maxAmount: string;
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

export interface PaginatedDisbursements {
  records: DisbursementRecord[];
  totalCount: number;
  hasMore: boolean;
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
 * Decodes the recalled amount from a Soroban transaction response.
 *
 * The `recall_unused_funds` contract function returns an i128 representing the
 * number of stroops recalled. `scValToNative` converts it to a BigInt; we
 * stringify it to preserve exact integer semantics across all magnitudes.
 *
 * Throws if the return value is absent or is not a numeric type, so callers
 * always see an explicit error rather than a silent zero.
 */
export function decodeRecalledAmount(response: any): string {
  try {
    const meta = response.resultMetaXdr;
    if (!meta) {
      throw new Error('resultMetaXdr is absent from transaction response');
    }

    // TransactionMeta v3 carries per-operation Soroban return values.
    const v3 = typeof meta.v3 === 'function' ? meta.v3() : meta.v3;
    if (!v3) {
      throw new Error('resultMetaXdr has no v3 field');
    }

    const sorobanMeta =
      typeof v3.sorobanMeta === 'function' ? v3.sorobanMeta() : v3.sorobanMeta;
    if (!sorobanMeta) {
      throw new Error('v3 metadata has no sorobanMeta field');
    }

    const returnVal =
      typeof sorobanMeta.returnValue === 'function'
        ? sorobanMeta.returnValue()
        : sorobanMeta.returnValue;
    if (returnVal === undefined || returnVal === null) {
      throw new Error('sorobanMeta has no returnValue');
    }

    const native = scValToNative(returnVal);

    if (typeof native === 'bigint') {
      return native.toString();
    }
    if (typeof native === 'number') {
      // Guard against floating-point imprecision for large amounts.
      if (!Number.isInteger(native)) {
        throw new Error(
          `contract returned non-integer numeric value: ${native}`
        );
      }
      return String(native);
    }
    if (typeof native === 'string') {
      // Accept a string only when it represents a valid integer.
      if (!/^-?\d+$/.test(native)) {
        throw new Error(
          `contract returned non-integer string value: "${native}"`
        );
      }
      return native;
    }

    throw new Error(
      `unexpected return value type: ${typeof native} (value: ${native})`
    );
  } catch (error: any) {
    throw new NetworkError(
      'decode recalled amount',
      error.message,
      { responseHash: response?.hash }
    );
  }
}

/**
 * Emergency Fund SDK Client
 * Manages creation, deployment, monitoring, and execution of emergency funds
 * with multi-sig releases and automated trigger execution
 */
export class EmergencyFundsClient {
  private contractId: string;
  private signingKey: Keypair;
  private server: any;
  private networkPassphrase: string;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    networkPassphrase: string = Networks.TESTNET
  ) {
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Creates an emergency fund with pre-positioned capital and defined triggers
   * Enables rapid response to disasters
   */
  async createFund(
    adminAddress: string,
    fundId: string,
    name: string,
    description: string,
    totalAmount: string,
    disasterType: string,
    geographicScope: string,
    expiresAt: number,
    signersArray: string[],
    requiredSignatures: number,
    metadata: Record<string, string> = {}
  ): Promise<{ success: boolean; transactionHash: string; fundId: string }> {
    validateAddress(adminAddress, 'adminAddress');
    validateAddressList(signersArray, 'signersArray');
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(adminAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'create_fund',
            new Address(adminAddress),
            fundId,
            name,
            description,
            totalAmount,
            disasterType,
            geographicScope,
            expiresAt,
            signersArray.map(s => new Address(s)),
            requiredSignatures,
            metadata
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);

      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));
      return {
        success: true,
        transactionHash: response.hash,
        fundId,
      };
    } catch (error: any) {
      throw new FundCreationError(fundId, error.message, { adminAddress, disasterType, geographicScope });
    }
  }

  /**
   * Adds an automated trigger to a fund
   * Trigger can be based on seismic, weather, conflict, or health events
   */
  async addTrigger(
    adminAddress: string,
    fundId: string,
    triggerId: string,
    triggerType: string,
    threshold: string,
    oracleSource: string,
    autoReleaseAmount: string,
    geofenceLatitude: number,
    geofenceLongitude: number,
    geofenceRadiusKm: number,
    minOracleConfirmations: number
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(adminAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'add_trigger',
            new Address(adminAddress),
            fundId,
            triggerId,
            triggerType,
            threshold,
            oracleSource,
            autoReleaseAmount,
            Math.floor(geofenceLatitude * 1e6),
            Math.floor(geofenceLongitude * 1e6),
            geofenceRadiusKm,
            minOracleConfirmations
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new Error(`Trigger addition failed: ${error.message}`);
    }
  }

  /**
   * Submits oracle data to trigger verification
   * Multi-source verification prevents manipulation
   */
  async submitOracleData(
    oracleAddress: string,
    fundId: string,
    triggerId: string,
    dataType: string,
    value: string,
    location: string,
    confidence: number
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(oracleAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'submit_oracle_data',
            new Address(oracleAddress),
            fundId,
            triggerId,
            dataType,
            value,
            location,
            confidence
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new Error(`Oracle data submission failed: ${error.message}`);
    }
  }

  /**
   * Executes automated trigger release
   * Called when oracle conditions are met and confirmations received
   */
  async executeTrigger(
    fundId: string,
    triggerId: string,
    signerAddress: string
  ): Promise<TriggerExecutionResult> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(signerAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'execute_trigger',
            fundId,
            triggerId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        fundId,
        triggerId,
        amountReleased: '0', // Would come from contract response
        timestamp: Date.now(),
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new TriggerExecutionError(triggerId, fundId, error.message, { signerAddress });
    }
  }

  /**
   * Executes batch multi-sig release for multiple beneficiaries atomically.
   * All entries succeed or all fail.
   *
   * @param fundId    Fund to draw from
   * @param entries   Array of { beneficiary, amount, purpose }
   * @param approvers Keypairs of multi-sig approvers
   */
  async executeBatchMultiSigRelease(
    fundId: string,
    entries: Array<{ beneficiary: string; amount: string; purpose: string }>,
    approvers: Keypair[]
  ): Promise<{ success: boolean; transactionHash: string; count: number }> {
    if (entries.length === 0) {
      throw new Error('Batch must contain at least one entry');
    }

    try {
      const primaryAccount = await this.server.loadAccount(approvers[0].publicKey());
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(primaryAccount, {
        fee: String(Number(BASE_FEE) * approvers.length),
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'submit_batch_disbursement',
            new Address(approvers[0].publicKey()),
            fundId,
            entries.map(e => [new Address(e.beneficiary), e.amount, e.purpose]),
            approvers.map(a => new Address(a.publicKey()))
          )
        )
        .setTimeout(300)
        .build();

      for (const approver of approvers) {
        transaction.sign(approver);
      }

      const response = await this.server.submitTransaction(transaction);
      return {
        success: true,
        transactionHash: response.hash,
        count: entries.length,
      };
    } catch (error: any) {
      throw new Error(`Batch multi-sig release failed: ${error.message}`);
    }
  }

  /**
   * Executes multi-sig manual release requiring 2-of-3 approvals
   * Requires authorization from NGO, government, or UN representatives
   */
  async executeMultiSigRelease(
    fundId: string,
    beneficiary: string,
    amount: string,
    purpose: string,
    approvers: Keypair[]
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const primaryAccount = await withRetry<any>(() => this.server.loadAccount(approvers[0].publicKey()));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(primaryAccount, {
        fee: String(Number(BASE_FEE) * approvers.length),
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'execute_multi_sig_release',
            fundId,
            new Address(beneficiary),
            amount,
            purpose,
            approvers.map(a => new Address(a.publicKey()))
          )
        )
        .setTimeout(300)
        .build();

      // Sign with all approvers
      for (const approver of approvers) {
        transaction.sign(approver);
      }

      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));
      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      if (error.message?.includes('Insufficient approvals')) {
        throw new InsufficientApprovalsError(fundId, approvers.length, 0, { beneficiary, amount });
      }
      if (error.message?.includes('Unauthorized')) {
        throw new UnauthorizedApproverError(fundId, approvers[0].publicKey(), { beneficiary });
      }
      throw new NetworkError('multi-sig release', error.message, { fundId, beneficiary, amount });
    }
  }

  /**
   * Allocates funds to specific sectors with beneficiary tracking
   */
  async allocateFunds(
    adminAddress: string,
    fundId: string,
    sector: string,
    amount: string,
    beneficiaries: string[],
    proofOfNeed: string,
    minAmount: string,
    maxAmount: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(adminAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'allocate_funds',
            new Address(adminAddress),
            fundId,
            sector,
            amount,
            beneficiaries.map(b => new Address(b)),
            proofOfNeed,
            minAmount,
            maxAmount
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      if (error.message?.includes('below minimum')) {
        throw new AllocationBelowMinimumError(fundId, sector, amount, minAmount, { adminAddress });
      }
      if (error.message?.includes('exceeds maximum')) {
        throw new AllocationExceedsMaximumError(fundId, sector, amount, maxAmount, { adminAddress });
      }
      throw new AllocationError(fundId, sector, error.message, { adminAddress, amount, beneficiaries });
    }
  }

  /**
   * Retrieves current status and metrics of an emergency fund
   */
  async getFundStatus(fundId: string): Promise<FundStatus> {
    try {
      const contract = new Contract(this.contractId) as any;

      // Note: This would typically use contract.call() in a simulation
      // For now, returning a placeholder structure
      return {
        status: 'active',
        totalAmount: '0',
        releasedAmount: '0',
        availableAmount: '0',
        beneficiaryCount: 0,
      };
    } catch (error: any) {
      throw new NetworkError('get fund status', error.message, { fundId });
    }
  }

  /**
   * Gets all triggers configured for a fund
   */
  async getFundTriggers(fundId: string): Promise<Trigger[]> {
    try {
      // Query contract for triggers
      return [];
    } catch (error: any) {
      throw new NetworkError('get fund triggers', error.message, { fundId });
    }
  }

  /**
   * Gets all allocations for a fund
   */
  async getFundAllocations(fundId: string): Promise<FundAllocation[]> {
    try {
      // Query contract for allocations
      return [];
    } catch (error: any) {
      throw new NetworkError('get fund allocations', error.message, { fundId });
    }
  }

  /**
   * Gets disbursement history for a fund with pagination
   */
  async getDisbursementHistory(
    fundId: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<PaginatedDisbursements> {
    try {
      const contract = new Contract(this.contractId) as any;

      // Note: This would typically use contract.call() in a simulation
      // For now, returning a placeholder structure
      return {
        records: [],
        totalCount: 0,
        hasMore: false,
      };
    } catch (error: any) {
      throw new NetworkError('get disbursement history', error.message, { fundId, offset, limit });
    }
  }

  /**
   * Recalls unused funds after 12 month period.
   * Returns the amount confirmed by the contract, decoded from the transaction
   * result metadata. Throws NetworkError when the transaction fails or when
   * the contract return value cannot be decoded (a failed recall is never
   * silently reported as a zero recall).
   */
  async recallUnusedFunds(
    donorAddress: string,
    fundId: string
  ): Promise<{ success: boolean; recalledAmount: string; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(donorAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'recall_unused_funds',
            new Address(donorAddress),
            fundId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      // A non-successful status means the recall did not execute; never report
      // that as a zero amount.
      if (response.status && response.status !== 'SUCCESS') {
        throw new NetworkError(
          'recall unused funds',
          `transaction status ${response.status}`,
          { fundId, donorAddress }
        );
      }

      const recalledAmount = decodeRecalledAmount(response);

      return {
        success: true,
        recalledAmount,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      if (error instanceof NetworkError) throw error;
      throw new NetworkError('recall unused funds', error.message, { fundId, donorAddress });
    }
  }

  /**
   * Enables recall capability for a fund
   */
  async enableRecall(
    adminAddress: string,
    fundId: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(adminAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'enable_recall',
            new Address(adminAddress),
            fundId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new NetworkError('enable recall', error.message, { fundId, adminAddress });
    }
  }

  /**
   * Deactivates a trigger
   */
  async deactivateTrigger(
    adminAddress: string,
    fundId: string,
    triggerId: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await withRetry<any>(() => this.server.loadAccount(adminAddress));
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'deactivate_trigger',
            new Address(adminAddress),
            fundId,
            triggerId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new TriggerExecutionError(triggerId, fundId, error.message, { adminAddress });
    }
  }

  /**
   * Updates metadata for a fund
   */
  async updateMetadata(
    adminAddress: string,
    fundId: string,
    metadata: Record<string, string>
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'update_metadata',
            new Address(adminAddress),
            fundId,
            metadata
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await this.server.submitTransaction(transaction);

      return {
        success: true,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new NetworkError('update metadata', error.message, { fundId, adminAddress });
    }
  }

  /**
   * Gets metadata for a fund
   */
  async getMetadata(fundId: string): Promise<Record<string, string>> {
    try {
      const contract = new Contract(this.contractId) as any;

      // Note: This would typically use contract.call() in a simulation
      // For now, returning a placeholder structure
      return {};
    } catch (error: any) {
      throw new NetworkError('get fund metadata', error.message, { fundId });
    }
  }

  /**
   * Monitors oracle data feeds for trigger validation
   * Implements multi-source verification to prevent manipulation
   */
  async monitorOracleFeeds(fundId: string, triggerId: string): Promise<OracleData[]> {
    try {
      // Fetch from multiple oracle sources
      const oracleEntries: OracleData[] = [];
      // Implementation would query actual oracle data
      return oracleEntries;
    } catch (error: any) {
      throw new NetworkError('monitor oracle feeds', error.message, { fundId, triggerId });
    }
  }

  /**
   * Generates impact report with beneficiary count and sector breakdown
   */
  async generateImpactReport(fundId: string): Promise<{
    fundId: string;
    totalBeneficiaries: number;
    sectorBreakdown: Record<string, number>;
    amountDistributed: string;
    transactionCount: number;
  }> {
    try {
      const allocations = await this.getFundAllocations(fundId);
      const disbursements = await this.getDisbursementHistory(fundId);

      const sectorBreakdown: Record<string, number> = {};
      let totalBeneficiaries = 0;
      let amountDistributed = '0';

      for (const allocation of allocations) {
        sectorBreakdown[allocation.sector] = allocation.beneficiaries.length;
        totalBeneficiaries += allocation.beneficiaries.length;
      }

      return {
        fundId,
        totalBeneficiaries,
        sectorBreakdown,
        amountDistributed,
        transactionCount: disbursements.records.length,
      };
    } catch (error: any) {
      throw new NetworkError('generate impact report', error.message, { fundId });
    }
  }

  /**
   * Transfers unused funds from one disaster fund to another
   * Enables reallocation of resources to more pressing needs
   */
  async transferFundsBetweenDisasters(
    adminAddress: string,
    sourceFundId: string,
    destinationFundId: string,
    amount: string,
    reason: string
  ): Promise<{ success: boolean; transactionHash: string; transferAmount: string }> {
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'transfer_funds_between_disasters',
            new Address(adminAddress),
            sourceFundId,
            destinationFundId,
            amount,
            reason
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await this.server.submitTransaction(transaction);

      return {
        success: true,
        transactionHash: response.hash,
        transferAmount: amount,
      };
    } catch (error: any) {
      throw new Error(`Fund transfer between disasters failed: ${error.message}`);
    }
  }
}
