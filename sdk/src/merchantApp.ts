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

export interface MerchantAppConfig {
  rpcUrl: string;
  network: 'testnet' | 'mainnet' | 'standalone';
  merchantId: string;
  merchantKey: string;
  /** Optional remote acknowledgement hooks for non-payment queue items. */
  syncHandlers?: OfflineSyncHandlers;
}

export type OfflineQueueItemType = 'payment' | 'inventory_update' | 'support_message';

export interface OfflineQueueItem {
  id: string;
  type: OfflineQueueItemType;
  data: any;
  timestamp: number;
  retryCount: number;
}

/** Optional hooks used to acknowledge non-payment items during sync. */
export interface OfflineSyncHandlers {
  inventoryUpdate?: (item: OfflineQueueItem) => void | Promise<void>;
  supportMessage?: (item: OfflineQueueItem) => void | Promise<void>;
}

export type OfflineSyncStatus = 'synced' | 'failed' | 'unsupported';

/** Outcome of one queued item during a sync pass. */
export interface OfflineSyncItemResult {
  id: string;
  type: string;
  status: OfflineSyncStatus;
  reason?: string;
  retryCount: number;
}

/** Per-item report returned by `syncOfflineTransactions`. */
export interface OfflineSyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  unsupportedCount: number;
  remainingCount: number;
  syncedIds: string[];
  failedIds: string[];
  unsupportedIds: string[];
  unsupportedTypes: string[];
  results: OfflineSyncItemResult[];
  /** Aliases for consumers that prefer status-grouped arrays. */
  synced: OfflineSyncItemResult[];
  failed: OfflineSyncItemResult[];
  unsupported: OfflineSyncItemResult[];
  outcomes: OfflineSyncItemResult[];
  syncedItems: OfflineQueueItem[];
  failedItems: OfflineQueueItem[];
  unsupportedItems: OfflineQueueItem[];
}

function emptySyncResult(remainingCount: number): OfflineSyncResult {
  return {
    success: true,
    syncedCount: 0,
    failedCount: 0,
    unsupportedCount: 0,
    remainingCount,
    syncedIds: [],
    failedIds: [],
    unsupportedIds: [],
    unsupportedTypes: [],
    results: [],
    synced: [],
    failed: [],
    unsupported: [],
    outcomes: [],
    syncedItems: [],
    failedItems: [],
    unsupportedItems: [],
  };
}

function syncErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
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

export class MerchantApp {
  private sdk: MerchantNetworkSDK;
  private config: MerchantAppConfig;
  private offlineQueue: OfflineQueueItem[] = [];
  private inventory: InventoryItem[] = [];
  private supportMessages: SupportMessage[] = [];
  private isOnline: boolean = true;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncHandlers: OfflineSyncHandlers;
  private queueSequence: number = 0;

