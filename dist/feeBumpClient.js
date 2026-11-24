"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeeBumpClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const validation_1 = require("./validation");
const transactionSimulator_1 = require("./transactionSimulator");
/** Minimum multiplier over the inner transaction's per-op fee rate. */
const MIN_FEE_MULTIPLIER = 10;
/**
 * Checks whether a transaction is still pending (not yet confirmed or failed).
 * Returns true if the transaction is not found on-chain (i.e. still pending).
 */
async function isTransactionPending(horizonServer, txHash) {
    try {
        await horizonServer.transactions().transaction(txHash).call();
        // Transaction found on-chain — already confirmed, not pending.
        return false;
    }
    catch (err) {
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
function computeMinBumpFee(innerTx) {
    const innerOps = innerTx.operations.length || 1;
    const innerPerOpFee = Math.ceil(Number(innerTx.fee) / innerOps);
    const minFee = Math.max(innerPerOpFee * MIN_FEE_MULTIPLIER, Number(stellar_sdk_1.BASE_FEE));
    return String(minFee);
}
class FeeBumpClient {
    constructor(config) {
        this.config = config;
        this.rpcServer = new stellar_sdk_1.rpc.Server(config.rpcUrl);
        this.horizonServer = new stellar_sdk_1.Horizon.Server(config.horizonUrl);
        this.simulator = new transactionSimulator_1.TransactionSimulator(config);
    }
    /**
     * Simulates a fee bump transaction in non-persistent preview mode.
     *
     * Builds the fee bump envelope from the provided options and runs it through
     * the RPC simulation endpoint without submitting it. Useful for validating
     * construction and estimating fees before calling {@link bumpFee}.
     *
     * @throws if the inner transaction XDR is invalid or the fee source key is bad.
     */
    async simulateBump(options) {
        const { feeSourceKey, innerTransactionXdr, newBaseFee } = options;
        const feeSourceKeypair = stellar_sdk_1.Keypair.fromSecret(feeSourceKey);
        (0, validation_1.validateAddress)(feeSourceKeypair.publicKey(), 'feeSource');
        let innerTx;
        try {
            const envelope = stellar_sdk_1.TransactionBuilder.fromXDR(innerTransactionXdr, this.getNetworkPassphrase());
            if (envelope instanceof stellar_sdk_1.FeeBumpTransaction) {
                throw new Error('Cannot fee bump a fee bump transaction. Provide the original inner transaction XDR.');
            }
            innerTx = envelope;
        }
        catch (err) {
            if (err.message.includes('Cannot fee bump'))
                throw err;
            throw new Error(`Invalid inner transaction XDR: ${err.message}`);
        }
        const minFee = computeMinBumpFee(innerTx);
        const baseFee = newBaseFee ?? minFee;
        if (Number(baseFee) < Number(minFee)) {
            throw new Error(`newBaseFee (${baseFee}) is below the required minimum of ${minFee} stroops.`);
        }
        const feeBumpTx = stellar_sdk_1.TransactionBuilder.buildFeeBumpTransaction(feeSourceKeypair, baseFee, innerTx, this.getNetworkPassphrase());
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
     * - The new base fee meets protocol minimums.
     *
     * @throws if the inner transaction is already confirmed or is itself a fee bump.
     * @throws if the new base fee is below the required minimum.
     */
    async bumpFee(options) {
        const { feeSourceKey, innerTransactionXdr, newBaseFee } = options;
        const feeSourceKeypair = stellar_sdk_1.Keypair.fromSecret(feeSourceKey);
        (0, validation_1.validateAddress)(feeSourceKeypair.publicKey(), 'feeSource');
        // Deserialize and validate the inner transaction.
        let innerTx;
        try {
            const envelope = stellar_sdk_1.TransactionBuilder.fromXDR(innerTransactionXdr, this.getNetworkPassphrase());
            if (envelope instanceof stellar_sdk_1.FeeBumpTransaction) {
                throw new Error('Cannot fee bump a fee bump transaction. Provide the original inner transaction XDR.');
            }
            innerTx = envelope;
        }
        catch (err) {
            if (err.message.includes('Cannot fee bump'))
                throw err;
            throw new Error(`Invalid inner transaction XDR: ${err.message}`);
        }
        // Ensure the transaction is still pending.
        const pending = await isTransactionPending(this.horizonServer, innerTx.hash().toString('hex'));
        if (!pending) {
            throw new Error(`Transaction ${innerTx.hash().toString('hex')} is already confirmed and cannot be fee bumped.`);
        }
        // Determine and validate the bump fee.
        const minFee = computeMinBumpFee(innerTx);
        const baseFee = newBaseFee ?? minFee;
        if (Number(baseFee) < Number(minFee)) {
            throw new Error(`newBaseFee (${baseFee}) is below the required minimum of ${minFee} stroops.`);
        }
        // Build, sign, and submit the fee bump transaction.
        const feeBumpTx = stellar_sdk_1.TransactionBuilder.buildFeeBumpTransaction(feeSourceKeypair, baseFee, innerTx, this.getNetworkPassphrase());
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
    getMinBumpFee(innerTransactionXdr) {
        let innerTx;
        try {
            const envelope = stellar_sdk_1.TransactionBuilder.fromXDR(innerTransactionXdr, this.getNetworkPassphrase());
            if (envelope instanceof stellar_sdk_1.FeeBumpTransaction) {
                throw new Error('Cannot compute bump fee for a fee bump transaction.');
            }
            innerTx = envelope;
        }
        catch (err) {
            if (err.message.includes('Cannot compute'))
                throw err;
            throw new Error(`Invalid inner transaction XDR: ${err.message}`);
        }
        return computeMinBumpFee(innerTx);
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
exports.FeeBumpClient = FeeBumpClient;
//# sourceMappingURL=feeBumpClient.js.map