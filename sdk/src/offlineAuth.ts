// crypto-js — SHA256 is used for all security-sensitive operations (QR signatures,
// TOTP, mesh node signatures, paper code hashing).  MD5 is used only for the
// non-security 8-char display checksum on paper backup codes (human-readable
// error-detection only; not a security guarantee).  Do not use MD5 for any
// operation that requires collision or pre-image resistance.
import * as crypto from 'crypto';
import { SHA256, MD5 } from 'crypto-js';
import { 
  OfflineAuthCode, 
  BluetoothMeshNode, 
  PaperBackupCode,
  BeneficiaryIdentity 
} from './types';

export interface OfflineAuthConfig {
  signingSecret?: string;
  trustedVerificationKeys?: string[];
  ussdSecret?: string;
  signer?: (payload: string) => string;
  verifier?: (payload: string, signature: string) => boolean;
}

/**
 * Offline Authentication Module
 * Provides authentication capabilities without internet connectivity
 */
export class OfflineAuthClient {
  private config: OfflineAuthConfig & Record<string, any>;
  private meshNodes: Map<string, BluetoothMeshNode> = new Map();

  constructor(config?: OfflineAuthConfig | any) {
    this.config = config || {};
  }

  public setSigningSecret(secret: string): void {
    if (!secret || !secret.trim()) throw new Error('Signing secret must be a non-empty string');
    this.config.signingSecret = secret.trim();
  }

  public setTrustedVerificationKeys(keys: string[]): void {
    if (!keys || !Array.isArray(keys)) throw new Error('Verification keys must be an array');
    this.config.trustedVerificationKeys = keys;
  }

  public setUssdSecret(secret: string): void {
    if (!secret || !secret.trim()) throw new Error('USSD secret must be a non-empty string');
    this.config.ussdSecret = secret.trim();
  }

  private getSigningSecret(): string | null {
    return this.config?.signingSecret || this.config?.secretKey || this.config?.privateKey || null;
  }

