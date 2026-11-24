import { MerchantApp, OfflineQueueItem, OfflineSyncResult } from './merchantApp';

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

function storedQueue(): OfflineQueueItem[] {
  return JSON.parse(localStorage.getItem('offlineQueue') ?? '[]') as OfflineQueueItem[];
}

describe('MerchantApp offline queue sync', () => {
  const apps: MerchantApp[] = [];
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    (global as any).localStorage = new MemoryStorage();
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
    });
    apps.push(app);
    return app;
  }

  function setQueue(app: MerchantApp, items: OfflineQueueItem[]): void {
    (app as any).offlineQueue = items;
    localStorage.setItem('offlineQueue', JSON.stringify(items));
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
    expect(storedQueue().map(item => item.id)).toEqual(['pay-2', 'unknown-1']);

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
    expect(storedQueue()).toHaveLength(0);
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
      lastUpdated: 0,
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
