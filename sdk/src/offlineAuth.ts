// QR credentials are authenticated with Stellar ed25519 signatures verified
// against pinned public keys. USSD credentials are authenticated with HMAC over
// a verifier-side secret. SHA-256 is retained only for non-authenticating
// identifiers/digests (paper codes, TOTP, mesh request ids). MD5 is used only
// for the non-security 8-char display checksum on paper backup codes.
import { SHA256, MD5, HmacSHA256 } from 'crypto-js';
import { Keypair } from 'stellar-sdk';
import { 
  OfflineAuthCode, 
  BluetoothMeshNode, 
  PaperBackupCode,
  BeneficiaryIdentity 
} from './types';

export interface OfflineAuthConfig {
  /** Stellar secret key used to sign offline QR credentials. */
  signingKey?: string;
  /** Pinned public keys accepted when verifying offline QR credentials. */
  pinnedPublicKeys?: string[];
  /** Verifier-side secret used to authenticate SMS/USSD codes. */
  ussdSecret?: string;
}

interface SignedQRPayload {
  v: 1;
  id: string;
  ts: number;
  exp: number;
  trust: number;
  loc: string;
}

interface SignedUssdPayload {
  code: string;
  id: string;
  phone: string;
  ts: number;
  exp: number;
}

function canonicalQRPayload(payload: SignedQRPayload): string {
  return JSON.stringify({
    v: payload.v,
    id: payload.id,
    ts: payload.ts,
    exp: payload.exp,
    trust: payload.trust,
    loc: payload.loc,
  });
}

