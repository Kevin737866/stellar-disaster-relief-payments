import { Keypair } from 'stellar-sdk';
import { FundExpiryNotificationsClient } from './fundExpiryNotifications';

const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockSign = jest.fn();
const mockBuild = jest.fn();
const mockSetTimeout = jest.fn();
const mockAddOperation = jest.fn();
const mockContractCall = jest.fn();

const mockServer = {
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
  getTransaction: mockGetTransaction,
};

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: mockAddOperation.mockReturnThis(),
      setTimeout: mockSetTimeout.mockReturnThis(),
      build: mockBuild.mockReturnValue({ sign: mockSign }),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      call: mockContractCall.mockReturnValue({}),
    })),
    Address: jest.fn().mockImplementation((addr: string) => ({
      toScVal: () => addr,
      toString: () => addr,
    })),
    scValToNative: jest.fn((v: any) => v),
  };
});

describe('FundExpiryNotificationsClient.registerFundExpiryNotification', () => {
  const signingKey = Keypair.random();
  const adminAddress = Keypair.random().publicKey();
  const fundId = 'fund-123';
  const fundName = 'Emergency Fund';
  const expiresAt = 1_900_000_000;
  const notificationEmail = 'admin@example.com';
  const txHash = 'abc123txhash';

  let client: FundExpiryNotificationsClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadAccount.mockResolvedValue({ id: adminAddress, sequence: '1' });
    mockAddOperation.mockReturnThis();
    mockSetTimeout.mockReturnThis();
    mockBuild.mockReturnValue({ sign: mockSign });
    mockGetTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

    client = new FundExpiryNotificationsClient(
      'CCONTRACTID',
      signingKey,
      mockServer as any,
      { notificationThresholdDays: 7, enableAutoNotifications: true },
      'Test SDF Network ; September 2015'
    );
  });

  test('returns contract-returned notification ID when present in confirmed result', async () => {
    mockSubmitTransaction.mockResolvedValue({
      hash: txHash,
      status: 'SUCCESS',
      returnValue: 'notif-001',
    });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result).toEqual({
      success: true,
      transactionHash: txHash,
      notificationId: 'notif-001',
      notificationIdSource: 'contract',
    });
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });

  test('decodes contract notification ID from resultMetaXdr when submit response has no returnValue', async () => {
    const { scValToNative } = jest.requireMock('stellar-sdk') as { scValToNative: jest.Mock };
    scValToNative.mockReturnValueOnce('notif-meta-42');

    mockSubmitTransaction.mockResolvedValue({ hash: txHash, status: 'PENDING' });
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      resultMetaXdr: {
        v3: () => ({
          sorobanMeta: () => ({
            returnValue: () => ({ mock: 'scval' }),
          }),
        }),
      },
    });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result.notificationId).toBe('notif-meta-42');
    expect(result.notificationIdSource).toBe('contract');
    expect(result.transactionHash).toBe(txHash);
    expect(mockGetTransaction).toHaveBeenCalled();
  });

  test('falls back to transaction-hash correlation ID when contract exposes no notification ID', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: txHash, status: 'SUCCESS' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe(txHash);
    expect(result.notificationIdSource).toBe('correlation');
    expect(result.notificationId).toBe(`tx:${txHash}:fund:${fundId}:notification-registration`);
    expect(result.notificationId).not.toContain('_expiry_');
  });

  test('falls back to correlation ID when getTransaction is unavailable but tx hash is confirmed in submit response', async () => {
    const serverWithoutGetTx = {
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    };
    client = new FundExpiryNotificationsClient(
      'CCONTRACTID',
      signingKey,
      serverWithoutGetTx as any,
      { notificationThresholdDays: 7, enableAutoNotifications: true },
      'Test SDF Network ; September 2015'
    );

    mockSubmitTransaction.mockResolvedValue({ hash: txHash });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result.notificationIdSource).toBe('correlation');
    expect(result.notificationId).toContain(txHash);
  });

  test('throws on malformed contract result and does not return success-shaped unrelated identifier', async () => {
    mockSubmitTransaction.mockResolvedValue({
      hash: txHash,
      status: 'SUCCESS',
      returnValue: { unexpected: 'object' },
    });

    await expect(
      client.registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail)
    ).rejects.toThrow(/malformed contract result/i);

    await expect(
      client.registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail)
    ).rejects.not.toMatchObject({ notificationId: expect.any(String) });
  });

  test('throws when confirmed transaction lookup reports FAILED', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: txHash, status: 'PENDING' });
    mockGetTransaction.mockResolvedValue({ status: 'FAILED' });

    await expect(
      client.registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail)
    ).rejects.toThrow(/failed on-chain/i);
  });

  test('decodes a named notification ID from result.retval', async () => {
    mockSubmitTransaction.mockResolvedValue({
      hash: txHash,
      status: 'SUCCESS',
      result: { retval: { notification_id: 'notif-retval-7' } },
    });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result.notificationId).toBe('notif-retval-7');
    expect(result.notificationIdSource).toBe('contract');
  });

  test('uses a correlation ID when the confirmed result has no notification data', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: txHash, status: 'PENDING' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: null });

    const result = await client.registerFundExpiryNotification(
      adminAddress,
      fundId,
      fundName,
      expiresAt,
      notificationEmail
    );

    expect(result.notificationIdSource).toBe('correlation');
    expect(result.notificationId).toContain(txHash);
  });

  test('throws when result decoding fails instead of returning a correlation ID', async () => {
    const { scValToNative } = jest.requireMock('stellar-sdk') as { scValToNative: jest.Mock };
    scValToNative.mockImplementationOnce(() => {
      throw new Error('invalid xdr');
    });
    mockSubmitTransaction.mockResolvedValue({ hash: txHash, status: 'PENDING' });
    mockGetTransaction.mockResolvedValue({
      status: 'SUCCESS',
      resultMetaXdr: {
        v3: () => ({
          sorobanMeta: () => ({
            returnValue: () => ({ mock: 'scval' }),
          }),
        }),
      },
    });

    await expect(
      client.registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail)
    ).rejects.toThrow(/malformed contract result/i);
  });

  test('throws when transaction response has no transaction hash', async () => {
    mockSubmitTransaction.mockResolvedValue({ status: 'SUCCESS', returnValue: 'notif-1' });

    await expect(
      client.registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail)
    ).rejects.toThrow(/transaction hash/i);
  });
});

