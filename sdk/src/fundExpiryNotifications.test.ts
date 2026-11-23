/**
 * Tests for fundExpiryNotifications.ts
 *
 * Coverage:
 *   - InMemoryNotificationStore: append, getByFund ordering and fund scoping
 *   - FundExpiryNotificationsClient.getNotificationHistory:
 *       persisted records returned, empty list for unknown fund,
 *       store errors surfaced, fund scoping, stable ordering
 *   - FundExpiryNotificationsClient.sendExpiryNotifications:
 *       all delivery statuses (sent, failed, bounced) persisted and retrievable
 */

import {
  FundExpiryNotificationsClient,
  InMemoryNotificationStore,
  NotificationLog,
  NotificationStore,
  ExpiryNotification,
} from './fundExpiryNotifications';
import { Keypair, Networks } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FUND_A = 'fund-hurricane-2024';
const FUND_B = 'fund-earthquake-2024';

function makeLog(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    fundId: FUND_A,
    notificationType: 'email',
    recipient: 'admin@example.org',
    sentAt: 1_000_000,
    status: 'sent',
    message: 'Fund expiry alert',
    retryCount: 0,
    ...overrides,
  };
}

/** Build a minimal ExpiryNotification for use with sendExpiryNotifications. */
function makeExpiryNotification(fundId: string, overrides: Partial<ExpiryNotification> = {}): ExpiryNotification {
  return {
    id: `notif-${fundId}`,
    fundId,
    fundName: 'Test Fund',
    expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400,
    daysUntilExpiry: 7,
    totalAmount: '100000',
    releasedAmount: '20000',
    availableAmount: '80000',
    adminAddress: 'admin@example.org',
    notificationSentAt: Math.floor(Date.now() / 1000),
    notificationStatus: 'pending',
    ...overrides,
  };
}

/** Build a client backed by a provided store; server stubs are no-ops. */
function makeClient(store: NotificationStore): FundExpiryNotificationsClient {
  const signingKey = Keypair.random();
  const mockServer = {
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  };
  return new FundExpiryNotificationsClient(
    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    signingKey,
    mockServer,
    { notificationThresholdDays: 7, enableAutoNotifications: true },
    Networks.TESTNET,
    store
  );
}

// ---------------------------------------------------------------------------
// InMemoryNotificationStore
// ---------------------------------------------------------------------------

describe('InMemoryNotificationStore', () => {
  describe('getByFund on an empty store', () => {
    it('returns an empty array for a fund with no records', async () => {
      const store = new InMemoryNotificationStore();
      expect(await store.getByFund(FUND_A)).toEqual([]);
    });
  });

  describe('append and getByFund', () => {
    it('returns a record after it is appended', async () => {
      const store = new InMemoryNotificationStore();
      const log = makeLog({ fundId: FUND_A });
      await store.append(log);
      const result = await store.getByFund(FUND_A);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(log);
    });

    it('returns all records for a fund in sentAt ascending order', async () => {
      const store = new InMemoryNotificationStore();
      // Insert out of order intentionally
      const third = makeLog({ fundId: FUND_A, sentAt: 3_000_000 });
      const first  = makeLog({ fundId: FUND_A, sentAt: 1_000_000 });
      const second = makeLog({ fundId: FUND_A, sentAt: 2_000_000 });
      await store.append(third);
      await store.append(first);
      await store.append(second);

      const result = await store.getByFund(FUND_A);
      expect(result.map(r => r.sentAt)).toEqual([1_000_000, 2_000_000, 3_000_000]);
    });

    it('returns records with equal sentAt in stable insertion order', async () => {
      const store = new InMemoryNotificationStore();
      const a = makeLog({ fundId: FUND_A, sentAt: 1_000_000, id: 'a' });
      const b = makeLog({ fundId: FUND_A, sentAt: 1_000_000, id: 'b' });
      await store.append(a);
      await store.append(b);

      const result = await store.getByFund(FUND_A);
      expect(result.map(r => r.id)).toEqual(['a', 'b']);
    });
  });

  describe('fund scoping', () => {
    it('does not return records belonging to a different fund', async () => {
      const store = new InMemoryNotificationStore();
      await store.append(makeLog({ fundId: FUND_A }));
      await store.append(makeLog({ fundId: FUND_B }));

      const resultA = await store.getByFund(FUND_A);
      const resultB = await store.getByFund(FUND_B);

      expect(resultA).toHaveLength(1);
      expect(resultA[0].fundId).toBe(FUND_A);

      expect(resultB).toHaveLength(1);
      expect(resultB[0].fundId).toBe(FUND_B);
    });

    it('records for fund B are not polluted by appends to fund A', async () => {
      const store = new InMemoryNotificationStore();
      for (let i = 0; i < 5; i++) {
        await store.append(makeLog({ fundId: FUND_A, sentAt: i }));
      }
      expect(await store.getByFund(FUND_B)).toEqual([]);
    });
  });

  describe('all statuses', () => {
    it('stores and retrieves sent, failed, bounced, and acknowledged records', async () => {
      const store = new InMemoryNotificationStore();
      const statuses = ['sent', 'failed', 'bounced', 'acknowledged'] as const;
      for (const status of statuses) {
        await store.append(makeLog({ fundId: FUND_A, status, sentAt: statuses.indexOf(status) }));
      }

      const result = await store.getByFund(FUND_A);
      expect(result.map(r => r.status)).toEqual(['sent', 'failed', 'bounced', 'acknowledged']);
    });
  });
});

