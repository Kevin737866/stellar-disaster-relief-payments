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

/** Maximum number of paper backup codes issued in one batch. */
export const MAX_PAPER_BACKUP_CODES = 100;

/** Eight random bytes become 16 uppercase hex characters: XXXX-XXXX-XXXX-XXXX. */
const PAPER_CODE_BYTES = 8;

/** Fail closed if a broken/rigid random source keeps producing duplicates. */
const MAX_UNIQUE_CODE_ATTEMPTS = 10;

/** Sixteen random bytes become a 32-character hexadecimal challenge ID. */
const CHALLENGE_ID_BYTES = 16;

export type SMSChallengeValidationReason =
  | 'valid'
  | 'expired'
  | 'unknown_challenge'
  | 'already_consumed'
  | 'invalid_signature'
  | 'invalid_code'
  | 'invalid_verifier';

export interface SMSChallengeValidationResult {
  isValid: boolean;
  reason: SMSChallengeValidationReason;
  challengeId?: string;
  verifierId?: string;
  consumedAt?: number;
}

/** Issuer-side record needed to recognise a challenge before consuming it. */
export interface IssuedSMSChallengeRecord {
  challengeId: string;
  idHash: string;
  phoneNumber: string;
  codeHash: string;
  issuedAt: number;
  expiresAt: number;
}

/** Verifier-side tombstone: this authority has accepted this challenge. */
export interface ConsumedSMSChallengeRecord {
  challengeId: string;
  verifierId: string;
  consumedAt: number;
}

/** Portable state used to persist or reconcile single-use challenge state. */
export interface SMSChallengeStateSnapshot {
  issued: IssuedSMSChallengeRecord[];
  consumed: ConsumedSMSChallengeRecord[];
}

/**
 * Storage contract for challenge issuance and verifier-side consumption.
 * Implementations must be durable for production verifiers; an in-memory
 * implementation is provided for tests only.
 */
export interface SMSChallengeStateStore {
  recordIssued(record: IssuedSMSChallengeRecord): void;
  getIssued(challengeId: string): IssuedSMSChallengeRecord | undefined;
  listIssued(): IssuedSMSChallengeRecord[];
  getConsumed(verifierId: string, challengeId: string): ConsumedSMSChallengeRecord | undefined;
  /** Atomically consume; returns false when already consumed by this verifier. */
  markConsumed(record: ConsumedSMSChallengeRecord): boolean;
  listConsumed(verifierId: string): ConsumedSMSChallengeRecord[];
  /** Reconciliation only: merge a tombstone, keeping the earliest timestamp. */
  putConsumed(record: ConsumedSMSChallengeRecord): void;
}

/** Non-durable store for tests and single-process demos. */
export class InMemorySMSChallengeStateStore implements SMSChallengeStateStore {
  private issued = new Map<string, IssuedSMSChallengeRecord>();
  private consumed = new Map<string, ConsumedSMSChallengeRecord>();

  private key(verifierId: string, challengeId: string): string {
    return `${verifierId}\u0000${challengeId}`;
  }

  recordIssued(record: IssuedSMSChallengeRecord): void {
    this.issued.set(record.challengeId, { ...record });
  }

  getIssued(challengeId: string): IssuedSMSChallengeRecord | undefined {
    const record = this.issued.get(challengeId);
    return record ? { ...record } : undefined;
  }

  listIssued(): IssuedSMSChallengeRecord[] {
    return Array.from(this.issued.values()).map(record => ({ ...record }));
  }

  getConsumed(verifierId: string, challengeId: string): ConsumedSMSChallengeRecord | undefined {
    const record = this.consumed.get(this.key(verifierId, challengeId));
    return record ? { ...record } : undefined;
  }

  markConsumed(record: ConsumedSMSChallengeRecord): boolean {
    const key = this.key(record.verifierId, record.challengeId);
    if (this.consumed.has(key)) {
      return false;
    }
    this.consumed.set(key, { ...record });
    return true;
  }

  listConsumed(verifierId: string): ConsumedSMSChallengeRecord[] {
    return Array.from(this.consumed.values())
      .filter(record => record.verifierId === verifierId)
      .map(record => ({ ...record }));
  }

  putConsumed(record: ConsumedSMSChallengeRecord): void {
    this.consumed.set(this.key(record.verifierId, record.challengeId), { ...record });
  }
}

export interface OfflineAuthConfig {
  /** Default verifier authority used when validateSMSCode omits verifierId. */
  verifierId?: string;
  /** Durable verifier-side challenge state. Required for SMS/USSD challenges. */
  challengeStateStore?: SMSChallengeStateStore;
  /**
   * Explicit opt-in to non-durable in-memory state. Never enable this for a
   * verifier that must survive a restart.
   */
  allowEphemeralChallengeState?: boolean;
  [key: string]: any;
}

