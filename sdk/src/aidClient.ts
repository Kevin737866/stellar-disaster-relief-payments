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
const { Server } = SorobanRpc;
type Server = SorobanRpc.Server;

import { OfflineSigner, OfflineEnvelope } from './offlineSigner';
import {
  EmergencyFund,
  DisbursementRecord,
  DeploymentOptions,
  NetworkConfig,
  BATCH_MAX_SIZE,
} from './types';
import { ReadCache } from './readCache';
import { validateAddress, validateAddressList } from './validation';
import { withRetry } from './retry';

/**
 * Maximum number of entries accepted by the on-chain batch disbursement
 * contract. Keep this in sync with `MAX_BATCH_SIZE` in `src/aid_registry.rs`.
 */
export const MAX_BATCH_SIZE = BATCH_MAX_SIZE;

/** A batch must contain at least one entry. */
export const MIN_BATCH_SIZE = 1;

/** Fallback Stellar base fee in stroops when no estimator or override is configured. */
export const DEFAULT_BASE_FEE = '100';

/** Minimum Stellar protocol base fee in stroops. */
export const MIN_BASE_FEE = 100;

/**
 * Sentinel timeout (0 seconds) passed to `TransactionBuilder.setTimeout` for
 * air-gapped offline envelopes so transactions do not expire while awaiting
 * offline multi-sig collection. Pass an explicit positive `timeoutSeconds`
 * in `OfflineTxOptions` to enforce bounded expiry on submitted envelopes.
 */
export const OFFLINE_INFINITE_TIMEOUT = 0;

export interface FeeOptions {
  /** Static fee (in stroops) overriding `DEFAULT_BASE_FEE` when no estimator is supplied. */
  baseFee?: string | number;
  /** Async hook returning an estimated fee in stroops for the named operation. */
  feeEstimator?: (operation: string) => Promise<string | number>;
}

export interface TxOptions {
  /** Per-call transaction fee override in stroops. */
  fee?: string | number;
}

export interface OfflineTxOptions extends TxOptions {
  /**
   * Transaction validity window in seconds. Defaults to `OFFLINE_INFINITE_TIMEOUT` (0),
   * meaning no ledger expiry (`TimeBounds(0, 0)`) so multi-party offline signing can
   * complete without racing a clock. Trade-off: an unconsumed signed envelope remains
   * valid indefinitely unless invalidated by consuming/bumping the source sequence number.
   */
  timeoutSeconds?: number;
}

function normalizeFee(value: string | number, label = 'fee'): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < MIN_BASE_FEE) {
      throw new Error(`Invalid ${label}: expected an integer >= ${MIN_BASE_FEE}, received ${value}`);
    }
    return String(value);
  }
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${label}: expected numeric stroops string, received "${value}"`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_BASE_FEE) {
    throw new Error(`Invalid ${label}: expected stroops >= ${MIN_BASE_FEE}, received "${value}"`);
  }
  return trimmed;
}

function parseMonetaryBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`Invalid monetary field ${fieldName}: negative value ${value.toString()}`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid monetary field ${fieldName}: unsafe or non-integer number ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid monetary field ${fieldName}: expected unsigned integer string, received "${value}"`);
    }
    return BigInt(trimmed);
  }
  throw new Error(`Invalid monetary field ${fieldName}: unsupported value type ${typeof value}`);
}

function parseBatchDisbursementResult(result: any): string[] {
  const rawCandidate = result?.returnValue ?? result?.result?.retval;
  if (rawCandidate !== undefined) {
    const decoded = Array.isArray(rawCandidate) ? rawCandidate : scValToNative(rawCandidate);
    if (!Array.isArray(decoded) || decoded.some((item) => typeof item !== 'string')) {
      throw new Error('Invalid batch disbursement return value: expected string[]');
    }
    return decoded;
  }

  if (result?.resultMetaXdr !== undefined) {
    let decoded: unknown;
    try {
      decoded = scValToNative(result.resultMetaXdr);
    } catch (err: any) {
      throw new Error(
        `Failed to parse batch disbursement IDs from transaction result: ${err?.message ?? String(err)}`
      );
    }
    if (!Array.isArray(decoded) || decoded.some((item) => typeof item !== 'string')) {
      throw new Error('Failed to parse batch disbursement IDs from transaction result: expected string[]');
    }
    return decoded;
  }

  throw new Error('Batch disbursement succeeded without a parseable return value');
}

