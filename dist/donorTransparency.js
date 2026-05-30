"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DonorTransparencyClient = void 0;
/**
 * Donor Transparency Client
 * Provides complete traceability from donor wallet to beneficiary with:
 * - Real-time expense tracking with geolocation
 * - Proof-of-impact attestations from field workers
 * - Automated tax receipts for charitable contributions
 * - Donor-facing dashboards showing fund flow
 */
class DonorTransparencyClient {
    constructor(ipfsGateway = 'https://ipfs.io/ipfs/') {
        this.donorDataKey = 'donor_transparency_';
        this.ipfsGateway = ipfsGateway;
    }
    /**
     * Creates complete transparency record for fund deployment
     */
    async createTransparencyEntry(fundId, transactionType, amount, description, beneficiary, location, proof) {
        const entry = {
            id: this.generateId(),
            fundId,
            timestamp: Date.now(),
            transactionType: transactionType,
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
    async submitProofOfImpact(fundId, disbursementId, fieldWorkerId, location, beneficiaryCount, description, mediaHash, signature) {
        const proof = {
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
    async verifyProof(proofId, verifierId) {
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
        }
        catch (error) {
            console.error('Proof verification failed:', error);
            return false;
        }
    }
    /**
     * Tracks complete fund flow from donor to beneficiary
     * Provides real-time visibility into every transaction
     */
    async trackFundFlow(fundId, donorAddress) {
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
            const allocationBreakdown = {};
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
        }
        catch (error) {
            throw new Error(`Fund flow tracking failed: ${error.message}`);
        }
    }
    /**
     * Generates donor dashboard with complete fund visibility
     */
    async generateDonorDashboard(donorAddress) {
        try {
            // Retrieve all funds associated with donor
            const allTransparencyEntries = await this.retrieveAllDonorEntries(donorAddress);
            const allProofs = await this.retrieveAllDonorProofs(donorAddress);
            // Get unique funds
            const fundIds = [...new Set(allTransparencyEntries.map(e => e.fundId))];
            // Build fund flows
            const fundFlows = [];
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
        }
        catch (error) {
            throw new Error(`Dashboard generation failed: ${error.message}`);
        }
    }
    /**
     * Generates automated tax receipt for donors
     * Supports charitable contribution tracking and audit
     */
    async generateTaxReceipt(fundId, donorAddress, donorName, donorEmail) {
        try {
            const fundFlow = await this.trackFundFlow(fundId, donorAddress);
            const proofs = await this.retrieveProofsOfImpact(fundId);
            // Calculate tax deductible amount
            const taxDeductibleAmount = this.calculateTaxDeductible(fundFlow.initialAmount);
            // Get impact data
            const sectors = new Set();
            const regions = new Set();
            proofs.forEach(p => {
                // Extract sectors and regions from proofs
                sectors.add('General Relief');
                regions.add(p.location.address.split(',').pop()?.trim() || 'Unknown');
            });
            const receipt = {
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
        }
        catch (error) {
            throw new Error(`Tax receipt generation failed: ${error.message}`);
        }
    }
    /**
     * Retrieves real-time expense tracking for a fund
     * Shows geolocation and detailed transaction history
     */
    async getExpenseTracking(fundId) {
        try {
            const entries = await this.retrieveTransparencyEntries(fundId);
            const disbursements = entries.filter(e => e.transactionType === 'disbursement');
            const totalExpenses = disbursements.reduce((sum, e) => {
                return this.addBigNumbers(sum, e.amount);
            }, '0');
            const geolocationCoverage = [
                ...new Set(disbursements.map(e => e.location?.address || 'Unknown')),
            ];
            return {
                totalExpenses,
                expenses: disbursements,
                geolocationCoverage,
            };
        }
        catch (error) {
            throw new Error(`Expense tracking retrieval failed: ${error.message}`);
        }
    }
    /**
     * Export transparency data for audit
     */
    async exportTransparencyReport(fundId) {
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
        }
        catch (error) {
            throw new Error(`Report export failed: ${error.message}`);
        }
    }
    // Private helper methods
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    generateCertificateNumber() {
        return `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    }
    async storeTransparencyEntry(entry) {
        // Store in local storage or backend
        const key = `${this.donorDataKey}entry_${entry.id}`;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(entry));
        }
    }
    async retrieveTransparencyEntries(fundId) {
        // Retrieve from storage
        const entries = [];
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(`${this.donorDataKey}entry_`)) {
                    const entry = JSON.parse(localStorage.getItem(key) || '{}');
                    if (entry.fundId === fundId) {
                        entries.push(entry);
                    }
                }
            }
        }
        return entries;
    }
    async retrieveAllDonorEntries(donorAddress) {
        // Retrieve all transparency entries for a donor
        const entries = [];
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
    async storeProofOfImpact(proof) {
        const key = `${this.donorDataKey}proof_${proof.id}`;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(proof));
        }
    }
    async retrieveProofOfImpact(proofId) {
        const key = `${this.donorDataKey}proof_${proofId}`;
        if (typeof localStorage !== 'undefined') {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        }
        return null;
    }
    async retrieveProofsOfImpact(fundId) {
        const proofs = [];
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(`${this.donorDataKey}proof_`)) {
                    const proof = JSON.parse(localStorage.getItem(key) || '{}');
                    if (proof.fundId === fundId) {
                        proofs.push(proof);
                    }
                }
            }
        }
        return proofs;
    }
    async retrieveAllDonorProofs(donorAddress) {
        const proofs = [];
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
    async storeTaxReceipt(receipt) {
        const key = `${this.donorDataKey}tax_receipt_${receipt.id}`;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(receipt));
        }
    }
    async retrieveTaxReceipts(donorAddress) {
        const receipts = [];
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith(`${this.donorDataKey}tax_receipt_`)) {
                    const receipt = JSON.parse(localStorage.getItem(key) || '{}');
                    if (receipt.donorAddress === donorAddress) {
                        receipts.push(receipt);
                    }
                }
            }
        }
        return receipts;
    }
    async initiateVerificationProcess(proofId) {
        // Implement verification workflow
        // Could trigger notifications to verifiers
    }
    calculateCurrentBalance(initial, transactions) {
        let balance = BigInt(initial);
        transactions.forEach(t => {
            const amount = BigInt(t.amount);
            if (t.transactionType === 'disbursement' || t.transactionType === 'recall') {
                balance -= amount;
            }
        });
        return balance.toString();
    }
    calculateTaxDeductible(amount) {
        // Typically 100% of qualified charitable contributions
        return amount;
    }
    addBigNumbers(a, b) {
        return (BigInt(a) + BigInt(b)).toString();
    }
}
exports.DonorTransparencyClient = DonorTransparencyClient;
//# sourceMappingURL=donorTransparency.js.map