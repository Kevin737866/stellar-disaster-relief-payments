"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineSigner = exports.NetworkMismatchError = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class NetworkMismatchError extends Error {
    constructor(expected, got) {
        super(`Network mismatch: envelope is for "${expected}" but signing key belongs to "${got}". ` +
            'Refusing to sign to prevent cross-network replay.');
        this.name = 'NetworkMismatchError';
    }
}
exports.NetworkMismatchError = NetworkMismatchError;
class OfflineSigner {
    /**
     * Serialize a built (unsigned) Transaction into a portable OfflineEnvelope.
     * The envelope can be safely exported, stored, or transferred to an air-gapped
     * device for signing without any network dependency.
     */
    static serialize(tx) {
        return {
            txXdr: tx.toXDR(),
            networkPassphrase: tx.networkPassphrase,
            createdAt: new Date().toISOString(),
            signedBy: [],
        };
    }
    /**
     * Deserialize an OfflineEnvelope back into a Transaction object.
     * Validates that the envelope's network passphrase matches the expected network.
     *
     * @throws {NetworkMismatchError} if passphrases do not match.
     */
    static deserialize(envelope, expectedPassphrase) {
        if (expectedPassphrase && envelope.networkPassphrase !== expectedPassphrase) {
            throw new NetworkMismatchError(envelope.networkPassphrase, expectedPassphrase);
        }
        return new stellar_sdk_1.Transaction(envelope.txXdr, envelope.networkPassphrase);
    }
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
    static sign(envelope, signerSecretKey, expectedPassphrase) {
        const passphrase = expectedPassphrase ?? envelope.networkPassphrase;
        if (envelope.networkPassphrase !== passphrase) {
            throw new NetworkMismatchError(envelope.networkPassphrase, passphrase);
        }
        const keypair = stellar_sdk_1.Keypair.fromSecret(signerSecretKey);
        const publicKey = keypair.publicKey();
        if (envelope.signedBy.includes(publicKey)) {
            throw new Error(`Key ${publicKey} has already signed this envelope`);
        }
        const tx = new stellar_sdk_1.Transaction(envelope.txXdr, envelope.networkPassphrase);
        tx.sign(keypair);
        return {
            txXdr: tx.toXDR(),
            networkPassphrase: envelope.networkPassphrase,
            createdAt: envelope.createdAt,
            signedBy: [...envelope.signedBy, publicKey],
        };
    }
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
    static importSignature(envelope, signerPublicKey, signatureHex) {
        if (envelope.signedBy.includes(signerPublicKey)) {
            throw new Error(`Key ${signerPublicKey} has already signed this envelope`);
        }
        const sigBytes = Buffer.from(signatureHex, 'hex');
        if (sigBytes.length !== 64) {
            throw new Error(`Invalid signature length: expected 64 bytes, got ${sigBytes.length}`);
        }
        const tx = new stellar_sdk_1.Transaction(envelope.txXdr, envelope.networkPassphrase);
        const keypair = stellar_sdk_1.Keypair.fromPublicKey(signerPublicKey);
        tx.addSignature(keypair.publicKey(), sigBytes.toString('base64'));
        return {
            txXdr: tx.toXDR(),
            networkPassphrase: envelope.networkPassphrase,
            createdAt: envelope.createdAt,
            signedBy: [...envelope.signedBy, signerPublicKey],
        };
    }
    /**
     * Encode an OfflineEnvelope to a Base64 JSON string for safe transfer
     * between environments (QR code, file, clipboard, etc.).
     */
    static encode(envelope) {
        return Buffer.from(JSON.stringify(envelope)).toString('base64');
    }
    /**
     * Decode a Base64 JSON string back into an OfflineEnvelope.
     *
     * @throws {Error} if the string is not valid Base64 JSON or is missing required fields.
     */
    static decode(encoded) {
        let parsed;
        try {
            parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        }
        catch {
            throw new Error('Invalid encoded envelope: not valid Base64 JSON');
        }
        const env = parsed;
        if (typeof env.txXdr !== 'string' ||
            typeof env.networkPassphrase !== 'string' ||
            typeof env.createdAt !== 'string' ||
            !Array.isArray(env.signedBy)) {
            throw new Error('Invalid encoded envelope: missing required fields');
        }
        return env;
    }
    /**
     * Validate that an envelope's network passphrase matches the expected network.
     * Returns true if valid, false otherwise.
     */
    static validateNetwork(envelope, expectedPassphrase) {
        return envelope.networkPassphrase === expectedPassphrase;
    }
    /**
     * Submit a signed envelope to the network.
     * Separates offline signing from online submission — call this only when
     * connectivity is restored.
     *
     * @param envelope  A signed OfflineEnvelope (signedBy.length >= required threshold)
     * @param server    stellar-sdk Server instance
     */
    static async submit(envelope, server) {
        const tx = new stellar_sdk_1.Transaction(envelope.txXdr, envelope.networkPassphrase);
        return server.sendTransaction(tx);
    }
}
exports.OfflineSigner = OfflineSigner;
//# sourceMappingURL=offlineSigner.js.map