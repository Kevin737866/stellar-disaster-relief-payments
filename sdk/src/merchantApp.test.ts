import {
  LEGACY_STORAGE_KEYS,
  MERCHANT_APP_PERSISTENCE_VERSION,
  InventoryItem,
  MerchantApp,
  MerchantAppDataset,
  OfflineQueueItem,
  OfflineSyncResult,
  SupportMessage,
} from './merchantApp';

jest.mock('./merchantNetwork', () => {
  const syncOfflineTransactions = jest.fn();
  return {
    MerchantNetworkSDK: jest.fn().mockImplementation(() => ({
      syncOfflineTransactions,
      getMerchant: jest.fn(),
      processPayment: jest.fn(),
      parseUSSDCode: jest.fn(),
      generateQRCode: jest.fn(),
      generateTransactionQR: jest.fn(),
      getSettlementHistory: jest.fn(),
      getMerchantStats: jest.fn(),
      getMerchantTransactions: jest.fn(),
    })),
    syncOfflineTransactions,
    PAYMENT_QR: 0,
    PAYMENT_USSD: 1,
    PAYMENT_OFFLINE: 3,
    CATEGORY_FOOD: 0,
    CATEGORY_MEDICAL: 3,
  };
});

const { syncOfflineTransactions: mockNetworkSync } = jest.requireMock('./merchantNetwork');

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  get length(): number {
    return this.values.size;
  }
}

function makeItem(overrides: Partial<OfflineQueueItem> = {}): OfflineQueueItem {
  return {
    id: 'queue-1',
    type: 'payment',
    data: {},
    timestamp: Date.now(),
    retryCount: 0,
    ...overrides,
  };
}

function parseStoredPayload<T>(raw: string | null): T[] {
  if (raw === null) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).data)) {
    return (parsed as any).data as T[];
  }
  return [];
}

function storedDataset<T>(app: MerchantApp, dataset: MerchantAppDataset): T[] {
  return parseStoredPayload<T>(localStorage.getItem(app.getStorageKeys()[dataset]));
}

function storedQueue(app: MerchantApp): OfflineQueueItem[] {
  return storedDataset<OfflineQueueItem>(app, 'offlineQueue');
}

