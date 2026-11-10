import {
  MerchantNetworkSDK,
  Merchant,
  Transaction,
  Settlement,
  PAYMENT_QR,
  PAYMENT_USSD,
  PAYMENT_OFFLINE,
} from './merchantNetwork';
import { ValidationError } from './errors';

const STORAGE_SCHEMA_VERSION = 1;

export interface MerchantStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface MerchantSyncHandlers {
  syncInventoryUpdate?: (item: OfflineQueueItem) => Promise<void>;
  syncSupportMessage?: (item: OfflineQueueItem) => Promise<void>;
}

export interface MerchantAppConfig {
  rpcUrl: string;
  network: 'testnet' | 'mainnet' | 'standalone';
  merchantId: string;
  merchantKey: string;
  storage?: MerchantStorageAdapter;
  autoSync?: boolean;
  migrateLegacyStorage?: boolean;
  syncHandlers?: MerchantSyncHandlers;
  sdk?: MerchantNetworkSDK;
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

export interface SaleLineItem {
  itemId: string;
  quantity: number;
}

export interface SyncItemOutcome {
  id: string;
  type: OfflineQueueItem['type'] | string;
  status: 'synced' | 'failed' | 'unsupported';
  error?: string;
}

export interface OfflineQueueSyncSummary {
  syncedCount: number;
  failedCount: number;
  unsupportedCount: number;
  outcomes: SyncItemOutcome[];
}

export interface StorageDiagnostic {
  dataset: 'offlineQueue' | 'inventory' | 'supportMessages';
  key: string;
  reason: string;
  quarantinedEntriesCount: number;
  rawPayload?: string;
}

interface PersistedEnvelope<T> {
  version: number;
  merchantId: string;
  data: T[];
}

/**
 * Browser storage adapter backed by `globalThis.localStorage`.
 * Surfaces explicit contextual errors when `localStorage` is unavailable or fails.
 */
export function createBrowserStorageAdapter(): MerchantStorageAdapter {
  const getStore = (): any => {
    const ls = typeof globalThis !== 'undefined' ? (globalThis as any).localStorage : undefined;
    if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') {
      throw new Error('Browser localStorage is unavailable in this environment');
    }
    return ls;
  };

  return {
    getItem(key: string): string | null {
      try {
        return getStore().getItem(key);
      } catch (err: any) {
        throw new Error(`Storage read failed for key '${key}': ${err?.message || String(err)}`);
      }
    },
    setItem(key: string, value: string): void {
      try {
        getStore().setItem(key, value);
      } catch (err: any) {
        throw new Error(`Storage write failed for key '${key}': ${err?.message || String(err)}`);
      }
    },
    removeItem(key: string): void {
      try {
        const store = getStore();
        if (typeof store.removeItem === 'function') {
          store.removeItem(key);
        }
      } catch (err: any) {
        throw new Error(`Storage delete failed for key '${key}': ${err?.message || String(err)}`);
      }
    },
  };
}

/**
 * In-memory synchronous storage adapter.
 *
 * React Native callers can hydrate an in-memory cache from AsyncStorage before
 * instantiating `MerchantApp` and mirror writes back to AsyncStorage cleanly
 * without coupling the SDK core to a React Native dependency.
 */
export function createInMemoryStorageAdapter(
  initialData: Record<string, string> = {}
): MerchantStorageAdapter {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    getItem: (key: string): string | null => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
  };
}

function getDefaultStorageAdapter(): MerchantStorageAdapter {
  const hasBrowserStorage =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).localStorage?.getItem === 'function' &&
    typeof (globalThis as any).localStorage?.setItem === 'function';

  return hasBrowserStorage ? createBrowserStorageAdapter() : createInMemoryStorageAdapter();
}

/**
 * Merchant App - Lightweight React Native / Web SDK client
 */
