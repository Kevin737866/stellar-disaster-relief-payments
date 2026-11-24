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

/** Minimal storage contract used for local persistence. */
export interface MerchantAppStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Legacy unscoped keys written by earlier versions of the app. */
export const LEGACY_STORAGE_KEYS = {
  offlineQueue: 'offlineQueue',
  inventory: 'inventory',
  supportMessages: 'supportMessages',
} as const;

export type MerchantAppDataset = keyof typeof LEGACY_STORAGE_KEYS;

export const MERCHANT_APP_DATASETS: MerchantAppDataset[] = [
  'offlineQueue',
  'inventory',
  'supportMessages',
];

export const MERCHANT_APP_STORAGE_PREFIX = 'merchantApp';

/** Version written to newly persisted datasets. Bare arrays are treated as v1. */
export const MERCHANT_APP_PERSISTENCE_VERSION = 1;
/** Alias retained for callers that prefer the shorter name. */
export const PERSISTED_DATA_VERSION = MERCHANT_APP_PERSISTENCE_VERSION;

export type PersistenceIssueCode =
  | 'invalid_json'
  | 'unexpected_shape'
  | 'unknown_version'
  | 'invalid_entries';

/** Actionable validation problem surfaced during a persistence load. */
export interface PersistenceIssue {
  dataset: MerchantAppDataset;
  /** Storage key that contained the problematic payload. */
  key: string;
  code: PersistenceIssueCode;
  message: string;
  recordCount?: number;
  /** Storage key holding the original values for operator recovery. */
  quarantinedKey: string;
}

/** One rejected value kept for operator inspection. */
export interface QuarantinedRecord {
  /** Index in the original payload, when the rejection was entry-specific. */
  index?: number;
  reason: string;
  value: unknown;
}

/** Appended record of data that was not safe to restore directly. */
export interface QuarantinedPersistenceData {
  dataset: MerchantAppDataset;
  sourceKey: string;
  quarantinedAt: number;
  version: number;
  reason: PersistenceIssueCode;
  message: string;
  records: QuarantinedRecord[];
}

/** Validation/quarantine state for the active merchant. */
export interface MerchantAppPersistenceReport {
  merchantId: string;
  issues: PersistenceIssue[];
  quarantined: Record<MerchantAppDataset, QuarantinedPersistenceData[]>;
}

/** Outcome of an explicit recovery pass for one dataset. */
export interface MerchantAppRecoveryResult {
  dataset: MerchantAppDataset;
  restored: number;
  rejected: number;
  issues: PersistenceIssue[];
}

/**
 * Recovery model: a malformed payload or malformed entry is copied to a
 * per-merchant quarantine key and reported by `getPersistenceReport()`.
 * Valid records are restored normally, so queued payments are never silently
 * discarded. Operators can correct storage and call `reloadPersistedData()`,
 * or pass corrected records to `restoreDataset()`.
 */
export interface MerchantAppPersistenceConfig {
  /**
   * Copy legacy unscoped records into this merchant's scoped keys when the
   * scoped key is missing. Off by default so one account never inherits
   * another account's legacy data accidentally.
   */
  migrateLegacyKeys?: boolean;
  /** Remove the legacy key after a successful migration. Default: false. */
  removeLegacyKeysAfterMigration?: boolean;
  /** Storage implementation. Defaults to the global `localStorage` when present. */
  storage?: MerchantAppStorage;
}

export interface MerchantAppMigrationResult {
  migrated: MerchantAppDataset[];
  skipped: MerchantAppDataset[];
}

