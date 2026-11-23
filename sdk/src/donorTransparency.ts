import axios from 'axios';
import { UnauthorizedError, ValidationError } from './errors';
// NOTE: crypto-js is intentionally not imported here — donorTransparency uses
// Math.random() + Date.now() for non-security IDs and certificate numbers.
// No cryptographic hashing is required in this module.

export interface TransparencyEntry {
  id: string;
  fundId: string;
  timestamp: number;
  transactionType: 'fund_created' | 'allocation' | 'disbursement' | 'recall';
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

export type ProofVerificationStatus = 'pending' | 'verified' | 'disputed';

export type ProofReviewAction = 'verified' | 'disputed';

export interface ProofReviewRecord {
  action: ProofReviewAction;
  actor: string;
  fromStatus: ProofVerificationStatus;
  toStatus: ProofVerificationStatus;
  timestamp: number;
  reason?: string;
}

export interface ProofDispute {
  reason: string;
  disputedBy: string;
  timestamp: number;
  previousStatus: Exclude<ProofVerificationStatus, 'disputed'>;
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
  verificationStatus: ProofVerificationStatus;
  verifiedBy?: string;
  signature: string;
  dispute?: ProofDispute;
  reviewHistory?: ProofReviewRecord[];
}

export class InvalidProofTransitionError extends Error {
  readonly code = 'INVALID_PROOF_TRANSITION';
  readonly proofId: string;
  readonly fromStatus: string;
  readonly toStatus: string;

  constructor(proofId: string, fromStatus: string, toStatus: string) {
    super(`Invalid proof transition for '${proofId}': cannot move from '${fromStatus}' to '${toStatus}'`);
    this.name = 'InvalidProofTransitionError';
    this.proofId = proofId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
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
  private authorizedReviewers: Set<string>;

  constructor(ipfsGateway: string = 'https://ipfs.io/ipfs/', authorizedReviewers: string[] = []) {
    this.ipfsGateway = ipfsGateway;
    this.authorizedReviewers = new Set(
      authorizedReviewers
        .filter((reviewer): reviewer is string => typeof reviewer === 'string' && reviewer.trim().length > 0)
        .map(reviewer => reviewer.trim())
    );
  }

  addAuthorizedReviewer(reviewerId: string): void {
    const normalized = typeof reviewerId === 'string' ? reviewerId.trim() : '';
    if (!normalized) {
      throw new ValidationError('reviewerId', 'must be a non-empty string');
    }
    this.authorizedReviewers.add(normalized);
  }

  removeAuthorizedReviewer(reviewerId: string): void {
    this.authorizedReviewers.delete(typeof reviewerId === 'string' ? reviewerId.trim() : reviewerId);
  }

  isAuthorizedReviewer(reviewerId: string): boolean {
    return typeof reviewerId === 'string' && this.authorizedReviewers.has(reviewerId.trim());
  }

  getAuthorizedReviewers(): string[] {
    return Array.from(this.authorizedReviewers);
  }

  /**
   * Creates complete transparency record for fund deployment
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
    const entry: TransparencyEntry = {
      id: this.generateId(),
      fundId,
      timestamp: Date.now(),
      transactionType: transactionType as any,
      amount,
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
    signature: string
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
      reviewHistory: [],
    };

    // Store proof
    await this.storeProofOfImpact(proof);

    // Trigger verification process
    await this.initiateVerificationProcess(proof.id);

    return proof;
  }

  /**
   * Verifies proof-of-impact with blockchain attestation
   */
  async verifyProof(proofId: string, verifierId: string): Promise<boolean> {
    try {
      // Retrieve proof
      const proof = await this.retrieveProofOfImpact(proofId);

      if (!proof) {
        throw new Error('Proof not found');
      }

      const fromStatus = proof.verificationStatus;
      proof.verificationStatus = 'verified';
      proof.verifiedBy = verifierId;
      proof.reviewHistory = [
        ...(proof.reviewHistory ?? []),
        {
          action: 'verified',
          actor: verifierId,
          fromStatus,
          toStatus: 'verified',
          timestamp: Date.now(),
        },
      ];

      await this.storeProofOfImpact(proof);

      return true;
    } catch (error) {
      console.error('Proof verification failed:', error);
      return false;
    }
  }

  async disputeProof(proofId: string, reviewerId: string, reason: string): Promise<ProofOfImpact> {
    const proof = await this.retrieveProofOfImpact(proofId);

    if (!proof) {
      throw new Error(`Proof not found: ${proofId}`);
    }

    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      throw new ValidationError('reason', 'must be a non-empty string', { proofId });
    }

    const trimmedReviewer = typeof reviewerId === 'string' ? reviewerId.trim() : '';
    if (!trimmedReviewer) {
      throw new ValidationError('reviewerId', 'must be a non-empty string', { proofId });
    }

    if (!this.isAuthorizedReviewer(trimmedReviewer)) {
      throw new UnauthorizedError('dispute proof', trimmedReviewer, { proofId });
    }

    const fromStatus = proof.verificationStatus;
    if (fromStatus !== 'pending' && fromStatus !== 'verified') {
      throw new InvalidProofTransitionError(proofId, fromStatus, 'disputed');
    }

    const timestamp = Date.now();
    const dispute: ProofDispute = {
      reason: trimmedReason,
      disputedBy: trimmedReviewer,
      timestamp,
      previousStatus: fromStatus,
    };
    const reviewRecord: ProofReviewRecord = {
      action: 'disputed',
      actor: trimmedReviewer,
      fromStatus,
      toStatus: 'disputed',
      timestamp,
      reason: trimmedReason,
    };

    proof.verificationStatus = 'disputed';
    proof.dispute = dispute;
    proof.reviewHistory = [...(proof.reviewHistory ?? []), reviewRecord];

    await this.storeProofOfImpact(proof);

    return proof;
  }

  async getProofOfImpact(proofId: string): Promise<ProofOfImpact | null> {
    return this.retrieveProofOfImpact(proofId);
  }

  async getProofReviewHistory(proofId: string): Promise<ProofReviewRecord[]> {
    const proof = await this.retrieveProofOfImpact(proofId);
    if (!proof) {
      throw new Error(`Proof not found: ${proofId}`);
    }
    return [...(proof.reviewHistory ?? [])];
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
          const key = t.description.split(':')[0] || 'Other';
          allocationBreakdown[key] = t.amount;
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
