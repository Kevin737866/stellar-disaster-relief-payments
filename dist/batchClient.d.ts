import { NetworkConfig, BatchExecuteRequest, BatchExecuteResult } from './types';
import { PollOptions } from './transactionPoller';
/**
 * Client for batching multiple contract calls into a single Stellar transaction.
 *
 * Stellar supports up to 100 operations per transaction. BatchClient packs
 * each BatchContractCall as one operation, preserving call order and execution
 * semantics. The transaction is signed once and submitted as a unit.
 *
 * Usage:
 *   const client = new BatchClient(config);
 *   const result = await client.execute({
 *     calls: [
 *       { contractTarget: 'aidRegistry', method: 'create_fund', args: [...] },
 *       { contractTarget: 'beneficiaryManager', method: 'register', args: [...] },
 *     ],
 *     signerKey: 'S...',
 *   });
 */
export declare class BatchClient {
    private server;
    private config;
    private poller;
    constructor(config: NetworkConfig);
    /**
     * Execute an ordered batch of contract calls in a single transaction.
     *
     * @param request - Batch request containing calls and signer key.
     * @param pollOptions - Optional polling configuration.
     * @returns BatchExecuteResult with per-call results and overall status.
     * @throws Error on invalid inputs, authorization failure, or network error.
     */
    execute(request: BatchExecuteRequest, pollOptions?: PollOptions): Promise<BatchExecuteResult>;
    private validateRequest;
    private resolveContractId;
    private buildFailedResults;
    /**
     * Extract per-call return values from the transaction result metadata.
     * Soroban encodes operation results in resultMetaXdr; we attempt to decode
     * each one. If decoding fails for any call, that call is marked as failed
     * while others remain unaffected.
     */
    private extractCallResults;
    private getNetworkPassphrase;
}
//# sourceMappingURL=batchClient.d.ts.map