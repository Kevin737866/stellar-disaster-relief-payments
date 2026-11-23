"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionPoller = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const { Server } = stellar_sdk_1.SorobanRpc;
const { GetTransactionStatus } = stellar_sdk_1.SorobanRpc.Api;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 60000;
class TransactionPoller {
    constructor(config) {
        this.activePolls = new Map();
        this.config = config;
        this.server = new Server(config.rpcUrl);
    }
    /**
     * Poll a transaction until it reaches a terminal state (SUCCESS or FAILED),
     * or until the timeout is exceeded.
     *
     * Deduplicates concurrent polls for the same hash: if a poll is already in
     * progress for the given hash, the same Promise is returned.
     */
    pollTransaction(hash, options) {
        const existing = this.activePolls.get(hash);
        if (existing) {
            return existing;
        }
        const promise = this._poll(hash, options).finally(() => {
            this.activePolls.delete(hash);
        });
        this.activePolls.set(hash, promise);
        return promise;
    }
    /**
     * Poll a transaction until it reaches a terminal completion status.
     *
     * This is a convenience alias for `pollTransaction` that clearly expresses
     * the intent of waiting for final transaction completion.
     */
    pollTransactionStatus(hash, options) {
        return this.pollTransaction(hash, options);
    }
    async _poll(hash, options) {
        const intervalMs = options?.intervalMs ??
            this.config.pollIntervalMs ??
            DEFAULT_POLL_INTERVAL_MS;
        const timeoutMs = options?.timeoutMs ??
            this.config.pollTimeoutMs ??
            DEFAULT_TIMEOUT_MS;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            let response;
            try {
                response = await this.server.getTransaction(hash);
            }
            catch (error) {
                // Transient network / RPC error — log and retry after interval
                console.error(`TransactionPoller: transient error polling ${hash}:`, error);
                await this._sleep(intervalMs);
                continue;
            }
            if (response.status === GetTransactionStatus.SUCCESS) {
                return { status: 'SUCCESS', response: response };
            }
            if (response.status === GetTransactionStatus.FAILED) {
                return { status: 'FAILED', response: response };
            }
            // NOT_FOUND — transaction is still pending; wait and retry
            await this._sleep(intervalMs);
        }
        return { status: 'TIMEOUT' };
    }
    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.TransactionPoller = TransactionPoller;
//# sourceMappingURL=transactionPoller.js.map