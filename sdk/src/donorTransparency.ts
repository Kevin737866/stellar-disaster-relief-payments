import axios from 'axios';
import { SHA256 } from 'crypto-js';
import { ValidationError } from './errors';

/** Transaction types accepted by {@link DonorTransparencyClient.createTransparencyEntry}. */
export const VALID_TRANSACTION_TYPES = [
  'fund_created',
  'allocation',
  'disbursement',
  'recall',
] as const;
type TransactionType = (typeof VALID_TRANSACTION_TYPES)[number];

/** Maximum 256-bit unsigned integer value: 2^256 - 1. */
const MAX_U256 = (1n << 256n) - 1n;

/**
 * Validate that an amount string is a non-negative integer that fits in a
 * 256-bit unsigned integer (the representation used by Soroban and by the
 * BigInt-based balance calculations in this module).
 *
 * Rejects empty strings, fractions, negatives, and values exceeding U256.
 * @internal
 */
function validateAmount(amount: string, field = 'amount'): string {
  if (typeof amount !== 'string') {
    throw new ValidationError(field, 'Amount must be a string');
  }
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new ValidationError(field, 'Amount string must not be empty');
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new ValidationError(
      field,
      'Amount must be a non-negative decimal integer string without decimals, fractions, or signs'
    );
  }
  try {
    const val = BigInt(trimmed);
    if (val < 0n || val > MAX_U256) {
      throw new ValidationError(
        field,
        'Amount must fit within a 256-bit unsigned integer (0 <= amount <= 2^256 - 1)'
      );
    }
    return val.toString();
  } catch (err: any) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(field, `Failed to parse amount as U256: ${err?.message || err}`);
  }
}

export interface TransparencyEntry {
  id: string;
  fundId: string;
  timestamp: number;
  transactionType: TransactionType;
  amount: string;
  description: string;
  beneficiary?: string;
  location?: {
    latitude: number;
    longitude: number;
    precision?: number;
  };
  proof?: string;
}

export interface ProofOfImpact {
  id: string;
  fundId: string;
  disbursementId: string;
  fieldWorkerId: string;
  timestamp: number;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  };
  beneficiaryCount: number;
  description: string;
  mediaHash: string; // IPFS hash or similar
  verificationStatus: 'pending' | 'verified' | 'disputed';
  verifiedBy?: string;
  signature: string;
  /** Public key of the field worker who signed the proof (Ed25519, base58 or hex). */
  fieldWorkerPublicKey?: string;
}

/**
 * Registry of identities authorised to verify proofs-of-impact.
 * Each entry maps a verifier identifier to a public key used for
 * signature verification.
 */
export interface TrustedVerifier {
  verifierId: string;
  /** Ed25519 public key (hex or base58-encoded) used to verify proof signatures. */
  publicKey: string;
  /** When set to false the verifier is temporarily disabled. */
  active?: boolean;
}

/**
 * Result returned by {@link DonorTransparencyClient.verifyProof}.
 *
 * A proof is only considered verified when `success` is true.  On failure
 * `error` provides a machine-readable reason and `message` a human-readable
 * explanation so callers can surface actionable feedback.
 */
export interface ProofVerificationResult {
  success: boolean;
  error?:
    | 'PROOF_NOT_FOUND'
    | 'MISSING_SIGNATURE'
    | 'MISSING_PUBLIC_KEY'
    | 'INVALID_SIGNATURE'
    | 'UNAUTHORIZED_VERIFIER'
    | 'INACTIVE_VERIFIER'
    | 'VERIFIER_SERVICE_UNAVAILABLE'
    | 'PROOF_ALREADY_VERIFIED';
  message: string;
  proofId: string;
  verifierId: string;
  verificationStatus: 'pending' | 'verified' | 'disputed';
}

export interface FundFlow {
  fundId: string;
  donorAddress: string;
  initialAmount: string;
  currentBalance: string;
  releaseHistory: {
    timestamp: number;
    amount: string;
    beneficiary: string;
    purpose: string;
  }[];
  allocationBreakdown: Record<string, string>;
}

export interface TaxReceipt {
  id: string;
  fundId: string;
  donorAddress: string;
  donorName: string;
  donorEmail: string;
  totalDonation: string;
  taxDeductibleAmount: string;
  donationDate: number;
  receiptDate: number;
  certificateNumber: string;
  impact: {
    beneficiariesReached: number;
    sectorsSupported: string[];
    regionsImpacted: string[];
  };
}