export interface MerchantAppConfig {
  rpcUrl: string;
  network: 'testnet' | 'mainnet' | 'standalone';
  merchantId: string;
  merchantKey: string;
  /** Optional remote acknowledgement hooks for non-payment queue items. */
  syncHandlers?: OfflineSyncHandlers;
  /** Merchant-scoped local persistence options. */
  persistence?: MerchantAppPersistenceConfig;
  /** Shorthand for `persistence.migrateLegacyKeys`. */
  migrateLegacyKeys?: boolean;
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

type EntryValidator = (entry: unknown) => string | null;

const SUPPORT_MESSAGE_STATUSES = new Set<SupportMessage['status']>([
  'pending',
  'sent',
  'read',
  'resolved',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const DATASET_VALIDATORS: Record<MerchantAppDataset, EntryValidator> = {
  offlineQueue(entry) {
    if (!isRecord(entry)) return 'entry must be an object';
    if (!isNonEmptyString(entry.id)) return 'id must be a non-empty string';
    if (
      entry.type !== 'payment' &&
      entry.type !== 'inventory_update' &&
      entry.type !== 'support_message'
    ) {
      return 'type must be payment, inventory_update, or support_message';
    }
    if (!isFiniteNumber(entry.timestamp)) return 'timestamp must be a finite number';
    if (!isFiniteNumber(entry.retryCount) || entry.retryCount < 0) {
      return 'retryCount must be a non-negative finite number';
    }
    if (!isRecord(entry.data)) return 'data must be an object';
    return null;
  },
  inventory(entry) {
    if (!isRecord(entry)) return 'entry must be an object';
    if (!isNonEmptyString(entry.id)) return 'id must be a non-empty string';
    if (!isNonEmptyString(entry.name)) return 'name must be a non-empty string';
    if (!isNonEmptyString(entry.category)) return 'category must be a non-empty string';
    if (!isFiniteNumber(entry.quantity) || entry.quantity < 0) {
      return 'quantity must be a non-negative finite number';
    }
    if (!isNonEmptyString(entry.unit)) return 'unit must be a non-empty string';
    if (typeof entry.price !== 'string') return 'price must be a string';
    if (!isFiniteNumber(entry.lastUpdated)) return 'lastUpdated must be a finite number';
    return null;
  },
  supportMessages(entry) {
    if (!isRecord(entry)) return 'entry must be an object';
    if (!isNonEmptyString(entry.id)) return 'id must be a non-empty string';
    if (!isNonEmptyString(entry.merchantId)) return 'merchantId must be a non-empty string';
    if (typeof entry.message !== 'string') return 'message must be a string';
    if (!isFiniteNumber(entry.timestamp)) return 'timestamp must be a finite number';
    if (typeof entry.isFromMerchant !== 'boolean') {
      return 'isFromMerchant must be a boolean';
    }
    if (typeof entry.status !== 'string' || !SUPPORT_MESSAGE_STATUSES.has(entry.status as SupportMessage['status'])) {
      return 'status is not a recognized support message status';
    }
    return null;
  },
};

export class MerchantApp {
  private sdk: MerchantNetworkSDK;
  private config: MerchantAppConfig;
  private offlineQueue: OfflineQueueItem[] = [];
  private inventory: InventoryItem[] = [];
  private supportMessages: SupportMessage[] = [];
  private isOnline: boolean = true;
  private syncInterval: NodeJS.Timeout | null = null;
  private syncHandlers: OfflineSyncHandlers;
  private persistence: MerchantAppPersistenceConfig;
  private persistenceIssues: PersistenceIssue[] = [];
  private queueSequence: number = 0;

  constructor(config: MerchantAppConfig) {
    this.config = config;
    this.syncHandlers = config.syncHandlers ?? {};
    this.persistence = {
      storage: config.persistence?.storage,
      migrateLegacyKeys: config.migrateLegacyKeys ?? config.persistence?.migrateLegacyKeys ?? false,
      removeLegacyKeysAfterMigration:
        config.persistence?.removeLegacyKeysAfterMigration ?? false,
    };
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

  // ============== Local Storage (Merchant-scoped) ==============

  private getStorageScope(): string {
    return encodeURIComponent(this.config.merchantId);
  }

  /** Stable storage keys for this merchant's datasets. */
  getStorageKeys(): Record<MerchantAppDataset, string> {
    const scope = this.getStorageScope();
    return {
      offlineQueue: `${MERCHANT_APP_STORAGE_PREFIX}:${scope}:${LEGACY_STORAGE_KEYS.offlineQueue}`,
      inventory: `${MERCHANT_APP_STORAGE_PREFIX}:${scope}:${LEGACY_STORAGE_KEYS.inventory}`,
      supportMessages: `${MERCHANT_APP_STORAGE_PREFIX}:${scope}:${LEGACY_STORAGE_KEYS.supportMessages}`,
    };
  }

  /**
   * Switch the active merchant without exposing the previous merchant's data.
   * The new account only sees records stored under its own scoped keys.
   */
  switchMerchant(merchantId: string, merchantKey: string = this.config.merchantKey): void {
    if (merchantId === this.config.merchantId) return;

    this.stopAutoSync();
    this.config = { ...this.config, merchantId, merchantKey };
    this.persistenceIssues = [];
    this.queueSequence = 0;
    this.offlineQueue = [];
    this.inventory = [];
    this.supportMessages = [];
    this.loadOfflineQueue();
    this.loadInventory();
    this.loadSupportMessages();
    this.startAutoSync();
  }

  /** Alias of `switchMerchant`. */
  switchAccount(merchantId: string, merchantKey?: string): void {
    this.switchMerchant(merchantId, merchantKey ?? this.config.merchantKey);
  }

  /**
   * Opt-in migration of legacy unscoped records into this merchant's keys.
   * Existing scoped data is never overwritten.
   */
  migrateLegacyData(
    options: { removeLegacyKeys?: boolean } = {}
  ): MerchantAppMigrationResult {
    const storage = this.getStorage();
    const keys = this.getStorageKeys();
    const result: MerchantAppMigrationResult = { migrated: [], skipped: [] };

    for (const dataset of MERCHANT_APP_DATASETS) {
      if (storage.getItem(keys[dataset]) !== null) {
        result.skipped.push(dataset);
        continue;
      }
      const legacyKey = LEGACY_STORAGE_KEYS[dataset];
      const legacy = storage.getItem(legacyKey);
      if (legacy === null || !this.canClaimLegacyDataset(storage, dataset, true)) {
        result.skipped.push(dataset);
        continue;
      }

      const restored = this.readDataset<any>(legacy, dataset, legacyKey);
      this.persistDataset(dataset, restored.records);
      this.applyDataset(dataset, restored.records);
      if (options.removeLegacyKeys ?? this.persistence.removeLegacyKeysAfterMigration) {
        storage.removeItem?.(legacyKey);
      }
      result.migrated.push(dataset);
    }
    return result;
  }

  private getStorage(): MerchantAppStorage {
    if (this.persistence.storage) return this.persistence.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return { getItem: () => null, setItem: () => undefined };
  }

  private legacyClaimKey(dataset: MerchantAppDataset): string {
    return `${MERCHANT_APP_STORAGE_PREFIX}:legacyMigration:${dataset}:owner`;
  }

  private canClaimLegacyDataset(
    storage: MerchantAppStorage,
    dataset: MerchantAppDataset,
    explicitMigration = false
  ): boolean {
    if (!explicitMigration && !this.persistence.migrateLegacyKeys) return false;
    const claimKey = this.legacyClaimKey(dataset);
    const owner = storage.getItem(claimKey);
    if (owner !== null && owner !== this.config.merchantId) return false;
    storage.setItem(claimKey, this.config.merchantId);
    return true;
  }

  /** Storage key holding rejected values for the active merchant/dataset. */
  getQuarantineKey(dataset: MerchantAppDataset): string {
    return `${MERCHANT_APP_STORAGE_PREFIX}:${this.getStorageScope()}:quarantine:${dataset}`;
  }

  /** Re-read local storage after an operator corrects a quarantined payload. */
  reloadPersistedData(): MerchantAppPersistenceReport {
    this.persistenceIssues = [];
    this.loadOfflineQueue();
    this.loadInventory();
    this.loadSupportMessages();
    return this.getPersistenceReport();
  }

  /** Issues and quarantined originals for the active merchant. */
  getPersistenceReport(): MerchantAppPersistenceReport {
    const quarantined = {} as Record<MerchantAppDataset, QuarantinedPersistenceData[]>;
    for (const dataset of MERCHANT_APP_DATASETS) {
      quarantined[dataset] = this.readQuarantineEntries(this.getQuarantineKey(dataset));
    }
    return {
      merchantId: this.config.merchantId,
      issues: [...this.persistenceIssues],
      quarantined,
    };
  }

  getPersistenceIssues(): PersistenceIssue[] {
    return [...this.persistenceIssues];
  }

  /**
   * Remove quarantined copies after remediation. This does not change the
   * active dataset; call `reloadPersistedData()` if storage was corrected.
   */
  clearQuarantine(dataset?: MerchantAppDataset): void {
    const datasets = dataset ? [dataset] : MERCHANT_APP_DATASETS;
    const storage = this.getStorage();
    for (const name of datasets) {
      const key = this.getQuarantineKey(name);
      if (storage.removeItem) {
        storage.removeItem(key);
      } else {
        storage.setItem(
          key,
          JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, entries: [] })
        );
      }
    }
    this.persistenceIssues = this.persistenceIssues.filter(
      issue => !datasets.includes(issue.dataset)
    );
  }

  /**
   * Explicit recovery path: validate supplied records, restore the valid ones,
   * and quarantine any that remain invalid.
   */
  restoreDataset(dataset: MerchantAppDataset, records: unknown[]): MerchantAppRecoveryResult {
    const validated = this.validateEntries<unknown>(records, DATASET_VALIDATORS[dataset]);
    if (validated.invalid.length > 0) {
      this.appendQuarantine(
        dataset,
        this.getStorageKeys()[dataset],
        'invalid_entries',
        `${validated.invalid.length} record(s) rejected during recovery`,
        validated.invalid
      );
    }
    this.persistDataset(dataset, validated.records);
    this.applyDataset(dataset, validated.records);
    return {
      dataset,
      restored: validated.records.length,
      rejected: validated.invalid.length,
      issues: this.persistenceIssues.filter(issue => issue.dataset === dataset),
    };
  }

  private recordPersistenceIssue(
    issue: Omit<PersistenceIssue, 'quarantinedKey'> & { quarantinedKey?: string }
  ): PersistenceIssue {
    const full: PersistenceIssue = {
      ...issue,
      quarantinedKey: issue.quarantinedKey ?? this.getQuarantineKey(issue.dataset),
    };
    const duplicate = this.persistenceIssues.some(existing =>
      existing.dataset === full.dataset &&
      existing.key === full.key &&
      existing.code === full.code &&
      existing.message === full.message
    );
    if (!duplicate) this.persistenceIssues.push(full);
    console.warn(
      `[merchant-app] ${full.code} in ${full.dataset} (${full.key}): ${full.message} Original value quarantined at ${full.quarantinedKey}`
    );
    return full;
  }

  private readQuarantineEntries(key: string): QuarantinedPersistenceData[] {
    const raw = this.getStorage().getItem(key);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return [];
      return parsed.entries
        .filter(isRecord)
        .filter(entry =>
          MERCHANT_APP_DATASETS.includes(entry.dataset as MerchantAppDataset) &&
          Array.isArray(entry.records)
        )
        .map(entry => entry as unknown as QuarantinedPersistenceData);
    } catch {
      return [];
    }
  }

  private appendQuarantine(
    dataset: MerchantAppDataset,
    sourceKey: string,
    reason: PersistenceIssueCode,
    message: string,
    records: QuarantinedRecord[]
  ): string {
    const key = this.getQuarantineKey(dataset);
    const storage = this.getStorage();
    const existing = this.readQuarantineEntries(key);
    const entry: QuarantinedPersistenceData = {
      dataset,
      sourceKey,
      quarantinedAt: Date.now(),
      version: MERCHANT_APP_PERSISTENCE_VERSION,
      reason,
      message,
      records,
    };
    const duplicate = existing.some(existingEntry =>
      existingEntry.sourceKey === sourceKey &&
      existingEntry.reason === reason &&
      existingEntry.message === message &&
      JSON.stringify(existingEntry.records) === JSON.stringify(records)
    );
    if (!duplicate) {
      try {
        storage.setItem(
          key,
          JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, entries: [...existing, entry] })
        );
      } catch (error) {
        console.warn(
          `[merchant-app] Unable to quarantine ${dataset} data at ${key}: ${syncErrorMessage(error)}`
        );
      }
    }
    this.recordPersistenceIssue({
      dataset,
      key: sourceKey,
      code: reason,
      message,
      recordCount: records.length,
      quarantinedKey: key,
    });
    return key;
  }

  private extractDatasetPayload(parsed: unknown): {
    entries: unknown[];
    version: number | null;
    recognized: boolean;
  } {
    if (Array.isArray(parsed)) {
      return { entries: parsed, version: null, recognized: true };
    }
    if (!isRecord(parsed)) {
      return { entries: [], version: null, recognized: false };
    }
    const rawVersion = parsed.version ?? parsed.schemaVersion;
    let version: number | null = null;
    if (isFiniteNumber(rawVersion)) {
      version = rawVersion;
    } else if (typeof rawVersion === 'string' && /^\d+$/.test(rawVersion)) {
      version = Number(rawVersion);
    } else if (rawVersion !== undefined) {
      return { entries: [], version: null, recognized: false };
    }
    const entries = parsed.data ?? parsed.items ?? parsed.records ?? parsed.payload;
    if (!Array.isArray(entries)) {
      return { entries: [], version, recognized: false };
    }
    return { entries, version, recognized: true };
  }

  private validateEntries<T>(
    entries: unknown[],
    validator: EntryValidator
  ): { records: T[]; invalid: QuarantinedRecord[] } {
    const records: T[] = [];
    const invalid: QuarantinedRecord[] = [];
    entries.forEach((entry, index) => {
      const reason = validator(entry);
      if (reason === null) {
        records.push(entry as T);
      } else {
        invalid.push({ index, reason, value: entry });
      }
    });
    return { records, invalid };
  }

  private readDataset<T>(
    raw: string,
    dataset: MerchantAppDataset,
    key: string
  ): { records: T[]; replaceSource: boolean } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.appendQuarantine(dataset, key, 'invalid_json', `Unreadable JSON (${syncErrorMessage(error)})`, [
        { reason: 'invalid_json', value: raw },
      ]);
      return { records: [], replaceSource: false };
    }

    const payload = this.extractDatasetPayload(parsed);
    const validated = this.validateEntries<T>(payload.entries, DATASET_VALIDATORS[dataset]);
    if (payload.version !== null && payload.version !== MERCHANT_APP_PERSISTENCE_VERSION) {
      const quarantined: QuarantinedRecord[] = [
        { reason: `Unknown schema version ${payload.version}`, value: parsed },
        ...validated.invalid,
      ];
      this.appendQuarantine(
        dataset,
        key,
        'unknown_version',
        `Unsupported schema version ${payload.version}; recovered ${validated.records.length} record(s)`,
        quarantined
      );
      return { records: validated.records, replaceSource: validated.records.length > 0 };
    }

    if (!payload.recognized) {
      this.appendQuarantine(dataset, key, 'unexpected_shape', 'Expected an array or a versioned payload with a data array', [
        { reason: 'unexpected_shape', value: parsed },
      ]);
      return { records: [], replaceSource: false };
    }

    if (validated.invalid.length > 0) {
      this.appendQuarantine(
        dataset,
        key,
        'invalid_entries',
        `${validated.invalid.length} invalid record(s) were quarantined`,
        validated.invalid
      );
    }
    return {
      records: validated.records,
      replaceSource:
        payload.version !== MERCHANT_APP_PERSISTENCE_VERSION || validated.invalid.length > 0,
    };
  }

  private loadDataset<T>(dataset: MerchantAppDataset): T[] {
    const storage = this.getStorage();
    const key = this.getStorageKeys()[dataset];
    const stored = storage.getItem(key);
    if (stored !== null) {
      const restored = this.readDataset<T>(stored, dataset, key);
      if (restored.replaceSource) this.persistDataset(dataset, restored.records);
      return restored.records;
    }

    const legacyKey = LEGACY_STORAGE_KEYS[dataset];
    const legacy = storage.getItem(legacyKey);
    if (legacy !== null && this.canClaimLegacyDataset(storage, dataset)) {
      const restored = this.readDataset<T>(legacy, dataset, legacyKey);
      this.persistDataset(dataset, restored.records);
      if (this.persistence.removeLegacyKeysAfterMigration) {
        storage.removeItem?.(legacyKey);
      }
      return restored.records;
    }
    return [];
  }

  private persistDataset<T>(dataset: MerchantAppDataset, value: T[]): void {
    try {
      this.getStorage().setItem(
        this.getStorageKeys()[dataset],
        JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, data: value })
      );
    } catch (error) {
      console.warn(
        `[merchant-app] Unable to persist ${dataset} data: ${syncErrorMessage(error)}`
      );
    }
  }

  private saveDataset<T>(dataset: MerchantAppDataset, value: T[]): void {
    this.persistDataset(dataset, value);
  }

  private applyDataset(dataset: MerchantAppDataset, value: unknown[]): void {
    if (dataset === 'offlineQueue') {
      this.offlineQueue = value as OfflineQueueItem[];
    } else if (dataset === 'inventory') {
      this.inventory = value as InventoryItem[];
    } else {
      this.supportMessages = value as SupportMessage[];
    }
  }

  private loadOfflineQueue(): void {
    this.offlineQueue = this.loadDataset<OfflineQueueItem>('offlineQueue');
  }

  private saveOfflineQueue(): void {
    this.saveDataset('offlineQueue', this.offlineQueue);
  }

  private loadInventory(): void {
    this.inventory = this.loadDataset<InventoryItem>('inventory');
  }

  private saveInventory(): void {
    this.saveDataset('inventory', this.inventory);
  }

  private loadSupportMessages(): void {
    this.supportMessages = this.loadDataset<SupportMessage>('supportMessages');
  }

  private saveSupportMessages(): void {
    this.saveDataset('supportMessages', this.supportMessages);
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