describe('FundExpiryNotificationsClient acknowledgement/history ID usage', () => {
  const signingKey = Keypair.random();
  const adminAddress = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadAccount.mockResolvedValue({ id: adminAddress, sequence: '1' });
    mockAddOperation.mockReturnThis();
    mockSetTimeout.mockReturnThis();
    mockBuild.mockReturnValue({ sign: mockSign });
  });

  test('acknowledgeNotification accepts contract-returned ID', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: 'ack-hash' });
    const client = new FundExpiryNotificationsClient('CCONTRACTID', signingKey, mockServer as any);

    const result = await client.acknowledgeNotification(adminAddress, 'notif-001');

    expect(result.success).toBe(true);
    expect(typeof result.acknowledgedAt).toBe('number');
    expect(mockContractCall).toHaveBeenCalledWith(
      'acknowledge_notification',
      expect.anything(),
      'notif-001'
    );
  });

  test('acknowledgeNotification accepts correlation ID returned by register fallback', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: 'ack-hash' });
    const client = new FundExpiryNotificationsClient('CCONTRACTID', signingKey, mockServer as any);
    const correlationId = 'tx:abc123txhash:fund:fund-123:notification-registration';

    await client.acknowledgeNotification(adminAddress, correlationId);

    expect(mockContractCall).toHaveBeenCalledWith(
      'acknowledge_notification',
      expect.anything(),
      correlationId
    );
  });

  test('acknowledgeNotification rejects empty notificationId', async () => {
    const client = new FundExpiryNotificationsClient('CCONTRACTID', signingKey, mockServer as any);

    await expect(client.acknowledgeNotification(adminAddress, '')).rejects.toThrow(/notificationId is required/);
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  test('getNotificationHistory remains fund-scoped', async () => {
    const client = new FundExpiryNotificationsClient('CCONTRACTID', signingKey, mockServer as any);
    const logs = await client.getNotificationHistory('fund-123');
    expect(logs).toEqual([]);
  });

  test('acknowledgeNotification accepts the identifier returned by registration', async () => {
    const client = new FundExpiryNotificationsClient('CCONTRACTID', signingKey, mockServer as any);
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });
    mockSubmitTransaction.mockResolvedValueOnce({ hash: 'register-hash', status: 'SUCCESS' });

    const registered = await client.registerFundExpiryNotification(
      adminAddress,
      'fund-123',
      'Emergency Fund',
      1_900_000_000,
      'admin@example.com'
    );

    mockSubmitTransaction.mockResolvedValueOnce({ hash: 'ack-hash' });
    await client.acknowledgeNotification(adminAddress, registered.notificationId);

    expect(registered.notificationIdSource).toBe('correlation');
    expect(mockContractCall).toHaveBeenLastCalledWith(
      'acknowledge_notification',
      expect.anything(),
      registered.notificationId
    );
  });
});
