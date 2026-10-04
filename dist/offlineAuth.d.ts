import { OfflineAuthCode, BluetoothMeshNode, PaperBackupCode, BeneficiaryIdentity } from './types';
/**
 * Offline Authentication Module
 * Provides authentication capabilities without internet connectivity
 */
export declare class OfflineAuthClient {
    private config;
    private meshNodes;
    constructor(config: any);
    /**
     * Generate QR code with time-based signatures for offline verification
     */
    generateQRCode(idHash: string, identity: BeneficiaryIdentity, validityMinutes?: number): OfflineAuthCode;
    /**
     * Validate QR code offline
     */
    validateQRCode(qrCodeData: string): {
        isValid: boolean;
        idHash?: string;
        trustScore?: number;
        campLocation?: string;
        reason?: string;
    };
    /**
     * Generate paper backup codes with cryptographic checksums
     */
    generatePaperBackupCodes(idHash: string, count?: number): PaperBackupCode[];
    /**
     * Validate paper backup code
     */
    validatePaperBackupCode(code: string, checksum: string): boolean;
    /**
     * Generate SMS/USSD authentication code for feature phones
     */
    generateSMSCode(idHash: string, phoneNumber: string, validityMinutes?: number): OfflineAuthCode;
    /**
     * Validate SMS/USSD code
     */
    validateSMSCode(code: string, phoneNumber: string, signature: string, expiresAt: number): boolean;
    /**
     * Format USSD menu for feature phones
     */
    formatUSSDMenu(step: string, data?: any): string;
    /**
     * Initialize Bluetooth mesh networking for camp-wide verification
     */
    initializeMeshNetwork(nodeId: string, publicKey: string, location: string): BluetoothMeshNode;
    /**
     * Broadcast identity verification request to mesh network
     */
    broadcastVerificationRequest(idHash: string, requestingNodeId: string): {
        requestId: string;
        timestamp: number;
        signature: string;
    };
    /**
     * Respond to mesh network verification request
     */
    respondToVerificationRequest(requestId: string, nodeId: string, isVerified: boolean, trustScore: number): {
        responseId: string;
        signature: string;
    };
    /**
     * Sync mesh node data
     */
    syncMeshNode(nodeId: string): void;
    /**
     * Get active mesh nodes (seen in last 5 minutes)
     */
    getActiveMeshNodes(): BluetoothMeshNode[];
    /**
     * Generate offline authentication bundle (QR + Paper + SMS)
     */
    generateOfflineBundle(idHash: string, identity: BeneficiaryIdentity, phoneNumber?: string): {
        qrCode: OfflineAuthCode;
        paperCodes: PaperBackupCode[];
        smsCode?: OfflineAuthCode;
    };
    /**
     * Generate printable paper backup sheet
     */
    generatePrintableBackup(idHash: string, identity: BeneficiaryIdentity, paperCodes: PaperBackupCode[]): string;
    /**
     * Generate checksum for paper codes
     */
    private generateChecksum;
    /**
     * Create time-based one-time password (TOTP) for offline verification
     */
    generateTOTP(idHash: string, timeStep?: number): string;
    /**
     * Validate TOTP with time window tolerance
     */
    validateTOTP(idHash: string, totp: string, timeStep?: number, windowSize?: number): boolean;
}
//# sourceMappingURL=offlineAuth.d.ts.map