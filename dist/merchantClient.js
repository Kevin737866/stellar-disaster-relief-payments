"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
class MerchantClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.merchantNetwork);
    }
    /**
     * Register local merchant for relief network
     */
    async registerMerchant(ownerKey, merchantId, request) {
        const ownerKeypair = stellar_sdk_1.Keypair.fromSecret(ownerKey);
        const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(ownerAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("register_merchant", ...[
            new stellar_sdk_1.Address(ownerKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(request.name),
            (0, stellar_sdk_1.nativeToScVal)(request.businessType),
            (0, stellar_sdk_1.nativeToScVal)(request.location),
            (0, stellar_sdk_1.nativeToScVal)(request.contactInfo),
            (0, stellar_sdk_1.nativeToScVal)(request.stellarTomlUrl),
            (0, stellar_sdk_1.nativeToScVal)(request.acceptedTokens),
            (0, stellar_sdk_1.nativeToScVal)(request.dailyLimit),
            (0, stellar_sdk_1.nativeToScVal)(request.monthlyLimit),
            (0, stellar_sdk_1.nativeToScVal)(request.verificationDocuments)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(ownerKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Merchant ${merchantId} registered successfully. Awaiting verification.`;
        }
        else {
            throw new Error(`Failed to register merchant: ${result.status}`);
        }
    }
    /**
     * Verify merchant (by authorized verifier)
     */
    async verifyMerchant(verifierKey, merchantId, approved, notes) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(verifierAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("verify_merchant", ...[
            new stellar_sdk_1.Address(verifierKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(approved),
            (0, stellar_sdk_1.nativeToScVal)(notes)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(verifierKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return approved
                ? `Merchant ${merchantId} verified and activated`
                : `Merchant ${merchantId} verification rejected`;
        }
        else {
            throw new Error(`Failed to verify merchant: ${result.status}`);
        }
    }
    /**
     * Process payment from beneficiary to merchant
     */
    async processPayment(merchantKey, beneficiaryKey, merchantId, beneficiaryId, amount, token, purpose) {
        const merchantKeypair = stellar_sdk_1.Keypair.fromSecret(merchantKey);
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(merchantAccount, {
            fee: '200', // Higher fee for multi-sig
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("process_payment", ...[
            new stellar_sdk_1.Address(merchantKeypair.publicKey()).toScVal(),
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(token),
            (0, stellar_sdk_1.nativeToScVal)(purpose)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(merchantKeypair);
        tx.sign(beneficiaryKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to process payment: ${result.status}`);
        }
    }
    /**
     * Get merchant details
     */
    async getMerchant(merchantId) {
        try {
            const result = await this.contract.call("get_merchant", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            const merchant = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return merchant;
        }
        catch (error) {
            console.error('Failed to get merchant:', error);
            return null;
        }
    }
    /**
     * Find merchants by location (geographic search)
     */
    async findMerchantsByLocation(latitude, longitude, radiusKm) {
        try {
            const result = await this.contract.call("find_merchants_by_location", (0, stellar_sdk_1.nativeToScVal)(latitude), (0, stellar_sdk_1.nativeToScVal)(longitude), (0, stellar_sdk_1.nativeToScVal)(radiusKm));
            const merchants = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return merchants;
        }
        catch (error) {
            console.error('Failed to find merchants by location:', error);
            return [];
        }
    }
    /**
     * Get merchant transaction history
     */
    async getMerchantTransactions(merchantId) {
        try {
            const result = await this.contract.call("get_merchant_transactions", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            const transactions = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return transactions;
        }
        catch (error) {
            console.error('Failed to get merchant transactions:', error);
            return [];
        }
    }
    /**
     * Update merchant reputation based on feedback
     */
    async updateReputation(adminKey, merchantId, feedbackScore // -10 to +10
    ) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("update_reputation", ...[
            new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(feedbackScore)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Reputation updated for merchant ${merchantId}`;
        }
        else {
            throw new Error(`Failed to update reputation: ${result.status}`);
        }
    }
    /**
     * Get verification queue
     */
    async getVerificationQueue() {
        try {
            const result = await this.contract.call("get_verification_queue");
            const queue = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return queue;
        }
        catch (error) {
            console.error('Failed to get verification queue:', error);
            return [];
        }
    }
    /**
     * Generate QR code for merchant identification
     */
    generateMerchantQRCode(merchantId, merchant) {
        const qrData = {
            type: 'merchant',
            merchantId,
            name: merchant.name,
            businessType: merchant.businessType,
            location: merchant.location,
            acceptedTokens: merchant.acceptedTokens,
            reputationScore: merchant.reputationScore,
            stellarTomlUrl: merchant.stellarTomlUrl,
            timestamp: Date.now()
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate merchant QR code
     */
    async validateMerchantQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'merchant') {
                return false;
            }
            // Verify merchant exists and is active
            const merchant = await this.getMerchant(data.merchantId);
            return merchant !== null && merchant.isActive;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Discover merchants using Stellar TOML
     */
    async discoverMerchantsFromStellarToml(domain) {
        try {
            // Fetch Stellar TOML file
            const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
            const response = await fetch(tomlUrl);
            const tomlData = await response.text();
            // Parse TOML and extract merchant information
            // This is a simplified implementation
            const merchants = [];
            // In production, use a proper TOML parser
            const lines = tomlData.split('\n');
            let currentSection = '';
            for (const line of lines) {
                if (line.startsWith('[')) {
                    currentSection = line.slice(1, -1);
                }
                else if (currentSection === 'MERCHANTS' && line.includes('=')) {
                    const [key, value] = line.split('=').map(s => s.trim());
                    if (key === 'name') {
                        // Create merchant from TOML data
                        merchants.push({
                            id: `toml_${Date.now()}`,
                            name: value.replace(/"/g, ''),
                            owner: '',
                            businessType: 'general',
                            location: {
                                latitude: 0,
                                longitude: 0,
                                address: '',
                                city: '',
                                country: '',
                                postalCode: ''
                            },
                            contactInfo: '',
                            registrationDate: Date.now(),
                            isVerified: false,
                            verificationDocuments: [],
                            stellarTomlUrl: tomlUrl,
                            acceptedTokens: ['XLM'],
                            dailyLimit: '1000',
                            monthlyLimit: '10000',
                            currentMonthVolume: '0',
                            reputationScore: 50,
                            isActive: false
                        });
                    }
                }
            }
            return merchants;
        }
        catch (error) {
            console.error('Failed to discover merchants from TOML:', error);
            return [];
        }
    }
    /**
     * Create merchant onboarding request template
     */
    createOnboardingRequest(name, businessType, location, contactInfo, stellarAddress) {
        return {
            name,
            businessType,
            location,
            contactInfo,
            stellarTomlUrl: `https://stellar.expert/explorer/testnet/account/${stellarAddress}`,
            acceptedTokens: ['XLM'], // Default to XLM
            dailyLimit: '1000', // Default limits
            monthlyLimit: '10000',
            verificationDocuments: [] // Will be uploaded separately
        };
    }
    /**
     * Get merchant statistics
     */
    async getMerchantStatistics(merchantId) {
        const transactions = await this.getMerchantTransactions(merchantId);
        const merchant = await this.getMerchant(merchantId);
        if (!merchant) {
            throw new Error(`Merchant ${merchantId} not found`);
        }
        const totalTransactions = transactions.length;
        const totalVolume = transactions.reduce((sum, tx) => sum + BigInt(tx.amount), BigInt(0));
        const averageTransaction = totalTransactions > 0
            ? (totalVolume / BigInt(totalTransactions)).toString()
            : '0';
        const monthlyLimit = BigInt(merchant.monthlyLimit);
        const currentVolume = BigInt(merchant.currentMonthVolume);
        const monthlyUtilization = monthlyLimit > 0
            ? Number((currentVolume * BigInt(100)) / monthlyLimit)
            : 0;
        return {
            totalTransactions,
            totalVolume: totalVolume.toString(),
            averageTransaction,
            reputationScore: merchant.reputationScore,
            monthlyUtilization
        };
    }
    /**
     * Batch verify merchants
     */
    async batchVerifyMerchants(verifierKey, merchantIds, approved, notes) {
        const results = [];
        for (const merchantId of merchantIds) {
            try {
                const result = await this.verifyMerchant(verifierKey, merchantId, approved, notes);
                results.push(result);
            }
            catch (error) {
                results.push(`Failed to verify ${merchantId}: ${error}`);
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
exports.MerchantClient = MerchantClient;
//# sourceMappingURL=merchantClient.js.map