export class MerchantApp {
  private sdk: MerchantNetworkSDK;
  private config: MerchantAppConfig;
  private storage: MerchantStorageAdapter;
  private offlineQueue: OfflineQueueItem[] = [];
  private inventory: InventoryItem[] = [];
  private supportMessages: SupportMessage[] = [];
  private unsupportedQueueItems: OfflineQueueItem[] = [];
  private storageDiagnostics: StorageDiagnostic[] = [];
  private lastSyncSummary: OfflineQueueSyncSummary = {
    syncedCount: 0,
    failedCount: 0,
    unsupportedCount: 0,
    outcomes: [],
  };
  private isOnline: boolean = true;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(config: MerchantAppConfig) {
    if (!config.merchantId || typeof config.merchantId !== 'string' || !config.merchantId.trim()) {
      throw new ValidationError('merchantId', 'merchantId must be a non-empty string');
    }

    this.config = config;
    this.storage = config.storage ?? getDefaultStorageAdapter();
    this.sdk =
      config.sdk ??
      new MerchantNetworkSDK({
        rpcUrl: config.rpcUrl,
        network: config.network,
        contractIds: {
          merchantNetwork: 'MERCHANT_NETWORK_CONTRACT_ID',
        },
      });

    this.loadOfflineQueue();
    this.loadInventory();
    this.loadSupportMessages();

    if (config.autoSync !== false) {
      this.startAutoSync();
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
   * Process payment with multiple payment methods.
   * When `saleItems` are provided, validates stock upfront and decrements
   * inventory deterministically ONLY after online payment confirmation.
   */
  async processPayment(
    beneficiaryId: string,
    amount: string,
    token: string = 'USDC',
    purpose: string = 'Aid Purchase',
    paymentMethod: number = PAYMENT_QR,
    saleItems?: SaleLineItem[]
  ): Promise<string> {
    if (saleItems !== undefined) {
      this.validateSaleItems(saleItems);
    }

    if (!this.isOnline) {
      return this.queueOfflinePayment(beneficiaryId, amount, token, purpose, saleItems);
    }

    try {
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

      if (saleItems && saleItems.length > 0) {
        this.applySaleToInventory(saleItems);
      }

      return transactionId;
    } catch (error) {
      console.error('Online payment failed, queuing for offline:', error);
      return this.queueOfflinePayment(beneficiaryId, amount, token, purpose, saleItems);
    }
  }

  /**
   * Queue offline payment for later sync
   */
  private async queueOfflinePayment(
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    saleItems?: SaleLineItem[]
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
        signature: this.generateOfflineSignature(beneficiaryId, amount),
        ...(saleItems ? { saleItems } : {}),
      },
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.offlineQueue.push(queueItem);
    this.saveOfflineQueue();

    return offlineId;
  }

  private generateOfflineSignature(beneficiaryId: string, amount: string): string {
    const data = `${beneficiaryId}:${amount}:${Date.now()}`;
    if (typeof btoa === 'function') {
      return btoa(data);
    }
    return Buffer.from(data, 'utf8').toString('base64');
  }

  /**
   * Synchronizes all queued offline items (`payment`, `inventory_update`, `support_message`)
   * with per-item outcomes so partial success does not discard unsynced work.
   */
  async syncOfflineQueue(): Promise<OfflineQueueSyncSummary> {
    if (this.offlineQueue.length === 0) {
      this.lastSyncSummary = { syncedCount: 0, failedCount: 0, unsupportedCount: 0, outcomes: [] };
      return this.lastSyncSummary;
    }

    const snapshot = [...this.offlineQueue];
    const remaining: OfflineQueueItem[] = [];
    const outcomes: SyncItemOutcome[] = [];
    let syncedCount = 0;
    let failedCount = 0;
    let unsupportedCount = 0;

    for (const item of snapshot) {
      if (item.type === 'payment') {
        try {
          const synced = await this.sdk.syncOfflineTransactions(
            this.config.merchantKey,
            this.config.merchantId,
            [item.id]
          );
          if (synced >= 1) {
            syncedCount++;
            outcomes.push({ id: item.id, type: item.type, status: 'synced' });
            const saleItems = item.data?.saleItems as SaleLineItem[] | undefined;
            if (Array.isArray(saleItems) && saleItems.length > 0) {
              this.applySaleToInventory(saleItems);
            }
          } else {
            failedCount++;
            item.retryCount++;
            remaining.push(item);
            outcomes.push({
              id: item.id,
              type: item.type,
              status: 'failed',
              error: 'SDK did not confirm payment sync',
            });
          }
        } catch (err: any) {
          failedCount++;
          item.retryCount++;
          remaining.push(item);
          outcomes.push({
            id: item.id,
            type: item.type,
            status: 'failed',
            error: err?.message || String(err),
          });
        }
      } else if (item.type === 'inventory_update') {
        const handler = this.config.syncHandlers?.syncInventoryUpdate;
        if (!handler) {
          unsupportedCount++;
          this.unsupportedQueueItems.push(item);
          outcomes.push({
            id: item.id,
            type: item.type,
            status: 'unsupported',
            error: 'No inventory_update sync handler configured',
          });
          continue;
        }
        try {
          await handler(item);
          syncedCount++;
          outcomes.push({ id: item.id, type: item.type, status: 'synced' });
        } catch (err: any) {
          failedCount++;
          item.retryCount++;
          remaining.push(item);
          outcomes.push({
            id: item.id,
            type: item.type,
            status: 'failed',
            error: err?.message || String(err),
          });
        }
      } else if (item.type === 'support_message') {
        const handler = this.config.syncHandlers?.syncSupportMessage;
        try {
          if (handler) {
            await handler(item);
          } else if (item.data?.supportMessage) {
            await this.syncSupportMessage(item.data.supportMessage);
          } else {
            unsupportedCount++;
            this.unsupportedQueueItems.push(item);
            outcomes.push({
              id: item.id,
              type: item.type,
              status: 'unsupported',
              error: 'Missing support message payload or sync handler',
            });
            continue;
          }
          syncedCount++;
          outcomes.push({ id: item.id, type: item.type, status: 'synced' });
        } catch (err: any) {
          failedCount++;
          item.retryCount++;
          remaining.push(item);
          outcomes.push({
            id: item.id,
            type: item.type,
            status: 'failed',
            error: err?.message || String(err),
          });
        }
      } else {
        unsupportedCount++;
        this.unsupportedQueueItems.push(item);
        outcomes.push({
          id: item.id,
          type: (item as any).type,
          status: 'unsupported',
          error: `Unsupported offline queue item type '${String((item as any).type)}'`,
        });
      }
    }

    this.offlineQueue = remaining;
    this.saveOfflineQueue();

    this.lastSyncSummary = { syncedCount, failedCount, unsupportedCount, outcomes };
    return this.lastSyncSummary;
  }

  /**
   * Sync queued offline entries and return the count of items successfully synced.
   */
  async syncOfflineTransactions(): Promise<number> {
    const summary = await this.syncOfflineQueue();
    return summary.syncedCount;
  }

  getLastSyncSummary(): OfflineQueueSyncSummary {
    return this.lastSyncSummary;
  }

  getUnsupportedQueueItems(): OfflineQueueItem[] {
    return [...this.unsupportedQueueItems];
  }

  getQueuedItems(): OfflineQueueItem[] {
    return [...this.offlineQueue];
  }

  /**
   * Scan QR code and process payment
   */
  async processQRPayment(qrData: string): Promise<string> {
    const parts = qrData.split('|');

    if (parts.length < 3) {
      throw new Error('Invalid QR code format');
    }

    const merchantId = parts[0];
    const amount = parts[1];
    const transferCode = parts[2];

    if (merchantId !== this.config.merchantId) {
      throw new Error('QR code is for a different merchant');
    }

    return this.processPayment(transferCode, amount, 'USDC', 'QR Payment', PAYMENT_QR);
  }

  /**
   * Process USSD payment
   */
  async processUSSDPayment(ussdCode: string): Promise<string> {
    const { merchantCode, amount } = this.sdk.parseUSSDCode(ussdCode);

    if (!merchantCode || amount === '0') {
      throw new Error('Invalid USSD code format');
    }

    if (merchantCode !== this.config.merchantId.substring(0, 6)) {
      throw new Error('Invalid merchant code');
    }

    return this.processPayment('ussd_beneficiary', amount, 'USDC', 'USSD Payment', PAYMENT_USSD);
  }

  getPendingOfflineCount(): number {
    return this.offlineQueue.length;
  }

  async generateShopQR(): Promise<string> {
    const qrData = await this.sdk.generateQRCode(this.config.merchantId);
    return JSON.stringify(qrData);
  }

  async generateTransactionQR(amount: string, transferCode: string): Promise<string> {
    const qrData = await this.sdk.generateTransactionQR(this.config.merchantId, amount, transferCode);
    return JSON.stringify(qrData);
  }

  // ============== Inventory Management ==============

  addInventoryItem(item: Omit<InventoryItem, 'id' | 'lastUpdated'>): string {
    const newItem: InventoryItem = {
      ...item,
      id: `inv_${Date.now()}_${this.inventory.length}`,
      lastUpdated: Date.now(),
    };

    this.inventory.push(newItem);
    this.saveInventory();

    return newItem.id;
  }

  getInventory(): InventoryItem[] {
    return [...this.inventory];
  }

  updateInventoryItem(itemId: string, updates: Partial<InventoryItem>): void {
    const itemIndex = this.inventory.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      throw new Error('Inventory item not found');
    }

    this.inventory[itemIndex] = {
      ...this.inventory[itemIndex],
      ...updates,
      lastUpdated: Date.now(),
    };

    this.saveInventory();

    if (!this.isOnline) {
      this.queueInventoryUpdate(itemId, updates);
    }
  }

