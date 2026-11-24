import { BeneficiaryIdentity, IdentityFactor, GeofenceZone } from './types';
export declare class BeneficiaryIdentityClient {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Create identity from multiple factors (NO BIOMETRICS)
     * Factors include: knowledge, possession, social, behavioral, institutional
     */
    createIdentity(registrarKey: string, factors: IdentityFactor[], recoveryContacts: string[], // Stellar addresses
    campLocation: string, walletAddress: string, duressPin?: string): Promise<string>;
    /**
     * Generate identity factors from various sources
     */
    generateFactors(options: {
        pin?: string;
        mothersMaidenName?: string;
        birthCity?: string;
        phoneNumber?: string;
        simCardId?: string;
        aidRationCard?: string;
        nfcWristband?: string;
        communityVouchers?: string[];
        deviceFingerprint?: string;
        typingPattern?: string;
        locationHistory?: string[];
        ngoAttestation?: string;
        campRegistrationId?: string;
    }): IdentityFactor[];
    /**
     * Social recovery: Initiate recovery with trusted contacts
     */
    restoreIdentity(idHash: string, approvingContactKey: string, newWalletAddress: string): Promise<boolean>;
    /**
     * Verify identity without revealing factors (zero-knowledge proof simulation)
     */
    verifyIdentityWithoutReveal(idHash: string, challengeFactors: IdentityFactor[]): Promise<boolean>;
    /**
     * Update trust score based on activity
     */
    updateTrustScore(idHash: string, activityType: string, isPositive: boolean): Promise<void>;
    /**
     * Generate QR access code for offline verification
     */
    generateQRAccess(idHash: string, identity: BeneficiaryIdentity, validityMinutes?: number): string;
    /**
     * Validate QR access code
     */
    validateQRAccess(qrCodeData: string): boolean;
    /**
     * Create temporary credentials for shared devices
     */
    createTemporaryCredentials(idHash: string, ownerKey: string, deviceFingerprint: string, durationMinutes?: number): Promise<string>;
    /**
     * Transfer identity across camp locations
     */
    transferIdentity(idHash: string, ownerKey: string, newCampLocation: string, newGeofence?: GeofenceZone): Promise<void>;
    /**
     * Verify identity with duress mode check
     */
    verifyWithDuressCheck(idHash: string, pin: string): Promise<{
        isValid: boolean;
        isDuress: boolean;
    }>;
    /**
     * Check if identity is within safe geofence
     */
    checkGeofence(idHash: string, latitude: number, longitude: number): Promise<boolean>;
    /**
     * Get identity information
     */
    getIdentity(idHash: string): Promise<BeneficiaryIdentity | null>;
    /**
     * Hash a factor value for privacy.
     *
     * Uses SHA-256 via `crypto-js`, which produces a lowercase hex digest.
     * This **must** match the algorithm used on-chain in `beneficiary_manager.rs`
     * (`sha2::Sha256` + `hex::encode`).  Both produce identical lowercase hex
     * for the same input string.  Do not switch to a different algorithm without
     * updating the Soroban contract simultaneously.
     */
    private hashFactor;
    /**
     * Sign QR data for offline verification.
     *
     * Uses SHA-256 via `crypto-js` to create a short-lived signature over the
     * idHash + expiry + contract address.  Not sent to the contract; used only
     * for offline QR code validation by the `offlineAuth` module.
     */
    private signQRData;
    private getNetworkPassphrase;
}
//# sourceMappingURL=beneficiaryIdentity.d.ts.map