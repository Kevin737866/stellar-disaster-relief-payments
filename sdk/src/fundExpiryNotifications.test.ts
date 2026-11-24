import { Keypair } from 'stellar-sdk';
import {
  FundExpiryNotificationsClient,
  NotificationConfigError,
  NotificationConfigRecord,
  NotificationConfigStore,
  ExpiryNotificationConfig,
  MIN_NOTIFICATION_THRESHOLD_DAYS,
  MAX_NOTIFICATION_THRESHOLD_DAYS,
  MAX_NOTIFICATION_TEMPLATE_LENGTH,
} from './fundExpiryNotifications';

const SIGNER = Keypair.random();
const ADMIN = Keypair.random().publicKey();
const OTHER_ADMIN = Keypair.random().publicKey();
const CONTRACT_ID = 'CDUMMYCONTRACTID';

function makeClient(
  config?: ExpiryNotificationConfig,
  configStore?: NotificationConfigStore
): FundExpiryNotificationsClient {
  return new FundExpiryNotificationsClient(
    CONTRACT_ID,
    SIGNER,
    {} as any,
    config,
    undefined,
    configStore ? { configStore } : undefined
  );
}

function expectConfigError(fn: () => Promise<unknown>, code: string): Promise<void> {
  return fn().then(
    () => {
      throw new Error(`Expected rejection with code ${code}`);
    },
    (error: any) => {
      expect(error).toBeInstanceOf(NotificationConfigError);
      expect(error.code).toBe(code);
    }
  );
}

class MemoryConfigStore implements NotificationConfigStore {
  records = new Map<string, NotificationConfigRecord>();
  save = jest.fn(async (record: NotificationConfigRecord) => {
    this.records.set(record.contractId, { ...record, config: { ...record.config } });
  });
  load = jest.fn(async (contractId: string) => {
    const record = this.records.get(contractId);
    return record ? { ...record, config: { ...record.config } } : null;
  });
}