describe('MerchantApp offline queue sync', () => {
  const apps: MerchantApp[] = [];
  let storage: MemoryStorage;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    storage = new MemoryStorage();
    (global as any).localStorage = storage;
    mockNetworkSync.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    apps.splice(0).forEach(app => app.destroy());
    warnSpy.mockRestore();
  });

  function createApp(config: Partial<ConstructorParameters<typeof MerchantApp>[0]> = {}): MerchantApp {
    const app = new MerchantApp({
      rpcUrl: 'http://localhost:8000',
      network: 'testnet',
      merchantId: 'merchant-1',
      merchantKey: 'merchant-key',
      ...config,
      persistence: { storage, ...config.persistence },
    });
    apps.push(app);
    return app;
  }

  function setQueue(app: MerchantApp, items: OfflineQueueItem[]): void {
    (app as any).offlineQueue = items;
    localStorage.setItem(app.getStorageKeys().offlineQueue, JSON.stringify(items));
  }

  it('returns an empty report for an empty queue without calling the network', async () => {
    const app = createApp();

    const result = await app.syncOfflineTransactions();

    expect(result).toMatchObject({
      success: true,
      syncedCount: 0,
      failedCount: 0,
      unsupportedCount: 0,
      remainingCount: 0,
      syncedIds: [],
      failedIds: [],
      unsupportedIds: [],
      results: [],
    });
    expect(mockNetworkSync).not.toHaveBeenCalled();
  });

  it('syncs mixed queue types, removing successes and retaining failures and unsupported items', async () => {
    const app = createApp();
    (app as any).inventory = [
      {
        id: 'inv-1',
        name: 'Water',
        category: 'food',
        quantity: 1,
        unit: 'L',
        price: '1',
        lastUpdated: 0,
      },
    ];
    (app as any).supportMessages = [
      {
        id: 'support-1',
        merchantId: 'merchant-1',
        message: 'Need more water',
        timestamp: 1,
        isFromMerchant: true,
        status: 'pending',
      },
    ];

    mockNetworkSync.mockImplementation(async (_key: string, _id: string, ids: string[]) =>
      ids[0] === 'pay-1' ? 1 : Promise.reject(new Error('network unavailable'))
    );

    setQueue(app, [
      makeItem({ id: 'pay-1', type: 'payment' }),
      makeItem({ id: 'pay-2', type: 'payment', retryCount: 2 }),
      makeItem({
        id: 'inv-1',
        type: 'inventory_update',
        data: { itemId: 'inv-1', updates: { quantity: 12 } },
      }),
      makeItem({
        id: 'sup-1',
        type: 'support_message',
        data: { id: 'support-1', messageId: 'support-1' },
      }),
      makeItem({ id: 'unknown-1', type: 'future_type' as any }),
    ]);

    const result: OfflineSyncResult = await app.syncOfflineTransactions();

    expect(result.success).toBe(false);
    expect(result.syncedCount).toBe(3);
    expect(result.failedCount).toBe(1);
    expect(result.unsupportedCount).toBe(1);
    expect(result.remainingCount).toBe(2);
    expect(result.syncedIds).toEqual(['pay-1', 'inv-1', 'sup-1']);
    expect(result.failedIds).toEqual(['pay-2']);
    expect(result.unsupportedIds).toEqual(['unknown-1']);
    expect(result.unsupportedTypes).toEqual(['future_type']);
    expect(result.failed[0].reason).toContain('network unavailable');
    expect(result.failed[0].retryCount).toBe(3);
    expect(result.unsupported[0].reason).toMatch(/unsupported/i);
    expect(result.outcomes).toEqual(result.results);
    expect(result.syncedItems.map(item => item.id)).toEqual(result.syncedIds);
    expect(result.unsupportedItems[0].type).toBe('future_type');

    expect(app.getOfflineQueue().map(item => item.id)).toEqual(['pay-2', 'unknown-1']);
    expect(app.getPendingOfflineCount()).toBe(2);
    expect(app.getPendingPaymentCount()).toBe(1);
    expect(storedQueue(app).map(item => item.id)).toEqual(['pay-2', 'unknown-1']);

    expect((app as any).inventory[0].quantity).toBe(12);
    expect((app as any).supportMessages[0].status).toBe('sent');
    expect(mockNetworkSync).toHaveBeenCalledTimes(2);
    expect(mockNetworkSync).toHaveBeenNthCalledWith(1, 'merchant-key', 'merchant-1', ['pay-1']);
    expect(mockNetworkSync).toHaveBeenNthCalledWith(2, 'merchant-key', 'merchant-1', ['pay-2']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('keeps failed items retryable and removes them once a retry succeeds', async () => {
    const app = createApp();
    setQueue(app, [makeItem({ id: 'pay-retry', type: 'payment' })]);

    mockNetworkSync
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(1);

    const first = await app.syncOfflineTransactions();
    expect(first.failedCount).toBe(1);
    expect(first.failed[0].retryCount).toBe(1);
    expect(app.getOfflineQueue()).toHaveLength(1);
    expect(app.getOfflineQueue()[0].retryCount).toBe(1);

    const second = await app.syncOfflineTransactions();
    expect(second.syncedCount).toBe(1);
    expect(second.failedCount).toBe(0);
    expect(second.success).toBe(true);
    expect(second.results[0].retryCount).toBe(1);
    expect(app.getOfflineQueue()).toHaveLength(0);
    expect(storedQueue(app)).toHaveLength(0);
    expect(mockNetworkSync).toHaveBeenCalledTimes(2);
  });

  it('treats a zero acknowledgement from the network as a retryable failure', async () => {
    const app = createApp();
    setQueue(app, [makeItem({ id: 'pay-unacked', type: 'payment' })]);
    mockNetworkSync.mockResolvedValue(0);

    const result = await app.syncOfflineTransactions();

    expect(result.failedCount).toBe(1);
    expect(result.failed[0].reason).toMatch(/not acknowledged/i);
    expect(app.getOfflineQueue()[0].retryCount).toBe(1);
  });

  it('queues offline inventory and support work and acknowledges both on sync', async () => {
    const app = createApp();
    app.setOnlineStatus(false);
    app.addInventoryItem({
      name: 'Medicine',
      category: 'medical',
      quantity: 4,
      unit: 'box',
      price: '5',
    });
    const inventoryId = app.getInventoryByCategory('medical')[0].id;
    app.updateInventoryItem(inventoryId, { quantity: 2 });
    const messageId = await app.sendSupportMessage('Field team please restock');

    const queued = app.getOfflineQueue();
    expect(queued.map(item => item.type)).toEqual(['inventory_update', 'support_message']);
    expect(queued[1].data.messageId).toBe(messageId);

    const result = await app.syncOfflineTransactions();

    expect(result.syncedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(app.getOfflineQueue()).toHaveLength(0);
    expect(app.getInventoryByCategory('medical')[0].quantity).toBe(2);
    expect(app.getSupportMessages().find(message => message.id === messageId)?.status).toBe('sent');
    expect(mockNetworkSync).not.toHaveBeenCalled();
  });

  it('keeps inventory and support items retryable when their acknowledgement handlers reject', async () => {
    const inventoryUpdate = jest.fn().mockRejectedValue(new Error('inventory API down'));
    const supportMessage = jest.fn().mockRejectedValue(new Error('support API down'));
    const app = createApp({ syncHandlers: { inventoryUpdate, supportMessage } });
    (app as any).inventory = [
      {
        id: 'inv-2',
        name: 'Food',
        category: 'food',
        quantity: 1,
        unit: 'kg',
        price: '2',
        lastUpdated: 0,
      },
    ];
    (app as any).supportMessages = [
      {
        id: 'support-2',
        merchantId: 'merchant-1',
        message: 'hello',
        timestamp: 1,
        isFromMerchant: true,
        status: 'pending',
      },
    ];
    setQueue(app, [
      makeItem({
        id: 'inv-fail',
        type: 'inventory_update',
        data: { itemId: 'inv-2', updates: { quantity: 9 } },
      }),
      makeItem({
        id: 'sup-fail',
        type: 'support_message',
        data: { id: 'support-2' },
      }),
    ]);

    const result = await app.syncOfflineTransactions();

    expect(result.syncedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    expect(result.failed.map(item => item.reason)).toEqual(['inventory API down', 'support API down']);
    expect(app.getOfflineQueue()).toHaveLength(2);
    expect(app.getOfflineQueue().every(item => item.retryCount === 1)).toBe(true);
    expect(inventoryUpdate).toHaveBeenCalledTimes(1);
    expect(supportMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed inventory payloads without dropping the item', async () => {
    const app = createApp();
    setQueue(app, [makeItem({ id: 'bad-inv', type: 'inventory_update', data: {} })]);

    const result = await app.syncOfflineTransactions();

    expect(result.failedCount).toBe(1);
    expect(result.failed[0].reason).toMatch(/invalid inventory_update/i);
    expect(app.getOfflineQueue()[0].retryCount).toBe(1);
  });
});

describe('MerchantApp merchant-scoped persistence', () => {
  const apps: MerchantApp[] = [];
  let storage: MemoryStorage;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    storage = new MemoryStorage();
    (global as any).localStorage = storage;
    mockNetworkSync.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    apps.splice(0).forEach(app => app.destroy());
    warnSpy.mockRestore();
  });

  function createPersistedApp(
    merchantId: string,
    extra: Record<string, unknown> = {}
  ): MerchantApp {
    const app = new MerchantApp({
      rpcUrl: 'http://localhost:8000',
      network: 'testnet',
      merchantId,
      merchantKey: `${merchantId}-key`,
      persistence: { storage },
      ...extra,
    } as ConstructorParameters<typeof MerchantApp>[0]);
    apps.push(app);
    return app;
  }

  it('isolates queues, inventory, and messages between two merchant accounts', async () => {
    const appA = createPersistedApp('merchant-a');
    appA.setOnlineStatus(false);
    const paymentA = await appA.processPayment('beneficiary-a', '10');
    appA.addInventoryItem({
      name: 'A water',
      category: 'food',
      quantity: 5,
      unit: 'L',
      price: '1',
    });
    const messageA = await appA.sendSupportMessage('message from A');

    const appB = createPersistedApp('merchant-b');
    expect(appB.getStorageKeys().offlineQueue).not.toBe(appA.getStorageKeys().offlineQueue);
    expect(appB.getOfflineQueue()).toHaveLength(0);
    expect(appB.getInventoryByCategory('food')).toHaveLength(0);
    expect(appB.getSupportMessages()).toHaveLength(0);

    appB.setOnlineStatus(false);
    const paymentB = await appB.processPayment('beneficiary-b', '20');
    appB.addInventoryItem({
      name: 'B medicine',
      category: 'medical',
      quantity: 2,
      unit: 'box',
      price: '5',
    });
    const messageB = await appB.sendSupportMessage('message from B');

    expect(appA.getOfflineQueue().map(item => item.id)).toEqual(
      expect.arrayContaining([paymentA, expect.stringContaining('support_sync')])
    );
    expect(appA.getOfflineQueue().some(item => item.data.beneficiaryId === 'beneficiary-b')).toBe(false);
    expect(appB.getOfflineQueue().map(item => item.id)).toEqual(
      expect.arrayContaining([paymentB, expect.stringContaining('support_sync')])
    );
    expect(appB.getOfflineQueue().some(item => item.data.beneficiaryId === 'beneficiary-a')).toBe(false);

    expect(appA.getInventoryByCategory('food').map(item => item.name)).toEqual(['A water']);
    expect(appB.getInventoryByCategory('medical').map(item => item.name)).toEqual(['B medicine']);
    expect(appA.getSupportMessages().map(item => item.id)).toEqual([messageA]);
    expect(appB.getSupportMessages().map(item => item.id)).toEqual([messageB]);

    const storedA = storedQueue(appA);
    const storedB = storedQueue(appB);
    expect(storedA.some((item: OfflineQueueItem) => item.id === paymentA)).toBe(true);
    expect(storedB.some((item: OfflineQueueItem) => item.id === paymentB)).toBe(true);
    expect(storedA.some((item: OfflineQueueItem) => item.id === paymentB)).toBe(false);
  });

  it('restores the same merchant data after reinitialization', async () => {
    const app = createPersistedApp('merchant-restart');
    app.setOnlineStatus(false);
    const paymentId = await app.processPayment('beneficiary-restart', '30');
    app.addInventoryItem({
      name: 'Blankets',
      category: 'shelter',
      quantity: 7,
      unit: 'piece',
      price: '3',
    });
    const messageId = await app.sendSupportMessage('restart check');
    const originalQueue = app.getOfflineQueue();
    app.destroy();

    const restarted = createPersistedApp('merchant-restart');
    expect(restarted.getOfflineQueue()).toEqual(originalQueue);
    expect(restarted.getOfflineQueue().some(item => item.id === paymentId)).toBe(true);
    expect(restarted.getInventoryByCategory('shelter').map(item => item.name)).toEqual(['Blankets']);
    expect(restarted.getSupportMessages().map(item => item.id)).toEqual([messageId]);
  });

  it('ignores legacy unscoped keys by default and migrates them only when opted in', () => {
    const legacyQueue = [makeItem({ id: 'legacy-payment' })];
    const legacyInventory = [
      {
        id: 'legacy-inv',
        name: 'Legacy water',
        category: 'food',
        quantity: 3,
        unit: 'L',
        price: '1',
        lastUpdated: 0,
      },
    ];
    const legacyMessages = [
      {
        id: 'legacy-message',
        merchantId: 'merchant-legacy',
        message: 'legacy support',
        timestamp: 1,
        isFromMerchant: true,
        status: 'pending' as const,
      },
    ];
    storage.setItem(LEGACY_STORAGE_KEYS.offlineQueue, JSON.stringify(legacyQueue));
    storage.setItem(LEGACY_STORAGE_KEYS.inventory, JSON.stringify(legacyInventory));
    storage.setItem(LEGACY_STORAGE_KEYS.supportMessages, JSON.stringify(legacyMessages));

    const safeApp = createPersistedApp('merchant-legacy');
    expect(safeApp.getOfflineQueue()).toHaveLength(0);
    expect(safeApp.getInventoryByCategory('food')).toHaveLength(0);
    expect(safeApp.getSupportMessages()).toHaveLength(0);
    expect(storage.getItem(safeApp.getStorageKeys().offlineQueue)).toBeNull();
    expect(storage.getItem(LEGACY_STORAGE_KEYS.offlineQueue)).not.toBeNull();

    const migratedApp = createPersistedApp('merchant-legacy', { migrateLegacyKeys: true });
    expect(migratedApp.getOfflineQueue().map(item => item.id)).toEqual(['legacy-payment']);
    expect(migratedApp.getInventoryByCategory('food').map(item => item.name)).toEqual([
      'Legacy water',
    ]);
    expect(migratedApp.getSupportMessages().map(item => item.id)).toEqual(['legacy-message']);
    expect(storedQueue(migratedApp)).toEqual(legacyQueue);
    expect(JSON.parse(storage.getItem(migratedApp.getStorageKeys().offlineQueue) ?? '{}').version).toBe(
      MERCHANT_APP_PERSISTENCE_VERSION
    );
    expect(storage.getItem(LEGACY_STORAGE_KEYS.offlineQueue)).not.toBeNull();
  });

  it('does not let a second opted-in merchant claim legacy data owned by the first', () => {
    storage.setItem(
      LEGACY_STORAGE_KEYS.offlineQueue,
      JSON.stringify([makeItem({ id: 'legacy-only' })])
    );

    const first = createPersistedApp('merchant-first', { migrateLegacyKeys: true });
    const second = createPersistedApp('merchant-second', { migrateLegacyKeys: true });

    expect(first.getOfflineQueue().map(item => item.id)).toEqual(['legacy-only']);
    expect(second.getOfflineQueue()).toHaveLength(0);
    expect(storage.getItem(first.getStorageKeys().offlineQueue)).not.toBeNull();
    expect(storage.getItem(second.getStorageKeys().offlineQueue)).toBeNull();
  });

  it('supports explicit migration and switching accounts without mixing data', () => {
    const legacyInventory = [
      {
        id: 'legacy-inv-2',
        name: 'Legacy food',
        category: 'food',
        quantity: 1,
        unit: 'kg',
        price: '2',
        lastUpdated: 0,
      },
    ];
    storage.setItem(LEGACY_STORAGE_KEYS.inventory, JSON.stringify(legacyInventory));
    const app = createPersistedApp('merchant-switch');

    expect(app.migrateLegacyData({ removeLegacyKeys: true }).migrated).toContain('inventory');
    expect(app.getInventoryByCategory('food').map(item => item.name)).toEqual(['Legacy food']);
    expect(storage.getItem(LEGACY_STORAGE_KEYS.inventory)).toBeNull();

    app.switchMerchant('merchant-switched');
    expect(app.getStorageKeys().inventory).toContain('merchant-switched');
    expect(app.getInventoryByCategory('food')).toHaveLength(0);
    expect(app.getOfflineQueue()).toHaveLength(0);
  });
});

describe('MerchantApp persisted data validation', () => {
  const apps: MerchantApp[] = [];
  let storage: MemoryStorage;
  let warnSpy: jest.SpyInstance;

  function makeInventory(overrides: Partial<InventoryItem> = {}): InventoryItem {
    return {
      id: 'valid-inv',
      name: 'Valid water',
      category: 'food',
      quantity: 3,
      unit: 'L',
      price: '1',
      lastUpdated: 0,
      ...overrides,
    };
  }

  function makeSupport(overrides: Partial<SupportMessage> = {}): SupportMessage {
    return {
      id: 'valid-message',
      merchantId: 'merchant-valid',
      message: 'valid support',
      timestamp: 1,
      isFromMerchant: true,
      status: 'pending',
      ...overrides,
    };
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    (global as any).localStorage = storage;
    mockNetworkSync.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    apps.splice(0).forEach(app => app.destroy());
    warnSpy.mockRestore();
  });

  function createApp(merchantId: string): MerchantApp {
    const app = new MerchantApp({
      rpcUrl: 'http://localhost:8000',
      network: 'testnet',
      merchantId,
      merchantKey: `${merchantId}-key`,
      persistence: { storage },
    });
    apps.push(app);
    return app;
  }

  it('restores valid unversioned and versioned payloads without quarantine', () => {
    const app = createApp('merchant-valid');
    const legacyQueue = [makeItem({ id: 'legacy-scoped-payment' })];
    storage.setItem(app.getStorageKeys().offlineQueue, JSON.stringify(legacyQueue));
    storage.setItem(
      app.getStorageKeys().inventory,
      JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, data: [makeInventory()] })
    );
    storage.setItem(
      app.getStorageKeys().supportMessages,
      JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, data: [makeSupport()] })
    );

    const report = app.reloadPersistedData();

    expect(app.getOfflineQueue()).toEqual(legacyQueue);
    expect(app.getInventoryByCategory('food').map(item => item.id)).toEqual(['valid-inv']);
    expect(app.getSupportMessages().map(message => message.id)).toEqual(['valid-message']);
    expect(report.issues).toEqual([]);
    expect(report.quarantined.offlineQueue).toEqual([]);
    expect(JSON.parse(storage.getItem(app.getStorageKeys().offlineQueue) ?? '{}').version).toBe(
      MERCHANT_APP_PERSISTENCE_VERSION
    );
    expect(storedQueue(app)).toEqual(legacyQueue);
  });

  it('quarantines malformed JSON without throwing during initialization', () => {
    const app = createApp('merchant-json');
    const raw = '{not json';
    storage.setItem(app.getStorageKeys().offlineQueue, raw);

    const report = app.reloadPersistedData();

    expect(app.getOfflineQueue()).toEqual([]);
    expect(report.issues).toEqual([
      expect.objectContaining({
        dataset: 'offlineQueue',
        code: 'invalid_json',
        key: app.getStorageKeys().offlineQueue,
      }),
    ]);
    expect(report.quarantined.offlineQueue[0].reason).toBe('invalid_json');
    expect(report.quarantined.offlineQueue[0].records[0].value).toBe(raw);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid_json'));
    expect(storage.getItem(app.getStorageKeys().offlineQueue)).toBe(raw);
  });

  it('quarantines wrong top-level shapes without throwing', () => {
    const app = createApp('merchant-shape');
    storage.setItem(app.getStorageKeys().inventory, JSON.stringify({ unexpected: true }));

    const report = app.reloadPersistedData();

    expect(app.getInventoryByCategory('food')).toEqual([]);
    expect(report.issues).toEqual([
      expect.objectContaining({ dataset: 'inventory', code: 'unexpected_shape' }),
    ]);
    expect(report.quarantined.inventory[0].reason).toBe('unexpected_shape');
  });

  it('reports unknown versions while recovering structurally valid records', () => {
    const app = createApp('merchant-version');
    const futureQueue = [makeItem({ id: 'future-payment' })];
    storage.setItem(
      app.getStorageKeys().offlineQueue,
      JSON.stringify({ version: 99, data: futureQueue })
    );

    const report = app.reloadPersistedData();

    expect(app.getOfflineQueue()).toEqual(futureQueue);
    expect(report.issues).toEqual([
      expect.objectContaining({ dataset: 'offlineQueue', code: 'unknown_version' }),
    ]);
    expect(report.quarantined.offlineQueue[0].reason).toBe('unknown_version');
    expect(storedQueue(app)).toEqual(futureQueue);
    expect(JSON.parse(storage.getItem(app.getStorageKeys().offlineQueue) ?? '{}').version).toBe(
      MERCHANT_APP_PERSISTENCE_VERSION
    );
  });

  it('quarantines invalid queue entries while keeping valid payments restored', () => {
    const app = createApp('merchant-entries');
    const validPayment = makeItem({ id: 'valid-payment' });
    const validSupportQueue = makeItem({
      id: 'valid-support',
      type: 'support_message',
      data: { id: 'valid-message' },
    });
    const invalid = {
      id: 42,
      type: 'payment',
      data: {},
      timestamp: 1,
      retryCount: 0,
    };
    storage.setItem(
      app.getStorageKeys().offlineQueue,
      JSON.stringify({ version: MERCHANT_APP_PERSISTENCE_VERSION, data: [validPayment, invalid, validSupportQueue] })
    );

    const report = app.reloadPersistedData();

    expect(app.getOfflineQueue().map(item => item.id)).toEqual(['valid-payment', 'valid-support']);
    expect(report.issues).toEqual([
      expect.objectContaining({
        dataset: 'offlineQueue',
        code: 'invalid_entries',
        recordCount: 1,
      }),
    ]);
    expect(report.quarantined.offlineQueue[0].records[0]).toMatchObject({
      index: 1,
      reason: expect.stringContaining('id'),
    });
    expect(storedQueue(app).map(item => item.id)).toEqual(['valid-payment', 'valid-support']);
  });

  it('quarantines invalid inventory and support entries independently', () => {
    const app = createApp('merchant-datasets');
    storage.setItem(
      app.getStorageKeys().inventory,
      JSON.stringify([makeInventory(), makeInventory({ id: '' })])
    );
    storage.setItem(
      app.getStorageKeys().supportMessages,
      JSON.stringify([makeSupport(), makeSupport({ status: 'unknown' as SupportMessage['status'] })])
    );

    const report = app.reloadPersistedData();

    expect(app.getInventoryByCategory('food').map(item => item.id)).toEqual(['valid-inv']);
    expect(app.getSupportMessages().map(message => message.id)).toEqual(['valid-message']);
    expect(report.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining(['invalid_entries', 'invalid_entries'])
    );
    expect(report.quarantined.inventory[0].records[0].index).toBe(1);
    expect(report.quarantined.supportMessages[0].records[0].reason).toMatch(/status/);
  });

  it('supports explicit recovery after an operator corrects storage', () => {
    const app = createApp('merchant-recovery');
    const key = app.getStorageKeys().offlineQueue;
    storage.setItem(key, '{bad');
    app.reloadPersistedData();
    expect(app.getPersistenceReport().quarantined.offlineQueue).toHaveLength(1);

    storage.setItem(
      key,
      JSON.stringify({
        version: MERCHANT_APP_PERSISTENCE_VERSION,
        data: [makeItem({ id: 'operator-recovered-payment' })],
      })
    );
    const report = app.reloadPersistedData();

    expect(app.getOfflineQueue().map(item => item.id)).toEqual(['operator-recovered-payment']);
    expect(report.issues).toEqual([]);
    expect(report.quarantined.offlineQueue).toHaveLength(1);

    app.clearQuarantine('offlineQueue');
    expect(app.getPersistenceReport().quarantined.offlineQueue).toEqual([]);
  });
});
