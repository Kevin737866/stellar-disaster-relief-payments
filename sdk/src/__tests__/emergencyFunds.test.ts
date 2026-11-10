import { Account, Keypair, Networks, StrKey, nativeToScVal, xdr } from 'stellar-sdk';
import { EmergencyFundsClient } from '../emergencyFunds';
import { FundNotFoundError, NetworkError, ValidationError } from '../errors';

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

function makeClient(serverOverrides: Record<string, any> = {}) {
  const signingKey = Keypair.random();
  const donorKey = Keypair.random();
  const server = {
    loadAccount: jest.fn(async (pub: string) => new Account(pub, '100')),
    simulateTransaction: jest.fn(),
    submitTransaction: jest.fn(),
    getTransaction: jest.fn(),
    ...serverOverrides,
  };
  const client = new EmergencyFundsClient(CONTRACT_ID, signingKey, server, Networks.TESTNET);
  return { client, server, signingKey, donorKey };
}

describe('EmergencyFundsClient contract-backed reads and recall (#297-#299, #312-#313)', () => {
  describe('getFundStatus (#297)', () => {
    it('decodes live contract status tuple from simulation retval', async () => {
      const tupleVal = xdr.ScVal.scvVec([
        nativeToScVal('triggered'),
        nativeToScVal(BigInt('500000000'), { type: 'u256' }),
        nativeToScVal(BigInt('125000000'), { type: 'u256' }),
        nativeToScVal(BigInt('375000000'), { type: 'u256' }),
        nativeToScVal(42, { type: 'u64' }),
      ]);
      const { client, server } = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: tupleVal } })),
      });

      const status = await client.getFundStatus('fund-haiti-2026');
      expect(status).toEqual({
        status: 'triggered',
        totalAmount: '500000000',
        releasedAmount: '125000000',
        availableAmount: '375000000',
        beneficiaryCount: 42,
      });
      expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws FundNotFoundError when simulation reports a missing fund', async () => {
      const { client } = makeClient({
        simulateTransaction: jest.fn(async () => ({
          error: 'HostError: Error(Storage, MissingValue) — fund not found',
        })),
      });

      await expect(client.getFundStatus('missing-fund')).rejects.toThrow(FundNotFoundError);
    });

    it('throws ValidationError on malformed simulation response', async () => {
      const { client } = makeClient({
        simulateTransaction: jest.fn(async () => ({
          result: { retval: { invalidScVal: true } },
        })),
      });

      await expect(client.getFundStatus('fund-1')).rejects.toThrow(ValidationError);
    });

    it('throws NetworkError when RPC simulation fails', async () => {
      const { client } = makeClient({
        simulateTransaction: jest.fn(async () => {
          throw new Error('RPC connection refused');
        }),
      });

      await expect(client.getFundStatus('fund-1')).rejects.toThrow(NetworkError);
    });
  });

  describe('getFundTriggers & getFundAllocations (#298)', () => {
    it('returns decoded triggers from contract simulation', async () => {
      const triggersScVal = nativeToScVal([
        {
          id: 'trig-1',
          fund_id: 'fund-1',
          trigger_type: 'seismic',
          threshold: '6.5',
          oracle_source: 'usgs',
          auto_release_amount: BigInt('1000000'),
          geofence_latitude: 18.5,
          geofence_longitude: -72.3,
          geofence_radius_km: 50,
          min_oracle_confirmations: 2,
          is_active: true,
          last_triggered: 0,
          trigger_count: 1,
          last_verified: 1700000000,
        },
      ]);
      const { client } = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: triggersScVal } })),
      });

      const triggers = await client.getFundTriggers('fund-1');
      expect(triggers).toHaveLength(1);
      expect(triggers[0]).toMatchObject({
        id: 'trig-1',
        fundId: 'fund-1',
        triggerType: 'seismic',
        oracleSource: 'usgs',
        autoReleaseAmount: '1000000',
        minOracleConfirmations: 2,
      });
    });

    it('returns empty array only when contract returns no triggers and rejects RPC/decode errors', async () => {
      const emptyClient = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: xdr.ScVal.scvVec([]) } })),
      }).client;
      await expect(emptyClient.getFundTriggers('fund-1')).resolves.toEqual([]);

      const rpcFailClient = makeClient({
        simulateTransaction: jest.fn(async () => {
          throw new Error('timeout');
        }),
      }).client;
      await expect(rpcFailClient.getFundTriggers('fund-1')).rejects.toThrow(NetworkError);

      const decodeFailClient = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: nativeToScVal('not-an-array') } })),
      }).client;
      await expect(decodeFailClient.getFundTriggers('fund-1')).rejects.toThrow(ValidationError);
    });

    it('returns decoded allocations, empty allocations, and rejects RPC/decode failures', async () => {
      const allocScVal = nativeToScVal([
        {
          sector: 'medical',
          amount: BigInt('2500000'),
          beneficiaries: ['GAAA', 'GBBB'],
          proof_of_need: 'hospital-report',
          allocated_at: 1700000100,
          min_amount: BigInt('100000'),
          max_amount: BigInt('5000000'),
        },
      ]);
      const { client } = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: allocScVal } })),
      });
      const allocations = await client.getFundAllocations('fund-1');
      expect(allocations).toEqual([
        {
          sector: 'medical',
          amount: '2500000',
          beneficiaries: ['GAAA', 'GBBB'],
          proofOfNeed: 'hospital-report',
          allocatedAt: 1700000100,
          minAmount: '100000',
          maxAmount: '5000000',
        },
      ]);

      const emptyClient = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: xdr.ScVal.scvVec([]) } })),
      }).client;
      await expect(emptyClient.getFundAllocations('fund-1')).resolves.toEqual([]);

      const rpcFailClient = makeClient({
        simulateTransaction: jest.fn(async () => {
          throw new Error('RPC unavailable');
        }),
      }).client;
      await expect(rpcFailClient.getFundAllocations('fund-1')).rejects.toThrow(NetworkError);

      const badShapeClient = makeClient({
        simulateTransaction: jest.fn(async () => ({ result: { retval: nativeToScVal(123) } })),
      }).client;
      await expect(badShapeClient.getFundAllocations('fund-1')).rejects.toThrow(ValidationError);
    });
  });

  describe('getDisbursementHistory (#312)', () => {
    it('wires offset and limit to get_disbursements and decodes paginated pages', async () => {
      const page1 = nativeToScVal({
        records: [
          {
            id: 'disb-1',
            fund_id: 'fund-1',
            beneficiary: 'GBEN1',
            amount: BigInt('50000'),
            timestamp: 1700000200,
            purpose: 'food',
            approved_by: ['GAPP1'],
            transaction_hash: 'txhash1',
            is_auto_released: false,
          },
        ],
        total_count: 2,
        has_more: true,
      });
      const page2 = nativeToScVal({
        records: [
          {
            id: 'disb-2',
            fund_id: 'fund-1',
            beneficiary: 'GBEN2',
            amount: BigInt('75000'),
            timestamp: 1700000300,
            purpose: 'water',
            approved_by: ['GAPP1', 'GAPP2'],
            transaction_hash: 'txhash2',
            trigger_id: 'trig-1',
            is_auto_released: true,
          },
        ],
        total_count: 2,
        has_more: false,
      });

      const simulateTransaction = jest
        .fn()
        .mockResolvedValueOnce({ result: { retval: page1 } })
        .mockResolvedValueOnce({ result: { retval: page2 } });

      const { client } = makeClient({ simulateTransaction });

      const first = await client.getDisbursementHistory('fund-1', 0, 1);
      expect(first.totalCount).toBe(2);
      expect(first.hasMore).toBe(true);
      expect(first.records[0]).toMatchObject({
        id: 'disb-1',
        amount: '50000',
        purpose: 'food',
        isAutoReleased: false,
      });

      const second = await client.getDisbursementHistory('fund-1', 1, 1);
      expect(second.totalCount).toBe(2);
      expect(second.hasMore).toBe(false);
      expect(second.records[0]).toMatchObject({
        id: 'disb-2',
        amount: '75000',
        triggerId: 'trig-1',
        isAutoReleased: true,
      });
    });

    it('rejects invalid pagination bounds before calling RPC', async () => {
      const { client, server } = makeClient();
      await expect(client.getDisbursementHistory('fund-1', -1, 10)).rejects.toThrow(ValidationError);
      await expect(client.getDisbursementHistory('fund-1', 0, 0)).rejects.toThrow(ValidationError);
      await expect(client.getDisbursementHistory('fund-1', 0.5, 10)).rejects.toThrow(ValidationError);
      expect(server.simulateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('recallUnusedFunds (#299)', () => {
    it('returns non-zero recalled amount confirmed by contract result', async () => {
      const { client, donorKey } = makeClient({
        submitTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          hash: 'recall-hash-1',
          result: { retval: nativeToScVal(BigInt('900000000000'), { type: 'u256' }) },
        })),
      });

      const res = await client.recallUnusedFunds(donorKey.publicKey(), 'fund-1');
      expect(res).toEqual({
        success: true,
        recalledAmount: '900000000000',
        transactionHash: 'recall-hash-1',
      });
    });

    it('returns zero recalled amount when contract genuinely confirms zero via follow-up read', async () => {
      const { client, server, donorKey } = makeClient({
        submitTransaction: jest.fn(async () => ({
          status: 'PENDING',
          hash: 'recall-hash-zero',
        })),
        getTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          returnValue: nativeToScVal(BigInt(0), { type: 'u256' }),
        })),
      });

      const res = await client.recallUnusedFunds(donorKey.publicKey(), 'fund-1');
      expect(res).toEqual({
        success: true,
        recalledAmount: '0',
        transactionHash: 'recall-hash-zero',
      });
      expect(server.getTransaction).toHaveBeenCalledWith('recall-hash-zero');
    });

    it('rejects failed submissions and undecodable recall results', async () => {
      const { client: failClient, donorKey: dk1 } = makeClient({
        submitTransaction: jest.fn(async () => ({ status: 'FAILED', hash: 'bad-hash' })),
      });
      await expect(failClient.recallUnusedFunds(dk1.publicKey(), 'fund-1')).rejects.toThrow(NetworkError);

      const { client: undecodableClient, donorKey: dk2 } = makeClient({
        submitTransaction: jest.fn(async () => ({ status: 'SUCCESS', hash: 'missing-ret' })),
        getTransaction: jest.fn(async () => ({ status: 'SUCCESS' })),
      });
      await expect(undecodableClient.recallUnusedFunds(dk2.publicKey(), 'fund-1')).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe('getMetadata (#313)', () => {
    it('decodes populated metadata and empty metadata maps', async () => {
      const populatedMap = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: nativeToScVal('region'),
          val: nativeToScVal('caribbean'),
        }),
        new xdr.ScMapEntry({
          key: nativeToScVal('currency'),
          val: nativeToScVal('USDC'),
        }),
      ]);
      const emptyMap = xdr.ScVal.scvMap([]);

      const simulateTransaction = jest
        .fn()
        .mockResolvedValueOnce({ result: { retval: populatedMap } })
        .mockResolvedValueOnce({ result: { retval: emptyMap } });

      const { client } = makeClient({ simulateTransaction });
      await expect(client.getMetadata('fund-1')).resolves.toEqual({
        region: 'caribbean',
        currency: 'USDC',
      });
      await expect(client.getMetadata('fund-empty')).resolves.toEqual({});
    });

    it('surfaces invalid metadata values, unknown funds, and RPC errors', async () => {
      const invalidValClient = makeClient({
        simulateTransaction: jest.fn(async () => ({
          result: { retval: nativeToScVal({ count: 123 }) },
        })),
      }).client;
      await expect(invalidValClient.getMetadata('fund-1')).rejects.toThrow(ValidationError);

      const missingClient = makeClient({
        simulateTransaction: jest.fn(async () => ({ error: 'HostError: fund does not exist' })),
      }).client;
      await expect(missingClient.getMetadata('unknown')).rejects.toThrow(FundNotFoundError);

      const rpcClient = makeClient({
        simulateTransaction: jest.fn(async () => {
          throw new Error('network error');
        }),
      }).client;
      await expect(rpcClient.getMetadata('fund-1')).rejects.toThrow(NetworkError);
    });
  });
});
