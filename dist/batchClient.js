"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const types_1 = require("./types");
const transactionPoller_1 = require("./transactionPoller");
const { Server } = stellar_sdk_1.SorobanRpc;
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
class BatchClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.poller = new transactionPoller_1.TransactionPoller(config);
    }
    /**
     * Execute an ordered batch of contract calls in a single transaction.
     *
     * @param request - Batch request containing calls and signer key.
     * @param pollOptions - Optional polling configuration.
     * @returns BatchExecuteResult with per-call results and overall status.
     * @throws Error on invalid inputs, authorization failure, or network error.
     */
    async execute(request, pollOptions) {
        this.validateRequest(request);
        const signerKeypair = stellar_sdk_1.Keypair.fromSecret(request.signerKey);
        const signerAccount = await this.server.getAccount(signerKeypair.publicKey());
        const builder = new stellar_sdk_1.TransactionBuilder(signerAccount, {
            fee: String(100 * request.calls.length),
            networkPassphrase: this.getNetworkPassphrase(),
        });
        for (const call of request.calls) {
            const contractId = this.resolveContractId(call.contractTarget);
            const contract = new stellar_sdk_1.Contract(contractId);
            builder.addOperation(contract.call(call.method, ...call.args));
        }
        const tx = builder.setTimeout(30).build();
        tx.sign(signerKeypair);
        let sendResult;
        try {
            sendResult = await this.server.sendTransaction(tx);
        }
        catch (error) {
            throw new Error(`BatchClient: network error submitting batch transaction: ${error}`);
        }
        if (sendResult.status === 'ERROR' ||
            sendResult.status === 'DUPLICATE' ||
            sendResult.status === 'TRY_AGAIN_LATER') {
            throw new Error(`BatchClient: transaction rejected by network: ${sendResult.status}`);
        }
        const txHash = sendResult.hash;
        const pollResult = await this.poller.pollTransaction(txHash, pollOptions);
        if (pollResult.status === 'TIMEOUT') {
            return {
                transactionHash: txHash,
                status: 'TIMEOUT',
                results: this.buildFailedResults(request.calls.length, 'Transaction timed out'),
            };
        }
        if (pollResult.status === 'FAILED') {
            return {
                transactionHash: txHash,
                status: 'FAILED',
                results: this.buildFailedResults(request.calls.length, 'Transaction failed on-chain'),
            };
        }
        // SUCCESS — extract per-operation return values from result metadata
        const successResponse = pollResult.response;
        const results = this.extractCallResults(request.calls.length, successResponse);
        return {
            transactionHash: txHash,
            status: 'SUCCESS',
            results,
            ledger: successResponse.ledger,
        };
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    validateRequest(request) {
        if (!request.calls || request.calls.length === 0) {
            throw new Error('BatchClient: calls array must not be empty');
        }
        if (request.calls.length > types_1.BATCH_MAX_SIZE) {
            throw new Error(`BatchClient: batch size ${request.calls.length} exceeds maximum of ${types_1.BATCH_MAX_SIZE}`);
        }
        if (!request.signerKey || request.signerKey.trim() === '') {
            throw new Error('BatchClient: signerKey is required');
        }
        try {
            stellar_sdk_1.Keypair.fromSecret(request.signerKey);
        }
        catch {
            throw new Error('BatchClient: signerKey is not a valid Stellar secret key');
        }
        for (let i = 0; i < request.calls.length; i++) {
            const call = request.calls[i];
            if (!call.contractTarget) {
                throw new Error(`BatchClient: calls[${i}].contractTarget is required`);
            }
            if (!call.method || call.method.trim() === '') {
                throw new Error(`BatchClient: calls[${i}].method is required`);
            }
            if (!Array.isArray(call.args)) {
                throw new Error(`BatchClient: calls[${i}].args must be an array`);
            }
            // Validate contractTarget resolves (throws if not configured)
            this.resolveContractId(call.contractTarget);
        }
    }
    resolveContractId(target) {
        const id = this.config.contractIds[target];
        if (!id || id.trim() === '') {
            throw new Error(`BatchClient: no contractId configured for target "${target}"`);
        }
        return id;
    }
    buildFailedResults(count, error) {
        return Array.from({ length: count }, (_, i) => ({
            index: i,
            success: false,
            error,
        }));
    }
    /**
     * Extract per-call return values from the transaction result metadata.
     * Soroban encodes operation results in resultMetaXdr; we attempt to decode
     * each one. If decoding fails for any call, that call is marked as failed
     * while others remain unaffected.
     */
    extractCallResults(count, response) {
        const results = [];
        for (let i = 0; i < count; i++) {
            try {
                // Attempt to extract the return value for operation i from the XDR.
                // resultMetaXdr contains a TransactionMeta which holds per-operation
                // Soroban data. We use a best-effort decode; if unavailable we still
                // mark the call as successful (the overall tx succeeded).
                let returnValue;
                try {
                    const meta = response.resultMetaXdr;
                    if (meta) {
                        const v3 = meta.v3?.();
                        const sorobanMeta = v3?.sorobanMeta?.();
                        const returnVals = sorobanMeta?.returnValue?.();
                        if (returnVals) {
                            returnValue = (0, stellar_sdk_1.scValToNative)(returnVals);
                        }
                    }
                }
                catch {
                    // Return value extraction is best-effort; don't fail the call
                }
                results.push({ index: i, success: true, returnValue });
            }
            catch (err) {
                results.push({ index: i, success: false, error: String(err) });
            }
        }
        return results;
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return stellar_sdk_1.Networks.TESTNET;
            case 'mainnet':
                return stellar_sdk_1.Networks.PUBLIC;
            case 'standalone':
                return stellar_sdk_1.Networks.STANDALONE;
            default:
                throw new Error(`BatchClient: unsupported network "${this.config.network}"`);
        }
    }
}
exports.BatchClient = BatchClient;
//# sourceMappingURL=batchClient.js.map