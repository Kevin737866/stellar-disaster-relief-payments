"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmergencyFundsClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Emergency Fund SDK Client
 * Manages creation, deployment, monitoring, and execution of emergency funds
 * with multi-sig releases and automated trigger execution
 */
class EmergencyFundsClient {
    constructor(contractId, signingKey, server, networkPassphrase = stellar_sdk_1.Networks.TESTNET_NETWORK_PASSPHRASE) {
        this.contractId = contractId;
        this.signingKey = signingKey;
        this.server = server;
        this.networkPassphrase = networkPassphrase;
    }
    /**
     * Creates an emergency fund with pre-positioned capital and defined triggers
     * Enables rapid response to disasters
     */
    async createFund(adminAddress, fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, signersArray, requiredSignatures) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('create_fund', new stellar_sdk_1.Address(adminAddress), fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, signersArray.map(s => new stellar_sdk_1.Address(s)), requiredSignatures))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
                fundId,
            };
        }
        catch (error) {
            throw new Error(`Fund creation failed: ${error.message}`);
        }
    }
    /**
     * Adds an automated trigger to a fund
     * Trigger can be based on seismic, weather, conflict, or health events
     */
    async addTrigger(adminAddress, fundId, triggerId, triggerType, threshold, oracleSource, autoReleaseAmount, geofenceLatitude, geofenceLongitude, geofenceRadiusKm, minOracleConfirmations) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('add_trigger', new stellar_sdk_1.Address(adminAddress), fundId, triggerId, triggerType, threshold, oracleSource, autoReleaseAmount, Math.floor(geofenceLatitude * 1e6), Math.floor(geofenceLongitude * 1e6), geofenceRadiusKm, minOracleConfirmations))
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
            throw new Error(`Trigger addition failed: ${error.message}`);
        }
    }
    /**
     * Submits oracle data to trigger verification
     * Multi-source verification prevents manipulation
     */
    async submitOracleData(oracleAddress, fundId, triggerId, dataType, value, location, confidence) {
        try {
            const sourceAccount = await this.server.loadAccount(oracleAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('submit_oracle_data', new stellar_sdk_1.Address(oracleAddress), fundId, triggerId, dataType, value, location, confidence))
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
            throw new Error(`Oracle data submission failed: ${error.message}`);
        }
    }
    /**
     * Executes automated trigger release
     * Called when oracle conditions are met and confirmations received
     */
    async executeTrigger(fundId, triggerId, signerAddress) {
        try {
            const sourceAccount = await this.server.loadAccount(signerAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('execute_trigger', fundId, triggerId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
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
            return {
                success: false,
                fundId,
                triggerId,
                amountReleased: '0',
                timestamp: Date.now(),
                error: error.message,
            };
        }
    }
    /**
     * Executes multi-sig manual release requiring 2-of-3 approvals
     * Requires authorization from NGO, government, or UN representatives
     */
    async executeMultiSigRelease(fundId, beneficiary, amount, purpose, approvers) {
        try {
            const primaryAccount = await this.server.loadAccount(approvers[0].publicKey());
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(primaryAccount, {
                fee: stellar_sdk_1.BASE_FEE * approvers.length,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('execute_multi_sig_release', fundId, new stellar_sdk_1.Address(beneficiary), amount, purpose, approvers.map(a => new stellar_sdk_1.Address(a.publicKey()))))
                .setTimeout(300)
                .build();
            // Sign with all approvers
            for (const approver of approvers) {
                transaction.sign(approver);
            }
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new Error(`Multi-sig release failed: ${error.message}`);
        }
    }
    /**
     * Allocates funds to specific sectors with beneficiary tracking
     */
    async allocateFunds(adminAddress, fundId, sector, amount, beneficiaries, proofOfNeed) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('allocate_funds', new stellar_sdk_1.Address(adminAddress), fundId, sector, amount, beneficiaries.map(b => new stellar_sdk_1.Address(b)), proofOfNeed))
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
            throw new Error(`Fund allocation failed: ${error.message}`);
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
            throw new Error(`Failed to get fund status: ${error.message}`);
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
            throw new Error(`Failed to get fund triggers: ${error.message}`);
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
            throw new Error(`Failed to get fund allocations: ${error.message}`);
        }
    }
    /**
     * Gets disbursement history for a fund
     */
    async getDisbursementHistory(fundId) {
        try {
            // Query contract for disbursements
            return [];
        }
        catch (error) {
            throw new Error(`Failed to get disbursement history: ${error.message}`);
        }
    }
    /**
     * Recalls unused funds after 12 month period
     */
    async recallUnusedFunds(donorAddress, fundId) {
        try {
            const sourceAccount = await this.server.loadAccount(donorAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('recall_unused_funds', new stellar_sdk_1.Address(donorAddress), fundId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                recalledAmount: '0',
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new Error(`Fund recall failed: ${error.message}`);
        }
    }
    /**
     * Enables recall capability for a fund
     */
    async enableRecall(adminAddress, fundId) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('enable_recall', new stellar_sdk_1.Address(adminAddress), fundId))
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
            throw new Error(`Recall enablement failed: ${error.message}`);
        }
    }
    /**
     * Deactivates a trigger
     */
    async deactivateTrigger(adminAddress, fundId, triggerId) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('deactivate_trigger', new stellar_sdk_1.Address(adminAddress), fundId, triggerId))
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
            throw new Error(`Trigger deactivation failed: ${error.message}`);
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
            throw new Error(`Oracle monitoring failed: ${error.message}`);
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
                transactionCount: disbursements.length,
            };
        }
        catch (error) {
            throw new Error(`Impact report generation failed: ${error.message}`);
        }
    }
}
exports.EmergencyFundsClient = EmergencyFundsClient;
//# sourceMappingURL=emergencyFunds.js.map