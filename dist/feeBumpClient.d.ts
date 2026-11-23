import { NetworkConfig } from './types';
import { SimulationResult } from './transactionSimulator';
export interface FeeBumpOptions {
    /** Secret key of the account paying the bump fee. */
    feeSourceKey: string;
    /** XDR envelope of the original signed inner transaction. */
    innerTransactionXdr: string;
    /**
     * New base fee per operation in stroops.
     * Must be >= inner tx per-op fee * MIN_FEE_MULTIPLIER and >= BASE_FEE.
     * Defaults to inner per-op fee * MIN_FEE_MULTIPLIER.
     */
    newBaseFee?: string;
}
export interface FeeBumpResult {
    /** Hash of the submitted fee bump transaction. */
    hash: string;
    /** Status returned by the network. */
    status: string;
}
export declare class FeeBumpClient {
    private rpcServer;
    private horizonServer;
    private config;
    private simulator;
    constructor(config: NetworkConfig);
    /**
     * Simulates a fee bump transaction in non-persistent preview mode.
     *
     * Builds the fee bump envelope from the provided options and runs it through
     * the RPC simulation endpoint without submitting it. Useful for validating
     * construction and estimating fees before calling {@link bumpFee}.
     *
     * @throws if the inner transaction XDR is invalid or the fee source key is bad.
     */
    simulateBump(options: FeeBumpOptions): Promise<SimulationResult>;
    /**
     * Submits a fee bump transaction to increase the fee on a pending transaction.
     *
     * Validates that:
     * - The fee source address is a valid Stellar address.
     * - The inner transaction XDR is a valid signed Transaction (not already a fee bump).
     * - The inner transaction is still pending (not yet confirmed).
     * - The new base fee meets protocol minimums.
     *
     * @throws if the inner transaction is already confirmed or is itself a fee bump.
     * @throws if the new base fee is below the required minimum.
     */
    bumpFee(options: FeeBumpOptions): Promise<FeeBumpResult>;
    /**
     * Returns the minimum base fee (in stroops) required to bump the given transaction.
     * Useful for callers that want to compute the fee before calling bumpFee().
     */
    getMinBumpFee(innerTransactionXdr: string): string;
    private getNetworkPassphrase;
}
//# sourceMappingURL=feeBumpClient.d.ts.map