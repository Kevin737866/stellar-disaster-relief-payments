"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmergencyFundsClient = void 0;
exports.decodeRecalledAmount = decodeRecalledAmount;
const stellar_sdk_1 = require("stellar-sdk");
const errors_1 = require("./errors");
const retry_1 = require("./retry");
const validation_1 = require("./validation");
/**
 * Decodes the recalled amount from a Soroban transaction response.
 *
 * The `recall_unused_funds` contract function returns an i128 representing the
 * number of stroops recalled. `scValToNative` converts it to a BigInt; we
 * stringify it to preserve exact integer semantics across all magnitudes.
 *
 * Throws if the return value is absent or is not a numeric type, so callers
 * always see an explicit error rather than a silent zero.
 */
function decodeRecalledAmount(response) {
    try {
        const meta = response.resultMetaXdr;
        if (!meta) {
            throw new Error('resultMetaXdr is absent from transaction response');
        }
        // TransactionMeta v3 carries per-operation Soroban return values.
        const v3 = typeof meta.v3 === 'function' ? meta.v3() : meta.v3;
        if (!v3) {
            throw new Error('resultMetaXdr has no v3 field');
        }
        const sorobanMeta = typeof v3.sorobanMeta === 'function' ? v3.sorobanMeta() : v3.sorobanMeta;
        if (!sorobanMeta) {
            throw new Error('v3 metadata has no sorobanMeta field');
        }
        const returnVal = typeof sorobanMeta.returnValue === 'function'
            ? sorobanMeta.returnValue()
            : sorobanMeta.returnValue;
        if (returnVal === undefined || returnVal === null) {
            throw new Error('sorobanMeta has no returnValue');
        }
        const native = (0, stellar_sdk_1.scValToNative)(returnVal);
        if (typeof native === 'bigint') {
            return native.toString();
        }
        if (typeof native === 'number') {
            // Guard against floating-point imprecision for large amounts.
            if (!Number.isInteger(native)) {
                throw new Error(`contract returned non-integer numeric value: ${native}`);
            }
            return String(native);
        }
        if (typeof native === 'string') {
            // Accept a string only when it represents a valid integer.
            if (!/^-?\d+$/.test(native)) {
                throw new Error(`contract returned non-integer string value: "${native}"`);
            }
            return native;
        }
        throw new Error(`unexpected return value type: ${typeof native} (value: ${native})`);
    }
    catch (error) {
        throw new errors_1.NetworkError('decode recalled amount', error.message, { responseHash: response?.hash });
    }
}
/**
 * Emergency Fund SDK Client
 * Manages creation, deployment, monitoring, and execution of emergency funds
 * with multi-sig releases and automated trigger execution
 */