describe('FundExpiryNotificationsClient.updateNotificationConfig', () => {
  describe('threshold validation', () => {
    it.each([
      ['minimum', MIN_NOTIFICATION_THRESHOLD_DAYS],
      ['maximum', MAX_NOTIFICATION_THRESHOLD_DAYS],
    ])('accepts the %s boundary value (%d)', async (_label, threshold) => {
      const client = makeClient();

      const result = await client.updateNotificationConfig(ADMIN, {
        notificationThresholdDays: threshold,
      } as any);

      expect(result.success).toBe(true);
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(threshold);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['above maximum', MAX_NOTIFICATION_THRESHOLD_DAYS + 1],
      ['fractional', 3.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['string', '7'],
      ['null', null],
    ])('rejects an out-of-range %s threshold', async (_label, threshold) => {
      const client = makeClient();

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            notificationThresholdDays: threshold,
          } as any),
        'INVALID_CONFIG'
      );

      // The rejected update must not partially apply.
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });

    it('reports the accepted range in the error message', async () => {
      const client = makeClient();

      await expect(
        client.updateNotificationConfig(ADMIN, { notificationThresholdDays: 0 })
      ).rejects.toThrow(
        new RegExp(
          `${MIN_NOTIFICATION_THRESHOLD_DAYS} and ${MAX_NOTIFICATION_THRESHOLD_DAYS}`
        )
      );
    });
  });

  describe('channel and template validation', () => {
    it('rejects an empty or whitespace-only template', async () => {
      const client = makeClient();

      await expectConfigError(
        () => client.updateNotificationConfig(ADMIN, { emailTemplate: '   ' }),
        'INVALID_CONFIG'
      );
      await expectConfigError(
        () => client.updateNotificationConfig(ADMIN, { smsTemplate: '' }),
        'INVALID_CONFIG'
      );
      expect(client.getNotificationConfig().emailTemplate).toBeUndefined();
    });

    it('rejects a non-string template', async () => {
      const client = makeClient();

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            emailTemplate: 42,
          } as any),
        'INVALID_CONFIG'
      );
    });

    it('rejects an over-long template', async () => {
      const client = makeClient();

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            emailTemplate: 'x'.repeat(MAX_NOTIFICATION_TEMPLATE_LENGTH + 1),
          }),
        'INVALID_CONFIG'
      );
    });

    it('rejects a non-boolean auto-notification flag', async () => {
      const client = makeClient();

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            enableAutoNotifications: 'yes',
          } as any),
        'INVALID_CONFIG'
      );
    });

    it('rejects unknown configuration fields', async () => {
      const client = makeClient();

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            notifcationThresholdDays: 3,
          } as any),
        'INVALID_CONFIG'
      );
    });

    it('accepts valid templates and keeps unrelated settings', async () => {
      const client = makeClient();

      const result = await client.updateNotificationConfig(ADMIN, {
        emailTemplate: 'Fund {{name}} expires in {{days}} days',
        smsTemplate: '{{name}} expires soon',
      });

      expect(result.config.notificationThresholdDays).toBe(7);
      expect(result.config.emailTemplate).toBe(
        'Fund {{name}} expires in {{days}} days'
      );
      expect(result.config.smsTemplate).toBe('{{name}} expires soon');
    });
  });

  describe('admin address validation', () => {
    it('rejects a malformed admin address before touching storage', async () => {
      const store = new MemoryConfigStore();
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.updateNotificationConfig('not-a-stellar-key', {
          notificationThresholdDays: 3,
        }),
        'INVALID_ADMIN_ADDRESS'
      );

      expect(store.save).not.toHaveBeenCalled();
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });
  });

  describe('local-only updates', () => {
    it('documents that an update without a store is local and unverified', async () => {
      const client = makeClient();

      const result = await client.updateNotificationConfig(ADMIN, {
        notificationThresholdDays: 14,
      });

      expect(result).toMatchObject({
        success: true,
        persistence: 'local',
        authorization: 'unverified',
      });
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(14);
    });

    it('does not survive client reconstruction', async () => {
      const client = makeClient();
      await client.updateNotificationConfig(ADMIN, {
        notificationThresholdDays: 14,
      });

      const reloaded = makeClient();
      const load = await reloaded.loadNotificationConfig();

      expect(load).toMatchObject({ loaded: false, persistence: 'local' });
      expect(reloaded.getNotificationConfig().notificationThresholdDays).toBe(7);
    });
  });

  describe('persistent updates', () => {
    it('writes through the store and reports persistent scope', async () => {
      const store = new MemoryConfigStore();
      const client = makeClient(undefined, store);

      const result = await client.updateNotificationConfig(ADMIN, {
        notificationThresholdDays: 21,
        emailTemplate: 'Expiry reminder',
      });

      expect(result).toMatchObject({
        success: true,
        persistence: 'persistent',
        authorization: 'unverified',
      });
      expect(store.save).toHaveBeenCalledTimes(1);

      const saved = store.records.get(CONTRACT_ID)!;
      expect(saved.config.notificationThresholdDays).toBe(21);
      expect(saved.config.emailTemplate).toBe('Expiry reminder');
      expect(saved.requestedBy).toBe(ADMIN);
      expect(saved.updatedAt).toEqual(expect.any(Number));
    });

    it('survives client reconstruction via the same store', async () => {
      const store = new MemoryConfigStore();
      const client = makeClient(undefined, store);
      await client.updateNotificationConfig(ADMIN, {
        notificationThresholdDays: 30,
        smsTemplate: 'Expires in 30 days',
      });

      const rebuilt = makeClient({ notificationThresholdDays: 7, enableAutoNotifications: true }, store);
      const load = await rebuilt.loadNotificationConfig();

      expect(load).toMatchObject({ loaded: true, persistence: 'persistent' });
      expect(rebuilt.getNotificationConfig()).toEqual({
        notificationThresholdDays: 30,
        enableAutoNotifications: true,
        smsTemplate: 'Expires in 30 days',
      });
    });

    it('reports no stored snapshot without changing defaults', async () => {
      const store = new MemoryConfigStore();
      const client = makeClient(undefined, store);

      const load = await client.loadNotificationConfig();

      expect(load).toMatchObject({ loaded: false, persistence: 'persistent' });
      expect(load.config.notificationThresholdDays).toBe(7);
    });

    it('does not apply a stored snapshot with an invalid threshold', async () => {
      const store = new MemoryConfigStore();
      store.records.set(CONTRACT_ID, {
        contractId: CONTRACT_ID,
        config: { notificationThresholdDays: 0, enableAutoNotifications: true },
        updatedAt: 1,
        requestedBy: ADMIN,
      });
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.loadNotificationConfig(),
        'INVALID_CONFIG'
      );
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });

    it('discards a configuration whose merged result would be invalid', async () => {
      const store = new MemoryConfigStore();
      const client = makeClient(undefined, store);

      await expectConfigError(
        () =>
          client.updateNotificationConfig(ADMIN, {
            notificationThresholdDays: 10,
            smsTemplate: '',
          }),
        'INVALID_CONFIG'
      );

      expect(store.save).not.toHaveBeenCalled();
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });
  });

  describe('provider failures', () => {
    it('reports an authorization rejection without updating state', async () => {
      const store = new MemoryConfigStore();
      store.save.mockRejectedValueOnce(
        Object.assign(new Error('writer is not an admin'), { code: 'UNAUTHORIZED' })
      );
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.updateNotificationConfig(ADMIN, { notificationThresholdDays: 5 }),
        'UNAUTHORIZED'
      );
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });

    it('treats an HTTP 403 from the provider as unauthorized', async () => {
      const store = new MemoryConfigStore();
      store.save.mockRejectedValueOnce(
        Object.assign(new Error('forbidden'), { status: 403 })
      );
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.updateNotificationConfig(ADMIN, { notificationThresholdDays: 5 }),
        'UNAUTHORIZED'
      );
    });

    it('reports a generic provider failure as PERSISTENCE_FAILED', async () => {
      const store = new MemoryConfigStore();
      store.save.mockRejectedValueOnce(new Error('disk full'));
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.updateNotificationConfig(ADMIN, { notificationThresholdDays: 5 }),
        'PERSISTENCE_FAILED'
      );
      expect(client.getNotificationConfig().notificationThresholdDays).toBe(7);
    });

    it('reports a load failure as PERSISTENCE_FAILED', async () => {
      const store = new MemoryConfigStore();
      store.load.mockRejectedValueOnce(new Error('timeout'));
      const client = makeClient(undefined, store);

      await expectConfigError(
        () => client.loadNotificationConfig(),
        'PERSISTENCE_FAILED'
      );
    });

    it('does not claim persistence when the store is absent', async () => {
      const client = makeClient();

      const result = await client.updateNotificationConfig(OTHER_ADMIN, {
        notificationThresholdDays: 2,
      });

      expect(result.persistence).toBe('local');
      expect(result.authorization).toBe('unverified');
    });
  });

  describe('constructor validation', () => {
    it('rejects an invalid initial configuration', () => {
      expect(
        () =>
          new FundExpiryNotificationsClient(CONTRACT_ID, SIGNER, {} as any, {
            notificationThresholdDays: 0,
            enableAutoNotifications: true,
          })
      ).toThrow(NotificationConfigError);
    });
  });
});
