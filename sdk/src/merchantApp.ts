import { MerchantNetworkSDK, Merchant, Transaction, Settlement, CATEGORY_FOOD, CATEGORY_MEDICAL, PAYMENT_QR, PAYMENT_USSD, PAYMENT_OFFLINE } from './merchantNetwork';

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

// ============== Storage Adapter ==============

/**
 * Minimal synchronous key-value storage interface.
 *
 * The API mirrors the browser `localStorage` subset used by MerchantApp so
 * that `localStorageAdapter` is a zero-cost shim.  To use React Native's
 * `AsyncStorage` wrap it in a synchronous in-memory cache that flushes to
 * `AsyncStorage` in the background, or switch to a synchronous alternative
 * such as `react-native-mmkv`.
 *
 * @example React Native MMKV adapter
 * ```ts
 * import { MMKV } from 'react-native-mmkv';
 * const mmkv = new MMKV();
 * const mmkvAdapter: StorageAdapter = {
 *   getItem:    (key) => mmkv.getString(key) ?? null,
 *   setItem:    (key, value) => mmkv.set(key, value),
 *   removeItem: (key) => mmkv.delete(key),
 * };
 * new MerchantApp({ ...config, storage: mmkvAdapter });
 * ```
 */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Thrown when a storage read or write operation fails.
 * Includes the key and operation name so callers can log actionable context.
 */