class EmergencyFundsClient {
    constructor(contractId, signingKey, server, networkPassphrase = stellar_sdk_1.Networks.TESTNET) {
        this.contractId = contractId;
        this.signingKey = signingKey;
        this.server = server;
        this.networkPassphrase = networkPassphrase;
    }
    /**
     * Creates an emergency fund with pre-positioned capital and defined triggers
     * Enables rapid response to disasters
     */
    async createFund(adminAddress, fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, signersArray, requiredSignatures, metadata = {}) {
        (0, validation_1.validateAddress)(adminAddress, 'adminAddress');
        (0, validation_1.validateAddressList)(signersArray, 'signersArray');
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(adminAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('create_fund', new stellar_sdk_1.Address(adminAddress), fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, signersArray.map(s => new stellar_sdk_1.Address(s)), requiredSignatures, metadata))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
                fundId,
            };
        }
        catch (error) {
            throw new errors_1.FundCreationError(fundId, error.message, { adminAddress, disasterType, geographicScope });
        }
    }
    /**
     * Adds an automated trigger to a fund
     * Trigger can be based on seismic, weather, conflict, or health events
     */
    async addTrigger(adminAddress, fundId, triggerId, triggerType, threshold, oracleSource, autoReleaseAmount, geofenceLatitude, geofenceLongitude, geofenceRadiusKm, minOracleConfirmations) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(adminAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('add_trigger', new stellar_sdk_1.Address(adminAddress), fundId, triggerId, triggerType, threshold, oracleSource, autoReleaseAmount, Math.floor(geofenceLatitude * 1e6), Math.floor(geofenceLongitude * 1e6), geofenceRadiusKm, minOracleConfirmations))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new Error(`Trigger addition failed: ${error.message}`);
        }
    }
    /**
     * Submits oracle data to trigger verification
     * Multi-source verification prevents manipulation
     */
    async submitOracleData(oracleAddress, fundId, triggerId, dataType, value, location, confidence) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(oracleAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('submit_oracle_data', new stellar_sdk_1.Address(oracleAddress), fundId, triggerId, dataType, value, location, confidence))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new Error(`Oracle data submission failed: ${error.message}`);
        }
    }
    /**
     * Executes automated trigger release
     * Called when oracle conditions are met and confirmations received
     */
    async executeTrigger(fundId, triggerId, signerAddress) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(signerAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('execute_trigger', fundId, triggerId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                fundId,
                triggerId,
                amountReleased: '0', // Would come from contract response
                timestamp: Date.now(),
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new errors_1.TriggerExecutionError(triggerId, fundId, error.message, { signerAddress });
        }
    }
    /**
     * Executes batch multi-sig release for multiple beneficiaries atomically.
     * All entries succeed or all fail.
     *
     * @param fundId    Fund to draw from
     * @param entries   Array of { beneficiary, amount, purpose }
     * @param approvers Keypairs of multi-sig approvers
     */
    async executeBatchMultiSigRelease(fundId, entries, approvers) {
        if (entries.length === 0) {
            throw new Error('Batch must contain at least one entry');
        }
        try {
            const primaryAccount = await this.server.loadAccount(approvers[0].publicKey());
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(primaryAccount, {
                fee: String(Number(stellar_sdk_1.BASE_FEE) * approvers.length),
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('submit_batch_disbursement', new stellar_sdk_1.Address(approvers[0].publicKey()), fundId, entries.map(e => [new stellar_sdk_1.Address(e.beneficiary), e.amount, e.purpose]), approvers.map(a => new stellar_sdk_1.Address(a.publicKey()))))
                .setTimeout(300)
                .build();
            for (const approver of approvers) {
                transaction.sign(approver);
            }
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
                count: entries.length,
            };
        }
        catch (error) {
            throw new Error(`Batch multi-sig release failed: ${error.message}`);
        }
    }
    /**
     * Executes multi-sig manual release requiring 2-of-3 approvals
     * Requires authorization from NGO, government, or UN representatives
     */
    async executeMultiSigRelease(fundId, beneficiary, amount, purpose, approvers) {
        try {
            const primaryAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(approvers[0].publicKey()));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(primaryAccount, {
                fee: String(Number(stellar_sdk_1.BASE_FEE) * approvers.length),
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('execute_multi_sig_release', fundId, new stellar_sdk_1.Address(beneficiary), amount, purpose, approvers.map(a => new stellar_sdk_1.Address(a.publicKey()))))
                .setTimeout(300)
                .build();
            // Sign with all approvers
            for (const approver of approvers) {
                transaction.sign(approver);
            }
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            if (error.message?.includes('Insufficient approvals')) {
                throw new errors_1.InsufficientApprovalsError(fundId, approvers.length, 0, { beneficiary, amount });
            }
            if (error.message?.includes('Unauthorized')) {
                throw new errors_1.UnauthorizedApproverError(fundId, approvers[0].publicKey(), { beneficiary });
            }
            throw new errors_1.NetworkError('multi-sig release', error.message, { fundId, beneficiary, amount });
        }
    }
    /**
     * Allocates funds to specific sectors with beneficiary tracking
     */
    async allocateFunds(adminAddress, fundId, sector, amount, beneficiaries, proofOfNeed, minAmount, maxAmount) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(adminAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('allocate_funds', new stellar_sdk_1.Address(adminAddress), fundId, sector, amount, beneficiaries.map(b => new stellar_sdk_1.Address(b)), proofOfNeed, minAmount, maxAmount))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            if (error.message?.includes('below minimum')) {
                throw new errors_1.AllocationBelowMinimumError(fundId, sector, amount, minAmount, { adminAddress });
            }
            if (error.message?.includes('exceeds maximum')) {
                throw new errors_1.AllocationExceedsMaximumError(fundId, sector, amount, maxAmount, { adminAddress });
            }
            throw new errors_1.AllocationError(fundId, sector, error.message, { adminAddress, amount, beneficiaries });
        }
    }
    /**
     * Retrieves current status and metrics of an emergency fund
     */
    async getFundStatus(fundId) {
        try {
            const contract = new stellar_sdk_1.Contract(this.contractId);
            // Note: This would typically use contract.call() in a simulation
            // For now, returning a placeholder structure
            return {
                status: 'active',
                totalAmount: '0',
                releasedAmount: '0',
                availableAmount: '0',
                beneficiaryCount: 0,
            };
        }
        catch (error) {
            throw new errors_1.NetworkError('get fund status', error.message, { fundId });
        }
    }
    /**
     * Gets all triggers configured for a fund
     */
    async getFundTriggers(fundId) {
        try {
            // Query contract for triggers
            return [];
        }
        catch (error) {
            throw new errors_1.NetworkError('get fund triggers', error.message, { fundId });
        }
    }
    /**
     * Gets all allocations for a fund
     */
    async getFundAllocations(fundId) {
        try {
            // Query contract for allocations
            return [];
        }
        catch (error) {
            throw new errors_1.NetworkError('get fund allocations', error.message, { fundId });
        }
    }
    /**
     * Gets disbursement history for a fund with pagination
     */
    async getDisbursementHistory(fundId, offset = 0, limit = 50) {
        try {
            const contract = new stellar_sdk_1.Contract(this.contractId);
            // Note: This would typically use contract.call() in a simulation
            // For now, returning a placeholder structure
            return {
                records: [],
                totalCount: 0,
                hasMore: false,
            };
        }
        catch (error) {
            throw new errors_1.NetworkError('get disbursement history', error.message, { fundId, offset, limit });
        }
    }
    /**
     * Recalls unused funds after 12 month period.
     * Returns the amount confirmed by the contract, decoded from the transaction
     * result metadata. Throws NetworkError when the transaction fails or when
     * the contract return value cannot be decoded (a failed recall is never
     * silently reported as a zero recall).
     */
    async recallUnusedFunds(donorAddress, fundId) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(donorAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('recall_unused_funds', new stellar_sdk_1.Address(donorAddress), fundId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            // A non-successful status means the recall did not execute; never report
            // that as a zero amount.
            if (response.status && response.status !== 'SUCCESS') {
                throw new errors_1.NetworkError('recall unused funds', `transaction status ${response.status}`, { fundId, donorAddress });
            }
            const recalledAmount = decodeRecalledAmount(response);
            return {
                success: true,
                recalledAmount,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            if (error instanceof errors_1.NetworkError)
                throw error;
            throw new errors_1.NetworkError('recall unused funds', error.message, { fundId, donorAddress });
        }
    }
    /**
     * Enables recall capability for a fund
     */
    async enableRecall(adminAddress, fundId) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(adminAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('enable_recall', new stellar_sdk_1.Address(adminAddress), fundId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new errors_1.NetworkError('enable recall', error.message, { fundId, adminAddress });
        }
    }
    /**
     * Deactivates a trigger
     */
    async deactivateTrigger(adminAddress, fundId, triggerId) {
        try {
            const sourceAccount = await (0, retry_1.withRetry)(() => this.server.loadAccount(adminAddress));
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('deactivate_trigger', new stellar_sdk_1.Address(adminAddress), fundId, triggerId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await (0, retry_1.withRetry)(() => this.server.submitTransaction(transaction));
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new errors_1.TriggerExecutionError(triggerId, fundId, error.message, { adminAddress });
        }
    }
    /**
     * Updates metadata for a fund
     */
    async updateMetadata(adminAddress, fundId, metadata) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('update_metadata', new stellar_sdk_1.Address(adminAddress), fundId, metadata))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new errors_1.NetworkError('update metadata', error.message, { fundId, adminAddress });
        }
    }
    /**
     * Gets metadata for a fund
     */
    async getMetadata(fundId) {
        try {
            const contract = new stellar_sdk_1.Contract(this.contractId);
            // Note: This would typically use contract.call() in a simulation
            // For now, returning a placeholder structure
            return {};
        }
        catch (error) {
            throw new errors_1.NetworkError('get fund metadata', error.message, { fundId });
        }
    }
    /**
     * Monitors oracle data feeds for trigger validation
     * Implements multi-source verification to prevent manipulation
     */
    async monitorOracleFeeds(fundId, triggerId) {
        try {
            // Fetch from multiple oracle sources
            const oracleEntries = [];
            // Implementation would query actual oracle data
            return oracleEntries;
        }
        catch (error) {
            throw new errors_1.NetworkError('monitor oracle feeds', error.message, { fundId, triggerId });
        }
    }
    /**
     * Generates impact report with beneficiary count and sector breakdown
     */
    async generateImpactReport(fundId) {
        try {
            const allocations = await this.getFundAllocations(fundId);
            const disbursements = await this.getDisbursementHistory(fundId);
            const sectorBreakdown = {};
            let totalBeneficiaries = 0;
            let amountDistributed = '0';
            for (const allocation of allocations) {
                sectorBreakdown[allocation.sector] = allocation.beneficiaries.length;
                totalBeneficiaries += allocation.beneficiaries.length;
            }
            return {
                fundId,
                totalBeneficiaries,
                sectorBreakdown,
                amountDistributed,
                transactionCount: disbursements.records.length,
            };
        }
        catch (error) {
            throw new errors_1.NetworkError('generate impact report', error.message, { fundId });
        }
    }
    /**
     * Transfers unused funds from one disaster fund to another
     * Enables reallocation of resources to more pressing needs
     */
    async transferFundsBetweenDisasters(adminAddress, sourceFundId, destinationFundId, amount, reason) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('transfer_funds_between_disasters', new stellar_sdk_1.Address(adminAddress), sourceFundId, destinationFundId, amount, reason))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
                transferAmount: amount,
            };
        }
        catch (error) {
            throw new Error(`Fund transfer between disasters failed: ${error.message}`);
        }
    }
}
exports.EmergencyFundsClient = EmergencyFundsClient;
//# sourceMappingURL=emergencyFunds.js.map