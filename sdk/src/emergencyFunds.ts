import {
  Account,
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
  nativeToScVal,
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

const DEFAULT_DISBURSEMENT_PAGE_SIZE = 50;
const MAX_DISBURSEMENT_PAGE_SIZE = 100;

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
   * Gets disbursement history for a fund with pagination.
   *
   * Validates `offset`/`limit` before issuing the contract read, then decodes the
   * returned `PaginatedDisbursements` structure into the SDK page shape. An empty
   * page is only returned when the contract query succeeds with an empty result.
   */
  async getDisbursementHistory(
    fundId: string,
    offset: number = 0,
    limit: number = DEFAULT_DISBURSEMENT_PAGE_SIZE
  ): Promise<PaginatedDisbursements> {
    this.validateDisbursementPage(offset, limit);

    try {
      const contract = new Contract(this.contractId) as any;
      const operation = await contract.call(
        'get_disbursements',
        nativeToScVal(fundId),
        nativeToScVal(offset),
        nativeToScVal(limit)
      );

      const directValue = this.extractContractReturnValue(operation);
      if (directValue !== undefined) {
        return this.toDisbursementPage(directValue, offset);
      }

      // Real `Contract.call` returns an operation. Simulate it as a read to obtain
      // the contract's return value without submitting a transaction.
      const simulatedValue = await this.simulateContractRead(operation);
      return this.toDisbursementPage(simulatedValue, offset);
    } catch (error: any) {
      throw new NetworkError('get disbursement history', error.message, { fundId, offset, limit });
    }
  }

  private validateDisbursementPage(offset: number, limit: number): void {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('offset', 'offset must be a non-negative integer', { offset, limit });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISBURSEMENT_PAGE_SIZE) {
      throw new ValidationError(
        'limit',
        `limit must be an integer between 1 and ${MAX_DISBURSEMENT_PAGE_SIZE}`,
        { offset, limit }
      );
    }
  }

  private async simulateContractRead(operation: any): Promise<unknown> {
    if (typeof this.server?.simulateTransaction !== 'function') {
      throw new Error('contract result did not include a return value and simulateTransaction is unavailable');
    }

    const sourceAccount = new Account(this.signingKey.publicKey(), '0');
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const response = await this.server.simulateTransaction(transaction);
    const returnValue = this.extractContractReturnValue(response);
    if (returnValue === undefined) {
      throw new Error('simulation response did not include a contract return value');
    }
    return returnValue;
  }

  private extractContractReturnValue(response: any): unknown | undefined {
    if (response === undefined || response === null) return undefined;

    const errorMessage = response?.error ?? response?.result?.error;
    if (errorMessage !== undefined) {
      throw new Error(String(errorMessage));
    }

    if (response?.result?.retval !== undefined) return response.result.retval;
    if (response?.returnValue !== undefined) return response.returnValue;

    if (Array.isArray(response?.results)) {
      const first = response.results[0];
      if (first?.error !== undefined) throw new Error(String(first.error));
      if (first?.returnValue !== undefined) return first.returnValue;
      if (first?.result?.retval !== undefined) return first.result.retval;
    }

    if (this.isDisbursementPage(response)) return response;

    const meta = response?.resultMetaXdr ?? response?.result_meta_xdr;
    if (meta) {
      const v3 = typeof meta?.v3 === 'function' ? meta.v3() : meta?.v3;
      const sorobanMeta = typeof v3?.sorobanMeta === 'function' ? v3.sorobanMeta() : v3?.sorobanMeta;
      const returnValue =
        typeof sorobanMeta?.returnValue === 'function'
          ? sorobanMeta.returnValue()
          : sorobanMeta?.returnValue;
      if (returnValue !== undefined && returnValue !== null) return returnValue;
    }

    return undefined;
  }

  private isDisbursementPage(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 3;
    if (!value || typeof value !== 'object') return false;
    const page = value as Record<string, unknown>;
    return page.records !== undefined || page.disbursements !== undefined;
  }

  private toDisbursementPage(value: unknown, offset: number): PaginatedDisbursements {
    let decoded: unknown;
    try {
      decoded = scValToNative(value as any);
    } catch (error: any) {
      throw new Error(`failed to decode contract result: ${error.message}`);
    }

    let recordsValue: unknown;
    let totalCountValue: unknown;
    let hasMoreValue: unknown;

    if (Array.isArray(decoded)) {
      if (decoded.length === 0) {
        return { records: [], totalCount: 0, hasMore: false };
      }
      [recordsValue, totalCountValue, hasMoreValue] = decoded;
    } else if (decoded && typeof decoded === 'object') {
      const page = decoded as Record<string, unknown>;
      recordsValue = page.records ?? page.disbursements;
      totalCountValue = page.totalCount ?? page.total_count ?? page.count;
      hasMoreValue = page.hasMore ?? page.has_more;
    }

    if (!Array.isArray(recordsValue)) {
      throw new Error('contract result did not include a disbursement records array');
    }

    const records = recordsValue.map((record) => this.toDisbursementRecord(record));
    const totalCount = Number(totalCountValue ?? records.length);
    if (!Number.isFinite(totalCount) || totalCount < 0) {
      throw new Error('contract result included an invalid totalCount');
    }

    const hasMore =
      hasMoreValue === undefined ? offset + records.length < totalCount : Boolean(hasMoreValue);

    return { records, totalCount, hasMore };
  }

  private toDisbursementRecord(value: unknown): DisbursementRecord {
    let decoded: any;
    try {
      decoded = scValToNative(value as any);
    } catch (error: any) {
      throw new Error(`failed to decode disbursement record: ${error.message}`);
    }

    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('contract result included an invalid disbursement record');
    }

    const record = decoded as Record<string, any>;
    const approvedBy = record.approvedBy ?? record.approved_by ?? [];
    if (!Array.isArray(approvedBy)) {
      throw new Error('contract result included invalid disbursement approvers');
    }

    const triggerId = record.triggerId ?? record.trigger_id;
    return {
      id: String(record.id ?? ''),
      fundId: String(record.fundId ?? record.fund_id ?? ''),
      beneficiary: String(record.beneficiary ?? ''),
      amount: String(record.amount ?? '0'),
      timestamp: Number(record.timestamp ?? 0),
      purpose: String(record.purpose ?? ''),
      approvedBy: approvedBy.map((approver: unknown) => String(approver)),
      transactionHash: String(record.transactionHash ?? record.transaction_hash ?? ''),
      ...(triggerId !== undefined ? { triggerId: String(triggerId) } : {}),
      isAutoReleased: Boolean(record.isAutoReleased ?? record.is_auto_released ?? false),
    };
  }

  /**
   * Recalls unused funds after 12 month period
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

      return {
        success: true,
        recalledAmount: '0',
        transactionHash: response.hash,
      };
    } catch (error: any) {
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
   * Gets metadata for a fund.
   *
   * An empty object is returned only when the contract query succeeds with an
   * empty metadata map. RPC, simulation, and decoding failures are surfaced as
   * errors instead of an empty success response.
   */
  async getMetadata(fundId: string): Promise<Record<string, string>> {
    try {
      const contract = new Contract(this.contractId) as any;
      const operation = await contract.call('get_metadata', nativeToScVal(fundId));

      const directValue = this.extractContractReturnValue(operation);
      const value = directValue !== undefined ? directValue : await this.simulateContractRead(operation);
      return this.toMetadataMap(value);
    } catch (error: any) {
      throw new NetworkError('get fund metadata', error.message, { fundId });
    }
  }

  private toMetadataMap(value: unknown): Record<string, string> {
    let decoded: unknown;
    try {
      decoded = scValToNative(value as any);
    } catch (error: any) {
      throw new Error(`failed to decode metadata: ${error.message}`);
    }

    const entries: Array<[unknown, unknown]> = decoded instanceof Map
      ? Array.from(decoded.entries())
      : Array.isArray(decoded)
        ? decoded.map((entry) => {
            if (!Array.isArray(entry) || entry.length !== 2) {
              throw new Error('contract result included invalid metadata entry');
            }
            return [entry[0], entry[1]] as [unknown, unknown];
          })
        : decoded && typeof decoded === 'object'
          ? Object.entries(decoded as Record<string, unknown>)
          : [];

    if (!decoded || (typeof decoded !== 'object' && !Array.isArray(decoded))) {
      throw new Error('contract result did not include a metadata map');
    }

    const metadata: Record<string, string> = {};
    for (const [key, entryValue] of entries) {
      if (typeof entryValue !== 'string') {
        throw new Error('contract result included non-string metadata value');
      }
      metadata[String(key)] = entryValue;
    }
    return metadata;
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