export class StorageError extends Error {
  constructor(
    public readonly operation: 'getItem' | 'setItem' | 'removeItem',
    public readonly key: string,
    cause: unknown,
  ) {
    super(
      `StorageAdapter.${operation}("${key}") failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'StorageError';
    // Preserve the original error as `cause` on runtimes that support it.
    if (cause instanceof Error && 'cause' in Error.prototype === false) {
      (this as any).cause = cause;
    }
  }
}

/**
 * Ready-to-use adapter for browser environments.
 * Pass this (or omit `storage` in config) when running in a browser or jsdom.
 */
export const localStorageAdapter: StorageAdapter = {
  getItem:    (key) => localStorage.getItem(key),
  setItem:    (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

export interface MerchantAppConfig {
  rpcUrl: string;
  network: 'testnet' | 'mainnet' | 'standalone';
  merchantId: string;
  merchantKey: string;
  /**
   * Storage backend for the offline queue, inventory, and support messages.
   * Defaults to `localStorageAdapter` (browser `localStorage`).
   * Inject a custom adapter for React Native or test environments.
   */
  storage?: StorageAdapter;
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
  insufficientStock: Array<{ itemId: string; requested: number; available: number }>;
}

export class MerchantApp {
  private sdk: MerchantNetworkSDK;
  private config: MerchantAppConfig;
  private storage: StorageAdapter;
  private offlineQueue: OfflineQueueItem[] = [];
  private inventory: InventoryItem[] = [];
  private supportMessages: SupportMessage[] = [];
  private isOnline: boolean = true;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(config: MerchantAppConfig) {
    this.config = config;
    this.storage = config.storage ?? localStorageAdapter;
    this.sdk = new MerchantNetworkSDK({
      rpcUrl: config.rpcUrl,
      network: config.network,
      contractIds: {
        merchantNetwork: 'MERCHANT_NETWORK_CONTRACT_ID'
      }
    });
    
    // Initialize state from storage.
    this.loadOfflineQueue();
    this.loadInventory();
    this.loadSupportMessages();
    
    // Start automatic sync when online
    this.startAutoSync();
  }

  // ============== Storage helpers ==============

  /**
   * Read a JSON value from storage.
   * Returns `null` when the key is absent.
   * Throws `StorageError` on adapter failure or JSON parse errors.
   */
  private storageGet<T>(key: string): T | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(key);
    } catch (err) {
      throw new StorageError('getItem', key, err);
    }
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new StorageError('getItem', key, new Error(`JSON parse failed: ${(err as Error).message}`));
    }
  }

  /**
   * Write a JSON-serialisable value to storage.
   * Throws `StorageError` on adapter failure.
   */
  private storageSet(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new StorageError('setItem', key, err);
    }
  }

  /**
   * Initialize merchant app
   */
  async initialize(): Promise<Merchant> {
    const merchant = await this.sdk.getMerchant(this.config.merchantId);
    if (!merchant) {
      throw new Error('Merchant not found. Please register first.');
    }
    return merchant;
  }

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
  async processPayment(
    beneficiaryId: string,
    amount: string,
    token: string = 'USDC',
    purpose: string = 'Aid Purchase',
    paymentMethod: number = PAYMENT_QR,
    lineItems: SaleLineItem[] = []
  ): Promise<string> {
    // Check online status
    if (!this.isOnline) {
      return this.queueOfflinePayment(beneficiaryId, amount, token, purpose);
    }

    try {
      // Try online payment first
      const transactionId = await this.sdk.processPayment(
        this.config.merchantKey,
        '',
        this.config.merchantId,
        beneficiaryId,
        amount,
        token,
        purpose,
        paymentMethod
      );
      
      // Decrement stock only after confirmed payment success
      if (lineItems.length > 0) {
        this.updateInventoryAfterSale(lineItems);
      }
      
      return transactionId;
    } catch (error) {
      console.error('Online payment failed, queuing for offline:', error);
      return this.queueOfflinePayment(beneficiaryId, amount, token, purpose);
    }
  }

  /**
   * Queue offline payment for later sync
   */
  private async queueOfflinePayment(
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string
  ): Promise<string> {
    const offlineId = `offline_${Date.now()}`;
    
    const queueItem: OfflineQueueItem = {
      id: offlineId,
      type: 'payment',
      data: {
        beneficiaryId,
        amount,
        token,
        purpose,
        paymentMethod: PAYMENT_OFFLINE,
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
  private generateOfflineSignature(beneficiaryId: string, amount: string): string {
    // Simplified offline signature
    // In production, use proper cryptographic signing
    const data = `${beneficiaryId}:${amount}:${Date.now()}`;
    return btoa(data);
  }

  /**
   * Sync offline transactions (when connectivity returns)
   */
  async syncOfflineTransactions(): Promise<number> {
    if (this.offlineQueue.length === 0) {
      return 0;
    }

    const paymentItems = this.offlineQueue.filter(item => item.type === 'payment');
    const transactionIds = paymentItems.map(item => item.id);

    try {
      const syncedCount = await this.sdk.syncOfflineTransactions(
        this.config.merchantKey,
        this.config.merchantId,
        transactionIds
      );

      // Remove synced items from queue
      this.offlineQueue = this.offlineQueue.filter(
        item => !transactionIds.includes(item.id)
      );
      this.saveOfflineQueue();

      return syncedCount;
    } catch (error) {
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
  async processQRPayment(qrData: string): Promise<string> {
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
    return this.processPayment(
      transferCode, // Using transfer code as beneficiary ID
      amount,
      'USDC',
      'QR Payment',
      PAYMENT_QR
    );
  }

  /**
   * Process USSD payment
   * Format: *merchant_code*amount#
   */
  async processUSSDPayment(ussdCode: string): Promise<string> {
    const { merchantCode, amount } = this.sdk.parseUSSDCode(ussdCode);

    if (!merchantCode || amount === '0') {
      throw new Error('Invalid USSD code format');
    }

    // Verify merchant code (in production, map code to merchant ID)
    if (merchantCode !== this.config.merchantId.substring(0, 6)) {
      throw new Error('Invalid merchant code');
    }

    return this.processPayment(
      'ussd_beneficiary', // USSD doesn't have beneficiary ID
      amount,
      'USDC',
      'USSD Payment',
      PAYMENT_USSD
    );
  }

  /**
   * Get pending offline transactions count
   */
  getPendingOfflineCount(): number {
    return this.offlineQueue.filter(item => item.type === 'payment').length;
  }

  /**
   * Generate shop QR code (static)
   */
  async generateShopQR(): Promise<string> {
    const qrData = await this.sdk.generateQRCode(this.config.merchantId);
    return JSON.stringify(qrData);
  }

  /**
   * Generate dynamic transaction QR
   */
  async generateTransactionQR(amount: string, transferCode: string): Promise<string> {
    const qrData = await this.sdk.generateTransactionQR(
      this.config.merchantId,
      amount,
      transferCode
    );
    return JSON.stringify(qrData);
  }

  // ============== Inventory Management ==============

  /**
   * Add item to inventory
   */
  addInventoryItem(item: Omit<InventoryItem, 'id' | 'lastUpdated'>): string {
    const newItem: InventoryItem = {
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
  updateInventoryItem(itemId: string, updates: Partial<InventoryItem>): void {
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
  updateInventoryAfterSale(lineItems: SaleLineItem[]): InventoryUpdateResult {
    const result: InventoryUpdateResult = {
      decremented: [],
      unknownItems: [],
      insufficientStock: [],
    };

    if (lineItems.length === 0) {
      return result;
    }

    let changed = false;

    for (const line of lineItems) {
      const index = this.inventory.findIndex(item => item.id === line.itemId);

      if (index === -1) {
        result.unknownItems.push(line.itemId);
        continue;
      }

      const item = this.inventory[index];

      if (item.quantity < line.quantity) {
        result.insufficientStock.push({
          itemId: line.itemId,
          requested: line.quantity,
          available: item.quantity,
        });
        continue;
      }

      this.inventory[index] = {
        ...item,
        quantity: item.quantity - line.quantity,
        lastUpdated: Date.now(),
      };

      result.decremented.push({ itemId: line.itemId, quantity: line.quantity });
      changed = true;
    }

    if (changed) {
      this.saveInventory();
    }

    return result;
  }

  /**
   * Get inventory items by category
   */
  getInventoryByCategory(category: string): InventoryItem[] {
    return this.inventory.filter(item => item.category === category);
  }

  /**
   * Get low stock items
   */
  getLowStockItems(threshold: number = 10): InventoryItem[] {
    return this.inventory.filter(item => item.quantity < threshold);
  }

  /**
   * Queue inventory update for offline sync
   */
  private queueInventoryUpdate(itemId: string, updates: Partial<InventoryItem>): void {
    const queueItem: OfflineQueueItem = {
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
  async sendSupportMessage(message: string): Promise<string> {
    const supportMessage: SupportMessage = {
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
  private async syncSupportMessage(message: SupportMessage): Promise<string> {
    // In production, this would call an API to send to NGO
    message.status = 'sent';
    this.saveSupportMessages();
    return message.id;
  }

  /**
   * Get support messages
   */
  getSupportMessages(): SupportMessage[] {
    return this.supportMessages;
  }

  /**
   * Get unread support messages
   */
  getUnreadSupportMessages(): SupportMessage[] {
    return this.supportMessages.filter(
      msg => !msg.isFromMerchant && msg.status !== 'read' && msg.status !== 'resolved'
    );
  }

  // ============== Network Status ==============

  /**
   * Check online status
   */
  checkOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Set online status
   */
  setOnlineStatus(online: boolean): void {
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
  private startAutoSync(): void {
    // Sync every 5 minutes
    this.syncInterval = setInterval(() => {
      if (this.isOnline && this.offlineQueue.length > 0) {
        this.syncOfflineTransactions().catch(err => 
          console.error('Auto-sync failed:', err)
        );
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ============== Local Storage (Simplified) ==============

  private loadOfflineQueue(): void {
    this.offlineQueue = this.storageGet<OfflineQueueItem[]>('offlineQueue') ?? [];
  }

  private saveOfflineQueue(): void {
    this.storageSet('offlineQueue', this.offlineQueue);
  }

  private loadInventory(): void {
    this.inventory = this.storageGet<InventoryItem[]>('inventory') ?? [];
  }

  private saveInventory(): void {
    this.storageSet('inventory', this.inventory);
  }

  private loadSupportMessages(): void {
    this.supportMessages = this.storageGet<SupportMessage[]>('supportMessages') ?? [];
  }

  private saveSupportMessages(): void {
    this.storageSet('supportMessages', this.supportMessages);
  }

  // ============== Settlement ==============

  /**
   * Get settlement history
   */
  async getSettlementHistory(): Promise<Settlement[]> {
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
  async getRecentTransactions(limit: number = 10): Promise<Transaction[]> {
    const transactions = await this.sdk.getMerchantTransactions(this.config.merchantId);
    return transactions.slice(-limit);
  }

  // ============== Cleanup ==============

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAutoSync();
  }
}

export default MerchantApp;