export interface DonorDashboard {
  donorAddress: string;
  totalDocumented: string;
  activeFunds: number;
  totalBeneficiaries: number;
  impactReports: number;
  documents: TransparencyEntry[];
  fundFlow: FundFlow[];
  taxReceipts: TaxReceipt[];
}

/**
 * Donor Transparency Client
 * Provides complete traceability from donor wallet to beneficiary with:
 * - Real-time expense tracking with geolocation
 * - Proof-of-impact attestations from field workers
 * - Automated tax receipts for charitable contributions
 * - Donor-facing dashboards showing fund flow
 */
export class DonorTransparencyClient {
  private ipfsGateway: string;
  private donorDataKey: string = 'donor_transparency_';
  /** Map of verifierId → TrustedVerifier, the authoritative authorization list. */
  private trustedVerifiers: Map<string, TrustedVerifier> = new Map();
  /**
   * Pluggable verifier service used during signature validation.
   * When set, {@link verifyProof} delegates the cryptographic check to this
   * callback instead of using the built-in fallback.  When unset, the
   * built-in fallback is used (which requires the signature to equal the
   * SHA-256 hash of the canonical proof message — useful for testing but
   * not suitable for production use without a real Ed25519 implementation).
   */
  private verifierService?: (
    messageHash: string,
    signature: string,
    publicKey: string
  ) => Promise<boolean>;

  /**
   * Inject (or replace) the verifier-service callback used for
   * signature validation.  Pass `undefined` to revert to the built-in
   * fallback.
   */
  setVerifierService(
    service?: (messageHash: string, signature: string, publicKey: string) => Promise<boolean>
  ): void {
    this.verifierService = service;
  }

  constructor(ipfsGateway: string = 'https://ipfs.io/ipfs/') {
    this.ipfsGateway = ipfsGateway;
  }

  // ── Trusted-verifier management ──────────────────────────────────────

  /**
   * Register a verifier as trusted.  Only verifiers in this registry are
   * allowed to mark proofs as verified.
   */
  registerTrustedVerifier(verifier: TrustedVerifier): void {
    this.trustedVerifiers.set(verifier.verifierId, verifier);
  }

  /**
   * Remove a verifier from the trusted set.
   */
  revokeTrustedVerifier(verifierId: string): void {
    this.trustedVerifiers.delete(verifierId);
  }

  /**
   * Look up a trusted verifier by ID.
   * Returns `undefined` when the verifier is not registered.
   * @internal
   */
  private resolveTrustedVerifier(verifierId: string): TrustedVerifier | undefined {
    return this.trustedVerifiers.get(verifierId);
  }

  // ── Signature verification ────────────────────────────────────────────

  /**
   * Compute the canonical message string that the field worker signed.
   *
   * The signature is expected to be over the SHA-256 hash of a canonical
   * JSON representation of the proof **excluding** the signature and
   * verificationStatus fields (which are set after signing).
   *
   * @internal
   */
  private buildProofMessage(proof: ProofOfImpact): string {
    const payload = {
      id: proof.id,
      fundId: proof.fundId,
      disbursementId: proof.disbursementId,
      fieldWorkerId: proof.fieldWorkerId,
      timestamp: proof.timestamp,
      location: proof.location,
      beneficiaryCount: proof.beneficiaryCount,
      description: proof.description,
      mediaHash: proof.mediaHash,
    };
    return JSON.stringify(payload, Object.keys(payload).sort());
  }

  /**
   * Verify the Ed25519 signature on a proof-of-impact using a
   * verifier-service callback.
   *
   * The callback receives the canonical message hash, the signature, and
   * the public key.  It must return a boolean indicating whether the
   * signature is valid.  If the callback throws, it is treated as a
   * verifier-service failure.
   *
   * @internal
   */
  private async verifyProofSignature(
    proof: ProofOfImpact,
    verifier: TrustedVerifier
  ): Promise<boolean> {
    // Build the canonical message and its SHA-256 hash.
    const message = this.buildProofMessage(proof);
    const messageHash = SHA256(message).toString();

    // Use the injected verifier service when available.
    if (this.verifierService) {
      try {
        return await this.verifierService(messageHash, proof.signature, verifier.publicKey);
      } catch {
        throw new Error('VERIFIER_SERVICE_UNAVAILABLE');
      }
    }

    // Fallback: constant-time string comparison against a precomputed hash.
    // This is not real cryptographic verification, but it lets the class
    // operate in environments where a verifier service is not configured
    // while still enforcing that the signature field is present and
    // corresponds to the proof data.
    if (!proof.signature || proof.signature.trim() === '') {
      return false;
    }
    return this.constantTimeCompare(proof.signature, messageHash);
  }

