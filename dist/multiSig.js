"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiSigManager = void 0;
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Manages multi-signature collection for a single Stellar/Soroban transaction.
 *
 * Usage:
 *   const mgr = MultiSigManager.create(tx, networkPassphrase, authorizedSigners, threshold);
 *   mgr.addSignature(signerSecretKey);   // repeat until threshold met
 *   if (mgr.isReady()) await mgr.submit(server);
 */
class MultiSigManager {
    constructor(state) {
        this.state = state;
    }
    /**
     * Create a new MultiSigManager from a built (unsigned) transaction.
     *
     * @param tx                Built Transaction object (not yet signed)
     * @param networkPassphrase Stellar network passphrase
     * @param authorizedSigners Public keys allowed to sign
     * @param threshold         Minimum signatures required for submission
     */
    static create(tx, networkPassphrase, authorizedSigners, threshold) {
        if (authorizedSigners.length === 0) {
            throw new Error('authorizedSigners must not be empty');
        }
        if (threshold < 1 || threshold > authorizedSigners.length) {
            throw new Error(`threshold must be between 1 and ${authorizedSigners.length}, got ${threshold}`);
        }
        return new MultiSigManager({
            txXdr: tx.toXDR(),
            authorizedSigners: [...new Set(authorizedSigners)],
            threshold,
            collectedSigners: [],
            status: 'pending',
            networkPassphrase,
        });
    }
    /**
     * Restore a MultiSigManager from a previously serialized state (e.g. from DB/storage).
     */
    static fromState(state) {
        return new MultiSigManager({ ...state });
    }
    /**
     * Add a signature from the given signer secret key.
     *
     * Throws if:
     *  - the signer is not in authorizedSigners
     *  - the signer has already signed
     *  - the transaction has already been submitted
     *
     * Returns the updated progress.
     */
    addSignature(signerSecretKey) {
        if (this.state.status === 'submitted') {
            throw new Error('Transaction has already been submitted');
        }
        const keypair = stellar_sdk_1.Keypair.fromSecret(signerSecretKey);
        const publicKey = keypair.publicKey();
        if (!this.state.authorizedSigners.includes(publicKey)) {
            throw new Error(`Signer ${publicKey} is not authorized for this transaction`);
        }
        if (this.state.collectedSigners.includes(publicKey)) {
            throw new Error(`Signer ${publicKey} has already signed this transaction`);
        }
        // Deserialize, sign, re-serialize to accumulate signatures in the XDR
        const tx = this.deserializeTx();
        tx.sign(keypair);
        this.state.txXdr = tx.toXDR();
        this.state.collectedSigners.push(publicKey);
        if (this.state.collectedSigners.length >= this.state.threshold) {
            this.state.status = 'ready';
        }
        return this.getProgress();
    }
    /** Returns true when enough signatures have been collected. */
    isReady() {
        return this.state.status === 'ready' || this.state.status === 'submitted';
    }
    /** Returns current signing progress for UI feedback. */
    getProgress() {
        const remaining = this.state.authorizedSigners.filter(s => !this.state.collectedSigners.includes(s));
        return {
            status: this.state.status,
            collectedSigners: [...this.state.collectedSigners],
            remainingSigners: remaining,
            signaturesRequired: this.state.threshold,
            signaturesCollected: this.state.collectedSigners.length,
            signaturesRemaining: Math.max(0, this.state.threshold - this.state.collectedSigners.length),
        };
    }
    /**
     * Submit the fully-signed transaction to the network.
     * Throws if threshold has not been met.
     *
     * @param server  stellar-sdk Server instance
     * @returns       sendTransaction result
     */
    async submit(server) {
        if (this.state.status === 'submitted') {
            throw new Error('Transaction has already been submitted');
        }
        if (this.state.collectedSigners.length < this.state.threshold) {
            const progress = this.getProgress();
            throw new Error(`Cannot submit: ${progress.signaturesRemaining} more signature(s) required ` +
                `(${progress.signaturesCollected}/${progress.signaturesRequired} collected)`);
        }
        const tx = this.deserializeTx();
        const result = await server.sendTransaction(tx);
        this.state.status = 'submitted';
        return result;
    }
    /** Serialize state for persistence (e.g. store in DB between signing rounds). */
    toState() {
        return {
            ...this.state,
            authorizedSigners: [...this.state.authorizedSigners],
            collectedSigners: [...this.state.collectedSigners],
        };
    }
    deserializeTx() {
        return new stellar_sdk_1.Transaction(this.state.txXdr, this.state.networkPassphrase);
    }
}
exports.MultiSigManager = MultiSigManager;
//# sourceMappingURL=multiSig.js.map