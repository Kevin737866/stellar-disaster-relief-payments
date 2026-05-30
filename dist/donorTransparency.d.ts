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
        precision: number;
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
    mediaHash: string;
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
export declare class DonorTransparencyClient {
    private ipfsGateway;
    private donorDataKey;
    constructor(ipfsGateway?: string);
    /**
     * Creates complete transparency record for fund deployment
     */
    createTransparencyEntry(fundId: string, transactionType: string, amount: string, description: string, beneficiary?: string, location?: {
        latitude: number;
        longitude: number;
        precision?: number;
    }, proof?: string): Promise<TransparencyEntry>;
    /**
     * Records proof-of-impact attestation from field workers
     * Includes geolocation and media evidence
     */
    submitProofOfImpact(fundId: string, disbursementId: string, fieldWorkerId: string, location: {
        latitude: number;
        longitude: number;
        address: string;
    }, beneficiaryCount: number, description: string, mediaHash: string, signature: string): Promise<ProofOfImpact>;
    /**
     * Verifies proof-of-impact with blockchain attestation
     */
    verifyProof(proofId: string, verifierId: string): Promise<boolean>;
    /**
     * Tracks complete fund flow from donor to beneficiary
     * Provides real-time visibility into every transaction
     */
    trackFundFlow(fundId: string, donorAddress: string): Promise<FundFlow>;
    /**
     * Generates donor dashboard with complete fund visibility
     */
    generateDonorDashboard(donorAddress: string): Promise<DonorDashboard>;
    /**
     * Generates automated tax receipt for donors
     * Supports charitable contribution tracking and audit
     */
    generateTaxReceipt(fundId: string, donorAddress: string, donorName: string, donorEmail: string): Promise<TaxReceipt>;
    /**
     * Retrieves real-time expense tracking for a fund
     * Shows geolocation and detailed transaction history
     */
    getExpenseTracking(fundId: string): Promise<{
        totalExpenses: string;
        expenses: TransparencyEntry[];
        geolocationCoverage: string[];
    }>;
    /**
     * Export transparency data for audit
     */
    exportTransparencyReport(fundId: string): Promise<string>;
    private generateId;
    private generateCertificateNumber;
    private storeTransparencyEntry;
    private retrieveTransparencyEntries;
    private retrieveAllDonorEntries;
    private storeProofOfImpact;
    private retrieveProofOfImpact;
    private retrieveProofsOfImpact;
    private retrieveAllDonorProofs;
    private storeTaxReceipt;
    private retrieveTaxReceipts;
    private initiateVerificationProcess;
    private calculateCurrentBalance;
    private calculateTaxDeductible;
    private addBigNumbers;
}
//# sourceMappingURL=donorTransparency.d.ts.map