  private validateSaleItems(saleItems: SaleLineItem[]): Map<string, number> {
    if (!Array.isArray(saleItems)) {
      throw new ValidationError('saleItems', 'saleItems must be an array');
    }

    const totalsByItem = new Map<string, number>();
    for (const line of saleItems) {
      if (!line || typeof line.itemId !== 'string' || !line.itemId.trim()) {
        throw new ValidationError('itemId', 'Sale line itemId must be a non-empty string');
      }
      if (typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new ValidationError('quantity', 'Sale line quantity must be a positive integer', {
          itemId: line.itemId,
          quantity: line.quantity,
        });
      }
      totalsByItem.set(line.itemId, (totalsByItem.get(line.itemId) ?? 0) + line.quantity);
    }

    for (const [itemId, totalQty] of totalsByItem.entries()) {
      const invItem = this.inventory.find((i) => i.id === itemId);
      if (!invItem) {
        throw new ValidationError('itemId', `Unknown inventory item '${itemId}'`, { itemId });
      }
      if (invItem.quantity < totalQty) {
        throw new ValidationError(
          'quantity',
          `Insufficient stock for item '${itemId}': requested ${totalQty}, available ${invItem.quantity}`,
          { itemId, requested: totalQty, available: invItem.quantity }
        );
      }
    }

    return totalsByItem;
  }