  /**
   * Compare two strings in constant time to avoid timing side-channels.
   * @internal
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Creates complete transparency record for fund deployment.
   *
   * Validates the fund ID, transaction type, and amount before persisting.
   * Only `fund_created`, `allocation`, `disbursement`, and `recall` are
   * accepted as transaction types.  Amounts must be non-negative integer
   * strings that fit within a 256-bit unsigned integer.
   *
   * @throws {ValidationError} if `fundId` is empty, `transactionType` is
   *   not one of the supported values, or `amount` is malformed, negative,
   *   or exceeds U256.
   */
  async createTransparencyEntry(
    fundId: string,
    transactionType: string,
    amount: string,
    description: string,
    beneficiary?: string,
    location?: { latitude: number; longitude: number; precision?: number },
    proof?: string
  ): Promise<TransparencyEntry> {
    // Validate fund ID.
    if (!fundId || typeof fundId !== 'string' || fundId.trim() === '') {
      throw new ValidationError('fundId', 'Fund ID must be a non-empty string');
    }

    // Validate transaction type against the declared union.
    if (!VALID_TRANSACTION_TYPES.includes(transactionType as TransactionType)) {
      throw new ValidationError(
        'transactionType',
        `Unsupported transaction type: "${transactionType}". Must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}`
      );
    }

    // Validate amount — non-negative integer, U256-safe.
    const normalizedAmount = validateAmount(amount);

    const entry: TransparencyEntry = {
      id: this.generateId(),
      fundId: fundId.trim(),
      timestamp: Date.now(),
      transactionType: transactionType as TransactionType,
      amount: normalizedAmount,
      description,
      beneficiary,
      location,
      proof,
    };

    // Store entry
    await this.storeTransparencyEntry(entry);

    return entry;
  }

  /**
   * Records proof-of-impact attestation from field workers
   * Includes geolocation and media evidence
   *
   * @param signature  Ed25519 signature over the canonical proof message
   *                   (see {@link buildProofMessage}), hex-encoded.
   * @param fieldWorkerPublicKey  Public key of the signing field worker,
   *                   hex or base58-encoded.
   */
  async submitProofOfImpact(
    fundId: string,
    disbursementId: string,
    fieldWorkerId: string,
    location: {
      latitude: number;
      longitude: number;
      address: string;
    },
    beneficiaryCount: number,
    description: string,
    mediaHash: string,
    signature: string,
    fieldWorkerPublicKey?: string
  ): Promise<ProofOfImpact> {
    const proof: ProofOfImpact = {
      id: this.generateId(),
      fundId,
      disbursementId,
      fieldWorkerId,
      timestamp: Date.now(),
      location,
      beneficiaryCount,
      description,
      mediaHash,
      verificationStatus: 'pending',
      signature,
      fieldWorkerPublicKey,
    };

    // Store proof
    await this.storeProofOfImpact(proof);

    // Trigger verification process
    await this.initiateVerificationProcess(proof.id);

    return proof;
  }

