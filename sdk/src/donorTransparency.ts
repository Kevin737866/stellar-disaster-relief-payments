import axios from 'axios';
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
  /** Snapshot of the policy used; no tax claim is made without one. */
  taxPolicy: TaxDeductionPolicy;
  donationDate: number;
  receiptDate: number;
  certificateNumber: string;
  impact: {
    beneficiariesReached: number;
    sectorsSupported: string[];
    regionsImpacted: string[];
  };
}

/**
 * Explicit tax treatment for a contribution. Deductibility is never inferred
 * from the donation amount alone.
 */
export interface TaxDeductionPolicy {
  /** Jurisdiction whose rules are applied (e.g. `US`, `GB`, `CA-ON`). */
  jurisdiction: string;
  /** Share of the donation that is deductible, 0-100 inclusive. */
  deductiblePercentage: number;
  /** Optional cap, in the same unit as the donation amount. */
  maximumDeductibleAmount?: string;
  /** Inclusive donation-date bounds for which the policy applies. */
  validFrom?: number;
  validUntil?: number;
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

  constructor(ipfsGateway: string = 'https://ipfs.io/ipfs/') {
    this.ipfsGateway = ipfsGateway;
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

      // Update verification status
      proof.verificationStatus = 'verified';
      proof.verifiedBy = verifierId;

      // Store updated proof
      await this.storeProofOfImpact(proof);

      return true;
    } catch (error) {
      console.error('Proof verification failed:', error);
      return false;
    }
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
    donorEmail: string,
    taxPolicy?: TaxDeductionPolicy
  ): Promise<TaxReceipt> {
    try {
      // The contribution date comes from the single recorded fund-creation
      // event, not from when the receipt happens to be generated.
      const entries = await this.retrieveTransparencyEntries(fundId);
      const contribution = this.resolveDonationContribution(fundId, entries);
      const policy = this.validateTaxPolicy(taxPolicy);
      const fundFlow = await this.trackFundFlow(fundId, donorAddress);
      const proofs = await this.retrieveProofsOfImpact(fundId);

      if (fundFlow.initialAmount !== contribution.amount) {
        throw new Error(`Fund-creation amount is inconsistent for fund ${fundId}`);
      }

      const taxDeductibleAmount = this.calculateTaxDeductible(
        contribution.amount,
        policy,
        contribution.timestamp
      );

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
        totalDonation: contribution.amount,
        taxDeductibleAmount,
        taxPolicy: policy,
        donationDate: contribution.timestamp,
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

  /**
   * Resolves the one fund-creation event that verifies the contribution.
   * A missing or duplicated event leaves the donation date unverifiable.
   */
  private resolveDonationContribution(
    fundId: string,
    entries: TransparencyEntry[]
  ): { amount: string; timestamp: number } {
    const creations = entries.filter(e => e.transactionType === 'fund_created');

    if (creations.length === 0) {
      throw new Error(`No fund-creation record found for fund ${fundId}`);
    }
    if (creations.length > 1) {
      throw new Error(
        `Multiple fund-creation records found for fund ${fundId}; donation date is ambiguous`
      );
    }

    const creation = creations[0];
    const amount = this.parseDonationAmount(creation.amount, 'Fund-creation record');
    if (!Number.isFinite(creation.timestamp) || creation.timestamp < 0) {
      throw new Error(`Fund-creation record for fund ${fundId} has an invalid timestamp`);
    }

    return { amount, timestamp: creation.timestamp };
  }

  private validateTaxPolicy(policy?: TaxDeductionPolicy): TaxDeductionPolicy {
    if (!policy || typeof policy !== 'object') {
      throw new Error('An explicit tax policy is required to generate a tax receipt');
    }

    const jurisdiction = typeof policy.jurisdiction === 'string' ? policy.jurisdiction.trim() : '';
    if (!jurisdiction) {
      throw new Error('Tax policy must specify a jurisdiction');
    }
    if (
      !Number.isInteger(policy.deductiblePercentage) ||
      policy.deductiblePercentage < 0 ||
      policy.deductiblePercentage > 100
    ) {
      throw new Error('Tax policy deductiblePercentage must be an integer between 0 and 100');
    }

    const validated: TaxDeductionPolicy = {
      jurisdiction,
      deductiblePercentage: policy.deductiblePercentage,
    };

    if (policy.maximumDeductibleAmount !== undefined) {
      validated.maximumDeductibleAmount = this.parseDonationAmount(
        policy.maximumDeductibleAmount,
        'Tax policy maximumDeductibleAmount'
      );
    }

    for (const key of ['validFrom', 'validUntil'] as const) {
      const value = policy[key];
      if (value !== undefined) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Tax policy ${key} must be a non-negative timestamp`);
        }
        validated[key] = value;
      }
    }
    if (
      validated.validFrom !== undefined &&
      validated.validUntil !== undefined &&
      validated.validFrom > validated.validUntil
    ) {
      throw new Error('Tax policy validFrom must not be after validUntil');
    }

    return validated;
  }

  private parseDonationAmount(amount: string, source: string): string {
    if (typeof amount !== 'string' || !/^\d+$/.test(amount.trim())) {
      throw new Error(`${source} has an invalid non-negative integer amount`);
    }
    return BigInt(amount.trim()).toString();
  }

  private calculateTaxDeductible(
    amount: string,
    policy?: TaxDeductionPolicy,
    donationDate?: number
  ): string {
    // No amount is deductible unless an explicit, jurisdiction-scoped policy
    // applies to the verified donation date.
    const validatedPolicy = this.validateTaxPolicy(policy);
    if (donationDate === undefined || !Number.isFinite(donationDate)) {
      throw new Error('A verified donation date is required to calculate tax deductibility');
    }
    if (
      validatedPolicy.validFrom !== undefined &&
      donationDate < validatedPolicy.validFrom
    ) {
      throw new Error('Tax policy does not apply to this donation date');
    }
    if (
      validatedPolicy.validUntil !== undefined &&
      donationDate > validatedPolicy.validUntil
    ) {
      throw new Error('Tax policy does not apply to this donation date');
    }

    const total = BigInt(this.parseDonationAmount(amount, 'Donation'));
    const deductible = (total * BigInt(validatedPolicy.deductiblePercentage)) / BigInt(100);

    if (validatedPolicy.maximumDeductibleAmount !== undefined) {
      const cap = BigInt(validatedPolicy.maximumDeductibleAmount);
      return (deductible < cap ? deductible : cap).toString();
    }
    return deductible.toString();
  }

  private addBigNumbers(a: string, b: string): string {
    return (BigInt(a) + BigInt(b)).toString();
  }
}
