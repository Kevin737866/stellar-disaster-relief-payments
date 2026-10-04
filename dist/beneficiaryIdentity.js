"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeneficiaryIdentityClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const crypto_js_1 = require("crypto-js");
class BeneficiaryIdentityClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.beneficiaryManager);
    }
    /**
     * Create identity from multiple factors (NO BIOMETRICS)
     * Factors include: knowledge, possession, social, behavioral, institutional
     */
    async createIdentity(registrarKey, factors, recoveryContacts, // Stellar addresses
    campLocation, walletAddress, duressPin) {
        if (factors.length < 3) {
            throw new Error('Minimum 3 identity factors required for security');
        }
        const registrarKeypair = stellar_sdk_1.Keypair.fromSecret(registrarKey);
        const registrarAccount = await this.server.getAccount(registrarKeypair.publicKey());
        // Hash factors for privacy
        const hashedFactors = factors.map(f => ({
            ...f,
            factorHash: this.hashFactor(f.value)
        }));
        const tx = new stellar_sdk_1.TransactionBuilder(registrarAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_identity_from_factors", ...[
            new stellar_sdk_1.Address(registrarKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(hashedFactors),
            (0, stellar_sdk_1.nativeToScVal)(recoveryContacts.map(addr => new stellar_sdk_1.Address(addr).toScVal())),
            (0, stellar_sdk_1.nativeToScVal)(campLocation),
            new stellar_sdk_1.Address(walletAddress).toScVal(),
            duressPin ? (0, stellar_sdk_1.nativeToScVal)(duressPin) : (0, stellar_sdk_1.nativeToScVal)(null)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(registrarKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            const idHash = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return idHash;
        }
        else {
            throw new Error(`Failed to create identity: ${result.status}`);
        }
    }
    /**
     * Generate identity factors from various sources
     */
    generateFactors(options) {
        const factors = [];
        const currentTime = Date.now();
        // Knowledge factors
        if (options.pin) {
            factors.push({
                factorType: 'knowledge',
                value: options.pin,
                factorHash: this.hashFactor(options.pin),
                weight: 25,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.mothersMaidenName) {
            factors.push({
                factorType: 'knowledge',
                value: options.mothersMaidenName,
                factorHash: this.hashFactor(options.mothersMaidenName),
                weight: 20,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.birthCity) {
            factors.push({
                factorType: 'knowledge',
                value: options.birthCity,
                factorHash: this.hashFactor(options.birthCity),
                weight: 15,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        // Possession factors
        if (options.phoneNumber) {
            factors.push({
                factorType: 'possession',
                value: options.phoneNumber,
                factorHash: this.hashFactor(options.phoneNumber),
                weight: 30,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.simCardId) {
            factors.push({
                factorType: 'possession',
                value: options.simCardId,
                factorHash: this.hashFactor(options.simCardId),
                weight: 25,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.aidRationCard) {
            factors.push({
                factorType: 'possession',
                value: options.aidRationCard,
                factorHash: this.hashFactor(options.aidRationCard),
                weight: 30,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.nfcWristband) {
            factors.push({
                factorType: 'possession',
                value: options.nfcWristband,
                factorHash: this.hashFactor(options.nfcWristband),
                weight: 35,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        // Social factors
        if (options.communityVouchers && options.communityVouchers.length >= 3) {
            factors.push({
                factorType: 'social',
                value: options.communityVouchers.join(','),
                factorHash: this.hashFactor(options.communityVouchers.join(',')),
                weight: 40,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        // Behavioral factors
        if (options.deviceFingerprint) {
            factors.push({
                factorType: 'behavioral',
                value: options.deviceFingerprint,
                factorHash: this.hashFactor(options.deviceFingerprint),
                weight: 20,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.typingPattern) {
            factors.push({
                factorType: 'behavioral',
                value: options.typingPattern,
                factorHash: this.hashFactor(options.typingPattern),
                weight: 15,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.locationHistory) {
            factors.push({
                factorType: 'behavioral',
                value: options.locationHistory.join('|'),
                factorHash: this.hashFactor(options.locationHistory.join('|')),
                weight: 25,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        // Institutional factors
        if (options.ngoAttestation) {
            factors.push({
                factorType: 'institutional',
                value: options.ngoAttestation,
                factorHash: this.hashFactor(options.ngoAttestation),
                weight: 45,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        if (options.campRegistrationId) {
            factors.push({
                factorType: 'institutional',
                value: options.campRegistrationId,
                factorHash: this.hashFactor(options.campRegistrationId),
                weight: 40,
                verifiedAt: currentTime,
                verifier: null
            });
        }
        return factors;
    }
    /**
     * Social recovery: Initiate recovery with trusted contacts
     */
    async restoreIdentity(idHash, approvingContactKey, newWalletAddress) {
        const contactKeypair = stellar_sdk_1.Keypair.fromSecret(approvingContactKey);
        const contactAccount = await this.server.getAccount(contactKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(contactAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("social_recovery", ...[
            (0, stellar_sdk_1.nativeToScVal)(idHash),
            new stellar_sdk_1.Address(contactKeypair.publicKey()).toScVal(),
            new stellar_sdk_1.Address(newWalletAddress).toScVal()
        ]))
            .setTimeout(30)
            .build();
        tx.sign(contactKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to restore identity: ${result.status}`);
        }
    }
    /**
     * Verify identity without revealing factors (zero-knowledge proof simulation)
     */
    async verifyIdentityWithoutReveal(idHash, challengeFactors) {
        try {
            // Get identity from blockchain
            const identity = await this.getIdentity(idHash);
            if (!identity) {
                return false;
            }
            // Verify factors match without revealing actual values
            let matchedWeight = 0;
            let totalWeight = 0;
            for (const storedFactor of identity.creationFactors) {
                totalWeight += storedFactor.weight;
                for (const challengeFactor of challengeFactors) {
                    if (storedFactor.factorType === challengeFactor.factorType) {
                        const challengeHash = this.hashFactor(challengeFactor.value);
                        if (storedFactor.factorHash === challengeHash) {
                            matchedWeight += storedFactor.weight;
                            break;
                        }
                    }
                }
            }
            // Require 70% match for verification
            const verificationScore = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 0;
            return verificationScore >= 70;
        }
        catch (error) {
            console.error('Verification failed:', error);
            return false;
        }
    }
    /**
     * Update trust score based on activity
     */
    async updateTrustScore(idHash, activityType, isPositive) {
        try {
            await this.contract.call("update_trust_score", ...[
                (0, stellar_sdk_1.nativeToScVal)(idHash),
                (0, stellar_sdk_1.nativeToScVal)(activityType),
                (0, stellar_sdk_1.nativeToScVal)(isPositive)
            ]);
        }
        catch (error) {
            console.error('Failed to update trust score:', error);
        }
    }
    /**
     * Generate QR access code for offline verification
     */
    generateQRAccess(idHash, identity, validityMinutes = 30) {
        const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
        const qrData = {
            type: 'identity_verification',
            idHash,
            trustScore: identity.trustScore,
            campLocation: identity.campLocation,
            expiresAt,
            timestamp: Date.now(),
            signature: this.signQRData(idHash, expiresAt)
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate QR access code
     */
    validateQRAccess(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'identity_verification') {
                return false;
            }
            // Check expiration
            if (Date.now() > data.expiresAt) {
                return false;
            }
            // Verify signature
            const expectedSignature = this.signQRData(data.idHash, data.expiresAt);
            return data.signature === expectedSignature;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Create temporary credentials for shared devices
     */
    async createTemporaryCredentials(idHash, ownerKey, deviceFingerprint, durationMinutes = 60) {
        const ownerKeypair = stellar_sdk_1.Keypair.fromSecret(ownerKey);
        const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());
        const durationSeconds = durationMinutes * 60;
        const tx = new stellar_sdk_1.TransactionBuilder(ownerAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("temporary_credentials", ...[
            (0, stellar_sdk_1.nativeToScVal)(idHash),
            new stellar_sdk_1.Address(ownerKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(deviceFingerprint),
            (0, stellar_sdk_1.nativeToScVal)(durationSeconds)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(ownerKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to create temporary credentials: ${result.status}`);
        }
    }
    /**
     * Transfer identity across camp locations
     */
    async transferIdentity(idHash, ownerKey, newCampLocation, newGeofence) {
        const ownerKeypair = stellar_sdk_1.Keypair.fromSecret(ownerKey);
        const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(ownerAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("identity_portability", ...[
            (0, stellar_sdk_1.nativeToScVal)(idHash),
            new stellar_sdk_1.Address(ownerKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(newCampLocation),
            newGeofence ? (0, stellar_sdk_1.nativeToScVal)(newGeofence) : (0, stellar_sdk_1.nativeToScVal)(null)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(ownerKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status !== 'SUCCESS') {
            throw new Error(`Failed to transfer identity: ${result.status}`);
        }
    }
    /**
     * Verify identity with duress mode check
     */
    async verifyWithDuressCheck(idHash, pin) {
        try {
            const result = await this.contract.call("verify_identity_with_duress", ...[
                (0, stellar_sdk_1.nativeToScVal)(idHash),
                (0, stellar_sdk_1.nativeToScVal)(pin)
            ]);
            const [isValid, isDuress] = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return { isValid, isDuress };
        }
        catch (error) {
            console.error('Duress check failed:', error);
            return { isValid: false, isDuress: false };
        }
    }
    /**
     * Check if identity is within safe geofence
     */
    async checkGeofence(idHash, latitude, longitude) {
        try {
            // Scale coordinates by 1e6 for precision
            const scaledLat = Math.round(latitude * 1e6);
            const scaledLon = Math.round(longitude * 1e6);
            const result = await this.contract.call("check_geofence", ...[
                (0, stellar_sdk_1.nativeToScVal)(idHash),
                (0, stellar_sdk_1.nativeToScVal)(scaledLat),
                (0, stellar_sdk_1.nativeToScVal)(scaledLon)
            ]);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Geofence check failed:', error);
            return false;
        }
    }
    /**
     * Get identity information
     */
    async getIdentity(idHash) {
        try {
            const result = await this.contract.call("get_identity", (0, stellar_sdk_1.nativeToScVal)(idHash));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get identity:', error);
            return null;
        }
    }
    /**
     * Hash a factor value for privacy
     */
    hashFactor(value) {
        return (0, crypto_js_1.SHA256)(value).toString();
    }
    /**
     * Sign QR data for verification
     */
    signQRData(idHash, expiresAt) {
        const data = `${idHash}_${expiresAt}_${this.config.contractIds.beneficiaryManager}`;
        return (0, crypto_js_1.SHA256)(data).toString();
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return 'Test SDF Network ; September 2015';
            case 'mainnet':
                return 'Public Global Stellar Network ; September 2015';
            case 'standalone':
                return 'Standalone Network ; February 2017';
            default:
                throw new Error('Unsupported network');
        }
    }
}
exports.BeneficiaryIdentityClient = BeneficiaryIdentityClient;
//# sourceMappingURL=beneficiaryIdentity.js.map