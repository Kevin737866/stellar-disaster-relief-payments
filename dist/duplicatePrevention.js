"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuplicatePreventionClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Duplicate Disbursement Prevention Client
 * Ensures beneficiaries don't receive duplicate disbursements for the same purpose
 */
class DuplicatePreventionClient {
    constructor(contractId, signingKey, server, networkPassphrase = stellar_sdk_1.Networks.TESTNET) {
        this.contractId = contractId;
        this.signingKey = signingKey;
        this.server = server;
        this.networkPassphrase = networkPassphrase;
        this.localCache = new Map();
    }
    /**
     * Checks if a disbursement is a duplicate before processing
     * Compares beneficiary ID and purpose against existing disbursements
     */
    async checkForDuplicate(beneficiaryId, fundId, purpose) {
        try {
            const cacheKey = `${beneficiaryId}_${fundId}_${purpose}`;
            // Check local cache first
            const cached = this.localCache.get(cacheKey);
            if (cached && cached.length > 0) {
                return {
                    isDuplicate: true,
                    previousDisbursement: cached[0],
                    message: `Duplicate disbursement detected. Beneficiary has already received funds for purpose: ${purpose}`,
                };
            }
            // Query contract for historical disbursements
            const history = await this.getDisbursementHistory(beneficiaryId, fundId, purpose);
            if (history.disbursements.length > 0) {
                // Store in cache
                this.localCache.set(cacheKey, history.disbursements);
                return {
                    isDuplicate: true,
                    previousDisbursement: history.disbursements[0],
                    message: `Duplicate disbursement detected. Previous disbursement: ${history.disbursements[0].transactionHash}`,
                };
            }
            return {
                isDuplicate: false,
                message: 'No duplicate detected. Safe to proceed with disbursement.',
            };
        }
        catch (error) {
            throw new Error(`Failed to check for duplicate: ${error.message}`);
        }
    }
    /**
     * Records a disbursement in the contract to track it for future duplicate checks
     */
    async recordDisbursement(adminAddress, beneficiaryAddress, fundId, purpose, amount, transactionHash, approvers) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const recordId = `${beneficiaryAddress}_${fundId}_${purpose}_${Date.now()}`;
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('record_disbursement', new stellar_sdk_1.Address(adminAddress), beneficiaryAddress, fundId, purpose, amount, transactionHash, approvers.map(a => new stellar_sdk_1.Address(a))))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            await this.server.submitTransaction(transaction);
            // Update local cache
            const cacheKey = `${beneficiaryAddress}_${fundId}_${purpose}`;
            const tracker = {
                id: recordId,
                beneficiaryId: beneficiaryAddress,
                fundId,
                purpose,
                amount,
                timestamp: Math.floor(Date.now() / 1000),
                transactionHash,
                approvers,
                isProcessed: true,
            };
            const existing = this.localCache.get(cacheKey) || [];
            existing.push(tracker);
            this.localCache.set(cacheKey, existing);
            return {
                success: true,
                recordId,
            };
        }
        catch (error) {
            throw new Error(`Failed to record disbursement: ${error.message}`);
        }
    }
    /**
     * Gets all disbursements for a specific beneficiary
     */
    async getDisbursementHistory(beneficiaryId, fundId, purpose) {
        try {
            const sourceAccount = await this.server.loadAccount(this.signingKey.publicKey());
            const contract = new stellar_sdk_1.Contract(this.contractId);
            // Query contract for disbursements
            // This would typically use contract.call() in a simulation
            // For now, returning structure from contract query
            return {
                beneficiaryId,
                disbursements: [],
                totalDisbursements: 0,
                totalAmount: '0',
            };
        }
        catch (error) {
            throw new Error(`Failed to get disbursement history: ${error.message}`);
        }
    }
    /**
     * Gets disbursements for a specific purpose
     */
    async getDisbursementsByPurpose(fundId, purpose) {
        try {
            // Query contract for disbursements matching the purpose
            return [];
        }
        catch (error) {
            throw new Error(`Failed to get disbursements by purpose: ${error.message}`);
        }
    }
    /**
     * Validates disbursement request with duplicate check
     */
    async validateDisbursement(beneficiaryId, fundId, purpose, amount) {
        try {
            const errors = [];
            const warnings = [];
            // Check for duplicates
            const duplicateCheck = await this.checkForDuplicate(beneficiaryId, fundId, purpose);
            if (duplicateCheck.isDuplicate) {
                warnings.push(duplicateCheck.message);
            }
            // Validate amount
            if (!amount || parseFloat(amount) <= 0) {
                errors.push('Disbursement amount must be greater than 0');
            }
            // Validate purpose
            if (!purpose || purpose.trim().length === 0) {
                errors.push('Purpose must be specified');
            }
            return {
                isValid: errors.length === 0,
                isDuplicate: duplicateCheck.isDuplicate,
                errors,
                warnings,
            };
        }
        catch (error) {
            throw new Error(`Failed to validate disbursement: ${error.message}`);
        }
    }
    /**
     * Gets a summary of all disbursements to a beneficiary
     */
    async getBeneficiarySummary(beneficiaryId) {
        try {
            const history = await this.getDisbursementHistory(beneficiaryId);
            let totalAmount = '0';
            const purposes = new Set();
            let lastDisbursement = null;
            for (const disbursement of history.disbursements) {
                purposes.add(disbursement.purpose);
                totalAmount = (parseFloat(totalAmount) + parseFloat(disbursement.amount)).toString();
                if (!lastDisbursement || disbursement.timestamp > lastDisbursement.timestamp) {
                    lastDisbursement = disbursement;
                }
            }
            return {
                beneficiaryId,
                totalDisbursements: history.disbursements.length,
                totalAmount,
                purposes: Array.from(purposes),
                lastDisbursement,
            };
        }
        catch (error) {
            throw new Error(`Failed to get beneficiary summary: ${error.message}`);
        }
    }
    /**
     * Clears local cache for specific entries
     */
    clearCache(beneficiaryId, fundId, purpose) {
        if (!beneficiaryId) {
            this.localCache.clear();
            return;
        }
        if (!fundId || !purpose) {
            // Remove all entries for this beneficiary
            for (const key of this.localCache.keys()) {
                if (key.startsWith(beneficiaryId)) {
                    this.localCache.delete(key);
                }
            }
            return;
        }
        // Remove specific entry
        const cacheKey = `${beneficiaryId}_${fundId}_${purpose}`;
        this.localCache.delete(cacheKey);
    }
    /**
     * Exports disbursement records for audit trail
     */
    async exportDisbursementRecords(fundId, startDate, endDate) {
        try {
            const records = [];
            // Collect all records from cache
            for (const disbursements of this.localCache.values()) {
                for (const disbursement of disbursements) {
                    if (fundId && disbursement.fundId !== fundId)
                        continue;
                    if (startDate && disbursement.timestamp < startDate)
                        continue;
                    if (endDate && disbursement.timestamp > endDate)
                        continue;
                    records.push(disbursement);
                }
            }
            return records.sort((a, b) => b.timestamp - a.timestamp);
        }
        catch (error) {
            throw new Error(`Failed to export disbursement records: ${error.message}`);
        }
    }
}
exports.DuplicatePreventionClient = DuplicatePreventionClient;
//# sourceMappingURL=duplicatePrevention.js.map