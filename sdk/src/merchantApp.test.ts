/**
 * Tests for MerchantApp — inventory management and payment flow.
 *
 * We test `updateInventoryAfterSale` directly and through `processPayment`
 * to verify stock is only decremented after confirmed payment success.
 */

import { MerchantApp, MerchantAppConfig, InventoryItem, SaleLineItem } from './merchantApp';
import { PAYMENT_QR } from './merchantNetwork';

// ---------------------------------------------------------------------------
// Minimal localStorage stub (MerchantApp reads/writes localStorage)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
(global as any).localStorage = localStorageMock;

// ---------------------------------------------------------------------------
// MerchantNetworkSDK mock — prevents real network calls
// ---------------------------------------------------------------------------
jest.mock('./merchantNetwork', () => {
  const actual = jest.requireActual('./merchantNetwork');
  return {
    ...actual,
    MerchantNetworkSDK: jest.fn().mockImplementation(() => ({
      getMerchant: jest.fn().mockResolvedValue({ id: 'merchant_1', isActive: true }),
      processPayment: jest.fn().mockResolvedValue('txn_success_001'),
      syncOfflineTransactions: jest.fn().mockResolvedValue(0),
      generateQRCode: jest.fn().mockResolvedValue({}),
      generateTransactionQR: jest.fn().mockResolvedValue({}),
      parseUSSDCode: jest.fn().mockReturnValue({ merchantCode: 'MERCH', amount: '10' }),
      getSettlementHistory: jest.fn().mockResolvedValue([]),
      getMerchantStats: jest.fn().mockResolvedValue({}),
      getMerchantTransactions: jest.fn().mockResolvedValue([]),
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CONFIG: MerchantAppConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  network: 'testnet',
  merchantId: 'merchant_1',
  merchantKey: 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35',
};

function makeApp(): MerchantApp {
  localStorageMock.clear();
  const app = new MerchantApp(CONFIG);
  app.stopAutoSync(); // prevent setInterval leaking between tests
  app.setOnlineStatus(true);
  return app;
}

/** Add a named item to the app's inventory and return its assigned id. */
function seedItem(
  app: MerchantApp,
  overrides: Partial<Omit<InventoryItem, 'id' | 'lastUpdated'>> & { name: string }
): string {
  return app.addInventoryItem({
    name: overrides.name,
    category: overrides.category ?? 'food',
    quantity: overrides.quantity ?? 50,
    unit: overrides.unit ?? 'unit',
    price: overrides.price ?? '1.00',
  });
}

// ---------------------------------------------------------------------------
// updateInventoryAfterSale — unit tests
// ---------------------------------------------------------------------------

describe('updateInventoryAfterSale', () => {
  describe('single-item sale', () => {
    it('decrements stock by the requested quantity', () => {
      const app = makeApp();
      const id = seedItem(app, { name: 'Rice 5kg', quantity: 20 });

      const result = app.updateInventoryAfterSale([{ itemId: id, quantity: 3 }]);

      expect(result.decremented).toEqual([{ itemId: id, quantity: 3 }]);
      expect(result.unknownItems).toHaveLength(0);
      expect(result.insufficientStock).toHaveLength(0);

      const item = app.getInventoryByCategory('food').find(i => i.id === id)!;
      expect(item.quantity).toBe(17);
    });

    it('allows decrementing stock down to exactly zero', () => {
      const app = makeApp();
      const id = seedItem(app, { name: 'Water purifier', quantity: 1 });

      const result = app.updateInventoryAfterSale([{ itemId: id, quantity: 1 }]);

      expect(result.decremented).toHaveLength(1);
      const item = app.getInventoryByCategory('food').find(i => i.id === id)!;
      expect(item.quantity).toBe(0);
    });
  });

  describe('multi-item sale', () => {
    it('decrements each item independently in one call', () => {
      const app = makeApp();
      const riceId = seedItem(app, { name: 'Rice', quantity: 100 });
      const oilId  = seedItem(app, { name: 'Cooking oil', quantity: 40 });
      const saltId = seedItem(app, { name: 'Salt', quantity: 60 });

      const lineItems: SaleLineItem[] = [
        { itemId: riceId, quantity: 5 },
        { itemId: oilId,  quantity: 2 },
        { itemId: saltId, quantity: 10 },
      ];

      const result = app.updateInventoryAfterSale(lineItems);

      expect(result.decremented).toHaveLength(3);
      expect(result.unknownItems).toHaveLength(0);
      expect(result.insufficientStock).toHaveLength(0);

      const inventory = app.getInventoryByCategory('food');
      expect(inventory.find(i => i.id === riceId)!.quantity).toBe(95);
      expect(inventory.find(i => i.id === oilId)!.quantity).toBe(38);
      expect(inventory.find(i => i.id === saltId)!.quantity).toBe(50);
    });

    it('handles a mix of valid, unknown, and insufficient-stock items', () => {
      const app = makeApp();
      const knownId = seedItem(app, { name: 'Blanket', quantity: 10 });

      const result = app.updateInventoryAfterSale([
        { itemId: knownId,         quantity: 2 },
        { itemId: 'inv_ghost_999', quantity: 1 },   // unknown
        { itemId: knownId,         quantity: 100 },  // second line — but only 8 remain after first
      ]);

      // First line succeeds
      expect(result.decremented).toContainEqual({ itemId: knownId, quantity: 2 });
      // Unknown item is captured
      expect(result.unknownItems).toContain('inv_ghost_999');
      // Second line for the same item fails because only 8 remain
      expect(result.insufficientStock).toContainEqual(
        expect.objectContaining({ itemId: knownId, requested: 100, available: 8 })
      );
      // Net stock: 10 - 2 = 8 (second line rejected)
      expect(app.getInventoryByCategory('food').find(i => i.id === knownId)!.quantity).toBe(8);
    });
  });

  describe('unknown items', () => {
    it('reports an unknown itemId without touching other items', () => {
      const app = makeApp();
      const validId = seedItem(app, { name: 'Tarp', quantity: 5 });

      const result = app.updateInventoryAfterSale([
        { itemId: 'inv_does_not_exist', quantity: 1 },
        { itemId: validId, quantity: 1 },
      ]);

      expect(result.unknownItems).toEqual(['inv_does_not_exist']);
      expect(result.decremented).toEqual([{ itemId: validId, quantity: 1 }]);
      expect(app.getInventoryByCategory('food').find(i => i.id === validId)!.quantity).toBe(4);
    });

    it('returns all item ids as unknown when inventory is empty', () => {
      const app = makeApp();

      const result = app.updateInventoryAfterSale([
        { itemId: 'inv_a', quantity: 1 },
        { itemId: 'inv_b', quantity: 2 },
      ]);

      expect(result.unknownItems).toEqual(['inv_a', 'inv_b']);
      expect(result.decremented).toHaveLength(0);
      expect(result.insufficientStock).toHaveLength(0);
    });
  });

  describe('insufficient stock', () => {
    it('reports insufficient stock and leaves quantity unchanged', () => {
      const app = makeApp();
      const id = seedItem(app, { name: 'Medicine', category: 'medical', quantity: 3 });

      const result = app.updateInventoryAfterSale([{ itemId: id, quantity: 10 }]);

      expect(result.insufficientStock).toEqual([
        { itemId: id, requested: 10, available: 3 },
      ]);
      expect(result.decremented).toHaveLength(0);
      // Stock must not have changed
      expect(
        app.getInventoryByCategory('medical').find(i => i.id === id)!.quantity
      ).toBe(3);
    });

    it('does not decrement when requested quantity equals available plus one', () => {
      const app = makeApp();
      const id = seedItem(app, { name: 'Fuel canister', category: 'fuel', quantity: 5 });

      const result = app.updateInventoryAfterSale([{ itemId: id, quantity: 6 }]);

      expect(result.insufficientStock[0]).toMatchObject({ itemId: id, requested: 6, available: 5 });
      expect(app.getInventoryByCategory('fuel').find(i => i.id === id)!.quantity).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('returns empty result for an empty line-item list', () => {
      const app = makeApp();
      const result = app.updateInventoryAfterSale([]);
      expect(result.decremented).toHaveLength(0);
      expect(result.unknownItems).toHaveLength(0);
      expect(result.insufficientStock).toHaveLength(0);
    });

    it('updates lastUpdated timestamp on decremented items', () => {
      const app = makeApp();
      const before = Date.now();
      const id = seedItem(app, { name: 'Canteen', quantity: 10 });

      app.updateInventoryAfterSale([{ itemId: id, quantity: 1 }]);

      const item = app.getInventoryByCategory('food').find(i => i.id === id)!;
      expect(item.lastUpdated).toBeGreaterThanOrEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------
// processPayment — integration with inventory
// ---------------------------------------------------------------------------

describe('processPayment inventory integration', () => {
  it('decrements stock after a confirmed payment', async () => {
    const app = makeApp();
    const id = seedItem(app, { name: 'Ration pack', quantity: 50 });

    const lineItems: SaleLineItem[] = [{ itemId: id, quantity: 4 }];
    const txnId = await app.processPayment('ben_1', '20.00', 'USDC', 'Food aid', PAYMENT_QR, lineItems);

    expect(txnId).toBe('txn_success_001');
    expect(app.getInventoryByCategory('food').find(i => i.id === id)!.quantity).toBe(46);
  });

  it('does not decrement stock when payment fails', async () => {
    const app = makeApp();
    const id = seedItem(app, { name: 'Water tablet', quantity: 30 });

    // Make the SDK throw to simulate a failed payment
    const { MerchantNetworkSDK } = jest.requireMock('./merchantNetwork');
    MerchantNetworkSDK.mock.results[
      MerchantNetworkSDK.mock.results.length - 1
    ].value.processPayment.mockRejectedValueOnce(new Error('Network timeout'));

    const offlineId = await app.processPayment(
      'ben_2', '5.00', 'USDC', 'Water aid', PAYMENT_QR,
      [{ itemId: id, quantity: 5 }]
    );

    // Falls back to offline queue — no stock change
    expect(offlineId).toMatch(/^offline_/);
    expect(app.getInventoryByCategory('food').find(i => i.id === id)!.quantity).toBe(30);
  });

  it('does not decrement stock when no line items are provided', async () => {
    const app = makeApp();
    const id = seedItem(app, { name: 'Generic item', quantity: 20 });

    await app.processPayment('ben_3', '10.00');

    // No line items → inventory untouched
    expect(app.getInventoryByCategory('food').find(i => i.id === id)!.quantity).toBe(20);
  });

  it('handles a multi-item sale through processPayment', async () => {
    const app = makeApp();
    const riceId = seedItem(app, { name: 'Rice', quantity: 100 });
    const beansId = seedItem(app, { name: 'Beans', quantity: 60 });

    await app.processPayment(
      'ben_4', '30.00', 'USDC', 'Multi-item food aid', PAYMENT_QR,
      [
        { itemId: riceId,  quantity: 10 },
        { itemId: beansId, quantity: 5  },
      ]
    );

    expect(app.getInventoryByCategory('food').find(i => i.id === riceId)!.quantity).toBe(90);
    expect(app.getInventoryByCategory('food').find(i => i.id === beansId)!.quantity).toBe(55);
  });

  it('does not decrement stock when device is offline (payment queued)', async () => {
    const app = makeApp();
    app.setOnlineStatus(false);
    const id = seedItem(app, { name: 'Offline item', quantity: 15 });

    const queuedId = await app.processPayment(
      'ben_5', '8.00', 'USDC', 'Aid', PAYMENT_QR,
      [{ itemId: id, quantity: 3 }]
    );

    expect(queuedId).toMatch(/^offline_/);
    // Payment not confirmed → stock must remain unchanged
    expect(app.getInventoryByCategory('food').find(i => i.id === id)!.quantity).toBe(15);
  });
});