function canonicalUssdPayload(payload: SignedUssdPayload): string {
  return JSON.stringify({
    code: payload.code,
    id: payload.id,
    phone: payload.phone,
    ts: payload.ts,
    exp: payload.exp,
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Offline Authentication Module
 * Provides authentication capabilities without internet connectivity
 */
export class OfflineAuthClient {
  private config: OfflineAuthConfig & Record<string, any>;
  private meshNodes: Map<string, BluetoothMeshNode> = new Map();

  constructor(config: OfflineAuthConfig & Record<string, any> = {}) {
    this.config = config;
  }

  private getSigner(): Keypair {
    const secret = this.config.signingKey ?? this.config.offlineSigningKey ?? this.config.privateKey;
    if (typeof secret !== 'string' || !secret.trim()) {
      throw new Error('Offline QR signing key is not configured');
    }
    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new Error('Offline QR signing key is invalid');
    }
  }

  private getVerifierKeys(): Keypair[] {
    const configured = this.config.pinnedPublicKeys
      ?? this.config.trustedPublicKeys
      ?? this.config.publicKeys
      ?? (this.config.publicKey ? [this.config.publicKey] : undefined);
    if (!Array.isArray(configured) || configured.length === 0) {
      throw new Error('Trusted offline QR public keys are not configured');
    }

    const keys: Keypair[] = [];
    for (const key of configured) {
      if (typeof key !== 'string' || !key.trim()) {
        throw new Error('Trusted offline QR public key is invalid');
      }
      try {
        keys.push(Keypair.fromPublicKey(key));
      } catch {
        throw new Error('Trusted offline QR public key is invalid');
      }
    }
    return keys;
  }

  private getUssdSecret(): string {
    const secret = this.config.ussdSecret
      ?? this.config.smsSecret
      ?? this.config.ussdVerificationSecret;
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('USSD verification secret is not configured');
    }
    return secret;
  }

  /**
   * Generate a QR credential signed over the exact canonical payload it encodes.
   */
  generateQRCode(
    idHash: string,
    identity: BeneficiaryIdentity,
    validityMinutes: number = 30
  ): OfflineAuthCode {
    const signer = this.getSigner();
    const timestamp = Date.now();
    const expiresAt = timestamp + (validityMinutes * 60 * 1000);
    const payload: SignedQRPayload = {
      v: 1,
      id: idHash,
      ts: timestamp,
      exp: expiresAt,
      trust: identity.trustScore,
      loc: identity.campLocation,
    };
    const signature = signer
      .sign(Buffer.from(canonicalQRPayload(payload), 'utf8'))
      .toString('base64');

    return {
      type: 'qr',
      code: JSON.stringify({ ...payload, sig: signature }),
      idHash,
      expiresAt,
      signature,
    };
  }

  /**
   * Validate QR code offline against pinned public keys.
   * Missing configuration fails closed with an explicit reason.
   */
  validateQRCode(qrCodeData: string, expectedIdHash?: string): {
    isValid: boolean;
    idHash?: string;
    trustScore?: number;
    campLocation?: string;
    reason?: string;
  } {
    try {
      const data = JSON.parse(qrCodeData);
      if (!data || typeof data !== 'object') {
        return { isValid: false, reason: 'Invalid QR code format' };
      }
      if (data.v !== 1) {
        return { isValid: false, reason: 'Unsupported QR code version' };
      }
      if (
        typeof data.id !== 'string'
        || typeof data.ts !== 'number' || !Number.isFinite(data.ts)
        || typeof data.exp !== 'number' || !Number.isFinite(data.exp)
        || typeof data.trust !== 'number' || !Number.isFinite(data.trust)
        || typeof data.loc !== 'string'
        || typeof data.sig !== 'string'
      ) {
        return { isValid: false, reason: 'Invalid QR code format' };
      }
      if (expectedIdHash !== undefined && data.id !== expectedIdHash) {
        return { isValid: false, reason: 'Identity mismatch' };
      }
      if (Date.now() > data.exp) {
        return { isValid: false, reason: 'QR code expired' };
      }

      const payload: SignedQRPayload = {
        v: data.v,
        id: data.id,
        ts: data.ts,
        exp: data.exp,
        trust: data.trust,
        loc: data.loc,
      };
      const signedData = Buffer.from(canonicalQRPayload(payload), 'utf8');
      const signature = Buffer.from(data.sig, 'base64');
      const verified = this.getVerifierKeys().some(key => {
        try {
          return key.verify(signedData, signature);
        } catch {
          return false;
        }
      });

      if (!verified) {
        return { isValid: false, reason: 'Invalid signature' };
      }

      return {
        isValid: true,
        idHash: data.id,
        trustScore: data.trust,
        campLocation: data.loc,
      };
    } catch (error) {
      return {
        isValid: false,
        reason: error instanceof Error ? error.message : 'Invalid QR code format',
      };
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
   * Generate an HMAC-authenticated SMS/USSD code for feature phones.
   */
  generateSMSCode(
    idHash: string,
    phoneNumber: string,
    validityMinutes: number = 15
  ): OfflineAuthCode {
    const secret = this.getUssdSecret();
    const timestamp = Date.now();
    const expiresAt = timestamp + (validityMinutes * 60 * 1000);

    const seed = canonicalUssdPayload({
      code: '',
      id: idHash,
      phone: phoneNumber,
      ts: timestamp,
      exp: expiresAt,
    });
    const digest = HmacSHA256(seed, secret).toString();
    const code = (parseInt(digest.substring(0, 8), 16) % 1_000_000)
      .toString()
      .padStart(6, '0');

    const mac = HmacSHA256(canonicalUssdPayload({
      code,
      id: idHash,
      phone: phoneNumber,
      ts: timestamp,
      exp: expiresAt,
    }), secret).toString();
    const signature = Buffer.from(
      JSON.stringify({ ts: timestamp, id: idHash, mac }),
      'utf8',
    ).toString('base64');

    return {
      type: 'sms',
      code,
      idHash,
      expiresAt,
      signature,
    };
  }

  /**
   * Validate an SMS/USSD code using the verifier-side HMAC secret.
   * Missing secret configuration throws instead of accepting any code.
   */
  validateSMSCode(
    code: string,
    phoneNumber: string,
    signature: string,
    expiresAt: number,
    expectedIdHash?: string
  ): boolean {
    const secret = this.getUssdSecret();
    if (Date.now() > expiresAt || !/^\d{6}$/.test(code)) {
      return false;
    }

    try {
      const token = JSON.parse(Buffer.from(signature, 'base64').toString('utf8'));
      if (
        !token
        || typeof token.ts !== 'number' || !Number.isFinite(token.ts)
        || typeof token.id !== 'string'
        || typeof token.mac !== 'string'
      ) {
        return false;
      }
      if (expectedIdHash !== undefined && token.id !== expectedIdHash) {
        return false;
      }

      const expectedMac = HmacSHA256(canonicalUssdPayload({
        code,
        id: token.id,
        phone: phoneNumber,
        ts: token.ts,
        exp: expiresAt,
      }), secret).toString();

      return constantTimeEquals(token.mac, expectedMac);
    } catch {
      return false;
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
