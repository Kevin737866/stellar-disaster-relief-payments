"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractUpgradeClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const transactionPoller_1 = require("./transactionPoller");
const { Server } = stellar_sdk_1.SorobanRpc;
/**
 * Client for upgrading already-deployed Soroban contracts.
 *
 * The upgrade flow follows the Soroban contract-upgrade pattern:
 *   1. Validate inputs.
 *   2. Build a transaction that invokes the contract's `upgrade` function
 *      with the new WASM hash.
 *   3. Sign and submit the transaction.
 *   4. Poll until the transaction reaches a terminal state.
 *
 * The contract identifier is preserved — only the executing WASM changes.
 */
class ContractUpgradeClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.poller = new transactionPoller_1.TransactionPoller(config);
    }
    /**
     * Upgrade a deployed contract to a new WASM hash.
     *
     * @param request - Upgrade parameters (target, newWasmHash, adminKey).
     * @param pollOptions - Optional polling configuration.
     * @returns Upgrade result including the preserved contractId and tx hash.
     * @throws Error on invalid inputs, authorization failure, or network error.
     */
    async upgradeContract(request, pollOptions) {
        this.validateRequest(request);
        const contractId = this.resolveContractId(request.target);
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(request.adminKey);
        const wasmHashBytes = this.decodeWasmHash(request.newWasmHash);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const contract = new stellar_sdk_1.Contract(contractId);
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(contract.call('upgrade', stellar_sdk_1.xdr.ScVal.scvBytes(wasmHashBytes)))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        let sendResult;
        try {
            sendResult = await this.server.sendTransaction(tx);
        }
        catch (error) {
            throw new Error(`ContractUpgradeClient: network error submitting upgrade for ${request.target}: ${error}`);
        }
        if (sendResult.status === 'ERROR' ||
            sendResult.status === 'DUPLICATE' ||
            sendResult.status === 'TRY_AGAIN_LATER') {
            throw new Error(`ContractUpgradeClient: transaction rejected for ${request.target}: ${sendResult.status}`);
        }
        const txHash = sendResult.hash;
        const pollResult = await this.poller.pollTransaction(txHash, pollOptions);
        if (pollResult.status === 'TIMEOUT') {
            return { contractId, transactionHash: txHash, status: 'TIMEOUT' };
        }
        if (pollResult.status === 'FAILED') {
            return { contractId, transactionHash: txHash, status: 'FAILED' };
        }
        const ledger = pollResult.response.ledger;
        return { contractId, transactionHash: txHash, status: 'SUCCESS', ledger };
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    validateRequest(request) {
        if (!request.target) {
            throw new Error('ContractUpgradeClient: target is required');
        }
        if (!request.newWasmHash || request.newWasmHash.trim() === '') {
            throw new Error('ContractUpgradeClient: newWasmHash is required');
        }
        if (!request.adminKey || request.adminKey.trim() === '') {
            throw new Error('ContractUpgradeClient: adminKey is required');
        }
        // Validate the secret key format early so callers get a clear error.
        try {
            stellar_sdk_1.Keypair.fromSecret(request.adminKey);
        }
        catch {
            throw new Error('ContractUpgradeClient: adminKey is not a valid Stellar secret key');
        }
        // Validate WASM hash is decodable.
        this.decodeWasmHash(request.newWasmHash);
    }
    resolveContractId(target) {
        const id = this.config.contractIds[target];
        if (!id || id.trim() === '') {
            throw new Error(`ContractUpgradeClient: no contractId configured for target "${target}"`);
        }
        return id;
    }
    /**
     * Decode a WASM hash supplied as hex or base64 into a Buffer.
     * Soroban expects a 32-byte hash.
     */
    decodeWasmHash(hash) {
        const trimmed = hash.trim();
        // Hex: 64 hex chars = 32 bytes
        if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
            return Buffer.from(trimmed, 'hex');
        }
        // Base64: attempt decode
        try {
            const buf = Buffer.from(trimmed, 'base64');
            if (buf.length !== 32) {
                throw new Error(`expected 32 bytes, got ${buf.length}`);
            }
            return buf;
        }
        catch (e) {
            throw new Error(`ContractUpgradeClient: newWasmHash must be a 64-char hex string or 32-byte base64 value (${e})`);
        }
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
                throw new Error(`ContractUpgradeClient: unsupported network "${this.config.network}"`);
        }
    }
}
exports.ContractUpgradeClient = ContractUpgradeClient;
//# sourceMappingURL=contractUpgradeClient.js.map