import { Transaction } from 'stellar-sdk';
export type MultiSigStatus = 'pending' | 'ready' | 'submitted';
export interface MultiSigState {
    /** Serialized transaction XDR (immutable after creation) */
    txXdr: string;
    /** Ordered list of authorized signer public keys */
    authorizedSigners: string[];
    /** Number of signatures required before submission */
    threshold: number;
    /** Public keys that have already signed */
    collectedSigners: string[];
    status: MultiSigStatus;
    /** Network passphrase used to deserialize the transaction */
    networkPassphrase: string;
}
export interface MultiSigProgress {
    status: MultiSigStatus;
    collectedSigners: string[];
    remainingSigners: string[];
    signaturesRequired: number;
    signaturesCollected: number;
    signaturesRemaining: number;
}
/**
 * Manages multi-signature collection for a single Stellar/Soroban transaction.
 *
 * Usage:
 *   const mgr = MultiSigManager.create(tx, networkPassphrase, authorizedSigners, threshold);
 *   mgr.addSignature(signerSecretKey);   // repeat until threshold met
 *   if (mgr.isReady()) await mgr.submit(server);
 */
export declare class MultiSigManager {
    private state;
    private constructor();
    /**
     * Create a new MultiSigManager from a built (unsigned) transaction.
     *
     * @param tx                Built Transaction object (not yet signed)
     * @param networkPassphrase Stellar network passphrase
     * @param authorizedSigners Public keys allowed to sign
     * @param threshold         Minimum signatures required for submission
     */
    static create(tx: Transaction, networkPassphrase: string, authorizedSigners: string[], threshold: number): MultiSigManager;
    /**
     * Restore a MultiSigManager from a previously serialized state (e.g. from DB/storage).
     */
    static fromState(state: MultiSigState): MultiSigManager;
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
    addSignature(signerSecretKey: string): MultiSigProgress;
    /** Returns true when enough signatures have been collected. */
    isReady(): boolean;
    /** Returns current signing progress for UI feedback. */
    getProgress(): MultiSigProgress;
    /**
     * Submit the fully-signed transaction to the network.
     * Throws if threshold has not been met.
     *
     * @param server  stellar-sdk Server instance
     * @returns       sendTransaction result
     */
    submit(server: {
        sendTransaction: (tx: Transaction) => Promise<any>;
    }): Promise<any>;
    /** Serialize state for persistence (e.g. store in DB between signing rounds). */
    toState(): MultiSigState;
    private deserializeTx;
}
//# sourceMappingURL=multiSig.d.ts.map