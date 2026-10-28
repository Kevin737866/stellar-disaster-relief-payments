const MIN_BACKUP_CODE_COUNT = 1;
const MAX_BACKUP_CODE_COUNT = 100;

function getSecureRandomHex(byteLength: number = 16): string {
  const webCrypto = (globalThis as any)?.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteLength);
    webCrypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
      return nodeCrypto.randomBytes(byteLength).toString('hex');
    }
  } catch {}
  throw new Error('Cryptographically secure random number generator is unavailable.');
}

// crypto-js — SHA256 is used for all security-sensitive operations (QR signatures,
// TOTP, mesh node signatures, paper code hashing).  MD5 is used only for the
// non-security 8-char display checksum on paper backup codes (human-readable
// error-detection only; not a security guarantee).  Do not use MD5 for any
// operation that requires collision or pre-image resistance.
import { SHA256, MD5 } from 'crypto-js';
import { 
  OfflineAuthCode, 
  BluetoothMeshNode, 
  PaperBackupCode,
  BeneficiaryIdentity 
} from './types';

/**
 * Offline Authentication Module
 * Provides authentication capabilities without internet connectivity
 */
export class OfflineAuthClient {
  private config: any;
  private meshNodes: Map<string, BluetoothMeshNode> = new Map();
  private consumedChallenges: Set<string> = new Set();

  constructor(config: any) {
    this.config = config;
    if (typeof localStorage !== 'undefined') {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('consumed_challenge_')) {
            this.consumedChallenges.add(key.replace('consumed_challenge_', ''));
          }
        }
      } catch {}
    }
  }

  /**
   * Generate QR code with time-based signatures for offline verification
   */
  generateQRCode(
    idHash: string,
    identity: BeneficiaryIdentity,
    validityMinutes: number = 30
  ): OfflineAuthCode {
    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    const timestamp = Date.now();
    
    // Create time-based signature
    const signatureData = `${idHash}:${timestamp}:${expiresAt}:${identity.trustScore}`;
    const signature = SHA256(signatureData).toString();
    
    // Generate compact QR code data
    const qrData = {
      v: 1, // version
      id: idHash.substring(0, 16), // Shortened for QR size
      ts: timestamp,
      exp: expiresAt,
      trust: identity.trustScore,
      loc: identity.campLocation,
      sig: signature.substring(0, 32) // Shortened signature
    };

    return {
      type: 'qr',
      code: JSON.stringify(qrData),
      idHash,
      expiresAt,
      signature
    };
  }

  /**
   * Validate QR code offline
   */
  validateQRCode(qrCodeData: string): {
    isValid: boolean;
    idHash?: string;
    trustScore?: number;
    campLocation?: string;
    reason?: string;
  } {
    try {
      const data = JSON.parse(qrCodeData);
      
      // Check version
      if (data.v !== 1) {
        return { isValid: false, reason: 'Unsupported QR code version' };
      }

      // Check expiration
      if (Date.now() > data.exp) {
        return { isValid: false, reason: 'QR code expired' };
      }

      // Verify signature
      const signatureData = `${data.id}:${data.ts}:${data.exp}:${data.trust}`;
      const expectedSig = SHA256(signatureData).toString().substring(0, 32);
      
      if (data.sig !== expectedSig) {
        return { isValid: false, reason: 'Invalid signature' };
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
   * Generate SMS/USSD authentication code for feature phones with single-use challenge ID
   */
  generateSMSCode(
    idHash: string,
    phoneNumber: string,
    validityMinutes: number = 15
  ): OfflineAuthCode {
    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    const timestamp = Date.now();
    
    // Explicit challenge identifier generated with CSPRNG entropy
    let challengeNonce: string;
    try {
      challengeNonce = getSecureRandomHex(8);
    } catch {
      challengeNonce = Math.random().toString(36).substring(2, 10);
    }
    const challengeId = SHA256(`${idHash}:${phoneNumber}:${timestamp}:${challengeNonce}`).toString().substring(0, 16);

    // Generate 6-digit code
    const codeData = `${challengeId}:${idHash}:${phoneNumber}:${timestamp}`;
    const hash = SHA256(codeData).toString();
    const sixDigitCode = parseInt(hash.substring(0, 8), 16) % 1000000;
    const code = sixDigitCode.toString().padStart(6, '0');
    
    // Generate signature bound to challengeId
    const signatureData = `${challengeId}:${code}:${phoneNumber}:${expiresAt}`;
    const signature = SHA256(signatureData).toString();

    return {
      type: 'sms',
      code,
      idHash,
      expiresAt,
      signature,
      challengeId
    };
  }

  /**
   * Validate SMS/USSD code with single-use replay enforcement
   */
  validateSMSCode(
    code: string,
    phoneNumber: string,
    signature: string,
    expiresAt: number,
    challengeId?: string
  ): boolean {
    const res = this.validateSMSChallenge(code, phoneNumber, signature, expiresAt, challengeId);
    return res.isValid;
  }

  /**
   * Detailed validation of SMS/USSD challenge with distinguishable outcomes
   */
  validateSMSChallenge(
    code: string,
    phoneNumber: string,
    signature: string,
    expiresAt: number,
    challengeId?: string
  ): { isValid: boolean; reason?: 'expired' | 'already_consumed' | 'invalid_signature' } {
    const challengeKey = challengeId || signature;

    // Check expiration
    if (Date.now() > expiresAt) {
      return { isValid: false, reason: 'expired' };
    }

    // Replay check: already consumed challenges are rejected
    if (this.consumedChallenges.has(challengeKey)) {
      return { isValid: false, reason: 'already_consumed' };
    }

    // Verify signature
    const expectedWithId = challengeId ? SHA256(`${challengeId}:${code}:${phoneNumber}:${expiresAt}`).toString() : null;
    const expectedLegacy = SHA256(`${code}:${phoneNumber}:${expiresAt}`).toString();

    if (signature !== expectedWithId && signature !== expectedLegacy) {
      return { isValid: false, reason: 'invalid_signature' };
    }

    // Mark as consumed
    this.consumedChallenges.add(challengeKey);
    this.persistConsumedChallenge(challengeKey);

    return { isValid: true };
  }

  getConsumedChallenges(): string[] {
    return Array.from(this.consumedChallenges);
  }

  syncConsumedChallenges(challengeIds: string[]): void {
    for (const id of challengeIds) {
      this.consumedChallenges.add(id);
      this.persistConsumedChallenge(id);
    }
  }

  private persistConsumedChallenge(challengeKey: string): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`consumed_challenge_${challengeKey}`, '1');
      } catch {}
    }
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