export class AidClient {
  private server: any;
  private contract: any;
  private config: NetworkConfig;
  private feeOptions: FeeOptions;
  readonly cache: ReadCache;

  constructor(config: NetworkConfig, feeOptions: FeeOptions = {}) {
    this.config = config;
    this.feeOptions = feeOptions;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.aidRegistry);
    this.cache = new ReadCache(config);
  }

  /** Resolve transaction fee from explicit override, configured estimator, RPC fee stats, or `DEFAULT_BASE_FEE`. */
  private async resolveFee(operation: string, explicitFee?: string | number): Promise<string> {
    if (explicitFee !== undefined) {
      return normalizeFee(explicitFee, 'explicit fee');
    }
    if (this.feeOptions.feeEstimator) {
      const estimated = await this.feeOptions.feeEstimator(operation);
      return normalizeFee(estimated, 'estimated fee');
    }
    if (typeof this.server?.getFeeStats === 'function') {
      try {
        const stats = await this.server.getFeeStats();
        const rawStat =
          stats?.sorobanInclusionFee?.p50 ??
          stats?.inclusionFee?.p50 ??
          stats?.recommendedFee;
        if (rawStat !== undefined && rawStat !== null) {
          const floor = this.feeOptions.baseFee !== undefined
            ? Number(normalizeFee(this.feeOptions.baseFee, 'baseFee'))
            : MIN_BASE_FEE;
          const numeric = Math.max(floor, Math.ceil(Number(rawStat)));
          if (Number.isSafeInteger(numeric) && numeric >= MIN_BASE_FEE) {
            return String(numeric);
          }
        }
      } catch {
        // Fall through to configured/default base fee if fee stats RPC call fails.
      }
    }
    if (this.feeOptions.baseFee !== undefined) {
      return normalizeFee(this.feeOptions.baseFee, 'baseFee');
    }
    return DEFAULT_BASE_FEE;
  }

  /**
   * Deploy emergency fund for disaster response
   */
  async deployEmergencyFund(
    adminKey: string,
    fundId: string,
    name: string,
    description: string,
    totalAmount: string,
    disasterType: string,
    geographicScope: string,
    expiresAt: number,
    releaseTriggers: string[],
    requiredSignatures: number,
    txOptions?: TxOptions
  ): Promise<string> {
    validateAddressList(releaseTriggers, 'releaseTriggers');
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await withRetry<any>(() => this.server.getAccount(adminKeypair.publicKey()));
    const fee = await this.resolveFee('create_fund', txOptions?.fee);

    const tx = new TransactionBuilder(adminAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "create_fund",
          ...[
            new Address(adminKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            nativeToScVal(name),
            nativeToScVal(description),
            nativeToScVal(totalAmount),
            nativeToScVal(disasterType),
            nativeToScVal(geographicScope),
            nativeToScVal(expiresAt),
            nativeToScVal(releaseTriggers),
            nativeToScVal(requiredSignatures)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));

    if (result.status === 'SUCCESS') {
      this.cache.invalidate('aid:listActiveFunds');
      return fundId;
    } else {
      throw new Error(`Failed to deploy emergency fund: ${result.status}`);
    }
  }

  /**
   * Trigger disbursement with multi-sig approval
   */
  async triggerDisbursement(
    requesterKey: string,
    fundId: string,
    beneficiary: string,
    amount: string,
    purpose: string,
    approvers: string[],
    txOptions?: TxOptions
  ): Promise<string> {
    validateAddress(beneficiary, 'beneficiary');
    validateAddressList(approvers, 'approvers');
    const requesterKeypair = Keypair.fromSecret(requesterKey);
    const requesterAccount = await withRetry<any>(() => this.server.getAccount(requesterKeypair.publicKey()));
    const fee = await this.resolveFee('submit_disbursement', txOptions?.fee);

    const tx = new TransactionBuilder(requesterAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "submit_disbursement",
          ...[
            new Address(requesterKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            nativeToScVal(beneficiary),
            nativeToScVal(amount),
            nativeToScVal(purpose),
            nativeToScVal(approvers)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(requesterKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));

    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`aid:fund:${fundId}`);
      this.cache.invalidate(`aid:disbursements:${fundId}`);
      return `Disbursement submitted for fund ${fundId}`;
    } else {
      throw new Error(`Failed to submit disbursement: ${result.status}`);
    }
  }

  /**
   * Submit multiple disbursements atomically in a single transaction.
   * All entries succeed or all fail — no partial state.
   *
   * Batches are limited to `MAX_BATCH_SIZE` (100) entries, matching the
   * on-chain limit. Split larger requests into multiple atomic batches.
   *
   * @param requesterKey  Secret key of the requester
   * @param fundId        Fund to draw from
   * @param entries       Array of { beneficiary, amount, purpose }
   * @param approvers     Secret keys of multi-sig approvers
   * @returns Array of disbursement IDs created on-chain
   */
  async triggerBatchDisbursement(
    requesterKey: string,
    fundId: string,
    entries: Array<{ beneficiary: string; amount: string; purpose: string }>,
    approvers: string[],
    txOptions?: TxOptions
  ): Promise<string[]> {
    if (entries.length < MIN_BATCH_SIZE) {
      throw new Error('Batch must contain at least one entry');
    }
    if (entries.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch contains ${entries.length} entries; the maximum is ${MAX_BATCH_SIZE}. ` +
          'Split the request into smaller batches.'
      );
    }

    const requesterKeypair = Keypair.fromSecret(requesterKey);
    const requesterAccount = await this.server.getAccount(requesterKeypair.publicKey());
    const fee = await this.resolveFee('submit_batch_disbursement', txOptions?.fee);

    // Build the entries as a Vec of tuples for the contract call
    const entriesScVal = nativeToScVal(
      entries.map(e => [e.beneficiary, e.amount, e.purpose])
    );

    const tx = new TransactionBuilder(requesterAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'submit_batch_disbursement',
          ...[
            new Address(requesterKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            entriesScVal,
            nativeToScVal(approvers),
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(requesterKeypair);
    const result = await this.server.sendTransaction(tx);

    if (result.status === 'SUCCESS') {
      const ids = parseBatchDisbursementResult(result);
      this.cache.invalidate(`aid:fund:${fundId}`);
      this.cache.invalidate(`aid:disbursements:${fundId}`);
      return ids;
    } else {
      throw new Error(`Batch disbursement failed: ${result.status}`);
    }
  }

  /**
   * Get fund details
   */
  async getFund(fundId: string): Promise<EmergencyFund | null> {
    return this.cache.get(`aid:fund:${fundId}`, async () => {
      try {
        const result = await this.contract.call("get_fund", nativeToScVal(fundId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get fund:', error);
        return null;
      }
    });
  }

  /**
   * List all active emergency funds
   */
  async listActiveFunds(): Promise<EmergencyFund[]> {
    return this.cache.get('aid:listActiveFunds', async () => {
      try {
        const result = await this.contract.call("list_active_funds");
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to list active funds:', error);
        return [];
      }
    });
  }

  /**
   * Get disbursement history for a fund
   */
  async getDisbursements(fundId: string): Promise<DisbursementRecord[]> {
    return this.cache.get(`aid:disbursements:${fundId}`, async () => {
      try {
        const result = await this.contract.call("get_disbursements", nativeToScVal(fundId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get disbursements:', error);
        return [];
      }
    });
  }

  /**
   * Monitor fund pool status
   */
  async monitorFundPool(fundId: string): Promise<{
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    isActive: boolean;
    expiresAt: number;
  }> {
    const fund = await this.getFund(fundId);
    if (!fund) {
      throw new Error(`Fund ${fundId} not found`);
    }

    const totalAmount = parseMonetaryBigInt(fund.totalAmount, 'totalAmount');
    const releasedAmount = parseMonetaryBigInt(fund.releasedAmount, 'releasedAmount');
    if (releasedAmount > totalAmount) {
      throw new Error('Invalid fund amounts: releasedAmount exceeds totalAmount');
    }
    const remainingAmount = totalAmount - releasedAmount;

    return {
      totalAmount: totalAmount.toString(),
      releasedAmount: releasedAmount.toString(),
      remainingAmount: remainingAmount.toString(),
      isActive: fund.isActive,
      expiresAt: fund.expiresAt
    };
  }

  /**
   * Cleanup expired funds
   */
  async cleanupExpiredFunds(adminKey: string, txOptions?: TxOptions): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await withRetry<any>(() => this.server.getAccount(adminKeypair.publicKey()));
    const fee = await this.resolveFee('cleanup_expired_funds', txOptions?.fee);

    const tx = new TransactionBuilder(adminAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(this.contract.call("cleanup_expired_funds"))
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));

    if (result.status === 'SUCCESS') {
      return 'Expired funds cleaned up successfully';
    } else {
      throw new Error(`Failed to cleanup expired funds: ${result.status}`);
    }
  }

  /**
   * Create multiple funds for large-scale disaster response
   */
  async deployRapidResponse(
    adminKey: string,
    disasterId: string,
    disasterType: string,
    affectedArea: string,
    totalBudget: string,
    fundCategories: Array<{
      name: string;
      percentage: number;
      description: string;
    }>
  ): Promise<string[]> {
    const fundIds: string[] = [];
    const adminKeypair = Keypair.fromSecret(adminKey);

    for (const category of fundCategories) {
      const fundId = `${disasterId}_${category.name.toLowerCase().replace(/\s+/g, '_')}`;
      const amount = (BigInt(totalBudget) * BigInt(category.percentage) / BigInt(100)).toString();

      try {
        await this.deployEmergencyFund(
          adminKey,
          fundId,
          `${category.name} - ${disasterId}`,
          category.description,
          amount,
          disasterType,
          affectedArea,
          Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now
          [adminKeypair.publicKey()],
          1
        );
        fundIds.push(fundId);
      } catch (error) {
        console.error(`Failed to create fund ${fundId}:`, error);
      }
    }

    return fundIds;
  }

  /**
   * Generate a minimised QR code for fund information (offline access).
   *
   * Payload contains only the fields a scanner needs to look up and display
   * the fund.  Financial amounts and internal state are intentionally omitted
   * — the scanner should query the contract for live details after verifying
   * `fundId`.
   *
   * The QR carries its own `qrExpiresAt` expiry (default 24 h) that is
   * independent of the fund's own `expiresAt`, so a QR printed for a field
   * agent cannot be replayed indefinitely even if the fund is still active.
   *
   * @param fundId  - Opaque fund identifier.
   * @param fund    - Fund record to generate the QR for.
   * @param qrTtlMs - Optional QR-specific TTL in milliseconds (default 24 h).
   * @returns JSON string representing the minimised QR payload.
   *
   * @see docs/QR_PAYLOADS.md for full field documentation and scanner guidance.
   */
  generateFundQRCode(
    fundId: string,
    fund: EmergencyFund,
    qrTtlMs: number = 24 * 60 * 60 * 1000
  ): string {
    const qrData = {
      type: 'emergency_fund',
      v: 1,                          // payload version for future schema evolution
      fundId,
      disasterType: fund.disasterType,
      // NOTE: fund.name is included as a human-readable label only; no PII.
      // fund.totalAmount and fund.releasedAmount are intentionally omitted —
      // the scanner must query the contract for live financial state.
      name: fund.name,
      // fund.expiresAt: when the fund itself expires (do not use for QR validation)
      fundExpiresAt: fund.expiresAt,
      // qrExpiresAt: when this specific QR image expires (independent of fund)
      qrExpiresAt: Date.now() + qrTtlMs,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate a fund QR code.
   *
   * Checks both the QR-specific expiry (`qrExpiresAt`) and confirms the fund
   * still exists on-chain.  Returns `false` for any expired or invalid QR.
   */
  async validateFundQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);

      if (data.type !== 'emergency_fund') {
        return false;
      }

      // Check QR-specific expiry first (fast, no network call)
      if (data.qrExpiresAt && Date.now() > data.qrExpiresAt) {
        return false;
      }

      // Legacy: also respect fund-level expiry if qrExpiresAt is absent
      if (!data.qrExpiresAt && data.expiresAt && Date.now() > data.expiresAt) {
        return false;
      }

      // Verify fund exists on chain
      return (await this.getFund(data.fundId)) !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get fund statistics for reporting
   */
  async getFundStatistics(fundId: string): Promise<{
    totalDisbursements: number;
    totalAmountDisbursed: string;
    averageDisbursement: string;
    lastDisbursement: number | null;
    beneficiariesReached: number;
  }> {
    const disbursements = await this.getDisbursements(fundId);
    const beneficiaries = new Set(disbursements.map(d => d.beneficiary));

    const totalAmount = disbursements.reduce((sum, d) =>
      sum + BigInt(d.amount), BigInt(0)
    );

    const averageDisbursement = disbursements.length > 0
      ? (totalAmount / BigInt(disbursements.length)).toString()
      : '0';

    const lastDisbursement = disbursements.length > 0
      ? Math.max(...disbursements.map(d => d.timestamp))
      : null;

    return {
      totalDisbursements: disbursements.length,
      totalAmountDisbursed: totalAmount.toString(),
      averageDisbursement,
      lastDisbursement,
      beneficiariesReached: beneficiaries.size
    };
  }


  /**
   * Build an unsigned transaction for deploying an emergency fund.
   *
   * Uses `OFFLINE_INFINITE_TIMEOUT` (0 -> `TimeBounds(0, 0)`) by default because
   * air-gapped signing workflows often transport unsigned envelopes out-of-band
   * across signers. Pass `txOptions.timeoutSeconds > 0` when bounded expiry is preferred.
   *
   * Returns an OfflineEnvelope that can be signed offline and submitted later.
   */
  async buildOfflineDeployFund(
    sourcePublicKey: string,
    fundId: string,
    name: string,
    description: string,
    totalAmount: string,
    disasterType: string,
    geographicScope: string,
    expiresAt: number,
    releaseTriggers: string[],
    requiredSignatures: number,
    txOptions?: OfflineTxOptions
  ): Promise<OfflineEnvelope> {
    const timeoutSeconds = this.validateTimeout(txOptions?.timeoutSeconds);
    const fee = await this.resolveFee('create_fund', txOptions?.fee);
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'create_fund',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(fundId), nativeToScVal(name), nativeToScVal(description),
            nativeToScVal(totalAmount), nativeToScVal(disasterType),
            nativeToScVal(geographicScope), nativeToScVal(expiresAt),
            nativeToScVal(releaseTriggers), nativeToScVal(requiredSignatures),
          ]
        )
      )
      .setTimeout(timeoutSeconds)
      .build();
    return OfflineSigner.serialize(tx);
  }

  /**
   * Build an unsigned transaction for triggering a disbursement.
   *
   * Uses `OFFLINE_INFINITE_TIMEOUT` (0 -> `TimeBounds(0, 0)`) by default so
   * offline approvers do not hit premature timeout expiration before submission.
   * Pass `txOptions.timeoutSeconds > 0` to bound envelope validity.
   */
  async buildOfflineDisbursement(
    sourcePublicKey: string,
    fundId: string,
    beneficiary: string,
    amount: string,
    purpose: string,
    approvers: string[],
    txOptions?: OfflineTxOptions
  ): Promise<OfflineEnvelope> {
    const timeoutSeconds = this.validateTimeout(txOptions?.timeoutSeconds);
    const fee = await this.resolveFee('submit_disbursement', txOptions?.fee);
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee,
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'submit_disbursement',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(fundId), nativeToScVal(beneficiary),
            nativeToScVal(amount), nativeToScVal(purpose), nativeToScVal(approvers),
          ]
        )
      )
      .setTimeout(timeoutSeconds)
      .build();
    return OfflineSigner.serialize(tx);
  }

  private validateTimeout(timeoutSeconds?: number): number {
    if (timeoutSeconds === undefined) {
      return OFFLINE_INFINITE_TIMEOUT;
    }
    if (!Number.isFinite(timeoutSeconds) || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 0) {
      throw new Error(`Invalid timeoutSeconds: expected non-negative integer, received ${timeoutSeconds}`);
    }
    return timeoutSeconds;
  }
  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return Networks.TESTNET;
      case 'mainnet':
        return Networks.PUBLIC;
      case 'standalone':
        return Networks.STANDALONE;
      default:
        throw new Error('Unsupported network');
    }
  }
}
