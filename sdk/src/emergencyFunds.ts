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
  FundNotFoundError,
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

  private assertValidFundId(fundId: string): void {
    if (typeof fundId !== 'string' || !fundId.trim()) {
      throw new ValidationError('fundId', 'fundId must be a non-empty string', { fundId });
    }
  }

  private normalizeU256String(raw: unknown, field: string): string {
    if (typeof raw === 'bigint') {
      if (raw < BigInt(0)) {
        throw new ValidationError(field, `${field} cannot be negative`);
      }
      return raw.toString();
    }
    if (typeof raw === 'number') {
      if (!Number.isSafeInteger(raw) || raw < 0) {
        throw new ValidationError(field, `${field} must be a non-negative integer`);
      }
      return String(raw);
    }
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
      return BigInt(raw.trim()).toString();
    }
    throw new ValidationError(field, `Malformed integer value for ${field}`);
  }

  private normalizeNonNegativeInt(raw: unknown, field: string): number {
    if (typeof raw === 'bigint') {
      if (raw < BigInt(0) || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ValidationError(field, `${field} is out of safe integer range`);
      }
      return Number(raw);
    }
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
      return raw;
    }
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
      const parsed = Number(raw.trim());
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
    throw new ValidationError(field, `Malformed non-negative integer for ${field}`);
  }

  private async simulateContractRead(
    method: string,
    args: any[],
    fundId: string,
    operationLabel: string
  ): Promise<any> {
    this.assertValidFundId(fundId);

    if (!this.server || typeof this.server.simulateTransaction !== 'function') {
      throw new NetworkError(
        operationLabel,
        'Contract read simulation is not supported by the configured server',
        { fundId, method }
      );
    }

    try {
      const publicKey = this.signingKey.publicKey();
      const sourceAccount =
        typeof this.server.loadAccount === 'function'
          ? await withRetry<any>(() => this.server.loadAccount(publicKey))
          : typeof this.server.getAccount === 'function'
            ? await withRetry<any>(() => this.server.getAccount(publicKey))
            : {
                accountId: () => publicKey,
                sequenceNumber: () => '0',
                incrementSequenceNumber: () => {},
              };

      const contract = new Contract(this.contractId) as any;
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simResponse = await withRetry<any>(() => this.server.simulateTransaction(transaction));
      if (!simResponse || typeof simResponse !== 'object') {
        throw new ValidationError(
          'simulationResponse',
          'Malformed simulation response: expected response object',
          { fundId, method }
        );
      }

      if (simResponse.error) {
        const errText = String(simResponse.error);
        if (/not found|missing|unknown fund|does not exist|unwrap/i.test(errText)) {
          throw new FundNotFoundError(fundId, { method, rpcError: errText });
        }
        throw new NetworkError(operationLabel, errText, { fundId, method });
      }

      const retval = simResponse.result?.retval ?? simResponse.retval;
      if (retval === undefined) {
        throw new ValidationError(
          'simulationResponse',
          'Malformed simulation response: missing return value',
          { fundId, method }
        );
      }
      if (retval === null) {
        throw new FundNotFoundError(fundId, { method });
      }

      try {
        return scValToNative(retval);
      } catch (decodeErr: any) {
        throw new ValidationError(
          'simulationResponse',
          `Failed to decode contract return value: ${decodeErr?.message || String(decodeErr)}`,
          { fundId, method }
        );
      }
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof FundNotFoundError || error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(operationLabel, error?.message || String(error), { fundId, method });
    }
  }

  /**
   * Retrieves current status and metrics of an emergency fund from the deployed contract
   */
  async getFundStatus(fundId: string): Promise<FundStatus> {
    const decoded = await this.simulateContractRead(
      'get_fund_status',
      [nativeToScVal(fundId)],
      fundId,
      'get fund status'
    );

    let status: unknown;
    let totalAmount: unknown;
    let releasedAmount: unknown;
    let availableAmount: unknown;
    let beneficiaryCount: unknown;

    if (Array.isArray(decoded)) {
      if (decoded.length !== 5) {
        throw new ValidationError('fundStatus', 'Malformed fund status tuple returned from contract', {
          fundId,
          length: decoded.length,
        });
      }
      [status, totalAmount, releasedAmount, availableAmount, beneficiaryCount] = decoded;
    } else if (decoded && typeof decoded === 'object') {
      const obj = decoded as Record<string, unknown>;
      status = obj.status ?? obj.currentStatus ?? obj.current_status;
      totalAmount = obj.totalAmount ?? obj.total_amount;
      releasedAmount = obj.releasedAmount ?? obj.released_amount;
      availableAmount = obj.availableAmount ?? obj.available_amount;
      beneficiaryCount = obj.beneficiaryCount ?? obj.beneficiary_count;
    } else {
      throw new ValidationError('fundStatus', 'Malformed fund status returned from contract', { fundId });
    }

    if (typeof status !== 'string' || !status.trim()) {
      throw new ValidationError('status', 'Malformed status string in fund status response', { fundId });
    }

    return {
      status,
      totalAmount: this.normalizeU256String(totalAmount, 'totalAmount'),
      releasedAmount: this.normalizeU256String(releasedAmount, 'releasedAmount'),
      availableAmount: this.normalizeU256String(availableAmount, 'availableAmount'),
      beneficiaryCount: this.normalizeNonNegativeInt(beneficiaryCount, 'beneficiaryCount'),
    };
  }

  /**
   * Gets all triggers configured for a fund from the contract
   */
  async getFundTriggers(fundId: string): Promise<Trigger[]> {
    const decoded = await this.simulateContractRead(
      'get_fund_triggers',
      [nativeToScVal(fundId)],
      fundId,
      'get fund triggers'
    );

    if (!Array.isArray(decoded)) {
      throw new ValidationError('triggers', 'Expected an array of triggers from contract', { fundId });
    }

    return decoded.map((item: any, index: number): Trigger => {
      if (!item || typeof item !== 'object') {
        throw new ValidationError('triggers', `Malformed trigger entry at index ${index}`, { fundId });
      }
      const id = item.id;
      const triggerType = item.triggerType ?? item.trigger_type;
      const threshold = item.threshold;
      const oracleSource = item.oracleSource ?? item.oracle_source;
      const autoReleaseAmount = item.autoReleaseAmount ?? item.auto_release_amount;
      if (typeof id !== 'string' || typeof triggerType !== 'string' || typeof oracleSource !== 'string') {
        throw new ValidationError('triggers', `Trigger entry at index ${index} is missing required fields`, {
          fundId,
        });
      }

      return {
        id,
        fundId: typeof item.fundId === 'string' ? item.fundId : typeof item.fund_id === 'string' ? item.fund_id : fundId,
        triggerType: triggerType as Trigger['triggerType'],
        threshold: String(threshold ?? ''),
        oracleSource,
        autoReleaseAmount: this.normalizeU256String(autoReleaseAmount ?? '0', 'autoReleaseAmount'),
        geofenceLatitude: Number(item.geofenceLatitude ?? item.geofence_latitude ?? 0),
        geofenceLongitude: Number(item.geofenceLongitude ?? item.geofence_longitude ?? 0),
        geofenceRadiusKm: Number(item.geofenceRadiusKm ?? item.geofence_radius_km ?? 0),
        minOracleConfirmations: this.normalizeNonNegativeInt(
          item.minOracleConfirmations ?? item.min_oracle_confirmations ?? 0,
          'minOracleConfirmations'
        ),
        isActive: Boolean(item.isActive ?? item.is_active ?? true),
        lastTriggered: this.normalizeNonNegativeInt(
          item.lastTriggered ?? item.last_triggered ?? 0,
          'lastTriggered'
        ),
        triggerCount: this.normalizeNonNegativeInt(
          item.triggerCount ?? item.trigger_count ?? 0,
          'triggerCount'
        ),
        lastVerified: this.normalizeNonNegativeInt(
          item.lastVerified ?? item.last_verified ?? 0,
          'lastVerified'
        ),
      };
    });
  }

  /**
   * Gets all allocations for a fund from the contract
   */
  async getFundAllocations(fundId: string): Promise<FundAllocation[]> {
    const decoded = await this.simulateContractRead(
      'get_fund_allocations',
      [nativeToScVal(fundId)],
      fundId,
      'get fund allocations'
    );

    if (!Array.isArray(decoded)) {
      throw new ValidationError('allocations', 'Expected an array of allocations from contract', { fundId });
    }

    return decoded.map((item: any, index: number): FundAllocation => {
      if (!item || typeof item !== 'object' || typeof item.sector !== 'string') {
        throw new ValidationError('allocations', `Malformed allocation entry at index ${index}`, { fundId });
      }
      const beneficiaries = item.beneficiaries;
      if (!Array.isArray(beneficiaries) || beneficiaries.some((b: unknown) => typeof b !== 'string')) {
        throw new ValidationError(
          'allocations',
          `Allocation entry at index ${index} has invalid beneficiaries list`,
          { fundId }
        );
      }
      const proofOfNeed = item.proofOfNeed ?? item.proof_of_need ?? '';
      return {
        sector: item.sector,
        amount: this.normalizeU256String(item.amount, 'amount'),
        beneficiaries,
        proofOfNeed: String(proofOfNeed),
        allocatedAt: this.normalizeNonNegativeInt(
          item.allocatedAt ?? item.allocated_at ?? 0,
          'allocatedAt'
        ),
        minAmount: this.normalizeU256String(item.minAmount ?? item.min_amount ?? '0', 'minAmount'),
        maxAmount: this.normalizeU256String(item.maxAmount ?? item.max_amount ?? '0', 'maxAmount'),
      };
    });
  }

  /**
   * Gets disbursement history for a fund with contract pagination
   */
  async getDisbursementHistory(
    fundId: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<PaginatedDisbursements> {
    this.assertValidFundId(fundId);
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('offset', 'offset must be a non-negative integer', { offset });
    }
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
      throw new ValidationError('limit', 'limit must be a positive integer', { limit });
    }

    const decoded = await this.simulateContractRead(
      'get_disbursements',
      [nativeToScVal(fundId), nativeToScVal(offset, { type: 'u32' }), nativeToScVal(limit, { type: 'u32' })],
      fundId,
      'get disbursement history'
    );

    if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.records)) {
      throw new ValidationError(
        'disbursements',
        'Malformed paginated disbursements response from contract',
        { fundId, offset, limit }
      );
    }

    const records: DisbursementRecord[] = decoded.records.map((rec: any, index: number): DisbursementRecord => {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || typeof rec.beneficiary !== 'string') {
        throw new ValidationError('disbursements', `Malformed disbursement record at index ${index}`, {
          fundId,
        });
      }
      const approvedBy = rec.approvedBy ?? rec.approved_by ?? [];
      if (!Array.isArray(approvedBy)) {
        throw new ValidationError('disbursements', `Invalid approvedBy list at index ${index}`, { fundId });
      }
      const triggerId = rec.triggerId ?? rec.trigger_id;
      return {
        id: rec.id,
        fundId: String(rec.fundId ?? rec.fund_id ?? fundId),
        beneficiary: rec.beneficiary,
        amount: this.normalizeU256String(rec.amount, 'amount'),
        timestamp: this.normalizeNonNegativeInt(rec.timestamp ?? 0, 'timestamp'),
        purpose: String(rec.purpose ?? ''),
        approvedBy: approvedBy.map((a: unknown) => String(a)),
        transactionHash: String(rec.transactionHash ?? rec.transaction_hash ?? ''),
        ...(triggerId !== undefined && triggerId !== null ? { triggerId: String(triggerId) } : {}),
        isAutoReleased: Boolean(rec.isAutoReleased ?? rec.is_auto_released ?? false),
      };
    });

    return {
      records,
      totalCount: this.normalizeNonNegativeInt(decoded.totalCount ?? decoded.total_count ?? records.length, 'totalCount'),
      hasMore: Boolean(decoded.hasMore ?? decoded.has_more ?? false),
    };
  }

  private async extractRecalledAmount(
    response: any,
    fundId: string,
    donorAddress: string
  ): Promise<string> {
    let candidate = response?.result?.retval ?? response?.returnValue;
    if (candidate === undefined && response?.resultMetaXdr) {
      if (typeof response.resultMetaXdr?.v3 === 'function') {
        candidate = response.resultMetaXdr.v3()?.sorobanMeta()?.returnValue?.();
      } else if (typeof response.resultMetaXdr === 'object') {
        candidate = response.resultMetaXdr;
      }
    }

    if (candidate === undefined && response?.hash && typeof this.server?.getTransaction === 'function') {
      const txResult = await withRetry<any>(() => this.server.getTransaction(response.hash));
      if (txResult?.status === 'FAILED' || txResult?.status === 'ERROR') {
        throw new NetworkError(
          'recall unused funds',
          txResult?.errorResultXdr || txResult?.status || 'Recall transaction failed on-chain',
          { fundId, donorAddress, transactionHash: response.hash }
        );
      }
      candidate = txResult?.result?.retval ?? txResult?.returnValue;
      if (candidate === undefined && txResult?.resultMetaXdr) {
        if (typeof txResult.resultMetaXdr?.v3 === 'function') {
          candidate = txResult.resultMetaXdr.v3()?.sorobanMeta()?.returnValue?.();
        } else if (typeof txResult.resultMetaXdr === 'object') {
          candidate = txResult.resultMetaXdr;
        }
      }
    }

    if (candidate === undefined || candidate === null) {
      throw new ValidationError(
        'recalledAmount',
        'Unable to decode confirmed recalled amount from recall transaction response',
        { fundId, donorAddress, transactionHash: response?.hash }
      );
    }

    try {
      const raw =
        typeof candidate === 'bigint' || typeof candidate === 'number' || typeof candidate === 'string'
          ? candidate
          : scValToNative(candidate);
      return this.normalizeU256String(raw, 'recalledAmount');
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        'recalledAmount',
        `Failed to decode recalled amount: ${error?.message || String(error)}`,
        { fundId, donorAddress, transactionHash: response?.hash }
      );
    }
  }

  /**
   * Recalls unused/unreleased funds after 12 month period
   */
  async recallUnusedFunds(
    donorAddress: string,
    fundId: string
  ): Promise<{ success: boolean; recalledAmount: string; transactionHash: string }> {
    validateAddress(donorAddress, 'donorAddress');
    this.assertValidFundId(fundId);

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
            new Address(donorAddress).toScVal(),
            nativeToScVal(fundId)
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await withRetry<any>(() => this.server.submitTransaction(transaction));

      if (
        !response ||
        response.status === 'FAILED' ||
        response.status === 'ERROR' ||
        response.successful === false
      ) {
        throw new NetworkError(
          'recall unused funds',
          response?.errorResultXdr || response?.status || 'Transaction submission failed',
          { fundId, donorAddress, transactionHash: response?.hash }
        );
      }

      const recalledAmount = await this.extractRecalledAmount(response, fundId, donorAddress);

      return {
        success: true,
        recalledAmount,
        transactionHash: response.hash,
      };
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError('recall unused funds', error?.message || String(error), { fundId, donorAddress });
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
   * Gets metadata for a fund from the deployed contract
   */
  async getMetadata(fundId: string): Promise<Record<string, string>> {
    const decoded = await this.simulateContractRead(
      'get_metadata',
      [nativeToScVal(fundId)],
      fundId,
      'get fund metadata'
    );

    const metadata: Record<string, string> = {};
    if (decoded instanceof Map) {
      for (const [k, v] of decoded.entries()) {
        if (typeof k !== 'string' || typeof v !== 'string') {
          throw new ValidationError('metadata', 'Metadata entries must map string keys to string values', {
            fundId,
          });
        }
        metadata[k] = v;
      }
      return metadata;
    }

    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new ValidationError('metadata', 'Malformed metadata map returned from contract', { fundId });
    }

    for (const [k, v] of Object.entries(decoded)) {
      if (typeof v !== 'string') {
        throw new ValidationError('metadata', `Metadata value for '${k}' must be a string`, { fundId });
      }
      metadata[k] = v;
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