// ---------------------------------------------------------------------------
// FundExpiryNotificationsClient.getNotificationHistory
// ---------------------------------------------------------------------------

describe('FundExpiryNotificationsClient.getNotificationHistory', () => {
  describe('empty history', () => {
    it('returns an empty array for a fund with no prior deliveries', async () => {
      const client = makeClient(new InMemoryNotificationStore());
      expect(await client.getNotificationHistory(FUND_A)).toEqual([]);
    });
  });

  describe('persisted records returned', () => {
    it('returns a record that was directly appended to the store', async () => {
      const store = new InMemoryNotificationStore();
      const log = makeLog({ fundId: FUND_A, sentAt: 1_000_000 });
      await store.append(log);

      const client = makeClient(store);
      const history = await client.getNotificationHistory(FUND_A);
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(log);
    });

    it('returns multiple records in sentAt ascending order', async () => {
      const store = new InMemoryNotificationStore();
      await store.append(makeLog({ fundId: FUND_A, sentAt: 300 }));
      await store.append(makeLog({ fundId: FUND_A, sentAt: 100 }));
      await store.append(makeLog({ fundId: FUND_A, sentAt: 200 }));

      const client = makeClient(store);
      const history = await client.getNotificationHistory(FUND_A);
      expect(history.map(r => r.sentAt)).toEqual([100, 200, 300]);
    });
  });

  describe('fund scoping', () => {
    it('returns only records for the requested fund', async () => {
      const store = new InMemoryNotificationStore();
      await store.append(makeLog({ fundId: FUND_A, id: 'a' }));
      await store.append(makeLog({ fundId: FUND_B, id: 'b' }));

      const client = makeClient(store);
      const historyA = await client.getNotificationHistory(FUND_A);
      expect(historyA).toHaveLength(1);
      expect(historyA[0].id).toBe('a');

      const historyB = await client.getNotificationHistory(FUND_B);
      expect(historyB).toHaveLength(1);
      expect(historyB[0].id).toBe('b');
    });
  });

  describe('all delivery statuses', () => {
    it('returns sent, failed, bounced, and acknowledged records for the fund', async () => {
      const store = new InMemoryNotificationStore();
      await store.append(makeLog({ fundId: FUND_A, status: 'sent',         sentAt: 1 }));
      await store.append(makeLog({ fundId: FUND_A, status: 'failed',       sentAt: 2 }));
      await store.append(makeLog({ fundId: FUND_A, status: 'bounced',      sentAt: 3 }));
      await store.append(makeLog({ fundId: FUND_A, status: 'acknowledged', sentAt: 4 }));

      const client = makeClient(store);
      const history = await client.getNotificationHistory(FUND_A);
      expect(history.map(r => r.status)).toEqual(['sent', 'failed', 'bounced', 'acknowledged']);
    });
  });

  describe('store errors surfaced', () => {
    it('throws an error when the store read fails', async () => {
      const faultyStore: NotificationStore = {
        append: jest.fn(),
        getByFund: jest.fn(async () => { throw new Error('DB connection lost'); }),
      };

      const client = makeClient(faultyStore);
      await expect(client.getNotificationHistory(FUND_A)).rejects.toThrow(
        'Failed to retrieve notification history'
      );
    });

    it('error message includes the original store error reason', async () => {
      const faultyStore: NotificationStore = {
        append: jest.fn(),
        getByFund: jest.fn(async () => { throw new Error('timeout after 5s'); }),
      };

      const client = makeClient(faultyStore);
      await expect(client.getNotificationHistory(FUND_A)).rejects.toThrow('timeout after 5s');
    });
  });
});

