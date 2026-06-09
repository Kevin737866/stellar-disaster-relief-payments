"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantApp = void 0;
const merchantNetwork_1 = require("./merchantNetwork");
class MerchantApp {
    constructor(config) {
        this.offlineQueue = [];
        this.inventory = [];
        this.supportMessages = [];
        this.isOnline = true;
        this.syncInterval = null;
        this.config = config;
        this.sdk = new merchantNetwork_1.MerchantNetworkSDK({
            rpcUrl: config.rpcUrl,
            network: config.network,
            contractIds: {
                merchantNetwork: 'MERCHANT_NETWORK_CONTRACT_ID'
            }
        });
        // Initialize offline queue from local storage (in real app)
        this.loadOfflineQueue();
        this.loadInventory();
        this.loadSupportMessages();
        // Start automatic sync when online
        this.startAutoSync();
    }
    /**
     * Initialize merchant app
     */
    async initialize() {
        const merchant = await this.sdk.getMerchant(this.config.merchantId);
        if (!merchant) {
            throw new Error('Merchant not found. Please register first.');
        }
        return merchant;
    }
    /**
     * Process payment with multiple payment methods
     * Supports: QR, USSD, NFC, Offline
     */
    async processPayment(beneficiaryId, amount, token = 'USDC', purpose = 'Aid Purchase', paymentMethod = merchantNetwork_1.PAYMENT_QR) {
        // Check online status
        if (!this.isOnline) {
            return this.queueOfflinePayment(beneficiaryId, amount, token, purpose);
        }
        try {
            // Try online payment first
            const transactionId = await this.sdk.processPayment(this.config.merchantKey, '', this.config.merchantId, beneficiaryId, amount, token, purpose, paymentMethod);
            // Update inventory
            this.updateInventoryAfterSale(amount, purpose);
            return transactionId;
        }
        catch (error) {
            console.error('Online payment failed, queuing for offline:', error);
            return this.queueOfflinePayment(beneficiaryId, amount, token, purpose);
        }
    }
    /**
     * Queue offline payment for later sync
     */
    async queueOfflinePayment(beneficiaryId, amount, token, purpose) {
        const offlineId = `offline_${Date.now()}`;
        const queueItem = {
            id: offlineId,
            type: 'payment',
            data: {
                beneficiaryId,
                amount,
                token,
                purpose,
                paymentMethod: merchantNetwork_1.PAYMENT_OFFLINE,
                signature: this.generateOfflineSignature(beneficiaryId, amount)
            },
            timestamp: Date.now(),
            retryCount: 0
        };
        this.offlineQueue.push(queueItem);
        this.saveOfflineQueue();
        return offlineId;
    }
    /**
     * Generate offline signature for transaction
     */
    generateOfflineSignature(beneficiaryId, amount) {
        // Simplified offline signature
        // In production, use proper cryptographic signing
        const data = `${beneficiaryId}:${amount}:${Date.now()}`;
        return btoa(data);
    }
    /**
     * Sync offline transactions (when connectivity returns)
     */
    async syncOfflineTransactions() {
        if (this.offlineQueue.length === 0) {
            return 0;
        }
        const paymentItems = this.offlineQueue.filter(item => item.type === 'payment');
        const transactionIds = paymentItems.map(item => item.id);
        try {
            const syncedCount = await this.sdk.syncOfflineTransactions(this.config.merchantKey, this.config.merchantId, transactionIds);
            // Remove synced items from queue
            this.offlineQueue = this.offlineQueue.filter(item => !transactionIds.includes(item.id));
            this.saveOfflineQueue();
            return syncedCount;
        }
        catch (error) {
            console.error('Failed to sync offline transactions:', error);
            // Increment retry count for failed items
            this.offlineQueue.forEach(item => {
                if (item.type === 'payment') {
                    item.retryCount++;
                }
            });
            this.saveOfflineQueue();
            throw error;
        }
    }
    /**
     * Scan QR code and process payment
     */
    async processQRPayment(qrData) {
        // Parse QR code: merchantId|amount|transferCode|timestamp
        const parts = qrData.split('|');
        if (parts.length < 3) {
            throw new Error('Invalid QR code format');
        }
        const merchantId = parts[0];
        const amount = parts[1];
        const transferCode = parts[2];
        // Verify this QR is for this merchant
        if (merchantId !== this.config.merchantId) {
            throw new Error('QR code is for a different merchant');
        }
        // Process payment
        return this.processPayment(transferCode, // Using transfer code as beneficiary ID
        amount, 'USDC', 'QR Payment', merchantNetwork_1.PAYMENT_QR);
    }
    /**
     * Process USSD payment
     * Format: *merchant_code*amount#
     */
    async processUSSDPayment(ussdCode) {
        const { merchantCode, amount } = this.sdk.parseUSSDCode(ussdCode);
        if (!merchantCode || amount === '0') {
            throw new Error('Invalid USSD code format');
        }
        // Verify merchant code (in production, map code to merchant ID)
        if (merchantCode !== this.config.merchantId.substring(0, 6)) {
            throw new Error('Invalid merchant code');
        }
        return this.processPayment('ussd_beneficiary', // USSD doesn't have beneficiary ID
        amount, 'USDC', 'USSD Payment', merchantNetwork_1.PAYMENT_USSD);
    }
    /**
     * Get pending offline transactions count
     */
    getPendingOfflineCount() {
        return this.offlineQueue.filter(item => item.type === 'payment').length;
    }
    /**
     * Generate shop QR code (static)
     */
    async generateShopQR() {
        const qrData = await this.sdk.generateQRCode(this.config.merchantId);
        return JSON.stringify(qrData);
    }
    /**
     * Generate dynamic transaction QR
     */
    async generateTransactionQR(amount, transferCode) {
        const qrData = await this.sdk.generateTransactionQR(this.config.merchantId, amount, transferCode);
        return JSON.stringify(qrData);
    }
    // ============== Inventory Management ==============
    /**
     * Add item to inventory
     */
    addInventoryItem(item) {
        const newItem = {
            ...item,
            id: `inv_${Date.now()}`,
            lastUpdated: Date.now()
        };
        this.inventory.push(newItem);
        this.saveInventory();
        return newItem.id;
    }
    /**
     * Update inventory item
     */
    updateInventoryItem(itemId, updates) {
        const itemIndex = this.inventory.findIndex(item => item.id === itemId);
        if (itemIndex === -1) {
            throw new Error('Inventory item not found');
        }
        this.inventory[itemIndex] = {
            ...this.inventory[itemIndex],
            ...updates,
            lastUpdated: Date.now()
        };
        this.saveInventory();
        // Queue for offline sync if needed
        if (!this.isOnline) {
            this.queueInventoryUpdate(itemId, updates);
        }
    }
    /**
     * Update inventory after sale
     */
    updateInventoryAfterSale(amount, purpose) {
        // In production, map purpose to inventory items and decrement quantity
        // This is a simplified implementation
        const amountNum = parseFloat(amount);
        if (amountNum > 0) {
            // Update inventory tracking
            console.log(`Sale recorded: ${amount} for ${purpose}`);
        }
    }
    /**
     * Get inventory items by category
     */
    getInventoryByCategory(category) {
        return this.inventory.filter(item => item.category === category);
    }
    /**
     * Get low stock items
     */
    getLowStockItems(threshold = 10) {
        return this.inventory.filter(item => item.quantity < threshold);
    }
    /**
     * Queue inventory update for offline sync
     */
    queueInventoryUpdate(itemId, updates) {
        const queueItem = {
            id: `inv_update_${Date.now()}`,
            type: 'inventory_update',
            data: { itemId, updates },
            timestamp: Date.now(),
            retryCount: 0
        };
        this.offlineQueue.push(queueItem);
        this.saveOfflineQueue();
    }
    // ============== Customer Support ==============
    /**
     * Send support message to NGO field team
     */
    async sendSupportMessage(message) {
        const supportMessage = {
            id: `support_${Date.now()}`,
            merchantId: this.config.merchantId,
            message,
            timestamp: Date.now(),
            isFromMerchant: true,
            status: 'pending'
        };
        this.supportMessages.push(supportMessage);
        this.saveSupportMessages();
        if (this.isOnline) {
            return this.syncSupportMessage(supportMessage);
        }
        return supportMessage.id;
    }
    /**
     * Sync support message
     */
    async syncSupportMessage(message) {
        // In production, this would call an API to send to NGO
        message.status = 'sent';
        this.saveSupportMessages();
        return message.id;
    }
    /**
     * Get support messages
     */
    getSupportMessages() {
        return this.supportMessages;
    }
    /**
     * Get unread support messages
     */
    getUnreadSupportMessages() {
        return this.supportMessages.filter(msg => !msg.isFromMerchant && msg.status !== 'read' && msg.status !== 'resolved');
    }
    // ============== Network Status ==============
    /**
     * Check online status
     */
    checkOnlineStatus() {
        return this.isOnline;
    }
    /**
     * Set online status
     */
    setOnlineStatus(online) {
        const wasOffline = !this.isOnline;
        this.isOnline = online;
        // Sync when coming back online
        if (wasOffline && online) {
            this.syncOfflineTransactions();
        }
    }
    /**
     * Start automatic sync
     */
    startAutoSync() {
        // Sync every 5 minutes
        this.syncInterval = setInterval(() => {
            if (this.isOnline && this.offlineQueue.length > 0) {
                this.syncOfflineTransactions().catch(err => console.error('Auto-sync failed:', err));
            }
        }, 5 * 60 * 1000);
    }
    /**
     * Stop automatic sync
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
    // ============== Local Storage (Simplified) ==============
    loadOfflineQueue() {
        // In production, use AsyncStorage or similar
        const stored = localStorage.getItem('offlineQueue');
        if (stored) {
            this.offlineQueue = JSON.parse(stored);
        }
    }
    saveOfflineQueue() {
        localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
    }
    loadInventory() {
        const stored = localStorage.getItem('inventory');
        if (stored) {
            this.inventory = JSON.parse(stored);
        }
    }
    saveInventory() {
        localStorage.setItem('inventory', JSON.stringify(this.inventory));
    }
    loadSupportMessages() {
        const stored = localStorage.getItem('supportMessages');
        if (stored) {
            this.supportMessages = JSON.parse(stored);
        }
    }
    saveSupportMessages() {
        localStorage.setItem('supportMessages', JSON.stringify(this.supportMessages));
    }
    // ============== Settlement ==============
    /**
     * Get settlement history
     */
    async getSettlementHistory() {
        return this.sdk.getSettlementHistory(this.config.merchantId);
    }
    /**
     * Get merchant statistics
     */
    async getMerchantStats() {
        return this.sdk.getMerchantStats(this.config.merchantId);
    }
    /**
     * Get recent transactions
     */
    async getRecentTransactions(limit = 10) {
        const transactions = await this.sdk.getMerchantTransactions(this.config.merchantId);
        return transactions.slice(-limit);
    }
    // ============== Cleanup ==============
    /**
     * Cleanup resources
     */
    destroy() {
        this.stopAutoSync();
    }
}
exports.MerchantApp = MerchantApp;
exports.default = MerchantApp;
//# sourceMappingURL=merchantApp.js.map