"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantNetworkSDK = exports.PAYMENT_ONLINE = exports.PAYMENT_OFFLINE = exports.PAYMENT_NFC = exports.PAYMENT_USSD = exports.PAYMENT_QR = exports.STATUS_GRADUATED = exports.STATUS_SUSPENDED = exports.STATUS_ACTIVE = exports.STATUS_TRIAL = exports.STATUS_PENDING = exports.CATEGORY_FUEL = exports.CATEGORY_CLOTHING = exports.CATEGORY_MEDICAL = exports.CATEGORY_SHELTER = exports.CATEGORY_WATER = exports.CATEGORY_FOOD = void 0;
const stellar_sdk_1 = require("stellar-sdk");
// Merchant categories
exports.CATEGORY_FOOD = 0;
exports.CATEGORY_WATER = 1;
exports.CATEGORY_SHELTER = 2;
exports.CATEGORY_MEDICAL = 3;
exports.CATEGORY_CLOTHING = 4;
exports.CATEGORY_FUEL = 5;
// Merchant status
exports.STATUS_PENDING = 0;
exports.STATUS_TRIAL = 1;
exports.STATUS_ACTIVE = 2;
exports.STATUS_SUSPENDED = 3;
exports.STATUS_GRADUATED = 4;
// Payment methods
exports.PAYMENT_QR = 0;
exports.PAYMENT_USSD = 1;
exports.PAYMENT_NFC = 2;
exports.PAYMENT_OFFLINE = 3;
exports.PAYMENT_ONLINE = 4;
class MerchantNetworkSDK {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.merchantNetwork);
    }
    /**
     * Register a merchant with simplified onboarding (community vouching)
     * Target: < 15 minutes onboarding time
     */
    async registerMerchant(ownerKey, merchantId, profile, references // 3 beneficiary references or 1 NGO field worker
    ) {
        const ownerKeypair = stellar_sdk_1.Keypair.fromSecret(ownerKey);
        const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(ownerAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("register_merchant", ...[
            new stellar_sdk_1.Address(ownerKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(profile.name),
            (0, stellar_sdk_1.nativeToScVal)(profile.businessType),
            (0, stellar_sdk_1.nativeToScVal)(profile.category),
            (0, stellar_sdk_1.nativeToScVal)(profile.location),
            (0, stellar_sdk_1.nativeToScVal)(profile.contactInfo),
            (0, stellar_sdk_1.nativeToScVal)(profile.acceptedTokens),
            (0, stellar_sdk_1.nativeToScVal)(references),
            (0, stellar_sdk_1.nativeToScVal)(profile.emergencyFastTrack)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(ownerKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Merchant ${merchantId} registered successfully.`;
        }
        else {
            throw new Error(`Failed to register merchant: ${result.status}`);
        }
    }
    /**
     * Add community vouches for merchant (3 beneficiaries or 1 NGO worker)
     */
    async addVouch(voucherKey, merchantId, voucherType // 0 = beneficiary, 1 = ngo
    ) {
        const voucherKeypair = stellar_sdk_1.Keypair.fromSecret(voucherKey);
        const voucherAccount = await this.server.getAccount(voucherKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(voucherAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("add_vouch", ...[
            new stellar_sdk_1.Address(voucherKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(voucherType)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(voucherKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Vouch added for merchant ${merchantId}`;
        }
        else {
            throw new Error(`Failed to add vouch: ${result.status}`);
        }
    }
    /**
     * Process payment from beneficiary to merchant
     * Sub-3 second processing for online, < 1 hour for offline sync
     */
    async processPayment(merchantKey, beneficiaryKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod = exports.PAYMENT_ONLINE) {
        const merchantKeypair = stellar_sdk_1.Keypair.fromSecret(merchantKey);
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(merchantAccount, {
            fee: '200',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("process_payment", ...[
            new stellar_sdk_1.Address(merchantKeypair.publicKey()).toScVal(),
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(token),
            (0, stellar_sdk_1.nativeToScVal)(purpose),
            (0, stellar_sdk_1.nativeToScVal)(paymentMethod)
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
     * Process offline payment (batched and synced when connectivity returns)
     */
    async processOfflinePayment(merchantId, beneficiaryId, amount, token, purpose, signature) {
        try {
            const result = await this.contract.call("process_offline_payment", (0, stellar_sdk_1.nativeToScVal)(merchantId), (0, stellar_sdk_1.nativeToScVal)(beneficiaryId), (0, stellar_sdk_1.nativeToScVal)(amount), (0, stellar_sdk_1.nativeToScVal)(token), (0, stellar_sdk_1.nativeToScVal)(purpose), (0, stellar_sdk_1.nativeToScVal)(signature));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            throw new Error(`Failed to process offline payment: ${error}`);
        }
    }
    /**
     * Sync offline transactions (when connectivity returns)
     */
    async syncOfflineTransactions(merchantKey, merchantId, offlineTransactionIds) {
        const merchantKeypair = stellar_sdk_1.Keypair.fromSecret(merchantKey);
        const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(merchantAccount, {
            fee: '200',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("sync_offline_transactions", ...[
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(offlineTransactionIds)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(merchantKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to sync offline transactions: ${result.status}`);
        }
    }
    /**
     * Get fraud alerts for a merchant
     */
    async getFraudAlerts(merchantId) {
        try {
            const result = await this.contract.call("get_fraud_alerts", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get fraud alerts:', error);
            return [];
        }
    }
    /**
     * Daily automatic settlement to merchant wallets
     */
    async settleBalances(adminKey) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '200',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("settle_balances", new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal()))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to settle balances: ${result.status}`);
        }
    }
    /**
     * Review trial merchant for graduation
     */
    async reviewTrialMerchant(adminKey, merchantId, approve) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("review_trial_merchant", ...[
            new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(approve)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return approve
                ? `Merchant ${merchantId} graduated successfully`
                : `Merchant ${merchantId} trial extended or suspended`;
        }
        else {
            throw new Error(`Failed to review trial merchant: ${result.status}`);
        }
    }
    /**
     * Generate static QR code for shop
     */
    async generateQRCode(merchantId) {
        try {
            const result = await this.contract.call("generate_shop_qr", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            const qrData = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            // Parse QR data: merchant_id|category|lat|lng|name
            const parts = qrData.split('|');
            return {
                merchantId: parts[0],
                category: parseInt(parts[1]),
                latitude: parseFloat(parts[2]),
                longitude: parseFloat(parts[3]),
                name: parts[4]
            };
        }
        catch (error) {
            throw new Error(`Failed to generate QR code: ${error}`);
        }
    }
    /**
     * Generate dynamic QR code for transaction
     */
    async generateTransactionQR(merchantId, amount, transferCode) {
        try {
            const result = await this.contract.call("generate_transaction_qr", ...[
                (0, stellar_sdk_1.nativeToScVal)(merchantId),
                (0, stellar_sdk_1.nativeToScVal)(amount),
                (0, stellar_sdk_1.nativeToScVal)(transferCode)
            ]);
            const qrData = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            // Parse QR data: merchant_id|amount|transfer_code|timestamp
            const parts = qrData.split('|');
            return {
                merchantId: parts[0],
                amount: parts[1],
                transferCode: parts[2],
                timestamp: parseInt(parts[3])
            };
        }
        catch (error) {
            throw new Error(`Failed to generate transaction QR: ${error}`);
        }
    }
    /**
     * Parse USSD code: *merchant_code*amount#
     */
    parseUSSDCode(code) {
        const parts = code.split('*');
        if (parts.length >= 3) {
            const merchantCode = parts[1];
            const amount = parts[2].replace('#', '');
            return { merchantCode, amount };
        }
        return { merchantCode: '', amount: '0' };
    }
    /**
     * Get merchant details
     */
    async getMerchant(merchantId) {
        try {
            const result = await this.contract.call("get_merchant", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get merchant:', error);
            return null;
        }
    }
    /**
     * Find merchants by location (geographic search)
     * Beneficiary discovery
     */
    async findNearbyMerchants(gpsCoords, radiusKm) {
        try {
            const result = await this.contract.call("find_merchants_by_location", ...[
                (0, stellar_sdk_1.nativeToScVal)(gpsCoords.latitude),
                (0, stellar_sdk_1.nativeToScVal)(gpsCoords.longitude),
                (0, stellar_sdk_1.nativeToScVal)(radiusKm)
            ]);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to find nearby merchants:', error);
            return [];
        }
    }
    /**
     * Find merchants by category
     */
    async findMerchantsByCategory(category) {
        try {
            const result = await this.contract.call("find_merchants_by_category", (0, stellar_sdk_1.nativeToScVal)(category));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to find merchants by category:', error);
            return [];
        }
    }
    /**
     * Get merchant transaction history
     */
    async getMerchantTransactions(merchantId) {
        try {
            const result = await this.contract.call("get_merchant_transactions", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get merchant transactions:', error);
            return [];
        }
    }
    /**
     * Get settlement history for a merchant
     * Daily payout tracking
     */
    async getSettlementHistory(merchantId) {
        try {
            const result = await this.contract.call("get_settlement_history", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get settlement history:', error);
            return [];
        }
    }
    /**
     * Get merchant statistics
     */
    async getMerchantStats(merchantId) {
        try {
            const result = await this.contract.call("get_merchant_stats", (0, stellar_sdk_1.nativeToScVal)(merchantId));
            const stats = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return {
                reputationScore: stats[0],
                currentDayVolume: stats[1],
                currentMonthVolume: stats[2],
                currentVouches: stats[3]
            };
        }
        catch (error) {
            console.error('Failed to get merchant stats:', error);
            return {
                reputationScore: 0,
                currentDayVolume: '0',
                currentMonthVolume: '0',
                currentVouches: 0
            };
        }
    }
    /**
     * Get onboarding queue
     */
    async getOnboardingQueue() {
        try {
            const result = await this.contract.call("get_onboarding_queue");
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to get onboarding queue:', error);
            return [];
        }
    }
    /**
     * Reset daily volumes
     */
    async resetDailyVolumes(adminKey) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await this.server.getAccount(adminKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("reset_daily_volumes"))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status !== 'SUCCESS') {
            throw new Error(`Failed to reset daily volumes: ${result.status}`);
        }
    }
    /**
     * Create merchant onboarding request
     */
    createOnboardingRequest(name, businessType, category, location, contactInfo, emergencyFastTrack = false) {
        return {
            name,
            businessType,
            category,
            location,
            contactInfo,
            acceptedTokens: ['USDC', 'XLM'],
            emergencyFastTrack
        };
    }
    /**
     * Get category name
     */
    getCategoryName(category) {
        const categories = {
            [exports.CATEGORY_FOOD]: 'Food',
            [exports.CATEGORY_WATER]: 'Water',
            [exports.CATEGORY_SHELTER]: 'Shelter',
            [exports.CATEGORY_MEDICAL]: 'Medical',
            [exports.CATEGORY_CLOTHING]: 'Clothing',
            [exports.CATEGORY_FUEL]: 'Fuel'
        };
        return categories[category] || 'Unknown';
    }
    /**
     * Get status name
     */
    getStatusName(status) {
        const statuses = {
            [exports.STATUS_PENDING]: 'Pending',
            [exports.STATUS_TRIAL]: 'Trial',
            [exports.STATUS_ACTIVE]: 'Active',
            [exports.STATUS_SUSPENDED]: 'Suspended',
            [exports.STATUS_GRADUATED]: 'Graduated'
        };
        return statuses[status] || 'Unknown';
    }
    /**
     * Get payment method name
     */
    getPaymentMethodName(method) {
        const methods = {
            [exports.PAYMENT_QR]: 'QR Code',
            [exports.PAYMENT_USSD]: 'USSD',
            [exports.PAYMENT_NFC]: 'NFC',
            [exports.PAYMENT_OFFLINE]: 'Offline',
            [exports.PAYMENT_ONLINE]: 'Online'
        };
        return methods[method] || 'Unknown';
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
exports.MerchantNetworkSDK = MerchantNetworkSDK;
exports.default = MerchantNetworkSDK;
//# sourceMappingURL=merchantNetwork.js.map