/**
 * Offline Authentication Module
 * Provides authentication capabilities without internet connectivity
 */
export class OfflineAuthClient {
  private config: OfflineAuthConfig;
  private meshNodes: Map<string, BluetoothMeshNode> = new Map();
  private challengeStateStore?: SMSChallengeStateStore;
  private issuedChallengeIds = new Set<string>();

  constructor(config: OfflineAuthConfig = {}) {
    this.config = config;
    if (config.challengeStateStore) {
      this.challengeStateStore = config.challengeStateStore;
    } else if (config.allowEphemeralChallengeState) {
      this.challengeStateStore = new InMemorySMSChallengeStateStore();
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
   * Generate paper backup codes from a cryptographically secure random source.
   *
   * The printed checksum only detects transcription errors; it is not an
   * authentication tag. Authenticity comes from the hash of the code stored
   * server-side/on-chain, never from the checksum on the sheet.
   */
  generatePaperBackupCodes(
    idHash: string,
    count: number = 10
  ): PaperBackupCode[] {
    // Kept for API compatibility; the identifier is deliberately not mixed
    // into code entropy. Unpredictability comes solely from the CSPRNG.
    void idHash;
    this.validatePaperBackupCodeCount(count);

    const codes: PaperBackupCode[] = [];
    const issuedCodes = new Set<string>();
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      const code = this.generateUniquePaperCode(issuedCodes);
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
   * Check only that a transcribed code matches its printed checksum.
   * This detects typos; it MUST NOT be treated as proof of authenticity.
   */
  validatePaperBackupCode(code: string, checksum: string): boolean {
    // Remove formatting
    const cleanCode = code.replace(/-/g, '');
    const expectedChecksum = this.generateChecksum(cleanCode);
    return checksum === expectedChecksum;
  }

  /**
   * Generate a single-use SMS/USSD authentication challenge for feature phones.
   * The returned challengeId must be presented with the code for validation.
   */
  generateSMSCode(
    idHash: string,
    phoneNumber: string,
    validityMinutes: number = 15
  ): OfflineAuthCode {
    const store = this.requireChallengeStateStore();
    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    const timestamp = Date.now();
    const challengeId = this.generateUniqueSMSChallengeId(store);

    // Generate 6-digit code
    const codeData = `${idHash}:${phoneNumber}:${timestamp}:${challengeId}`;
    const hash = SHA256(codeData).toString();
    const sixDigitCode = parseInt(hash.substring(0, 8), 16) % 1000000;
    const code = sixDigitCode.toString().padStart(6, '0');

    // Bind the challenge ID to the code, phone number, and expiry.
    const signatureData = `${challengeId}:${code}:${phoneNumber}:${expiresAt}`;
    const signature = SHA256(signatureData).toString();

    store.recordIssued({
      challengeId,
      idHash,
      phoneNumber,
      codeHash: SHA256(code).toString(),
      issuedAt: timestamp,
      expiresAt,
    });

    return {
      type: 'sms',
      challengeId,
      code,
      idHash,
      expiresAt,
      signature
    };
  }

  /**
   * Validate an SMS/USSD challenge and atomically consume it for one verifier.
   *
   * A challenge may be accepted once per `verifierId`. Different verifier
   * authorities keep independent ledgers. All offline devices sharing a
   * verifierId must exchange snapshots with `exportChallengeState` /
   * `reconcileChallengeState`; see docs/offline-flows.md for the concurrency
   * limitations and conflict handling.
   */
  validateSMSCode(
    challengeId: string,
    code: string,
    phoneNumber: string,
    signature: string,
    expiresAt: number,
    verifierId: string = this.config.verifierId || ''
  ): SMSChallengeValidationResult {
    const base = { challengeId, verifierId };
    if (!verifierId || !verifierId.trim()) {
      return { isValid: false, reason: 'invalid_verifier', ...base };
    }
    if (!challengeId || !challengeId.trim()) {
      return { isValid: false, reason: 'unknown_challenge', ...base };
    }

    const store = this.requireChallengeStateStore();
    const issued = store.getIssued(challengeId);
    if (!issued || issued.phoneNumber !== phoneNumber || issued.expiresAt !== expiresAt) {
      return { isValid: false, reason: 'unknown_challenge', ...base };
    }

    const consumed = store.getConsumed(verifierId, challengeId);
    if (consumed) {
      return { isValid: false, reason: 'already_consumed', ...base, consumedAt: consumed.consumedAt };
    }
    if (Date.now() > issued.expiresAt) {
      return { isValid: false, reason: 'expired', ...base };
    }

    const expectedSignature = SHA256(`${challengeId}:${code}:${phoneNumber}:${expiresAt}`).toString();
    if (signature !== expectedSignature) {
      return { isValid: false, reason: 'invalid_signature', ...base };
    }
    if (SHA256(code).toString() !== issued.codeHash) {
      return { isValid: false, reason: 'invalid_code', ...base };
    }

    const consumedAt = Date.now();
    if (!store.markConsumed({ challengeId, verifierId, consumedAt })) {
      const existing = store.getConsumed(verifierId, challengeId);
      return { isValid: false, reason: 'already_consumed', ...base, consumedAt: existing?.consumedAt };
    }

    return { isValid: true, reason: 'valid', ...base, consumedAt };
  }

  /** Snapshot issued challenges and this verifier's consumption tombstones. */
  exportChallengeState(verifierId: string = this.config.verifierId || ''): SMSChallengeStateSnapshot {
    const store = this.requireChallengeStateStore();
    return {
      issued: store.listIssued().map(record => ({ ...record })),
      consumed: store.listConsumed(verifierId).map(record => ({ ...record })),
    };
  }

  /**
   * Merge peer snapshots into this verifier's store. Consumption records are
   * monotonic tombstones: the union is kept and the earliest consumedAt wins.
   * Conflicting timestamps are reported, never silently overwritten.
   */
  reconcileChallengeState(
    verifierId: string,
    snapshots: SMSChallengeStateSnapshot[]
  ): { conflicts: string[] } {
    const store = this.requireChallengeStateStore();
    const conflicts = new Set<string>();

    for (const snapshot of snapshots || []) {
      for (const issued of snapshot.issued || []) {
        const existing = store.getIssued(issued.challengeId);
        if (!existing || issued.issuedAt < existing.issuedAt) {
          store.recordIssued(issued);
        }
      }

      for (const consumed of snapshot.consumed || []) {
        if (consumed.verifierId !== verifierId) {
          continue;
        }
        const existing = store.getConsumed(verifierId, consumed.challengeId);
        if (!existing) {
          store.markConsumed(consumed);
        } else if (existing.consumedAt !== consumed.consumedAt) {
          conflicts.add(consumed.challengeId);
          const earliest = Math.min(existing.consumedAt, consumed.consumedAt);
          if (earliest !== existing.consumedAt) {
            store.putConsumed({ ...existing, consumedAt: earliest });
          }
        }
      }
    }

    return { conflicts: Array.from(conflicts) };
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

  private validatePaperBackupCodeCount(count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PAPER_BACKUP_CODES) {
      throw new Error(
        `Paper backup code count must be an integer between 1 and ${MAX_PAPER_BACKUP_CODES}`
      );
    }
  }

  private generateUniquePaperCode(issuedCodes: Set<string>): string {
    for (let attempt = 0; attempt < MAX_UNIQUE_CODE_ATTEMPTS; attempt++) {
      const code = this.generateRandomPaperCode();
      if (!issuedCodes.has(code)) {
        issuedCodes.add(code);
        return code;
      }
    }
    throw new Error('Unable to generate unique paper backup codes from the secure random source');
  }

  private generateRandomPaperCode(): string {
    return Array.from(this.getSecureRandomBytes(PAPER_CODE_BYTES))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  /**
   * Prefer Web Crypto (browser and modern Node), then Node's crypto module.
   * If neither is available, fail closed — never fall back to Math.random().
   */
  private getSecureRandomBytes(length: number): Uint8Array {
    const browserCrypto = (globalThis as any)?.crypto;
    if (browserCrypto && typeof browserCrypto.getRandomValues === 'function') {
      return browserCrypto.getRandomValues(new Uint8Array(length)) as Uint8Array;
    }

    if (typeof require === 'function') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodeCrypto = require('crypto');
        if (nodeCrypto && typeof nodeCrypto.randomBytes === 'function') {
          return new Uint8Array(nodeCrypto.randomBytes(length));
        }
      } catch {
        // Fall through to the explicit failure below.
      }
    }

    throw new Error(
      'Cryptographically secure random source unavailable; cannot generate paper backup codes'
    );
  }

  private requireChallengeStateStore(): SMSChallengeStateStore {
    if (!this.challengeStateStore) {
      throw new Error(
        'SMS/USSD challenge state store is not configured. Inject a durable ' +
          'SMSChallengeStateStore or explicitly opt into allowEphemeralChallengeState for tests.'
      );
    }
    return this.challengeStateStore;
  }

  private generateUniqueSMSChallengeId(store: SMSChallengeStateStore): string {
    for (let attempt = 0; attempt < MAX_UNIQUE_CODE_ATTEMPTS; attempt++) {
      const id = Array.from(this.getSecureRandomBytes(CHALLENGE_ID_BYTES))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
      if (!this.issuedChallengeIds.has(id) && !store.getIssued(id)) {
        this.issuedChallengeIds.add(id);
        return id;
      }
    }
    throw new Error('Unable to generate a unique SMS challenge ID from the secure random source');
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