  /**
   * Verifies proof-of-impact with blockchain attestation.
   *
   * A proof is only transitioned to `verified` when **all** of the
   * following hold:
   *
   * 1. The proof exists in storage.
   * 2. The caller-supplied `verifierId` is present in the trusted-verifier
   *    registry and is active.
   * 3. The proof carries a non-empty signature.
   * 4. The signature validates against the canonical proof message.
   *
   * On any failure the proof's `verificationStatus` is left unchanged
   * (or set to `'disputed'` when the signature is present but invalid) and
   * a `ProofVerificationResult` with `success: false` is returned.
   */
  async verifyProof(proofId: string, verifierId: string): Promise<ProofVerificationResult> {
    const baseResult: ProofVerificationResult = {
      success: false,
      message: '',
      proofId,
      verifierId,
      verificationStatus: 'pending',
    };

    // 1. Retrieve proof ----------------------------------------------------
    let proof: ProofOfImpact | null;
    try {
      proof = await this.retrieveProofOfImpact(proofId);
    } catch {
      return {
        ...baseResult,
        error: 'VERIFIER_SERVICE_UNAVAILABLE',
        message: 'Unable to retrieve proof from storage.',
      };
    }

    if (!proof) {
      return {
        ...baseResult,
        error: 'PROOF_NOT_FOUND',
        message: `Proof '${proofId}' not found.`,
      };
    }

    // Guard: a proof that is already verified cannot be re-verified by a
    // different verifier.
    if (proof.verificationStatus === 'verified' && proof.verifiedBy !== verifierId) {
      return {
        ...baseResult,
        verificationStatus: proof.verificationStatus,
        error: 'PROOF_ALREADY_VERIFIED',
        message: `Proof already verified by '${proof.verifiedBy}'.`,
      };
    }

    // 2. Authorize the verifier --------------------------------------------
    const verifier = this.resolveTrustedVerifier(verifierId);
    if (!verifier) {
      return {
        ...baseResult,
        verificationStatus: proof.verificationStatus,
        error: 'UNAUTHORIZED_VERIFIER',
        message: `Verifier '${verifierId}' is not in the trusted verifier registry.`,
      };
    }
    if (verifier.active === false) {
      return {
        ...baseResult,
        verificationStatus: proof.verificationStatus,
        error: 'INACTIVE_VERIFIER',
        message: `Verifier '${verifierId}' is registered but inactive.`,
      };
    }

    // 3. Check that the proof carries a signature --------------------------
    if (!proof.signature || proof.signature.trim() === '') {
      return {
        ...baseResult,
        verificationStatus: proof.verificationStatus,
        error: 'MISSING_SIGNATURE',
        message: 'Proof has no signature to verify.',
      };
    }

    // 4. Validate the signature -------------------------------------------
    let signatureValid: boolean;
    try {
      signatureValid = await this.verifyProofSignature(proof, verifier);
    } catch (err: any) {
      // Verifier service threw — treat as a service failure, not a
      // signature failure.  Do NOT transition the proof.
      return {
        ...baseResult,
        verificationStatus: proof.verificationStatus,
        error: 'VERIFIER_SERVICE_UNAVAILABLE',
        message: `Verifier service error: ${err?.message ?? 'unknown error'}`,
      };
    }

    if (!signatureValid) {
      // Mark as disputed so the proof is not silently treated as pending.
      proof.verificationStatus = 'disputed';
      try {
        await this.storeProofOfImpact(proof);
      } catch {
        // Best-effort persistence; still report the invalid signature.
      }
      return {
        ...baseResult,
        verificationStatus: 'disputed',
        error: 'INVALID_SIGNATURE',
        message: 'Signature does not match the proof data.',
      };
    }

    // 5. All checks passed — transition to verified -----------------------
    proof.verificationStatus = 'verified';
    proof.verifiedBy = verifierId;

    try {
      await this.storeProofOfImpact(proof);
    } catch {
      // Even if persistence fails we report the verification result so
      // the caller can retry storage.  The in-memory proof is already
      // updated.
    }

    return {
      success: true,
      message: 'Proof verified successfully.',
      proofId,
      verifierId,
      verificationStatus: 'verified',
    };
  }

  /**
   * Tracks complete fund flow from donor to beneficiary
   * Provides real-time visibility into every transaction
   */
  async trackFundFlow(fundId: string, donorAddress: string): Promise<FundFlow> {
    try {
      // Retrieve all transactions for this fund
      const transactions = await this.retrieveTransparencyEntries(fundId);
      const proofs = await this.retrieveProofsOfImpact(fundId);

      const releaseHistory = transactions
        .filter(t => t.transactionType === 'disbursement')
        .map(t => ({
          timestamp: t.timestamp,
          amount: t.amount,
          beneficiary: t.beneficiary || '',
          purpose: t.description,
        }));

      const initialAmount = transactions
        .find(t => t.transactionType === 'fund_created')?.amount || '0';

      const allocationBreakdown: Record<string, string> = {};
      transactions
        .filter(t => t.transactionType === 'allocation')
        .forEach(t => {
          // Normalize the category from the description.  Descriptions are
          // expected to follow "Category: detail" format.  Entries with no
          // description or no colon prefix are grouped under 'Uncategorized'.
          const prefix = t.description.split(':')[0].trim();
          const key = prefix || 'Uncategorized';
          allocationBreakdown[key] = this.addBigNumbers(
            allocationBreakdown[key] || '0',
            t.amount
          );
        });

      return {
        fundId,
        donorAddress,
        initialAmount,
        currentBalance: this.calculateCurrentBalance(initialAmount, transactions),
        releaseHistory,
        allocationBreakdown,
      };
    } catch (error: any) {
      throw new Error(`Fund flow tracking failed: ${error.message}`);
    }
  }

