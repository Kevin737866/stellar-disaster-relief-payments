import { SorobanRpc } from 'stellar-sdk';
type GetSuccessfulTransactionResponse = SorobanRpc.Api.GetSuccessfulTransactionResponse;
type GetFailedTransactionResponse = SorobanRpc.Api.GetFailedTransactionResponse;
import { NetworkConfig } from './types';
export interface PollOptions {
    /** Polling interval in milliseconds. Defaults to 3000. */
    intervalMs?: number;
    /** Maximum time to wait in milliseconds. Defaults to 60000. */
    timeoutMs?: number;
}
export type TransactionPollResult = {
    status: 'SUCCESS';
    response: GetSuccessfulTransactionResponse;
} | {
    status: 'FAILED';
    response: GetFailedTransactionResponse;
} | {
    status: 'TIMEOUT';
};
export declare class TransactionPoller {
    private server;
    private config;
    private activePolls;
    constructor(config: NetworkConfig);
    /**
     * Poll a transaction until it reaches a terminal state (SUCCESS or FAILED),
     * or until the timeout is exceeded.
     *
     * Deduplicates concurrent polls for the same hash: if a poll is already in
     * progress for the given hash, the same Promise is returned.
     */
    pollTransaction(hash: string, options?: PollOptions): Promise<TransactionPollResult>;
    /**
     * Poll a transaction until it reaches a terminal completion status.
     *
     * This is a convenience alias for `pollTransaction` that clearly expresses
     * the intent of waiting for final transaction completion.
     */
    pollTransactionStatus(hash: string, options?: PollOptions): Promise<TransactionPollResult>;
    private _poll;
    private _sleep;
}
export {};
//# sourceMappingURL=transactionPoller.d.ts.map