// ---------------------------------------------------------------------------
// FundExpiryNotificationsClient.sendExpiryNotifications — persistence
// ---------------------------------------------------------------------------

describe('FundExpiryNotificationsClient.sendExpiryNotifications — persistence', () => {
  describe('sent notifications persisted', () => {
    it('persists one log per channel per notification', async () => {
      const store = new InMemoryNotificationStore();
      const client = makeClient(store);

      await client.sendExpiryNotifications(
        [makeExpiryNotification(FUND_A)],
        ['email', 'sms']
      );

      const history = await client.getNotificationHistory(FUND_A);
      expect(history).toHaveLength(2);
      expect(history.map(r => r.notificationType).sort()).toEqual(['email', 'sms']);
    });

    it('records for two different funds are stored independently', async () => {
      const store = new InMemoryNotificationStore();
      const client = makeClient(store);

      await client.sendExpiryNotifications(
        [makeExpiryNotification(FUND_A), makeExpiryNotification(FUND_B)],
        ['email']
      );

      expect(await client.getNotificationHistory(FUND_A)).toHaveLength(1);
      expect(await client.getNotificationHistory(FUND_B)).toHaveLength(1);
    });

    it('all persisted logs carry the correct fundId', async () => {
      const store = new InMemoryNotificationStore();
      const client = makeClient(store);

      await client.sendExpiryNotifications([makeExpiryNotification(FUND_A)], ['email']);

      const history = await client.getNotificationHistory(FUND_A);
      expect(history.every(r => r.fundId === FUND_A)).toBe(true);
    });
  });

  describe('failed delivery persisted', () => {
    it('persists a failed log when sendNotificationViaChannel throws', async () => {
      // Simulate a channel send failure by injecting a store that records
      // whatever sendExpiryNotifications writes; a "failed" record arrives
      // when the internal send throws.
      const logs: NotificationLog[] = [];
      const capturingStore: NotificationStore = {
        append: jest.fn(async (log: NotificationLog) => { logs.push(log); }),
        getByFund: jest.fn(async () => logs.filter(l => l.fundId === FUND_A)),
      };

      // Monkey-patch to trigger the catch branch inside sendExpiryNotifications.
      // We replace sendNotificationViaChannel on the prototype temporarily.
      const proto = FundExpiryNotificationsClient.prototype as any;
      const original = proto.sendNotificationViaChannel;
      proto.sendNotificationViaChannel = jest.fn(async () => {
        throw new Error('SMTP server unreachable');
      });

      const client = makeClient(capturingStore);
      const result = await client.sendExpiryNotifications(
        [makeExpiryNotification(FUND_A)],
        ['email']
      );

      proto.sendNotificationViaChannel = original;

      expect(result.failedCount).toBe(1);
      expect(result.sentCount).toBe(0);
      const history = await client.getNotificationHistory(FUND_A);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('failed');
    });
  });

  describe('store write failure surfaced', () => {
    it('throws when the store fails to persist a log', async () => {
      const faultyStore: NotificationStore = {
        append: jest.fn(async () => { throw new Error('disk full'); }),
        getByFund: jest.fn(async () => []),
      };

      const client = makeClient(faultyStore);
      await expect(
        client.sendExpiryNotifications([makeExpiryNotification(FUND_A)], ['email'])
      ).rejects.toThrow();
    });
  });
});
