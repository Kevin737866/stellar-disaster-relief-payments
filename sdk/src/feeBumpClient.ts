import {
  TransactionBuilder,
  Networks,
  Keypair,
  FeeBumpTransaction,
  Transaction,
  BASE_FEE,
  rpc as SorobanRpc,
  Horizon,
} from 'stellar-sdk';
import { NetworkConfig } from './types';
import { validateAddress } from './validation';
import { TransactionSimulator, SimulationResult } from './transactionSimulator';

/** Minimum multiplier over the inner transaction's per-op fee rate. */
const MIN_FEE_MULTIPLIER = 10;

/** Strict decimal stroop format: no signs, fractions, exponents, or separators. */
const STROOPS_PATTERN = /^\d+$/;

/** Largest stroop value that can be compared precisely as a JS number. */
const MAX_SAFE_STROOPS = BigInt(Number.MAX_SAFE_INTEGER);

/** XDR Int64 limit for the total fee of a fee-bump transaction. */
const MAX_FEE_BUMP_TOTAL_STROOPS = BigInt('9223372036854775807');

export interface FeeBumpOptions {
  /** Secret key of the account paying the bump fee. */
  feeSourceKey: string;
  /** XDR envelope of the original signed inner transaction. */
  innerTransactionXdr: string;
  /**
   * New base fee per operation in stroops.
   * Must be a positive whole-number integer within the supported range, and
   * >= inner tx per-op fee * MIN_FEE_MULTIPLIER and >= BASE_FEE.
   * Defaults to the computed minimum.
   */
  newBaseFee?: string;
}

export interface FeeBumpResult {
  /** Hash of the submitted fee bump transaction. */
  hash: string;
  /** Status returned by the network. */
  status: string;
}

/**
 * Checks whether a transaction is still pending (not yet confirmed or failed).
 * Returns true if the transaction is not found on-chain (i.e. still pending).
 */
async function isTransactionPending(
  horizonServer: Horizon.Server,
  txHash: string
): Promise<boolean> {
  try {
    await horizonServer.transactions().transaction(txHash).call();
    // Transaction found on-chain — already confirmed, not pending.
    return false;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return true;
    }
    // Re-throw unexpected errors.
    throw err;
  }
}

/**
 * Computes the minimum acceptable bump fee given the inner transaction.
 * Stellar protocol requires the fee bump's per-op rate to be at least as high
 * as the inner transaction's per-op rate, and at least BASE_FEE.
 */
function computeMinBumpFee(innerTx: Transaction): string {
  const innerOps = innerTx.operations.length || 1;
  const innerPerOpFee = Math.ceil(Number(innerTx.fee) / innerOps);
  const minFee = Math.max(innerPerOpFee * MIN_FEE_MULTIPLIER, Number(BASE_FEE));
  return String(minFee);
}

function invalidBaseFeeError(value: unknown): Error {
  return new Error(
    `Invalid newBaseFee: fee must be a positive whole-number integer in stroops within the supported range (1-${MAX_SAFE_STROOPS}); received "${String(value)}"`
  );
}

/**
 * Strictly parses and validates a per-operation fee before it reaches the
 * Stellar SDK. `Number('abc')` is NaN, which silently defeats `<` checks, and
 * integers above Number.MAX_SAFE_INTEGER lose precision, so both are rejected
 * here instead of during transaction construction.
 */
function resolveBaseFee(newBaseFee: string | undefined, innerTx: Transaction): string {
  const minFee = computeMinBumpFee(innerTx);
  const rawFee = newBaseFee ?? minFee;
  const trimmed = typeof rawFee === 'string' ? rawFee.trim() : '';

  if (!STROOPS_PATTERN.test(trimmed)) {
    throw invalidBaseFeeError(rawFee);
  }

  const stroops = BigInt(trimmed);
  const maxPerOperation = MAX_FEE_BUMP_TOTAL_STROOPS / BigInt(innerTx.operations.length + 1);
  const maxSupported = maxPerOperation < MAX_SAFE_STROOPS ? maxPerOperation : MAX_SAFE_STROOPS;

  if (stroops < 1n || stroops > maxSupported) {
    throw invalidBaseFeeError(rawFee);
  }

  if (stroops < BigInt(minFee)) {
    throw new Error(
      `newBaseFee (${trimmed}) is below the required minimum of ${minFee} stroops.`
    );
  }

  return stroops.toString();
}

