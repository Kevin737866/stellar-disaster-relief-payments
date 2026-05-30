"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AidClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class AidClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.aidRegistry);
    }
    /**
     * Deploy emergency fund for disaster response
     */
    async deployEmergencyFund(adminKey, fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, releaseTriggers, requiredSignatures) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_fund", ...[
            new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId),
            (0, stellar_sdk_1.nativeToScVal)(name),
            (0, stellar_sdk_1.nativeToScVal)(description),
            (0, stellar_sdk_1.nativeToScVal)(totalAmount),
            (0, stellar_sdk_1.nativeToScVal)(disasterType),
            (0, stellar_sdk_1.nativeToScVal)(geographicScope),
            (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(releaseTriggers),
            (0, stellar_sdk_1.nativeToScVal)(requiredSignatures)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return fundId;
        }
        else {
            throw new Error(`Failed to deploy emergency fund: ${result.status}`);
        }
    }
    /**
     * Trigger disbursement with multi-sig approval
     */
    async triggerDisbursement(requesterKey, fundId, beneficiary, amount, purpose, approvers) {
        const requesterKeypair = stellar_sdk_1.Keypair.fromSecret(requesterKey);
        const requesterAccount = await this.server.getAccount(requesterKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(requesterAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("submit_disbursement", ...[
            new stellar_sdk_1.Address(requesterKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiary),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(purpose),
            (0, stellar_sdk_1.nativeToScVal)(approvers)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(requesterKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Disbursement submitted for fund ${fundId}`;
        }
        else {
            throw new Error(`Failed to submit disbursement: ${result.status}`);
        }
    }
    /**
     * Get fund details
     */
    async getFund(fundId) {
        try {
            const result = await this.contract.call("get_fund", (0, stellar_sdk_1.nativeToScVal)(fundId));
            const fundData = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return fundData;
        }
        catch (error) {
            console.error('Failed to get fund:', error);
            return null;
        }
    }
    /**
     * List all active emergency funds
     */
    async listActiveFunds() {
        try {
            const result = await this.contract.call("list_active_funds");
            const funds = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return funds;
        }
        catch (error) {
            console.error('Failed to list active funds:', error);
            return [];
        }
    }
    /**
     * Get disbursement history for a fund
     */
    async getDisbursements(fundId) {
        try {
            const result = await this.contract.call("get_disbursements", (0, stellar_sdk_1.nativeToScVal)(fundId));
            const disbursements = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return disbursements;
        }
        catch (error) {
            console.error('Failed to get disbursements:', error);
            return [];
        }
    }
    /**
     * Monitor fund pool status
     */
    async monitorFundPool(fundId) {
        const fund = await this.getFund(fundId);
        if (!fund) {
            throw new Error(`Fund ${fundId} not found`);
        }
        const totalAmount = BigInt(fund.totalAmount);
        const releasedAmount = BigInt(fund.releasedAmount);
        const remainingAmount = totalAmount - releasedAmount;
        return {
            totalAmount: fund.totalAmount,
            releasedAmount: fund.releasedAmount,
            remainingAmount: remainingAmount.toString(),
            isActive: fund.isActive,
            expiresAt: fund.expiresAt
        };
    }
    /**
     * Cleanup expired funds
     */
    async cleanupExpiredFunds(adminKey) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("cleanup_expired_funds"))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return 'Expired funds cleaned up successfully';
        }
        else {
            throw new Error(`Failed to cleanup expired funds: ${result.status}`);
        }
    }
    /**
     * Create multiple funds for large-scale disaster response
     */
    async deployRapidResponse(adminKey, disasterId, disasterType, affectedArea, totalBudget, fundCategories) {
        const fundIds = [];
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        for (const category of fundCategories) {
            const fundId = `${disasterId}_${category.name.toLowerCase().replace(/\s+/g, '_')}`;
            const amount = (BigInt(totalBudget) * BigInt(category.percentage) / BigInt(100)).toString();
            try {
                await this.deployEmergencyFund(adminKey, fundId, `${category.name} - ${disasterId}`, category.description, amount, disasterType, affectedArea, Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now
                [adminKeypair.publicKey()], 1);
                fundIds.push(fundId);
            }
            catch (error) {
                console.error(`Failed to create fund ${fundId}:`, error);
            }
        }
        return fundIds;
    }
    /**
     * Generate QR code for fund information (offline access)
     */
    generateFundQRCode(fundId, fund) {
        const qrData = {
            type: 'emergency_fund',
            fundId,
            name: fund.name,
            totalAmount: fund.totalAmount,
            disasterType: fund.disasterType,
            expiresAt: fund.expiresAt,
            timestamp: Date.now()
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate fund QR code
     */
    validateFundQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'emergency_fund') {
                return false;
            }
            // Check if QR code is expired
            if (data.expiresAt && Date.now() > data.expiresAt) {
                return false;
            }
            // Verify fund exists on chain
            return this.getFund(data.fundId).then(fund => fund !== null);
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Get fund statistics for reporting
     */
    async getFundStatistics(fundId) {
        const disbursements = await this.getDisbursements(fundId);
        const beneficiaries = new Set(disbursements.map(d => d.beneficiary));
        const totalAmount = disbursements.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
        const averageDisbursement = disbursements.length > 0
            ? (totalAmount / BigInt(disbursements.length)).toString()
            : '0';
        const lastDisbursement = disbursements.length > 0
            ? Math.max(...disbursements.map(d => d.timestamp))
            : null;
        return {
            totalDisbursements: disbursements.length,
            totalAmountDisbursed: totalAmount.toString(),
            averageDisbursement,
            lastDisbursement,
            beneficiariesReached: beneficiaries.size
        };
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return stellar_sdk_1.Networks.TESTNET;
            case 'mainnet':
                return stellar_sdk_1.Networks.PUBLIC;
            case 'standalone':
                return stellar_sdk_1.Networks.STANDALONE;
            default:
                throw new Error('Unsupported network');
        }
    }
}
exports.AidClient = AidClient;
//# sourceMappingURL=aidClient.js.map