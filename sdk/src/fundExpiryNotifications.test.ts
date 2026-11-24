import {
  DeliveryReceipt,
  ExpiryNotification,
  FundExpiryNotificationsClient,
  NotificationDeliveryProvider,
  NotificationDeliveryProviders,
  NotificationDeliveryRequest,
} from './fundExpiryNotifications';
import { logger } from './logger';

type FakeProvider = NotificationDeliveryProvider & {
  send: jest.Mock<Promise<DeliveryReceipt | void>, [NotificationDeliveryRequest]>;
};

function acceptedProvider(messageId = 'msg-accepted'): FakeProvider {
  return {
    send: jest.fn().mockResolvedValue({ accepted: true, messageId } as DeliveryReceipt),
  };
}

function rejectingProvider(reason: string): FakeProvider {
  return {
    send: jest.fn().mockResolvedValue({ accepted: false, reason } as DeliveryReceipt),
  };
}

function throwingProvider(error: string): FakeProvider {
  return {
    send: jest.fn().mockRejectedValue(new Error(error)),
  };
}

function makeClient(providers: NotificationDeliveryProviders = {}): FundExpiryNotificationsClient {
  return new FundExpiryNotificationsClient('contract-id', {} as any, {} as any, {
    notificationThresholdDays: 7,
    enableAutoNotifications: true,
    deliveryProviders: providers,
  });
}

function makeNotification(overrides: Partial<ExpiryNotification> = {}): ExpiryNotification {
  return {
    id: 'notification-1',
    fundId: 'fund-1',
    fundName: 'Relief Fund',
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
    daysUntilExpiry: 1,
    totalAmount: '1000',
    releasedAmount: '200',
    availableAmount: '800',
    adminAddress: 'GADMIN',
    notificationSentAt: 0,
    notificationStatus: 'pending',
    ...overrides,
  };
}

describe('FundExpiryNotificationsClient delivery providers', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('marks a notification sent only after the provider accepts delivery', async () => {
    const email = acceptedProvider('email-123');
    const client = makeClient({ email });
    const notification = makeNotification();

    const result = await client.sendExpiryNotifications([notification], ['email']);

    expect(result).toEqual({
      success: true,
      sentCount: 1,
      failedCount: 0,
      logs: expect.any(Array),
    });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      fundId: 'fund-1',
      notificationType: 'email',
      status: 'sent',
      providerMessageId: 'email-123',
    });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0]).toMatchObject({
      channel: 'email',
      recipient: 'GADMIN',
      fundId: 'fund-1',
      message: expect.stringContaining('Relief Fund'),
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('treats a resolved provider call with no receipt as acceptance', async () => {
    const webhook: FakeProvider = { send: jest.fn().mockResolvedValue(undefined) };
    const client = makeClient({ webhook });

    const result = await client.sendExpiryNotifications([makeNotification()], ['webhook']);

    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.logs[0].status).toBe('sent');
  });

  it('reports a provider rejection as a failed result with the reason', async () => {
    const email = rejectingProvider('SMTP quota exceeded');
    const client = makeClient({ email });

    const result = await client.sendExpiryNotifications([makeNotification()], ['email']);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.logs[0]).toMatchObject({
      notificationType: 'email',
      status: 'failed',
      reason: 'SMTP quota exceeded',
    });
    expect(result.logs[0].message).toContain('SMTP quota exceeded');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports a thrown provider error as failed without throwing out of the client', async () => {
    const sms = throwingProvider('SMS gateway unavailable');
    const client = makeClient({ sms });

    const result = await client.sendExpiryNotifications([makeNotification()], ['sms']);

    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.sentCount).toBe(0);
    expect(result.logs[0].status).toBe('failed');
    expect(result.logs[0].reason).toContain('SMS gateway unavailable');
    expect(result.logs[0].message).toContain('SMS gateway unavailable');
  });

  it('fails with an actionable reason when no provider is configured', async () => {
    const client = makeClient();

    const result = await client.sendExpiryNotifications([makeNotification()], ['email']);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].status).toBe('failed');
    expect(result.logs[0].reason).toMatch(/no email delivery provider is configured/i);
    expect(result.logs[0].reason).toMatch(/deliveryProviders\.email/i);
    expect(result.logs[0].message).toContain(result.logs[0].reason);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('fails when a configured provider does not implement a delivery method', async () => {
    const client = makeClient({ webhook: {} as NotificationDeliveryProvider });

    const result = await client.sendExpiryNotifications([makeNotification()], ['webhook']);

    expect(result.failedCount).toBe(1);
    expect(result.logs[0].status).toBe('failed');
    expect(result.logs[0].reason).toMatch(/no send\(\) method/i);
  });

  it('keeps successful channel results when another channel fails or is missing', async () => {
    const email = throwingProvider('email outage');
    const sms = acceptedProvider('sms-456');
    const client = makeClient({ email, sms });
    const notifications = [makeNotification(), makeNotification({ id: 'notification-2', fundId: 'fund-2' })];

    const result = await client.sendExpiryNotifications(notifications, ['email', 'sms', 'webhook']);

    expect(result.success).toBe(false);
    expect(result.sentCount).toBe(2);
    expect(result.failedCount).toBe(4);
    expect(result.logs).toHaveLength(6);
    expect(result.logs.map((log) => log.notificationType)).toEqual([
      'email', 'sms', 'webhook', 'email', 'sms', 'webhook',
    ]);
    expect(result.logs.map((log) => log.status)).toEqual([
      'failed', 'sent', 'failed', 'failed', 'sent', 'failed',
    ]);
    expect(result.logs.filter((log) => log.notificationType === 'sms')).toHaveLength(2);
    expect(result.logs.filter((log) => log.notificationType === 'sms').every((log) => log.status === 'sent')).toBe(true);
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(sms.send).toHaveBeenCalledTimes(2);
  });

  it('accepts providers passed as the dedicated constructor argument', async () => {
    const email = acceptedProvider();
    const client = new FundExpiryNotificationsClient(
      'contract-id',
      {} as any,
      {} as any,
      undefined,
      undefined,
      { email }
    );

    const result = await client.sendExpiryNotifications([makeNotification()], ['email']);

    expect(result.sentCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(email.send).toHaveBeenCalledTimes(1);
  });
});
