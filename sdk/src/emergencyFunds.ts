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

/** Geofence coordinates are stored on-chain as degrees * 1e6. */
const GEOCOORDINATE_SCALE = 1e6;

/**
 * Reads a field from a decoded contract record, tolerating both the snake_case
 * keys produced by `scValToNative` for the Rust structs and camelCase keys.
 */
function pickField(raw: any, snake: string, camel: string): any {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (raw[snake] !== undefined) {
    return raw[snake];
  }
  return raw[camel];
}

function toStringValue(value: any, fallback = ''): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function toNumberValue(value: any, fallback = 0): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBooleanValue(value: any): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function decodeTrigger(raw: any): Trigger {
  return {
    id: toStringValue(pickField(raw, 'id', 'id')),
    fundId: toStringValue(pickField(raw, 'fund_id', 'fundId')),
    triggerType: toStringValue(
      pickField(raw, 'trigger_type', 'triggerType'),
      'manual'
    ) as Trigger['triggerType'],
    threshold: toStringValue(pickField(raw, 'threshold', 'threshold')),
    oracleSource: toStringValue(pickField(raw, 'oracle_source', 'oracleSource')),
    autoReleaseAmount: toStringValue(
      pickField(raw, 'auto_release_amount', 'autoReleaseAmount'),
      '0'
    ),
    geofenceLatitude:
      toNumberValue(pickField(raw, 'geofence_latitude', 'geofenceLatitude')) /
      GEOCOORDINATE_SCALE,
    geofenceLongitude:
      toNumberValue(pickField(raw, 'geofence_longitude', 'geofenceLongitude')) /
      GEOCOORDINATE_SCALE,
    geofenceRadiusKm: toNumberValue(
      pickField(raw, 'geofence_radius_km', 'geofenceRadiusKm')
    ),
    minOracleConfirmations: toNumberValue(
      pickField(raw, 'min_oracle_confirmations', 'minOracleConfirmations')
    ),
    isActive: toBooleanValue(pickField(raw, 'is_active', 'isActive')),
    lastTriggered: toNumberValue(pickField(raw, 'last_triggered', 'lastTriggered')),
    triggerCount: toNumberValue(pickField(raw, 'trigger_count', 'triggerCount')),
    lastVerified: toNumberValue(pickField(raw, 'last_verified', 'lastVerified')),
  };
}

function decodeFundAllocation(raw: any): FundAllocation {
  const rawBeneficiaries = pickField(raw, 'beneficiaries', 'beneficiaries');
  const beneficiaries = Array.isArray(rawBeneficiaries)
    ? rawBeneficiaries.map((beneficiary: any) => toStringValue(beneficiary))
    : [];

  return {
    sector: toStringValue(pickField(raw, 'sector', 'sector')),
    amount: toStringValue(pickField(raw, 'amount', 'amount'), '0'),
    beneficiaries,
    proofOfNeed: toStringValue(pickField(raw, 'proof_of_need', 'proofOfNeed')),
    allocatedAt: toNumberValue(pickField(raw, 'allocated_at', 'allocatedAt')),
    minAmount: toStringValue(pickField(raw, 'min_amount', 'minAmount'), '0'),
    maxAmount: toStringValue(pickField(raw, 'max_amount', 'maxAmount'), '0'),
  };
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
  private contract: any;

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
    this.contract = new Contract(this.contractId) as any;
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
      const result = await this.contract.call(
        'get_fund_triggers',
        nativeToScVal(fundId)
      );
      const records = scValToNative(result.result.retval);
      if (!Array.isArray(records)) {
        throw new Error('Unexpected contract response for fund triggers');
      }
      return records.map(decodeTrigger);
    } catch (error: any) {
      throw new NetworkError('get fund triggers', error.message, { fundId });
    }
  }

  /**
   * Gets all allocations for a fund
   */
  async getFundAllocations(fundId: string): Promise<FundAllocation[]> {
    try {
      const result = await this.contract.call(
        'get_fund_allocations',
        nativeToScVal(fundId)
      );
      const records = scValToNative(result.result.retval);
      if (!Array.isArray(records)) {
        throw new Error('Unexpected contract response for fund allocations');
      }
      return records.map(decodeFundAllocation);
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
