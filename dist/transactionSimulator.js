"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionSimulator = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class TransactionSimulator {
    constructor(config) {
        this.config = config;
        this.rpcServer = new stellar_sdk_1.rpc.Server(config.rpcUrl);
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
    async simulate(transaction) {
        const tx = this.resolveTransaction(transaction);
        const raw = await this.rpcServer.simulateTransaction(tx);
        return this.buildResult(raw);
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    resolveTransaction(transaction) {
        if (typeof transaction !== 'string') {
            return transaction;
        }
        try {
            return stellar_sdk_1.TransactionBuilder.fromXDR(transaction, this.getNetworkPassphrase());
        }
        catch (err) {
            throw new Error(`Invalid transaction XDR: ${err.message}`);
        }
    }
    buildResult(raw) {
        if (stellar_sdk_1.rpc.Api.isSimulationError(raw)) {
            return {
                success: false,
                error: raw.error,
                latestLedger: raw.latestLedger,
                restoreRequired: false,
                raw,
            };
        }
        const successResponse = raw;
        const restoreRequired = stellar_sdk_1.rpc.Api.isSimulationRestore(raw);
        return {
            success: true,
            minResourceFee: successResponse.minResourceFee,
            latestLedger: raw.latestLedger,
            restoreRequired,
            raw,
        };
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
                throw new Error(`Unsupported network: ${this.config.network}`);
        }
    }
}
exports.TransactionSimulator = TransactionSimulator;
//# sourceMappingURL=transactionSimulator.js.map