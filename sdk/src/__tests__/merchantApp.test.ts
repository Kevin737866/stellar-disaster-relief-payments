import { ValidationError } from '../errors';
import {
  MerchantApp,
  createBrowserStorageAdapter,
  createInMemoryStorageAdapter,
  MerchantStorageAdapter,
} from '../merchantApp';

function makeSdkMock(overrides: Record<string, any> = {}) {
  return {
    getMerchant: jest.fn(async (id: string) => ({ id, isActive: true })),
    processPayment: jest.fn(async () => 'tx-online-1'),
    syncOfflineTransactions: jest.fn(async (_key: string, _id: string, ids: string[]) => ids.length),
    getSettlementHistory: jest.fn(async () => []),
    getMerchantStats: jest.fn(async () => ({})),
    getMerchantTransactions: jest.fn(async () => []),
    parseUSSDCode: jest.fn(() => ({ merchantCode: '', amount: '0' })),
    generateQRCode: jest.fn(async () => ({})),
    generateTransactionQR: jest.fn(async () => ({})),
    ...overrides,
  } as any;
}

describe('MerchantApp reliability & persistence (#303-#307)', () => {
  const apps: MerchantApp[] = [];

  function track(app: MerchantApp): MerchantApp {
    apps.push(app);
    return app;
  }

  afterEach(() => {
    while (apps.length > 0) {
      apps.pop()!.destroy();
    }
  });

  describe('storage adapters & error handling (#307)', () => {
    it('runs cleanly with injected in-memory storage without touching global localStorage', () => {
      const storage = createInMemoryStorageAdapter();
      const sdk = makeSdkMock();
      const app = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_A',
          merchantKey: 'S_KEY',
          storage,
          sdk,
          autoSync: false,
        })
      );

      const itemId = app.addInventoryItem({
        name: 'Rice Bag',
        category: 'food',
        quantity: 20,
        unit: 'kg',
        price: '10',
      });
      expect(app.getInventory().find((i) => i.id === itemId)?.quantity).toBe(20);
    });

    it('surfaces unavailable browser localStorage and read/write errors with context', () => {
      const browserAdapter = createBrowserStorageAdapter();
      expect(() => browserAdapter.getItem('any')).toThrow(/localStorage is unavailable/i);

      const failingReadStorage: MerchantStorageAdapter = {
        getItem: () => {
          throw new Error('EIO read error');
        },
        setItem: () => {},
      };
      expect(() =>
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_FAIL',
          merchantKey: 'S_KEY',
          storage: failingReadStorage,
          sdk: makeSdkMock(),
          autoSync: false,
        })
      ).toThrow(/EIO read error/);

      const failingWriteStorage: MerchantStorageAdapter = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      };
      const app = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_QUOTA',
          merchantKey: 'S_KEY',
          storage: failingWriteStorage,
          sdk: makeSdkMock(),
          autoSync: false,
        })
      );
      expect(() =>
        app.addInventoryItem({
          name: 'Water',
          category: 'water',
          quantity: 5,
          unit: 'L',
          price: '2',
        })
      ).toThrow(/QuotaExceededError/);
    });
  });

  describe('merchant account namespacing (#304)', () => {
    it('isolates offline queues, inventory, and support messages across merchants and restores per-merchant state', async () => {
      const sharedStorage = createInMemoryStorageAdapter();
      const sdk = makeSdkMock();

      const appA = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_ONE',
          merchantKey: 'S_1',
          storage: sharedStorage,
          sdk,
          autoSync: false,
        })
      );
      const appB = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_TWO',
          merchantKey: 'S_2',
          storage: sharedStorage,
          sdk,
          autoSync: false,
        })
      );

      appA.addInventoryItem({ name: 'Blanket', category: 'shelter', quantity: 10, unit: 'pcs', price: '5' });
      appA.setOnlineStatus(false);
      await appA.processPayment('GBEN_1', '15');
      await appA.sendSupportMessage('Need stock');

      expect(appB.getInventory()).toEqual([]);
      expect(appB.getPendingOfflineCount()).toBe(0);
      expect(appB.getSupportMessages()).toEqual([]);

      // Reinitialize MERCHANT_ONE against the same shared storage
      const appARestored = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_ONE',
          merchantKey: 'S_1',
          storage: sharedStorage,
          sdk,
          autoSync: false,
        })
      );
      expect(appARestored.getInventory()).toHaveLength(1);
      expect(appARestored.getInventory()[0].name).toBe('Blanket');
      expect(appARestored.getPendingOfflineCount()).toBe(2); // offline payment + support message
      expect(appARestored.getSupportMessages()).toHaveLength(1);
    });

    it('migrates legacy unscoped storage only when migrateLegacyStorage is enabled', () => {
      const storage = createInMemoryStorageAdapter({
        inventory: JSON.stringify([
          { id: 'legacy-1', name: 'Legacy Rice', category: 'food', quantity: 8, unit: 'kg', price: '4', lastUpdated: 1000 },
        ]),
      });

      const appDefault = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_L',
          merchantKey: 'S_L',
          storage,
          sdk: makeSdkMock(),
          autoSync: false,
        })
      );
      expect(appDefault.getInventory()).toEqual([]);

      const appOptIn = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'MERCHANT_L',
          merchantKey: 'S_L',
          storage,
          sdk: makeSdkMock(),
          autoSync: false,
          migrateLegacyStorage: true,
        })
      );
      expect(appOptIn.getInventory()).toHaveLength(1);
      expect(appOptIn.getInventory()[0].id).toBe('legacy-1');
    });
  });

  describe('persisted payload validation & recovery (#305)', () => {
    it('handles malformed JSON, unknown versions, and preserves valid queued payments alongside invalid entries', () => {
      const storage = createInMemoryStorageAdapter({
        'merchant:M_VAL:inventory': '{not valid json',
        'merchant:M_VAL:supportMessages': JSON.stringify({ version: 99, merchantId: 'M_VAL', data: [] }),
        'merchant:M_VAL:offlineQueue': JSON.stringify([
          {
            id: 'pay-good-1',
            type: 'payment',
            data: { beneficiaryId: 'GBEN', amount: '20' },
            timestamp: 1700000000,
            retryCount: 0,
          },
          { id: '', type: 'invalid-type', data: null },
        ]),
      });

      const app = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'M_VAL',
          merchantKey: 'S_KEY',
          storage,
          sdk: makeSdkMock(),
          autoSync: false,
        })
      );

      expect(app.getInventory()).toEqual([]);
      expect(app.getSupportMessages()).toEqual([]);
      expect(app.getQueuedItems().map((q) => q.id)).toEqual(['pay-good-1']);
      expect(app.getStorageDiagnostics()).toHaveLength(3);
    });
  });

  describe('syncOfflineQueue (#303)', () => {
    it('syncs mixed-type queues individually, preserves failed items for retry, and surfaces unsupported types', async () => {
      const syncInventoryUpdate = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('inventory API down'));

      const syncSupportMessage = jest.fn().mockResolvedValue(undefined);

      const sdk = makeSdkMock({
        syncOfflineTransactions: jest.fn(async (_k: string, _m: string, ids: string[]) => {
          return ids[0] === 'pay-ok' ? 1 : 0;
        }),
      });

      const storage = createInMemoryStorageAdapter({
        'merchant:M_SYNC:offlineQueue': JSON.stringify({
          version: 1,
          merchantId: 'M_SYNC',
          data: [
            { id: 'pay-ok', type: 'payment', data: { amount: '10' }, timestamp: 1, retryCount: 0 },
            { id: 'pay-fail', type: 'payment', data: { amount: '20' }, timestamp: 2, retryCount: 0 },
            { id: 'inv-1', type: 'inventory_update', data: { itemId: 'i1' }, timestamp: 3, retryCount: 0 },
            { id: 'inv-2', type: 'inventory_update', data: { itemId: 'i2' }, timestamp: 4, retryCount: 0 },
            {
              id: 'sup-1',
              type: 'support_message',
              data: { supportMessage: { id: 'sup-msg-1', merchantId: 'M_SYNC', message: 'hi', timestamp: 5, isFromMerchant: true, status: 'pending' } },
              timestamp: 5,
              retryCount: 0,
            },
            { id: 'sup-missing', type: 'support_message', data: {}, timestamp: 6, retryCount: 0 },
          ],
        }),
      });

      const app = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'M_SYNC',
          merchantKey: 'S_KEY',
          storage,
          sdk,
          autoSync: false,
          syncHandlers: {
            syncInventoryUpdate,
            syncSupportMessage,
          },
        })
      );

      const summary = await app.syncOfflineQueue();
      expect(summary.syncedCount).toBe(3); // pay-ok, inv-1, sup-1
      expect(summary.failedCount).toBe(2); // pay-fail, inv-2
      expect(summary.unsupportedCount).toBe(1); // sup-missing

      // Failed items remain retryable with incremented retryCount
      expect(app.getQueuedItems().map((i) => [i.id, i.retryCount])).toEqual([
        ['pay-fail', 1],
        ['inv-2', 1],
      ]);
      // Unsupported item was moved out and surfaced explicitly
      expect(app.getUnsupportedQueueItems().map((i) => i.id)).toEqual(['sup-missing']);
    });
  });

  describe('itemized sale inventory decrement (#306)', () => {
    it('decrements inventory deterministically after confirmed payment and leaves stock untouched on failure/insufficient stock', async () => {
      const storage = createInMemoryStorageAdapter();
      const sdk = makeSdkMock();
      const app = track(
        new MerchantApp({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          network: 'testnet',
          merchantId: 'M_SALE',
          merchantKey: 'S_KEY',
          storage,
          sdk,
          autoSync: false,
        })
      );

      const riceId = app.addInventoryItem({ name: 'Rice', category: 'food', quantity: 10, unit: 'kg', price: '2' });
      const oilId = app.addInventoryItem({ name: 'Oil', category: 'food', quantity: 4, unit: 'L', price: '5' });

      await app.processPayment('GBEN_1', '14', 'USDC', 'Food basket', 1, [
        { itemId: riceId, quantity: 3 },
        { itemId: oilId, quantity: 2 },
      ]);

      expect(app.getInventory().find((i) => i.id === riceId)?.quantity).toBe(7);
      expect(app.getInventory().find((i) => i.id === oilId)?.quantity).toBe(2);

      // Unknown item or insufficient stock throws ValidationError without partial mutations
      await expect(
        app.processPayment('GBEN_1', '10', 'USDC', 'Bad', 1, [
          { itemId: riceId, quantity: 2 },
          { itemId: 'unknown-item', quantity: 1 },
        ])
      ).rejects.toThrow(ValidationError);
      expect(app.getInventory().find((i) => i.id === riceId)?.quantity).toBe(7);

      await expect(
        app.processPayment('GBEN_1', '10', 'USDC', 'Too much', 1, [{ itemId: oilId, quantity: 5 }])
      ).rejects.toThrow(ValidationError);
      expect(app.getInventory().find((i) => i.id === oilId)?.quantity).toBe(2);

      // Failed online payment queues offline instead of decrementing stock prematurely
      sdk.processPayment.mockRejectedValueOnce(new Error('network error'));
      await app.processPayment('GBEN_1', '4', 'USDC', 'Queued sale', 1, [{ itemId: riceId, quantity: 2 }]);
      expect(app.getInventory().find((i) => i.id === riceId)?.quantity).toBe(7);
    });
  });
});