  constructor(config: MerchantAppConfig) {
    this.config = config;
    this.syncHandlers = config.syncHandlers ?? {};
    this.sdk = new MerchantNetworkSDK({
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
   */
  async processPayment(
    beneficiaryId: string,
    amount: string,
    token: string = 'USDC',
    purpose: string = 'Aid Purchase',
    paymentMethod: number = PAYMENT_QR
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
      
      // Update inventory
      this.updateInventoryAfterSale(amount, purpose);
      
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
    const offlineId = this.nextQueueId('offline');
    
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
   * Sync every queued item with a per-item outcome.
   *
   * Successfully synced items are removed individually. Failed items stay in
   * the queue with an incremented retryCount. Unknown types are reported as
   * `unsupported` (and left in the queue) instead of being silently retained.
   */
  async syncOfflineTransactions(): Promise<OfflineSyncResult> {
    if (this.offlineQueue.length === 0) {
      return emptySyncResult(0);
    }

    const snapshot = [...this.offlineQueue];
    const result = emptySyncResult(snapshot.length);
    const syncedIds = new Set<string>();

    for (const item of snapshot) {
      try {
        switch (item.type) {
          case 'payment':
            await this.syncPaymentItem(item);
            break;
          case 'inventory_update':
            await this.syncInventoryUpdateItem(item);
            break;
          case 'support_message':
            await this.syncSupportMessageItem(item);
            break;
          default: {
            const type = String((item as OfflineQueueItem).type);
            const reason = `Unsupported offline queue item type "${type}"`;
            console.warn(`[merchant-app] ${reason}`, item.id);
            const unsupported: OfflineSyncItemResult = {
              id: item.id,
              type,
              status: 'unsupported',
              reason,
              retryCount: item.retryCount,
            };
            result.results.push(unsupported);
            result.outcomes.push(unsupported);
            result.unsupported.push(unsupported);
            result.unsupportedItems.push(item);
            result.unsupportedIds.push(item.id);
            if (!result.unsupportedTypes.includes(type)) {
              result.unsupportedTypes.push(type);
            }
            continue;
          }
        }

        const synced: OfflineSyncItemResult = {
          id: item.id,
          type: item.type,
          status: 'synced',
          retryCount: item.retryCount,
        };
        result.results.push(synced);
        result.outcomes.push(synced);
        result.synced.push(synced);
        result.syncedItems.push(item);
        result.syncedIds.push(item.id);
        syncedIds.add(item.id);
      } catch (error: unknown) {
        item.retryCount += 1;
        const failed: OfflineSyncItemResult = {
          id: item.id,
          type: item.type,
          status: 'failed',
          reason: syncErrorMessage(error),
          retryCount: item.retryCount,
        };
        result.results.push(failed);
        result.outcomes.push(failed);
        result.failed.push(failed);
        result.failedItems.push(item);
        result.failedIds.push(item.id);
      }
    }

    if (syncedIds.size > 0) {
      this.offlineQueue = this.offlineQueue.filter(item => !syncedIds.has(item.id));
    }
    this.saveOfflineQueue();

    result.syncedCount = result.synced.length;
    result.failedCount = result.failed.length;
    result.unsupportedCount = result.unsupported.length;
    result.remainingCount = this.offlineQueue.length;
    result.success = result.failedCount === 0 && result.unsupportedCount === 0;
    return result;
  }

  /** Alias for `syncOfflineTransactions` for callers that want the full report. */
  async syncOfflineQueue(): Promise<OfflineSyncResult> {
    return this.syncOfflineTransactions();
  }

  /** Legacy numeric view of the last sync pass's successful item count. */
  async syncOfflineTransactionsCount(): Promise<number> {
    return (await this.syncOfflineTransactions()).syncedCount;
  }

  /** Explicitly discard a queued item (e.g. an unsupported type). */
  rejectQueueItem(id: string): boolean {
    const originalLength = this.offlineQueue.length;
    this.offlineQueue = this.offlineQueue.filter(item => item.id !== id);
    if (this.offlineQueue.length !== originalLength) {
      this.saveOfflineQueue();
      return true;
    }
    return false;
  }

  /** Returns a copy of the current offline queue for inspection. */
  getOfflineQueue(): OfflineQueueItem[] {
    return this.offlineQueue.map(item => ({
      ...item,
      data: item.data && typeof item.data === 'object' ? { ...item.data } : item.data,
    }));
  }

  private nextQueueId(prefix: string): string {
    this.queueSequence += 1;
    return `${prefix}_${Date.now()}_${this.queueSequence}`;
  }

  private async syncPaymentItem(item: OfflineQueueItem): Promise<void> {
    const acknowledged = await this.sdk.syncOfflineTransactions(
      this.config.merchantKey,
      this.config.merchantId,
      [item.id]
    );
    if (!acknowledged || acknowledged < 1) {
      throw new Error(`Payment ${item.id} was not acknowledged by the network`);
    }
  }

  private async syncInventoryUpdateItem(item: OfflineQueueItem): Promise<void> {
    const data = item.data ?? {};
    const itemId = data.itemId ?? data.id;
    const updates = data.updates;
    if (!itemId || !updates || typeof updates !== 'object') {
      throw new Error('Invalid inventory_update queue payload');
    }

    if (this.syncHandlers.inventoryUpdate) {
      await this.syncHandlers.inventoryUpdate(item);
    }

    const index = this.inventory.findIndex(inventoryItem => inventoryItem.id === itemId);
    if (index === -1) {
      throw new Error(`Inventory item ${itemId} not found`);
    }
    this.inventory[index] = {
      ...this.inventory[index],
      ...updates,
      lastUpdated: Date.now(),
    };
    this.saveInventory();
  }

  private async syncSupportMessageItem(item: OfflineQueueItem): Promise<void> {
    const data = item.data ?? {};
    const messageId = data.id ?? data.messageId ?? item.id;
    const message = this.supportMessages.find(candidate => candidate.id === messageId);
    if (!message) {
      throw new Error(`Support message ${messageId} not found`);
    }

    if (this.syncHandlers.supportMessage) {
      await this.syncHandlers.supportMessage(item);
    }
    await this.syncSupportMessage(message);
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
    return this.offlineQueue.length;
  }

  /** Pending count restricted to payment queue items. */
  getPendingPaymentCount(): number {
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
   * Update inventory after sale
   */
  private updateInventoryAfterSale(amount: string, purpose: string): void {
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
      id: this.nextQueueId('inv_update'),
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

    this.queueSupportMessage(supportMessage);
    return supportMessage.id;
  }

  /** Queue an offline support message for later acknowledgement. */
  private queueSupportMessage(message: SupportMessage): void {
    const queueItem: OfflineQueueItem = {
      id: this.nextQueueId('support_sync'),
      type: 'support_message',
      data: {
        id: message.id,
        messageId: message.id,
        merchantId: message.merchantId,
      },
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.offlineQueue.push(queueItem);
    this.saveOfflineQueue();
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
      this.syncOfflineTransactions().catch(err =>
        console.error('Sync on reconnect failed:', err)
      );
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
    // In production, use AsyncStorage or similar
    const stored = localStorage.getItem('offlineQueue');
    if (stored) {
      this.offlineQueue = JSON.parse(stored);
    }
  }

  private saveOfflineQueue(): void {
    localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
  }

  private loadInventory(): void {
    const stored = localStorage.getItem('inventory');
    if (stored) {
      this.inventory = JSON.parse(stored);
    }
  }

  private saveInventory(): void {
    localStorage.setItem('inventory', JSON.stringify(this.inventory));
  }

  private loadSupportMessages(): void {
    const stored = localStorage.getItem('supportMessages');
    if (stored) {
      this.supportMessages = JSON.parse(stored);
    }
  }

  private saveSupportMessages(): void {
    localStorage.setItem('supportMessages', JSON.stringify(this.supportMessages));
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