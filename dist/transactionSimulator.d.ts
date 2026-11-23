import { Transaction, FeeBumpTransaction, rpc as SorobanRpc } from 'stellar-sdk';
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
export declare class TransactionSimulator {
    private rpcServer;
    private config;
    constructor(config: NetworkConfig);
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
    simulate(transaction: string | Transaction | FeeBumpTransaction): Promise<SimulationResult>;
    private resolveTransaction;
    private buildResult;
    private getNetworkPassphrase;
}
//# sourceMappingURL=transactionSimulator.d.ts.map