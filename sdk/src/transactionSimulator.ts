import {
  Transaction,
  FeeBumpTransaction,
  TransactionBuilder,
  Networks,
  rpc as SorobanRpc,
} from 'stellar-sdk';
import { NetworkConfig } from './types';

export interface SimulationResult {
  /** Whether the simulation succeeded without errors. */
  success: boolean;
  /** Error message if the simulation failed. */
  error?: string;
  /** Minimum resource fee (in stroops) estimated by the network. */
  minResourceFee?: string;
  /** Latest ledger sequence number at the time of simulation. */
  latestLedger: number;
  /**
   * Whether a ledger entry restoration is required before the transaction
   * can be submitted successfully.
   */
  restoreRequired: boolean;
  /** Raw response from the RPC server for advanced inspection. */
  raw: SorobanRpc.Api.SimulateTransactionResponse;
}

export class TransactionSimulator {
  private rpcServer: SorobanRpc.Server;
  private config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.rpcServer = new SorobanRpc.Server(config.rpcUrl);
  }

  /**
   * Simulates a transaction in non-persistent preview mode.
   *
   * The simulation validates transaction construction, estimates execution
   * outcomes, and surfaces expected errors without modifying on-chain state.
   *
   * Accepts either a signed XDR string or a pre-built Transaction /
   * FeeBumpTransaction object.
   *
   * @param transaction - XDR envelope string or Transaction / FeeBumpTransaction instance.
   * @returns SimulationResult with success status, fee estimate, and raw response.
   * @throws if the provided XDR is invalid or the network type is unsupported.
   */
  async simulate(
    transaction: string | Transaction | FeeBumpTransaction
  ): Promise<SimulationResult> {
    const tx = this.resolveTransaction(transaction);
    const raw = await this.rpcServer.simulateTransaction(tx);
    return this.buildResult(raw);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveTransaction(
    transaction: string | Transaction | FeeBumpTransaction
  ): Transaction | FeeBumpTransaction {
    if (typeof transaction !== 'string') {
      return transaction;
    }
    try {
      return TransactionBuilder.fromXDR(transaction, this.getNetworkPassphrase()) as
        | Transaction
        | FeeBumpTransaction;
    } catch (err: any) {
      throw new Error(`Invalid transaction XDR: ${err.message}`);
    }
  }

  private buildResult(raw: SorobanRpc.Api.SimulateTransactionResponse): SimulationResult {
    if (SorobanRpc.Api.isSimulationError(raw)) {
      return {
        success: false,
        error: raw.error,
        latestLedger: raw.latestLedger,
        restoreRequired: false,
        raw,
      };
    }

    const successResponse = raw as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    const restoreRequired = SorobanRpc.Api.isSimulationRestore(raw);

    return {
      success: true,
      minResourceFee: successResponse.minResourceFee,
      latestLedger: raw.latestLedger,
      restoreRequired,
      raw,
    };
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