  /**
   * Generates donor dashboard with complete fund visibility
   */
  async generateDonorDashboard(donorAddress: string): Promise<DonorDashboard> {
    try {
      // Retrieve all funds associated with donor
      const allTransparencyEntries = await this.retrieveAllDonorEntries(donorAddress);
      const allProofs = await this.retrieveAllDonorProofs(donorAddress);

      // Get unique funds
      const fundIds = [...new Set(allTransparencyEntries.map(e => e.fundId))];

      // Build fund flows
      const fundFlows: FundFlow[] = [];
      for (const fundId of fundIds) {
        const flow = await this.trackFundFlow(fundId, donorAddress);
        fundFlows.push(flow);
      }

      // Calculate metrics
      const totalDocumented = fundFlows.reduce((sum, f) => {
        return this.addBigNumbers(sum, f.initialAmount);
      }, '0');

      const totalBeneficiaries = allProofs.reduce((sum, p) => sum + p.beneficiaryCount, 0);

      // Retrieve tax receipts
      const taxReceipts = await this.retrieveTaxReceipts(donorAddress);

      return {
        donorAddress,
        totalDocumented,
        activeFunds: fundIds.length,
        totalBeneficiaries,
        impactReports: allProofs.length,
        documents: allTransparencyEntries,
        fundFlow: fundFlows,
        taxReceipts,
      };
    } catch (error: any) {
      throw new Error(`Dashboard generation failed: ${error.message}`);
    }
  }

  /**
   * Generates automated tax receipt for donors
   * Supports charitable contribution tracking and audit
   */
  async generateTaxReceipt(
    fundId: string,
    donorAddress: string,
    donorName: string,
    donorEmail: string
  ): Promise<TaxReceipt> {
    try {
      const fundFlow = await this.trackFundFlow(fundId, donorAddress);
      const proofs = await this.retrieveProofsOfImpact(fundId);

      // Calculate tax deductible amount
      const taxDeductibleAmount = this.calculateTaxDeductible(fundFlow.initialAmount);

      // Get impact data
      const sectors = new Set<string>();
      const regions = new Set<string>();

      proofs.forEach(p => {
        // Extract sectors and regions from proofs
        sectors.add('General Relief');
        regions.add(p.location.address.split(',').pop()?.trim() || 'Unknown');
      });

      const receipt: TaxReceipt = {
        id: this.generateId(),
        fundId,
        donorAddress,
        donorName,
        donorEmail,
        totalDonation: fundFlow.initialAmount,
        taxDeductibleAmount,
        donationDate: Date.now(),
        receiptDate: Date.now(),
        certificateNumber: this.generateCertificateNumber(),
        impact: {
          beneficiariesReached: proofs.reduce((sum, p) => sum + p.beneficiaryCount, 0),
          sectorsSupported: Array.from(sectors),
          regionsImpacted: Array.from(regions),
        },
      };

      // Store tax receipt
      await this.storeTaxReceipt(receipt);

      return receipt;
    } catch (error: any) {
      throw new Error(`Tax receipt generation failed: ${error.message}`);
    }
  }

  /**
   * Retrieves real-time expense tracking for a fund
   * Shows geolocation and detailed transaction history
   */
  async getExpenseTracking(fundId: string): Promise<{
    totalExpenses: string;
    expenses: TransparencyEntry[];
    geolocationCoverage: string[];
  }> {
    try {
      const entries = await this.retrieveTransparencyEntries(fundId);
      const disbursements = entries.filter(e => e.transactionType === 'disbursement');

      const totalExpenses = disbursements.reduce((sum, e) => {
        return this.addBigNumbers(sum, e.amount);
      }, '0');

      const geolocationCoverage = [
        ...new Set(disbursements.map(e => e.location ? `${e.location.latitude},${e.location.longitude}` : 'Unknown')),
      ];

      return {
        totalExpenses,
        expenses: disbursements,
        geolocationCoverage,
      };
    } catch (error: any) {
      throw new Error(`Expense tracking retrieval failed: ${error.message}`);
    }
  }

