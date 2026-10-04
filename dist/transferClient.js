"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class TransferClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.cashTransfer);
    }
    /**
     * Create conditional cash transfer
     */
    async createTransfer(creatorKey, transferId, beneficiaryId, amount, token, expiresAt, spendingRules, purpose) {
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_transfer", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(token),
            (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(spendingRules),
            (0, stellar_sdk_1.nativeToScVal)(purpose)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Conditional transfer ${transferId} created successfully`;
        }
        else {
            throw new Error(`Failed to create transfer: ${result.status}`);
        }
    }
    /**
     * Attempt to spend from conditional transfer
     */
    async spend(beneficiaryKey, transferId, merchantId, amount, category, location) {
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const beneficiaryAccount = await this.server.getAccount(beneficiaryKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(beneficiaryAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("spend", ...[
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(category),
            (0, stellar_sdk_1.nativeToScVal)(location)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(beneficiaryKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to process spend: ${result.status}`);
        }
    }
    /**
     * Get transfer details
     */
    async getTransfer(transferId) {
        try {
            const result = await this.contract.call("get_transfer", (0, stellar_sdk_1.nativeToScVal)(transferId));
            const transfer = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return transfer;
        }
        catch (error) {
            console.error('Failed to get transfer:', error);
            return null;
        }
    }
    /**
     * Get transaction history for a transfer
     */
    async getTransactions(transferId) {
        try {
            const result = await this.contract.call("get_transactions", (0, stellar_sdk_1.nativeToScVal)(transferId));
            const transactions = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return transactions;
        }
        catch (error) {
            console.error('Failed to get transactions:', error);
            return [];
        }
    }
    /**
     * Recall unspent funds after expiry
     */
    async recallFunds(creatorKey, transferId) {
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("recall_funds", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            const recalledAmount = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return `Recalled ${recalledAmount} units from transfer ${transferId}`;
        }
        else {
            throw new Error(`Failed to recall funds: ${result.status}`);
        }
    }
    /**
     * List active transfers for a beneficiary
     */
    async listBeneficiaryTransfers(beneficiaryId) {
        try {
            const result = await this.contract.call("list_beneficiary_transfers", (0, stellar_sdk_1.nativeToScVal)(beneficiaryId));
            const transfers = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return transfers;
        }
        catch (error) {
            console.error('Failed to list beneficiary transfers:', error);
            return [];
        }
    }
    /**
     * Extend transfer expiry
     */
    async extendExpiry(creatorKey, transferId, newExpiry) {
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await this.server.getAccount(creatorKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("extend_expiry", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(newExpiry)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Transfer ${transferId} expiry extended to ${new Date(newExpiry).toISOString()}`;
        }
        else {
            throw new Error(`Failed to extend expiry: ${result.status}`);
        }
    }
    /**
     * Create spending rules for conditional transfers
     */
    createSpendingRules(rules) {
        return rules.map(rule => ({
            ruleType: rule.type,
            parameters: rule.parameters,
            limit: rule.limit,
            currentUsage: '0'
        }));
    }
    /**
     * Create category limit rule
     */
    createCategoryLimitRule(category, limit) {
        return {
            ruleType: 'category_limit',
            parameters: {
                category
            },
            limit,
            currentUsage: '0'
        };
    }
    /**
     * Create time window rule
     */
    createTimeWindowRule(startTime, endTime) {
        return {
            ruleType: 'time_window',
            parameters: {
                start_time: startTime.toString(),
                end_time: endTime.toString()
            },
            limit: '0', // No limit, just time restriction
            currentUsage: '0'
        };
    }
    /**
     * Create location-based rule
     */
    createLocationRule(allowedLocation) {
        return {
            ruleType: 'location_based',
            parameters: {
                location: allowedLocation
            },
            limit: '0', // No limit, just location restriction
            currentUsage: '0'
        };
    }
    /**
     * Generate QR code for conditional transfer
     */
    generateTransferQRCode(transferId, transfer) {
        const qrData = {
            type: 'transfer',
            transferId,
            beneficiaryId: transfer.beneficiaryId,
            amount: transfer.amount,
            remainingAmount: transfer.remainingAmount,
            token: transfer.token,
            purpose: transfer.purpose,
            spendingRules: transfer.spendingRules.map(rule => ({
                type: rule.ruleType,
                limit: rule.limit
            })),
            expiresAt: transfer.expiresAt,
            timestamp: Date.now()
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate transfer QR code
     */
    async validateTransferQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'transfer') {
                return false;
            }
            // Verify transfer exists and is active
            const transfer = await this.getTransfer(data.transferId);
            return transfer !== null && transfer.isActive;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Create emergency transfer template
     */
    createEmergencyTransfer(beneficiaryId, amount, disasterType) {
        const transferId = `emergency_${beneficiaryId}_${Date.now()}`;
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        // Default emergency spending rules
        const spendingRules = [
            this.createCategoryLimitRule('food', (BigInt(amount) * BigInt(60) / BigInt(100)).toString()),
            this.createCategoryLimitRule('medicine', (BigInt(amount) * BigInt(30) / BigInt(100)).toString()),
            this.createCategoryLimitRule('shelter', (BigInt(amount) * BigInt(10) / BigInt(100)).toString()),
            this.createTimeWindowRule(Date.now(), Date.now() + (7 * 24 * 60 * 60 * 1000))
        ];
        const transfer = {
            id: transferId,
            beneficiaryId,
            amount,
            token: 'XLM',
            createdAt: Date.now(),
            expiresAt,
            spendingRules,
            isActive: true,
            spentAmount: '0',
            remainingAmount: amount,
            creator: 'emergency_system',
            purpose: `Emergency assistance for ${disasterType}`
        };
        return { transferId, transfer };
    }
    /**
     * Process payment request with validation
     */
    async processPaymentRequest(request, beneficiaryKey) {
        try {
            // Find active transfer for beneficiary
            const transfers = await this.listBeneficiaryTransfers(request.beneficiaryId);
            if (transfers.length === 0) {
                return {
                    success: false,
                    error: 'No active transfers found for beneficiary'
                };
            }
            // Try to spend from the first available transfer
            const transfer = transfers[0];
            const success = await this.spend(beneficiaryKey, transfer.id, request.merchantId, request.amount, 'general', // Default category
            request.location || 'unknown');
            if (success) {
                return {
                    success: true,
                    transactionId: `txn_${transfer.id}_${Date.now()}`
                };
            }
            else {
                return {
                    success: false,
                    error: 'Payment rejected by spending rules'
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: `Payment processing failed: ${error}`
            };
        }
    }
    /**
     * Get transfer statistics
     */
    async getTransferStatistics(transferId) {
        const transfer = await this.getTransfer(transferId);
        const transactions = await this.getTransactions(transferId);
        if (!transfer) {
            throw new Error(`Transfer ${transferId} not found`);
        }
        const totalSpent = transfer.spentAmount;
        const remainingAmount = transfer.remainingAmount;
        const totalAmount = transfer.amount;
        const utilizationRate = Number((BigInt(totalSpent) * BigInt(100)) / BigInt(totalAmount));
        const transactionCount = transactions.length;
        const averageTransaction = transactionCount > 0
            ? (BigInt(totalSpent) / BigInt(transactionCount)).toString()
            : '0';
        const isExpired = Date.now() > transfer.expiresAt;
        return {
            totalSpent,
            remainingAmount,
            utilizationRate,
            transactionCount,
            averageTransaction,
            isExpired
        };
    }
    /**
     * Batch create transfers for disaster response
     */
    async batchCreateTransfers(creatorKey, beneficiaryIds, amount, purpose, spendingRules) {
        const results = [];
        for (const beneficiaryId of beneficiaryIds) {
            const transferId = `batch_${beneficiaryId}_${Date.now()}`;
            const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
            try {
                const result = await this.createTransfer(creatorKey, transferId, beneficiaryId, amount, 'XLM', expiresAt, spendingRules, purpose);
                results.push(result);
            }
            catch (error) {
                results.push(`Failed to create transfer for ${beneficiaryId}: ${error}`);
            }
        }
        return results;
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return 'Test SDF Network ; September 2015';
            case 'mainnet':
                return 'Public Global Stellar Network ; September 2015';
            case 'standalone':
                return 'Standalone Network ; February 2017';
            default:
                throw new Error('Unsupported network');
        }
    }
}
exports.TransferClient = TransferClient;
//# sourceMappingURL=transferClient.js.map