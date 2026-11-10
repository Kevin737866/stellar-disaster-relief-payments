import { Account, Keypair, Networks, StrKey, nativeToScVal } from 'stellar-sdk';
import {
  ExpiringFundRecord,
  FundExpiryNotificationsClient,
  NotificationConfigStore,
  NotificationHistoryProvider,
  NotificationLog,
} from '../fundExpiryNotifications';
import { NetworkError, ValidationError } from '../errors';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));

function makeClient(
  serverOverrides: Record<string, any> = {},
  options: Record<string, any> = {}
) {
  const signingKey = Keypair.random();
  const adminKey = Keypair.random();
  const server = {
    loadAccount: jest.fn(async (pub: string) => new Account(pub, '100')),
    submitTransaction: jest.fn(async () => ({ status: 'SUCCESS', hash: 'txhash-default' })),
    simulateTransaction: jest.fn(),
    getTransaction: jest.fn(),
    ...serverOverrides,
  };
  const client = new FundExpiryNotificationsClient(
    CONTRACT_ID,
    signingKey,
    server,
    { notificationThresholdDays: 7, enableAutoNotifications: true },
    Networks.TESTNET,
    options
  );
  return { client, server, signingKey, adminKey };
}

describe('FundExpiryNotificationsClient (#300, #301, #302, #310, #311)', () => {
  describe('checkExpiringFunds (#300)', () => {
    it('returns only active funds expiring within threshold and ignores expired/missing/handled funds', async () => {
      const now = Math.floor(Date.now() / 1000);
      const day = 24 * 60 * 60;
      const records: Record<string, ExpiringFundRecord | null> = {
        'fund-soon': {
          id: 'fund-soon',
          name: 'Soon Relief',
          expiresAt: now + 3 * day,
          totalAmount: '1000',
          releasedAmount: '250',
          adminAddress: 'GADMIN1',
          isActive: true,
        },
        'fund-boundary': {
          id: 'fund-boundary',
          name: 'Exact Threshold',
          expiresAt: now + 7 * day,
          totalAmount: '500',
          releasedAmount: '0',
          isActive: true,
        },
        'fund-far': {
          id: 'fund-far',
          name: 'Far Future',
          expiresAt: now + 20 * day,
          totalAmount: '500',
          releasedAmount: '0',
          isActive: true,
        },
        'fund-expired': {
          id: 'fund-expired',
          name: 'Already Expired',
          expiresAt: now - 60,
          totalAmount: '500',
          releasedAmount: '0',
          isActive: true,
        },
        'fund-recalled': {
          id: 'fund-recalled',
          name: 'Already Recalled',
          expiresAt: now + 2 * day,
          totalAmount: '500',
          releasedAmount: '0',
          currentStatus: 'recalled',
          isActive: true,
        },
        'fund-missing': null,
      };

      const { client } = makeClient({}, {
        fundProvider: {
          getFund: jest.fn(async (id: string) => records[id] ?? null),
        },
      });

      const alerts = await client.checkExpiringFunds(Object.keys(records));
      expect(alerts.map((a) => a.fundId)).toEqual(['fund-soon', 'fund-boundary']);
      expect(alerts[0].availableAmount).toBe('750');
      expect(alerts[0].daysUntilExpiry).toBe(3);
    });

    it('surfaces provider errors rather than converting them into an empty array', async () => {
      const { client } = makeClient({}, {
        fundProvider: {
          getFund: jest.fn(async () => {
            throw new Error('backend unavailable');
          }),
        },
      });

      await expect(client.checkExpiringFunds(['fund-soon'])).rejects.toThrow('backend unavailable');
    });
  });

  describe('sendExpiryNotifications & delivery providers (#302)', () => {
    const sampleNotification = {
      id: 'notif-1',
      fundId: 'fund-1',
      fundName: 'Flood Relief',
      expiresAt: 1800000000,
      daysUntilExpiry: 2,
      totalAmount: '1000',
      releasedAmount: '200',
      availableAmount: '800',
      adminAddress: 'admin@relief.org',
      notificationSentAt: 1799800000,
      notificationStatus: 'pending' as const,
    };

    it('marks status as sent only when configured provider confirms delivery and records missing/rejected channels accurately', async () => {
      const { client } = makeClient({}, {
        deliveryProviders: {
          email: {
            send: jest.fn(async () => ({ accepted: true, externalId: 'msg-1' })),
          },
          sms: {
            send: jest.fn(async () => ({ accepted: false, bounced: true, reason: 'Invalid number' })),
          },
          // webhook intentionally omitted
        },
      });

      const result = await client.sendExpiryNotifications([sampleNotification], ['email', 'sms', 'webhook']);
      expect(result.success).toBe(false);
      expect(result.sentCount).toBe(1);
      expect(result.failedCount).toBe(2);
      expect(result.logs.map((l) => [l.notificationType, l.status])).toEqual([
        ['email', 'sent'],
        ['sms', 'bounced'],
        ['webhook', 'failed'],
      ]);
      expect(result.logs[2].message).toContain('No delivery provider configured');
    });
  });

  describe('getNotificationHistory & acknowledgeNotification (#301, #311)', () => {
    it('retrieves fund-scoped sent, failed, bounced, and acknowledged events in deterministic order and surfaces provider failures', async () => {
      const backing: NotificationLog[] = [];
      const historyProvider: NotificationHistoryProvider = {
        append: jest.fn(async (rec: NotificationLog) => {
          backing.push(rec);
        }),
        listByFund: jest.fn(async (fundId: string) => backing.filter((r) => r.fundId === fundId)),
        markAcknowledged: jest.fn(async (notificationId: string, acknowledgedAt: number) => {
          for (const rec of backing) {
            if (rec.notificationId === notificationId || rec.id === notificationId) {
              rec.acknowledged = true;
              rec.acknowledgedAt = acknowledgedAt;
            }
          }
        }),
      };

      const { client, adminKey } = makeClient(
        {
          submitTransaction: jest.fn(async () => ({
            status: 'SUCCESS',
            hash: 'reg-tx-123',
            result: { retval: nativeToScVal('onchain-notif-99') },
          })),
        },
        {
          historyProvider,
          deliveryProviders: {
            email: { send: jest.fn(async () => ({ accepted: true })) },
          },
        }
      );

      const reg = await client.registerFundExpiryNotification(
        adminKey.publicKey(),
        'fund-1',
        'Flood Fund',
        1800000000,
        'ops@relief.org'
      );
      expect(reg.notificationId).toBe('onchain-notif-99');
      expect(reg.identifierSource).toBe('contract');

      await client.sendExpiryNotifications(
        [
          {
            id: reg.notificationId,
            fundId: 'fund-1',
            fundName: 'Flood Fund',
            expiresAt: 1800000000,
            daysUntilExpiry: 3,
            totalAmount: '500',
            releasedAmount: '0',
            availableAmount: '500',
            adminAddress: adminKey.publicKey(),
            notificationSentAt: 1799700000,
            notificationStatus: 'pending',
          },
        ],
        ['email', 'sms']
      );

      await client.acknowledgeNotification(adminKey.publicKey(), reg.notificationId);

      const fund1History = await client.getNotificationHistory('fund-1');
      expect(fund1History).toHaveLength(2);
      expect(fund1History.every((h) => h.acknowledged === true)).toBe(true);
      expect(fund1History.map((h) => h.status)).toContain('sent');
      expect(fund1History.map((h) => h.status)).toContain('failed');

      await expect(client.getNotificationHistory('fund-empty')).resolves.toEqual([]);

      (historyProvider.listByFund as jest.Mock).mockRejectedValueOnce(new Error('storage offline'));
      await expect(client.getNotificationHistory('fund-1')).rejects.toThrow('storage offline');
    });

    it('uses deterministic tx correlation ID when contract returns no string ID and rejects malformed/missing result data (#311)', async () => {
      const { client: corrClient, adminKey: ak1 } = makeClient({
        submitTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          hash: 'abc999',
        })),
      });

      const reg = await corrClient.registerFundExpiryNotification(
        ak1.publicKey(),
        'fund-2',
        'Storm Fund',
        1800000000,
        'ops@relief.org'
      );
      expect(reg.identifierSource).toBe('tx-correlation');
      expect(reg.notificationId).toBe('tx:abc999:fund-2');

      await corrClient.acknowledgeNotification(ak1.publicKey(), reg.notificationId);
      const hist = await corrClient.getNotificationHistory('fund-2');
      expect(hist).toHaveLength(1);
      expect(hist[0].acknowledged).toBe(true);
      expect(hist[0].notificationId).toBe(reg.notificationId);

      const { client: badClient, adminKey: ak2 } = makeClient({
        submitTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          hash: 'bad-ret',
          result: { retval: { malformedScVal: true } },
        })),
      });
      await expect(
        badClient.registerFundExpiryNotification(ak2.publicKey(), 'fund-2', 'Storm', 1800000000, 'a@b.com')
      ).rejects.toThrow(ValidationError);

      const { client: failedTxClient, adminKey: ak3 } = makeClient({
        submitTransaction: jest.fn(async () => ({ status: 'FAILED', hash: 'failed-1' })),
      });
      await expect(
        failedTxClient.registerFundExpiryNotification(ak3.publicKey(), 'fund-2', 'Storm', 1800000000, 'a@b.com')
      ).rejects.toThrow(NetworkError);
    });
  });

  describe('updateNotificationConfig (#310)', () => {
    it('rejects out-of-range thresholds and persists validated updates across client reconstruction', async () => {
      let persisted: any = null;
      const configStore: NotificationConfigStore = {
        loadConfig: jest.fn(async () => persisted),
        saveConfig: jest.fn(async (_admin, cfg) => {
          persisted = { ...cfg };
        }),
      };

      const { client, adminKey } = makeClient({}, { configStore });

      await expect(
        client.updateNotificationConfig(adminKey.publicKey(), { notificationThresholdDays: 0 })
      ).rejects.toThrow(ValidationError);
      await expect(
        client.updateNotificationConfig(adminKey.publicKey(), { notificationThresholdDays: 400 })
      ).rejects.toThrow(ValidationError);
      await expect(
        client.updateNotificationConfig(adminKey.publicKey(), { notificationThresholdDays: Number.NaN })
      ).rejects.toThrow(ValidationError);

      const res = await client.updateNotificationConfig(adminKey.publicKey(), {
        notificationThresholdDays: 14,
        enableAutoNotifications: false,
      });
      expect(res.persistenceScope).toBe('persistent');

      // Reconstruct new client sharing the same store
      const { client: reloadedClient } = makeClient({}, { configStore });
      const loaded = await reloadedClient.loadNotificationConfig();
      expect(loaded.notificationThresholdDays).toBe(14);
      expect(loaded.enableAutoNotifications).toBe(false);

      // Without a configStore, client explicitly reports local-only persistence
      const { client: localClient, adminKey: localAdmin } = makeClient();
      const localRes = await localClient.updateNotificationConfig(localAdmin.publicKey(), {
        notificationThresholdDays: 10,
      });
      expect(localRes.persistenceScope).toBe('local-only');
    });
  });
});
