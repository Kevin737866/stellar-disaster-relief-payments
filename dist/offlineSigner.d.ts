import { Transaction } from 'stellar-sdk';
/** Portable envelope for an unsigned (or partially signed) transaction. */
export interface OfflineEnvelope {
    /** Base64-encoded XDR of the transaction (may carry 0 or more signatures). */
    txXdr: string;
    /** Stellar network passphrase — used to prevent cross-network replay. */
    networkPassphrase: string;
    /** ISO-8601 creation timestamp for auditing. */
    createdAt: string;
    /** Public keys that have already signed this envelope. */
    signedBy: string[];
}
export declare class NetworkMismatchError extends Error {
    constructor(expected: string, got: string);
}
export declare class OfflineSigner {
    /**
     * Serialize a built (unsigned) Transaction into a portable OfflineEnvelope.
     * The envelope can be safely exported, stored, or transferred to an air-gapped
     * device for signing without any network dependency.
     */
    static serialize(tx: Transaction): OfflineEnvelope;
    /**
     * Deserialize an OfflineEnvelope back into a Transaction object.
     * Validates that the envelope's network passphrase matches the expected network.
     *
     * @throws {NetworkMismatchError} if passphrases do not match.
     */
    static deserialize(envelope: OfflineEnvelope, expectedPassphrase?: string): Transaction;
    /**
     * Sign an OfflineEnvelope with a secret key — no network connection required.
     *
     * Validates that the signing key's network matches the envelope's network passphrase
     * to prevent accidental cross-network signing (testnet key on mainnet envelope).
     *
     * Returns a new envelope with the signature applied and the signer's public key
     * recorded in `signedBy`. The original envelope is not mutated.
     *
     * @throws {NetworkMismatchError} if the envelope passphrase does not match `expectedPassphrase`.
     * @throws {Error} if the signer has already signed this envelope.
     */
    static sign(envelope: OfflineEnvelope, signerSecretKey: string, expectedPassphrase?: string): OfflineEnvelope;
    /**
     * Import an external signature (e.g. from a hardware wallet or air-gapped device)
     * into an existing envelope without requiring the secret key.
     *
     * @param envelope     The envelope to add the signature to.
     * @param signerPublicKey  Public key of the signer.
     * @param signatureHex Hex-encoded 64-byte Ed25519 signature over the transaction hash.
     *
     * @throws {Error} if the signature is not 64 bytes.
     * @throws {Error} if the signer has already signed this envelope.
     */
    static importSignature(envelope: OfflineEnvelope, signerPublicKey: string, signatureHex: string): OfflineEnvelope;
    /**
     * Encode an OfflineEnvelope to a Base64 JSON string for safe transfer
     * between environments (QR code, file, clipboard, etc.).
     */
    static encode(envelope: OfflineEnvelope): string;
    /**
     * Decode a Base64 JSON string back into an OfflineEnvelope.
     *
     * @throws {Error} if the string is not valid Base64 JSON or is missing required fields.
     */
    static decode(encoded: string): OfflineEnvelope;
    /**
     * Validate that an envelope's network passphrase matches the expected network.
     * Returns true if valid, false otherwise.
     */
    static validateNetwork(envelope: OfflineEnvelope, expectedPassphrase: string): boolean;
    /**
     * Submit a signed envelope to the network.
     * Separates offline signing from online submission — call this only when
     * connectivity is restored.
     *
     * @param envelope  A signed OfflineEnvelope (signedBy.length >= required threshold)
     * @param server    stellar-sdk Server instance
     */
    static submit(envelope: OfflineEnvelope, server: {
        sendTransaction: (tx: Transaction) => Promise<any>;
    }): Promise<any>;
}
//# sourceMappingURL=offlineSigner.d.ts.map