  /**
   * Deterministically decrements inventory quantities from explicit itemized sale lines.
   * Validates all items and stock bounds atomically before mutating inventory.
   */
  applySaleToInventory(saleItems: SaleLineItem[]): void {
    const totalsByItem = this.validateSaleItems(saleItems);
    if (totalsByItem.size === 0) {
      return;
    }

    const now = Date.now();
    for (const [itemId, qty] of totalsByItem.entries()) {
      const invItem = this.inventory.find((i) => i.id === itemId)!;
      invItem.quantity -= qty;
      invItem.lastUpdated = now;
    }

    this.saveInventory();
  }

  getInventoryByCategory(category: string): InventoryItem[] {
    return this.inventory.filter((item) => item.category === category);
  }

  getLowStockItems(threshold: number = 10): InventoryItem[] {
    return this.inventory.filter((item) => item.quantity < threshold);
  }

  private queueInventoryUpdate(itemId: string, updates: Partial<InventoryItem>): void {
    const queueItem: OfflineQueueItem = {
      id: `inv_update_${Date.now()}_${this.offlineQueue.length}`,
      type: 'inventory_update',
      data: { itemId, updates },
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.offlineQueue.push(queueItem);
    this.saveOfflineQueue();
  }

  // ============== Customer Support ==============

  async sendSupportMessage(message: string): Promise<string> {
    const supportMessage: SupportMessage = {
      id: `support_${Date.now()}_${this.supportMessages.length}`,
      merchantId: this.config.merchantId,
      message,
      timestamp: Date.now(),
      isFromMerchant: true,
      status: 'pending',
    };

    this.supportMessages.push(supportMessage);
    this.saveSupportMessages();

    if (this.isOnline) {
      return this.syncSupportMessage(supportMessage);
    }

    this.offlineQueue.push({
      id: `support_queue_${supportMessage.id}`,
      type: 'support_message',
      data: { supportMessage },
      timestamp: Date.now(),
      retryCount: 0,
    });
    this.saveOfflineQueue();

    return supportMessage.id;
  }

  private async syncSupportMessage(message: SupportMessage): Promise<string> {
    const existing = this.supportMessages.find((m) => m.id === message.id);
    if (existing) {
      existing.status = 'sent';
    } else {
      message.status = 'sent';
    }
    this.saveSupportMessages();
    return message.id;
  }

  getSupportMessages(): SupportMessage[] {
    return this.supportMessages;
  }

  getUnreadSupportMessages(): SupportMessage[] {
    return this.supportMessages.filter(
      (msg) => !msg.isFromMerchant && msg.status !== 'read' && msg.status !== 'resolved'
    );
  }

  // ============== Network Status ==============

  checkOnlineStatus(): boolean {
    return this.isOnline;
  }

  setOnlineStatus(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (wasOffline && online) {
      this.syncOfflineTransactions().catch((err) =>
        console.error('Auto-sync on reconnect failed:', err)
      );
    }
  }

  private startAutoSync(): void {
    this.syncInterval = setInterval(() => {
      if (this.isOnline && this.offlineQueue.length > 0) {
        this.syncOfflineTransactions().catch((err) => console.error('Auto-sync failed:', err));
      }
    }, 5 * 60 * 1000);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ============== Namespaced & Validated Storage ==============

  private getScopedKey(dataset: 'offlineQueue' | 'inventory' | 'supportMessages'): string {
    return `merchant:${encodeURIComponent(this.config.merchantId)}:${dataset}`;
  }

  getStorageDiagnostics(): StorageDiagnostic[] {
    return [...this.storageDiagnostics];
  }

  private readStorageItem(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch (error: any) {
      throw new Error(
        `Failed to read merchant storage for '${this.config.merchantId}' (key '${key}'): ${error?.message || String(error)}`
      );
    }
  }

  private writeStorageEnvelope<T>(
    dataset: 'offlineQueue' | 'inventory' | 'supportMessages',
    data: T[]
  ): void {
    const key = this.getScopedKey(dataset);
    const envelope: PersistedEnvelope<T> = {
      version: STORAGE_SCHEMA_VERSION,
      merchantId: this.config.merchantId,
      data,
    };
    try {
      this.storage.setItem(key, JSON.stringify(envelope));
    } catch (error: any) {
      throw new Error(
        `Failed to persist ${dataset} for merchant '${this.config.merchantId}' (key '${key}'): ${error?.message || String(error)}`
      );
    }
  }

  private loadValidatedDataset<T>(
    dataset: 'offlineQueue' | 'inventory' | 'supportMessages',
    validator: (entry: unknown) => entry is T
  ): T[] {
    const scopedKey = this.getScopedKey(dataset);
    let raw = this.readStorageItem(scopedKey);
    let fromLegacy = false;

    if (raw === null && this.config.migrateLegacyStorage === true) {
      const legacyRaw = this.readStorageItem(dataset);
      if (legacyRaw !== null) {
        raw = legacyRaw;
        fromLegacy = true;
      }
    }

    if (raw === null || raw === '') {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      this.quarantineRaw(dataset, scopedKey, `Invalid JSON: ${err?.message || String(err)}`, raw);
      return [];
    }

    let candidateList: unknown;
    if (Array.isArray(parsed)) {
      // Legacy un-enveloped array payload
      candidateList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const envObj = parsed as Partial<PersistedEnvelope<unknown>>;
      if (envObj.version !== STORAGE_SCHEMA_VERSION) {
        this.quarantineRaw(
          dataset,
          scopedKey,
          `Unsupported schema version: ${String(envObj.version)}`,
          raw
        );
        return [];
      }
      if (envObj.merchantId && envObj.merchantId !== this.config.merchantId) {
        this.quarantineRaw(
          dataset,
          scopedKey,
          `Merchant mismatch in persisted envelope: expected '${this.config.merchantId}', got '${envObj.merchantId}'`,
          raw
        );
        return [];
      }
      if (!Array.isArray(envObj.data)) {
        this.quarantineRaw(dataset, scopedKey, 'Persisted envelope data is not an array', raw);
        return [];
      }
      candidateList = envObj.data;
    } else {
      this.quarantineRaw(dataset, scopedKey, 'Persisted top-level value must be an array or envelope', raw);
      return [];
    }

    const valid: T[] = [];
    const invalid: unknown[] = [];
    for (const entry of candidateList as unknown[]) {
      if (validator(entry)) {
        valid.push(entry);
      } else {
        invalid.push(entry);
      }
    }

    if (invalid.length > 0) {
      const quarantineKey = `${scopedKey}:quarantine`;
      try {
        this.storage.setItem(quarantineKey, JSON.stringify(invalid));
      } catch (_err) {
        // Ignore secondary quarantine write errors while keeping diagnostic
      }
      this.storageDiagnostics.push({
        dataset,
        key: scopedKey,
        reason: `Quarantined ${invalid.length} malformed ${dataset} record(s)`,
        quarantinedEntriesCount: invalid.length,
      });
    }

    if (fromLegacy && valid.length > 0) {
      this.writeStorageEnvelope(dataset, valid);
    }

    return valid;
  }

  private quarantineRaw(
    dataset: 'offlineQueue' | 'inventory' | 'supportMessages',
    scopedKey: string,
    reason: string,
    rawPayload: string
  ): void {
    const quarantineKey = `${scopedKey}:quarantine`;
    try {
      this.storage.setItem(quarantineKey, rawPayload);
    } catch (_err) {
      // Diagnostic is still captured in memory
    }
    this.storageDiagnostics.push({
      dataset,
      key: scopedKey,
      reason,
      quarantinedEntriesCount: 1,
      rawPayload,
    });
  }

  private isValidQueueItem = (entry: unknown): entry is OfflineQueueItem => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<OfflineQueueItem>;
    const validType =
      item.type === 'payment' ||
      item.type === 'inventory_update' ||
      item.type === 'support_message';
    return (
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      validType &&
      item.data !== undefined &&
      item.data !== null &&
      typeof item.data === 'object' &&
      typeof item.timestamp === 'number' &&
      Number.isFinite(item.timestamp) &&
      typeof item.retryCount === 'number' &&
      Number.isInteger(item.retryCount) &&
      item.retryCount >= 0
    );
  };

  private isValidInventoryItem = (entry: unknown): entry is InventoryItem => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<InventoryItem>;
    return (
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      typeof item.name === 'string' &&
      typeof item.category === 'string' &&
      typeof item.quantity === 'number' &&
      Number.isFinite(item.quantity) &&
      item.quantity >= 0 &&
      typeof item.unit === 'string' &&
      typeof item.price === 'string' &&
      typeof item.lastUpdated === 'number' &&
      Number.isFinite(item.lastUpdated)
    );
  };