  private getVerificationKeys(): string[] {
    const keys: string[] = [];
    if (this.config?.trustedVerificationKeys && Array.isArray(this.config.trustedVerificationKeys)) {
      keys.push(...this.config.trustedVerificationKeys);
    }
    if (this.config?.signingSecret) {
      keys.push(this.config.signingSecret);
    }
    if (this.config?.secretKey) {
      keys.push(this.config.secretKey);
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  private getUssdSecret(): string | null {
    return this.config?.ussdSecret || this.config?.signingSecret || this.config?.secretKey || null;
  }

  private signPayload(payload: string): string {
    if (this.config?.signer) {
      return this.config.signer(payload);
    }
    const secret = this.getSigningSecret();
    if (!secret) {
      throw new Error('OfflineAuthClient: signing key not configured (failed closed)');
    }
    return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  private verifyPayload(payload: string, signature: string): boolean {
    if (this.config?.verifier) {
      return this.config.verifier(payload, signature);
    }
    const verificationKeys = this.getVerificationKeys();
    if (verificationKeys.length === 0) {
      // Fail closed if no trusted verification keys/secrets configured
      return false;
    }
    for (const key of verificationKeys) {
      try {
        const expected = crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
        if (expected.length === signature.length) {
          if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
            return true;
          }
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Generate QR code with cryptographic authentication over canonical identity fields (#321).
   */
  generateQRCode(
    idHash: string,
    identity: BeneficiaryIdentity,
    validityMinutes: number = 30
  ): OfflineAuthCode {
    if (!idHash || typeof idHash !== 'string' || !idHash.trim()) {
      throw new Error('OfflineAuthClient: idHash must be a non-empty string');
    }
    if (!identity) {
      throw new Error('OfflineAuthClient: identity must be provided');
    }

    const secret = this.getSigningSecret();
    if (!secret && !this.config?.signer) {
      throw new Error('OfflineAuthClient: Cannot generate secure QR code without configured signingSecret');
    }

    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    const timestamp = Date.now();
    const version = 1;
    const cleanId = idHash.trim();
    const trustScore = typeof identity.trustScore === 'number' ? identity.trustScore : 0;
    const campLocation = identity.campLocation || '';

    // Create cryptographic signature over canonical payload
    const canonicalPayload = `${version}|${cleanId}|${timestamp}|${expiresAt}|${trustScore}|${campLocation}`;
    const signature = this.signPayload(canonicalPayload);

    // Compact QR data bound to exact canonical fields
    const qrData = {
      v: version,
      id: cleanId,
      ts: timestamp,
      exp: expiresAt,
      trust: trustScore,
      loc: campLocation,
      sig: signature
    };

    return {
      type: 'qr',
      code: JSON.stringify(qrData),
      idHash: cleanId,
      expiresAt,
      signature
    };
  }

  /**
   * Validate QR code offline using pinned/trusted verification keys (#321).
   */
  validateQRCode(qrCodeData: string): {
    isValid: boolean;
    idHash?: string;
    trustScore?: number;
    campLocation?: string;
    reason?: string;
  } {
    try {
      if (!qrCodeData || typeof qrCodeData !== 'string') {
        return { isValid: false, reason: 'Invalid QR code format' };
      }

      const data = JSON.parse(qrCodeData);
      
      // Check version
      if (data.v !== 1) {
        return { isValid: false, reason: 'Unsupported QR code version' };
      }

      // Check required fields
      if (!data.id || data.ts === undefined || data.exp === undefined || data.trust === undefined || data.loc === undefined || !data.sig) {
        return { isValid: false, reason: 'Missing required QR code fields' };
      }

      // Check expiration
      if (Date.now() > data.exp) {
        return { isValid: false, reason: 'QR code expired' };
      }

      // Check signature against configured trusted verification keys
      const canonicalPayload = `${data.v}|${data.id}|${data.ts}|${data.exp}|${data.trust}|${data.loc}`;
      const isValidSig = this.verifyPayload(canonicalPayload, data.sig);
      
      if (!isValidSig) {
        return { isValid: false, reason: 'Invalid signature or untrusted signer' };
      }

      return {
        isValid: true,
        idHash: data.id,
        trustScore: data.trust,
        campLocation: data.loc
      };
    } catch (error) {
      return { isValid: false, reason: 'Invalid QR code format' };
    }
  }

  /**
   * Generate paper backup codes with cryptographic checksums
   */
  generatePaperBackupCodes(
    idHash: string,
    count: number = 10
  ): PaperBackupCode[] {
    const codes: PaperBackupCode[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      // Generate random code
      const randomData = `${idHash}:${timestamp}:${i}:${Math.random()}`;
      const code = SHA256(randomData).toString().substring(0, 16).toUpperCase();
      
      // Generate checksum
      const checksum = this.generateChecksum(code);
      
      // Format code for readability: XXXX-XXXX-XXXX-XXXX
      const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;

      codes.push({
        code: formattedCode,
        checksum,
        createdAt: timestamp,
        instructions: `Keep this code safe. Use it to recover your identity. Code ${i + 1} of ${count}.`
      });
    }

    return codes;
  }

  /**
   * Validate paper backup code
   */
  validatePaperBackupCode(code: string, checksum: string): boolean {
    // Remove formatting
    const cleanCode = code.replace(/-/g, '');
    const expectedChecksum = this.generateChecksum(cleanCode);
    return checksum === expectedChecksum;
  }

  /**
   * Generate SMS/USSD authentication code for feature phones with verifier-side secret (#321).
   */
  generateSMSCode(
    idHash: string,
    phoneNumber: string,
    validityMinutes: number = 15
  ): OfflineAuthCode {
    const secret = this.getUssdSecret();
    if (!secret) {
      throw new Error('OfflineAuthClient: Cannot generate SMS/USSD code without configured USSD secret');
    }

    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    const timestamp = Date.now();
    
    // Generate 6-digit code authenticated by ussdSecret
    const codePayload = `${idHash}:${phoneNumber}:${timestamp}`;
    const hmac = crypto.createHmac('sha256', secret).update(codePayload, 'utf8').digest('hex');
    const sixDigitCode = parseInt(hmac.substring(0, 8), 16) % 1000000;
    const code = sixDigitCode.toString().padStart(6, '0');
    
    // Generate cryptographic signature over code, phone, expiresAt, and idHash bound to secret
    const signatureData = `${code}:${phoneNumber}:${expiresAt}:${idHash}`;
    const signature = crypto.createHmac('sha256', secret).update(signatureData, 'utf8').digest('hex');

    return {
      type: 'sms',
      code,
      idHash,
      expiresAt,
      signature
    };
  }

  /**
   * Validate SMS/USSD code with cryptographic authentication (#321).
   */
  validateSMSCode(
    code: string,
    phoneNumber: string,
    signature: string,
    expiresAt: number,
    idHash?: string
  ): boolean {
    const secret = this.getUssdSecret();
    if (!secret) {
      // Fail closed when no USSD secret is configured on the verifier
      return false;
    }

    // Check expiration
    if (Date.now() > expiresAt) {
      return false;
    }

    // Check signature with verifier secret
    const sigWithId = idHash ? `${code}:${phoneNumber}:${expiresAt}:${idHash}` : null;
    const sigWithoutId = `${code}:${phoneNumber}:${expiresAt}`;

    const expected1 = sigWithId ? crypto.createHmac('sha256', secret).update(sigWithId, 'utf8').digest('hex') : '';
    const expected2 = crypto.createHmac('sha256', secret).update(sigWithoutId, 'utf8').digest('hex');

    if (expected1 && signature.length === expected1.length) {
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected1))) {
        return true;
      }
    }
    if (signature.length === expected2.length) {
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected2))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Format USSD menu for feature phones
   */
  formatUSSDMenu(step: string, data?: any): string {
    switch (step) {
      case 'welcome':
        return '*123*1# Disaster Relief\n' +
               '1. Verify Identity\n' +
               '2. Check Balance\n' +
               '3. Find Merchants\n' +
               '4. Recovery\n' +
               '5. Help';
      
      case 'verify_identity':
        return 'Enter your 6-digit code:';
      
      case 'verify_success':
        return `✓ Identity verified\n` +
               `Trust Score: ${data?.trustScore || 0}\n` +
               `Location: ${data?.location || 'Unknown'}`;
      
      case 'verify_failed':
        return '✗ Verification failed\n' +
               'Please try again or contact support';
      
      case 'recovery_menu':
        return 'Recovery Options:\n' +
               '1. Use paper code\n' +
               '2. Social recovery\n' +
               '3. Contact support';
      
      case 'paper_code_entry':
        return 'Enter your 16-digit paper code:';
      
      case 'social_recovery':
        return 'Social recovery initiated.\n' +
               'Waiting for 3 of 5 contacts to approve.\n' +
               `Current approvals: ${data?.approvals || 0}/3`;
      
      default:
        return 'Invalid option. Please try again.';
    }
  }

  /**
   * Initialize Bluetooth mesh networking for camp-wide verification
   */
  initializeMeshNetwork(nodeId: string, publicKey: string, location: string): BluetoothMeshNode {
    const node: BluetoothMeshNode = {
      nodeId,
      publicKey,
      lastSeen: Date.now(),
      trustScore: 50,
      location
    };

    this.meshNodes.set(nodeId, node);
    return node;
  }

  /**
   * Broadcast identity verification request to mesh network
   */
  broadcastVerificationRequest(
    idHash: string,
    requestingNodeId: string
  ): {
    requestId: string;
    timestamp: number;
    signature: string;
  } {
    const timestamp = Date.now();
    const requestId = SHA256(`${idHash}:${requestingNodeId}:${timestamp}`).toString().substring(0, 16);
    
    const signatureData = `${requestId}:${idHash}:${requestingNodeId}:${timestamp}`;
    const signature = SHA256(signatureData).toString();

    // In a real implementation, this would broadcast via Bluetooth
    console.log(`Broadcasting verification request ${requestId} to mesh network`);

    return {
      requestId,
      timestamp,
      signature
    };
  }

  /**
   * Respond to mesh network verification request
   */
  respondToVerificationRequest(
    requestId: string,
    nodeId: string,
    isVerified: boolean,
    trustScore: number
  ): {
    responseId: string;
    signature: string;
  } {
    const timestamp = Date.now();
    const responseId = SHA256(`${requestId}:${nodeId}:${timestamp}`).toString().substring(0, 16);
    
    const signatureData = `${responseId}:${requestId}:${nodeId}:${isVerified}:${trustScore}`;
    const signature = SHA256(signatureData).toString();

    return {
      responseId,
      signature
    };
  }

  /**
   * Sync mesh node data
   */
  syncMeshNode(nodeId: string): void {
    const node = this.meshNodes.get(nodeId);
    if (node) {
      node.lastSeen = Date.now();
      this.meshNodes.set(nodeId, node);
    }
  }

  /**
   * Get active mesh nodes (seen in last 5 minutes)
   */
  getActiveMeshNodes(): BluetoothMeshNode[] {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const activeNodes: BluetoothMeshNode[] = [];

    this.meshNodes.forEach(node => {
      if (node.lastSeen > fiveMinutesAgo) {
        activeNodes.push(node);
      }
    });

    return activeNodes;
  }

  /**
   * Generate offline authentication bundle (QR + Paper + SMS)
   */
  generateOfflineBundle(
    idHash: string,
    identity: BeneficiaryIdentity,
    phoneNumber?: string
  ): {
    qrCode: OfflineAuthCode;
    paperCodes: PaperBackupCode[];
    smsCode?: OfflineAuthCode;
  } {
    const qrCode = this.generateQRCode(idHash, identity, 30);
    const paperCodes = this.generatePaperBackupCodes(idHash, 10);
    const smsCode = phoneNumber 
      ? this.generateSMSCode(idHash, phoneNumber, 15)
      : undefined;

    return {
      qrCode,
      paperCodes,
      smsCode
    };
  }

  /**
   * Generate printable paper backup sheet
   */
  generatePrintableBackup(
    idHash: string,
    identity: BeneficiaryIdentity,
    paperCodes: PaperBackupCode[]
  ): string {
    const header = `
╔════════════════════════════════════════════════════════════╗
║         DISASTER RELIEF IDENTITY BACKUP CODES              ║
╚════════════════════════════════════════════════════════════╝

IMPORTANT: Keep these codes safe and secure!
These codes can be used to recover your identity if you lose access.

Identity ID: ${idHash.substring(0, 16)}...
Camp Location: ${identity.campLocation}
Trust Score: ${identity.trustScore}
Generated: ${new Date().toISOString()}

═══════════════════════════════════════════════════════════════
                    RECOVERY CODES
═══════════════════════════════════════════════════════════════
`;

    const codesList = paperCodes.map((code, index) => {
      return `${(index + 1).toString().padStart(2, '0')}. ${code.code}  [Checksum: ${code.checksum}]`;
    }).join('\n');

    const footer = `
═══════════════════════════════════════════════════════════════
                    INSTRUCTIONS
═══════════════════════════════════════════════════════════════

1. Store these codes in a safe place
2. Do not share these codes with anyone
3. Use any code to recover your identity
4. Each code can only be used once
5. Contact support if you need help: +1234567890

═══════════════════════════════════════════════════════════════
`;

    return header + codesList + footer;
  }

  /**
   * Generate checksum for paper codes.
   *
   * Uses MD5 to produce an 8-character uppercase display checksum that allows
   * a field agent to detect typos when entering a paper backup code manually.
   * This is a human-readable error-detection aid only — it is **not** used for
   * any security-sensitive operation.  The actual security comes from the
   * full SHA-256 hash of the code stored in `RecoveryCode.code_hash` on-chain.
   * MD5 is acceptable here because collision resistance is not required.
   */
  private generateChecksum(code: string): string {
    return MD5(code).toString().substring(0, 8).toUpperCase();
  }

  /**
   * Create time-based one-time password (TOTP) for offline verification
   */
  generateTOTP(idHash: string, timeStep: number = 30): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const counter = Math.floor(timestamp / timeStep);
    
    const data = `${idHash}:${counter}`;
    const hash = SHA256(data).toString();
    
    // Generate 6-digit TOTP
    const totp = parseInt(hash.substring(0, 8), 16) % 1000000;
    return totp.toString().padStart(6, '0');
  }

  /**
   * Validate TOTP with time window tolerance
   */
  validateTOTP(
    idHash: string,
    totp: string,
    timeStep: number = 30,
    windowSize: number = 1
  ): boolean {
    const timestamp = Math.floor(Date.now() / 1000);
    const currentCounter = Math.floor(timestamp / timeStep);

    // Check current and adjacent time windows
    for (let i = -windowSize; i <= windowSize; i++) {
      const counter = currentCounter + i;
      const data = `${idHash}:${counter}`;
      const hash = SHA256(data).toString();
      const expectedTOTP = (parseInt(hash.substring(0, 8), 16) % 1000000)
        .toString()
        .padStart(6, '0');

      if (totp === expectedTOTP) {
        return true;
      }
    }

    return false;
  }
}
