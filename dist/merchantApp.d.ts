import { Merchant, Transaction, Settlement } from './merchantNetwork';
/**
 * Merchant App - Lightweight React Native app for Android (2G compatible)
 *
 * Features:
 * - Offline transaction queue with automatic sync
 * - Inventory management for aid item tracking
 * - Customer support chat with NGO field teams
 * - QR code scanning for payments
 * - USSD code support for feature phones
 */
export interface MerchantAppConfig {
    rpcUrl: string;
    network: 'testnet' | 'mainnet' | 'standalone';
    merchantId: string;
    merchantKey: string;
}
export interface OfflineQueueItem {
    id: string;
    type: 'payment' | 'inventory_update' | 'support_message';
    data: any;
    timestamp: number;
    retryCount: number;
}
export interface InventoryItem {
    id: string;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    price: string;
    lastUpdated: number;
}
export interface SupportMessage {
    id: string;
    merchantId: string;
    message: string;
    timestamp: number;
    isFromMerchant: boolean;
    status: 'pending' | 'sent' | 'read' | 'resolved';
}
/**
 * One line of an itemized sale.
 * `itemId` must match an `InventoryItem.id` already in inventory.
 */
export interface SaleLineItem {
    itemId: string;
    quantity: number;
}
/**
 * Returned by `updateInventoryAfterSale` so callers can inspect
 * what was decremented and what was rejected, without throwing on
 * soft errors like unknown items or insufficient stock.
 */
export interface InventoryUpdateResult {
    /** Items whose stock was successfully decremented. */
    decremented: SaleLineItem[];
    /** Items not found in inventory. */
    unknownItems: string[];
    /** Items found but with stock below the requested quantity. */
    insufficientStock: Array<{
        itemId: string;
        requested: number;
        available: number;
    }>;
}
export declare class MerchantApp {
    private sdk;
    private config;
    private offlineQueue;
    private inventory;
    private supportMessages;
    private isOnline;
    private syncInterval;
    constructor(config: MerchantAppConfig);
    /**
     * Initialize merchant app
     */
    initialize(): Promise<Merchant>;
    /**
     * Process payment with multiple payment methods
     * Supports: QR, USSD, NFC, Offline
     *
     * @param lineItems - Explicit inventory items and quantities consumed by this
     *   sale. Stock is only decremented after the payment is confirmed on-chain.
     *   Omit or pass an empty array to skip inventory tracking.
     * @returns Transaction ID on success. For offline payments returns a local
     *   queue ID prefixed with `offline_`.
     */
    processPayment(beneficiaryId: string, amount: string, token?: string, purpose?: string, paymentMethod?: number, lineItems?: SaleLineItem[]): Promise<string>;
    /**
     * Queue offline payment for later sync
     */
    private queueOfflinePayment;
    /**
     * Generate offline signature for transaction
     */
    private generateOfflineSignature;
    /**
     * Sync offline transactions (when connectivity returns)
     */
    syncOfflineTransactions(): Promise<number>;
    /**
     * Scan QR code and process payment
     */
    processQRPayment(qrData: string): Promise<string>;
    /**
     * Process USSD payment
     * Format: *merchant_code*amount#
     */
    processUSSDPayment(ussdCode: string): Promise<string>;
    /**
     * Get pending offline transactions count
     */
    getPendingOfflineCount(): number;
    /**
     * Generate shop QR code (static)
     */
    generateShopQR(): Promise<string>;
    /**
     * Generate dynamic transaction QR
     */
    generateTransactionQR(amount: string, transferCode: string): Promise<string>;
    /**
     * Add item to inventory
     */
    addInventoryItem(item: Omit<InventoryItem, 'id' | 'lastUpdated'>): string;
    /**
     * Update inventory item
     */
    updateInventoryItem(itemId: string, updates: Partial<InventoryItem>): void;
    /**
     * Decrement inventory quantities after a confirmed sale.
     *
     * Rules:
     * - Each `SaleLineItem.itemId` must resolve to an existing `InventoryItem`.
     * - Decrement is applied only when the item is found **and** has sufficient stock.
     * - Unknown items and insufficient-stock items are collected in the result and
     *   do **not** throw — the caller decides how to surface them.
     * - Persistence (`saveInventory`) is called once after all valid decrements are
     *   applied, so either all valid changes land or none do if `saveInventory` throws.
     *
     * @param lineItems - Items and quantities consumed by the confirmed sale.
     * @returns `InventoryUpdateResult` describing what was decremented and what was rejected.
     */
    updateInventoryAfterSale(lineItems: SaleLineItem[]): InventoryUpdateResult;
    /**
     * Get inventory items by category
     */
    getInventoryByCategory(category: string): InventoryItem[];
    /**
     * Get low stock items
     */
    getLowStockItems(threshold?: number): InventoryItem[];
    /**
     * Queue inventory update for offline sync
     */
    private queueInventoryUpdate;
    /**
     * Send support message to NGO field team
     */
    sendSupportMessage(message: string): Promise<string>;
    /**
     * Sync support message
     */
    private syncSupportMessage;
    /**
     * Get support messages
     */
    getSupportMessages(): SupportMessage[];
    /**
     * Get unread support messages
     */
    getUnreadSupportMessages(): SupportMessage[];
    /**
     * Check online status
     */
    checkOnlineStatus(): boolean;
    /**
     * Set online status
     */
    setOnlineStatus(online: boolean): void;
    /**
     * Start automatic sync
     */
    private startAutoSync;
    /**
     * Stop automatic sync
     */
    stopAutoSync(): void;
    private loadOfflineQueue;
    private saveOfflineQueue;
    private loadInventory;
    private saveInventory;
    private loadSupportMessages;
    private saveSupportMessages;
    /**
     * Get settlement history
     */
    getSettlementHistory(): Promise<Settlement[]>;
    /**
     * Get merchant statistics
     */
    getMerchantStats(): Promise<import("./merchantNetwork").MerchantStats>;
    /**
     * Get recent transactions
     */
    getRecentTransactions(limit?: number): Promise<Transaction[]>;
    /**
     * Cleanup resources
     */
    destroy(): void;
}
export default MerchantApp;
//# sourceMappingURL=merchantApp.d.ts.map