  private isValidSupportMessage = (entry: unknown): entry is SupportMessage => {
    if (!entry || typeof entry !== 'object') return false;
    const msg = entry as Partial<SupportMessage>;
    const validStatus =
      msg.status === 'pending' ||
      msg.status === 'sent' ||
      msg.status === 'read' ||
      msg.status === 'resolved';
    return (
      typeof msg.id === 'string' &&
      msg.id.length > 0 &&
      typeof msg.merchantId === 'string' &&
      msg.merchantId === this.config.merchantId &&
      typeof msg.message === 'string' &&
      typeof msg.timestamp === 'number' &&
      Number.isFinite(msg.timestamp) &&
      typeof msg.isFromMerchant === 'boolean' &&
      validStatus
    );
  };

  private loadOfflineQueue(): void {
    this.offlineQueue = this.loadValidatedDataset('offlineQueue', this.isValidQueueItem);
  }

  private saveOfflineQueue(): void {
    this.writeStorageEnvelope('offlineQueue', this.offlineQueue);
  }

  private loadInventory(): void {
    this.inventory = this.loadValidatedDataset('inventory', this.isValidInventoryItem);
  }

  private saveInventory(): void {
    this.writeStorageEnvelope('inventory', this.inventory);
  }

  private loadSupportMessages(): void {
    this.supportMessages = this.loadValidatedDataset('supportMessages', this.isValidSupportMessage);
  }

  private saveSupportMessages(): void {
    this.writeStorageEnvelope('supportMessages', this.supportMessages);
  }

  // ============== Settlement ==============

  async getSettlementHistory(): Promise<Settlement[]> {
    return this.sdk.getSettlementHistory(this.config.merchantId);
  }

  async getMerchantStats() {
    return this.sdk.getMerchantStats(this.config.merchantId);
  }

  async getRecentTransactions(limit: number = 10): Promise<Transaction[]> {
    const transactions = await this.sdk.getMerchantTransactions(this.config.merchantId);
    return transactions.slice(-limit);
  }

  // ============== Cleanup ==============

  destroy(): void {
    this.stopAutoSync();
  }
}

export default MerchantApp;
