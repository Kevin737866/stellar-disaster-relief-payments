import { Keypair, Networks } from 'stellar-sdk';
import {
  FundExpiryData,
  FundExpiryDataProvider,
  FundExpiryNotificationsClient,
} from './fundExpiryNotifications';

const CONTRACT_ID =
  'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA';
const NOW_SECONDS = 1_700_000_000;
const DAY = 24 * 60 * 60;

function makeClient(provider: FundExpiryDataProvider) {
  return new FundExpiryNotificationsClient(
    CONTRACT_ID,
    Keypair.random(),
    {}, // server — unused by checkExpiringFunds
    { notificationThresholdDays: 7, enableAutoNotifications: true },
    Networks.TESTNET,
    provider,
  );
}

function fund(partial: Partial<FundExpiryData>): FundExpiryData {
  return {
    fundId: 'fund',
    fundName: 'Fund',
    expiresAt: NOW_SECONDS + 3 * DAY,
    totalAmount: '1000',
    releasedAmount: '0',
    availableAmount: '1000',
    adminAddress: 'GADMIN',
    ...partial,
  };
}

describe('FundExpiryNotificationsClient.checkExpiringFunds', () => {
  const realDateNow = Date.now;

  beforeEach(() => {
    Date.now = () => NOW_SECONDS * 1000;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  it('returns notifications only for funds inside the threshold', async () => {
    const fundsById: Record<string, FundExpiryData> = {
      inside: fund({ fundId: 'inside', expiresAt: NOW_SECONDS + 3 * DAY }),
      outside: fund({ fundId: 'outside', expiresAt: NOW_SECONDS + 30 * DAY }),
    };
    const client = makeClient({
      getFund: async (id) => fundsById[id],
    });

    const result = await client.checkExpiringFunds(['inside', 'outside']);

    expect(result).toHaveLength(1);
    expect(result[0].fundId).toBe('inside');
    expect(result[0].daysUntilExpiry).toBe(3);
    expect(result[0].notificationStatus).toBe('pending');
  });

  it('includes funds at the threshold boundary and excludes funds one second past it', async () => {
    const atBoundary = fund({
      fundId: 'at',
      expiresAt: NOW_SECONDS + 7 * DAY,
    });
    const justPast = fund({
      fundId: 'past',
      expiresAt: NOW_SECONDS + 7 * DAY + 1,
    });
    const client = makeClient({
      getFund: async (id) => (id === 'at' ? atBoundary : justPast),
    });

    const result = await client.checkExpiringFunds(['at', 'past']);

    expect(result.map((r) => r.fundId)).toEqual(['at']);
  });

  it('skips already-expired, missing, non-expiring, and already-handled funds', async () => {
    const data: Record<string, FundExpiryData | undefined> = {
      expired: fund({ fundId: 'expired', expiresAt: NOW_SECONDS - 1 }),
      missing: undefined,
      perpetual: fund({ fundId: 'perpetual', neverExpires: true }),
      handled: fund({ fundId: 'handled', handled: true }),
    };
    const client = makeClient({
      getFund: async (id) => data[id],
    });

    const result = await client.checkExpiringFunds([
      'expired',
      'missing',
      'perpetual',
      'handled',
    ]);

    expect(result).toEqual([]);
  });

  it('surfaces provider errors instead of returning an empty success', async () => {
    const client = makeClient({
      getFund: async () => {
        throw new Error('RPC unavailable');
      },
    });

    await expect(client.checkExpiringFunds(['a'])).rejects.toThrow(
      'RPC unavailable',
    );
  });

  it('throws when no provider is configured', async () => {
    const client = new FundExpiryNotificationsClient(
      CONTRACT_ID,
      Keypair.random(),
      {},
    );
    await expect(client.checkExpiringFunds(['a'])).rejects.toThrow(
      /data provider/i,
    );
  });

  it('handles a mixed list without reordering surviving entries', async () => {
    const funds: Record<string, FundExpiryData | undefined> = {
      a: fund({ fundId: 'a', expiresAt: NOW_SECONDS + 2 * DAY }),
      b: undefined,
      c: fund({ fundId: 'c', expiresAt: NOW_SECONDS + 100 * DAY }),
      d: fund({ fundId: 'd', expiresAt: NOW_SECONDS + 5 * DAY }),
    };
    const client = makeClient({
      getFund: async (id) => funds[id],
    });

    const result = await client.checkExpiringFunds(['a', 'b', 'c', 'd']);

    expect(result.map((r) => r.fundId)).toEqual(['a', 'd']);
  });
});