  /**
   * Export transparency data for audit
   */
  async exportTransparencyReport(fundId: string): Promise<string> {
    try {
      const entries = await this.retrieveTransparencyEntries(fundId);
      const proofs = await this.retrieveProofsOfImpact(fundId);

      const report = {
        fundId,
        generateDate: new Date().toISOString(),
        entries,
        proofs,
        summary: {
          totalTransactions: entries.length,
          totalProofs: proofs.length,
          verifiedProofs: proofs.filter(p => p.verificationStatus === 'verified').length,
        },
      };

      // Could convert to PDF or other format
      return JSON.stringify(report, null, 2);
    } catch (error: any) {
      throw new Error(`Report export failed: ${error.message}`);
    }
  }

  // Private helper methods

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCertificateNumber(): string {
    return `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  private async storeTransparencyEntry(entry: TransparencyEntry): Promise<void> {
    // Store in local storage or backend
    const key = `${this.donorDataKey}entry_${entry.id}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(entry));
    }
  }

  private async retrieveTransparencyEntries(fundId: string): Promise<TransparencyEntry[]> {
    // Retrieve from storage
    const entries: TransparencyEntry[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${this.donorDataKey}entry_`)) {
          const entry = JSON.parse(localStorage.getItem(key) || '{}') as TransparencyEntry;
          if (entry.fundId === fundId) {
            entries.push(entry);
          }
        }
      }
    }
    return entries;
  }

  private async retrieveAllDonorEntries(donorAddress: string): Promise<TransparencyEntry[]> {
    // Retrieve all transparency entries for a donor
    const entries: TransparencyEntry[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${this.donorDataKey}entry_`)) {
          entries.push(JSON.parse(localStorage.getItem(key) || '{}'));
        }
      }
    }
    return entries;
  }

  private async storeProofOfImpact(proof: ProofOfImpact): Promise<void> {
    const key = `${this.donorDataKey}proof_${proof.id}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(proof));
    }
  }

  private async retrieveProofOfImpact(proofId: string): Promise<ProofOfImpact | null> {
    const key = `${this.donorDataKey}proof_${proofId}`;
    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    }
    return null;
  }

  private async retrieveProofsOfImpact(fundId: string): Promise<ProofOfImpact[]> {
    const proofs: ProofOfImpact[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${this.donorDataKey}proof_`)) {
          const proof = JSON.parse(localStorage.getItem(key) || '{}') as ProofOfImpact;
          if (proof.fundId === fundId) {
            proofs.push(proof);
          }
        }
      }
    }
    return proofs;
  }

  private async retrieveAllDonorProofs(donorAddress: string): Promise<ProofOfImpact[]> {
    const proofs: ProofOfImpact[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${this.donorDataKey}proof_`)) {
          proofs.push(JSON.parse(localStorage.getItem(key) || '{}'));
        }
      }
    }
    return proofs;
  }

  private async storeTaxReceipt(receipt: TaxReceipt): Promise<void> {
    const key = `${this.donorDataKey}tax_receipt_${receipt.id}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(receipt));
    }
  }

  private async retrieveTaxReceipts(donorAddress: string): Promise<TaxReceipt[]> {
    const receipts: TaxReceipt[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${this.donorDataKey}tax_receipt_`)) {
          const receipt = JSON.parse(localStorage.getItem(key) || '{}') as TaxReceipt;
          if (receipt.donorAddress === donorAddress) {
            receipts.push(receipt);
          }
        }
      }
    }
    return receipts;
  }

  private async initiateVerificationProcess(proofId: string): Promise<void> {
    // Implement verification workflow
    // Could trigger notifications to verifiers
  }

  private calculateCurrentBalance(initial: string, transactions: TransparencyEntry[]): string {
    let balance = BigInt(initial);

    transactions.forEach(t => {
      const amount = BigInt(t.amount);
      if (t.transactionType === 'disbursement' || t.transactionType === 'recall') {
        balance -= amount;
      }
    });

    return balance.toString();
  }

  private calculateTaxDeductible(amount: string): string {
    // Typically 100% of qualified charitable contributions
    return amount;
  }

  private addBigNumbers(a: string, b: string): string {
    return (BigInt(a) + BigInt(b)).toString();
  }
}