export class FeeBumpClient {
  private rpcServer: SorobanRpc.Server;
  private horizonServer: Horizon.Server;
  private config: NetworkConfig;
  private simulator: TransactionSimulator;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.rpcServer = new SorobanRpc.Server(config.rpcUrl);
    this.horizonServer = new Horizon.Server(config.horizonUrl);
    this.simulator = new TransactionSimulator(config);
  }

  /**
   * Simulates a fee bump transaction in non-persistent preview mode.
   *
   * Builds the fee bump envelope from the provided options and runs it through
   * the RPC simulation endpoint without submitting it. Useful for validating
   * construction and estimating fees before calling {@link bumpFee}.
   *
   * @throws if the inner transaction XDR is invalid, the fee source key is bad,
   *   or newBaseFee is not a valid whole-number stroop value.
   */
  async simulateBump(options: FeeBumpOptions): Promise<SimulationResult> {
    const { feeSourceKey, innerTransactionXdr, newBaseFee } = options;

    const feeSourceKeypair = Keypair.fromSecret(feeSourceKey);
    validateAddress(feeSourceKeypair.publicKey(), 'feeSource');

    let innerTx: Transaction;
    try {
      const envelope = TransactionBuilder.fromXDR(
        innerTransactionXdr,
        this.getNetworkPassphrase()
      );
      if (envelope instanceof FeeBumpTransaction) {
        throw new Error(
          'Cannot fee bump a fee bump transaction. Provide the original inner transaction XDR.'
        );
      }
      innerTx = envelope as Transaction;
    } catch (err: any) {
      if (err.message.includes('Cannot fee bump')) throw err;
      throw new Error(`Invalid inner transaction XDR: ${err.message}`);
    }

    const baseFee = resolveBaseFee(newBaseFee, innerTx);

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeSourceKeypair,
      baseFee,
      innerTx,
      this.getNetworkPassphrase()
    );
    feeBumpTx.sign(feeSourceKeypair);

    return this.simulator.simulate(feeBumpTx);
  }

  /**
   * Submits a fee bump transaction to increase the fee on a pending transaction.
   *
   * Validates that:
   * - The fee source address is a valid Stellar address.
   * - The inner transaction XDR is a valid signed Transaction (not already a fee bump).
   * - The inner transaction is still pending (not yet confirmed).
   * - The new base fee is a valid whole-number stroop value and meets protocol minimums.
   *
   * Fee validation happens before any Horizon/RPC call.
   *
   * @throws if the inner transaction is already confirmed or is itself a fee bump.
   * @throws if the new base fee is malformed or below the required minimum.
   */
  async bumpFee(options: FeeBumpOptions): Promise<FeeBumpResult> {
    const { feeSourceKey, innerTransactionXdr, newBaseFee } = options;

    const feeSourceKeypair = Keypair.fromSecret(feeSourceKey);
    validateAddress(feeSourceKeypair.publicKey(), 'feeSource');

    // Deserialize and validate the inner transaction.
    let innerTx: Transaction;
    try {
      const envelope = TransactionBuilder.fromXDR(
        innerTransactionXdr,
        this.getNetworkPassphrase()
      );
      if (envelope instanceof FeeBumpTransaction) {
        throw new Error(
          'Cannot fee bump a fee bump transaction. Provide the original inner transaction XDR.'
        );
      }
      innerTx = envelope as Transaction;
    } catch (err: any) {
      if (err.message.includes('Cannot fee bump')) throw err;
      throw new Error(`Invalid inner transaction XDR: ${err.message}`);
    }

    // Validate input before any Horizon/RPC call so malformed fees cannot reach
    // fee-bump construction or the network.
    const baseFee = resolveBaseFee(newBaseFee, innerTx);

    // Ensure the transaction is still pending.
    const pending = await isTransactionPending(this.horizonServer, innerTx.hash().toString('hex'));
    if (!pending) {
      throw new Error(
        `Transaction ${innerTx.hash().toString('hex')} is already confirmed and cannot be fee bumped.`
      );
    }

    // Build, sign, and submit the fee bump transaction.
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeSourceKeypair,
      baseFee,
      innerTx,
      this.getNetworkPassphrase()
    );

    feeBumpTx.sign(feeSourceKeypair);

    const result = await this.rpcServer.sendTransaction(feeBumpTx);

    if (result.status === 'ERROR') {
      throw new Error(`Fee bump transaction failed: ${result.status}`);
    }

    return {
      hash: result.hash,
      status: result.status,
    };
  }

  /**
   * Returns the minimum base fee (in stroops) required to bump the given transaction.
   * Useful for callers that want to compute the fee before calling bumpFee().
   */
  getMinBumpFee(innerTransactionXdr: string): string {
    let innerTx: Transaction;
    try {
      const envelope = TransactionBuilder.fromXDR(
        innerTransactionXdr,
        this.getNetworkPassphrase()
      );
      if (envelope instanceof FeeBumpTransaction) {
        throw new Error('Cannot compute bump fee for a fee bump transaction.');
      }
      innerTx = envelope as Transaction;
    } catch (err: any) {
      if (err.message.includes('Cannot compute')) throw err;
      throw new Error(`Invalid inner transaction XDR: ${err.message}`);
    }
    return computeMinBumpFee(innerTx);
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
        throw new Error(`Unsupported network: ${this.config.network}`);
    }
  }
}
