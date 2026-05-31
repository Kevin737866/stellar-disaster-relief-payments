import { BeneficiaryProfile, VerificationFactor } from './types';
export declare class BeneficiaryClient {
    private server;
    private contract;
    private config;
    constructor(config: any);
    /**
     * Register displaced person without traditional ID
     */
    registerBeneficiary(registrarKey: string, beneficiaryId: string, name: string, disasterId: string, location: string, walletAddress: string, familySize: number, specialNeeds: string[], verificationFactors: VerificationFactor[]): Promise<string>;
    /**
     * Verify beneficiary using behavioral/possession factors
     */
    verifyBeneficiary(verifierKey: string, beneficiaryId: string, providedFactors: VerificationFactor[]): Promise<boolean>;
    /**
     * Restore access using recovery code
     */
    restoreAccess(beneficiaryId: string, recoveryCode: string, newWalletAddress: string): Promise<boolean>;
    /**
     * Get beneficiary profile
     */
    getBeneficiary(beneficiaryId: string): Promise<BeneficiaryProfile | null>;
    /**
     * List beneficiaries by disaster
     */
    listBeneficiariesByDisaster(disasterId: string): Promise<BeneficiaryProfile[]>;
    /**
     * Update beneficiary location
     */
    updateLocation(beneficiaryKey: string, beneficiaryId: string, newLocation: string): Promise<string>;
    /**
     * Generate recovery codes for offline access
     */
    generateRecoveryCodes(beneficiaryId: string): string[];
    private generateRecoveryCode;
    /**
     * Create biometric-free identity factors
     */
    createVerificationFactors(possessionFactors: string[], behavioralFactors: string[], socialFactors: string[]): VerificationFactor[];
    /**
     * Generate QR code for beneficiary identification
     */
    generateBeneficiaryQRCode(beneficiaryId: string, profile: BeneficiaryProfile): string;
    /**
     * Validate beneficiary QR code
     */
    validateBeneficiaryQRCode(qrCodeData: string): Promise<boolean>;
    /**
     * Create USSD session for feature phone users
     */
    createUSSDSession(phoneNumber: string): {
        sessionId: string;
        welcomeMessage: string;
    };
    /**
     * Process USSD input
     */
    processUSSDInput(sessionId: string, input: string, currentStep: string): {
        response: string;
        nextStep: string;
        completed?: boolean;
    };
    private processMainMenu;
    private processRegistrationName;
    private processRegistrationLocation;
    private processRegistrationFamily;
    private generateSessionId;
    /**
     * Get beneficiary statistics
     */
    getBeneficiaryStatistics(disasterId: string): Promise<{
        totalBeneficiaries: number;
        averageFamilySize: number;
        averageTrustScore: number;
        activeBeneficiaries: number;
        specialNeedsCount: number;
    }>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=beneficiaryClient.d.ts.map