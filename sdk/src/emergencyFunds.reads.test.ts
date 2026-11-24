/**
 * Unit tests for EmergencyFundsClient contract-backed reads:
 *   - getFundTriggers
 *   - getFundAllocations
 *
 * Each method must:
 *   - return decoded records when the contract returns data,
 *   - return an empty array only when the contract confirms there are none,
 *   - surface RPC and decoding failures as errors (never as empty arrays).
 */

import { Keypair, StrKey, scValToNative } from 'stellar-sdk';
import {
  EmergencyFundsClient,
  Trigger,
  FundAllocation,
} from './emergencyFunds';
import { NetworkError } from './errors';

// ── Stellar SDK mock ────────────────────────────────────────────────────────
// Keep the real Contract/Keypair/StrKey implementations, but make the
// (de)serialisation helpers pass-through so tests can feed plain JS records
// that mimic the shape produced by scValToNative for the Rust structs.

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    nativeToScVal: jest.fn((v: unknown) => v),
    scValToNative: jest.fn((v: any) => v),
  };
});

const mockScValToNative = scValToNative as unknown as jest.Mock;

// ── Helpers ─────────────────────────────────────────────────────────────────

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const SIGNER_SECRET = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';

function makeClient(): EmergencyFundsClient {
  const client = new EmergencyFundsClient(
    contractId(1),
    Keypair.fromSecret(SIGNER_SECRET),
    {} as any
  );
  return client;
}

/** Wire the client's contract.call to resolve with a raw retval. */
function wireCall(client: EmergencyFundsClient, retval: any): jest.Mock {
  const call = jest.fn().mockResolvedValue({ result: { retval } });
  (client as any).contract.call = call;
  return call;
}

/** Wire the client's contract.call to reject (simulating an RPC failure). */
function wireCallRejecting(client: EmergencyFundsClient, error: Error): jest.Mock {
  const call = jest.fn().mockRejectedValue(error);
  (client as any).contract.call = call;
  return call;
}

function rawTrigger(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'trig_1',
    fund_id: 'fund_001',
    trigger_type: 'seismic',
    threshold: '6.5',
    oracle_source: 'usgs',
    auto_release_amount: '5000',
    geofence_latitude: 37_500_000, // 37.5 * 1e6
    geofence_longitude: -122_000_000, // -122 * 1e6
    geofence_radius_km: 50,
    min_oracle_confirmations: 3,
    is_active: true,
    last_triggered: 1_700_000_000,
    trigger_count: 2,
    last_verified: 1_700_000_100,
    ...overrides,
  };
}

function rawAllocation(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    sector: 'food',
    amount: '1000',
    beneficiaries: ['GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYZ7RJC5R4M4Q6R7T2G6JQ6R4M4Q'],
    proof_of_need: 'famine relief',
    allocated_at: 1_700_000_200,
    min_amount: '100',
    max_amount: '5000',
    ...overrides,
  };
}

// ── getFundTriggers ───────────────────────────────────────────────────────────

describe('EmergencyFundsClient.getFundTriggers', () => {
  beforeEach(() => {
    mockScValToNative.mockReset();
    mockScValToNative.mockImplementation((v: any) => v);
  });

  it('queries get_fund_triggers for the requested fund', async () => {
    const client = makeClient();
    const call = wireCall(client, []);

    await client.getFundTriggers('fund_001');

    expect(call).toHaveBeenCalledWith('get_fund_triggers', 'fund_001');
  });

  it('decodes non-empty contract records into Trigger[]', async () => {
    const client = makeClient();
    wireCall(client, [rawTrigger()]);

    const triggers: Trigger[] = await client.getFundTriggers('fund_001');

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toEqual({
      id: 'trig_1',
      fundId: 'fund_001',
      triggerType: 'seismic',
      threshold: '6.5',
      oracleSource: 'usgs',
      autoReleaseAmount: '5000',
      geofenceLatitude: 37.5,
      geofenceLongitude: -122,
      geofenceRadiusKm: 50,
      minOracleConfirmations: 3,
      isActive: true,
      lastTriggered: 1_700_000_000,
      triggerCount: 2,
      lastVerified: 1_700_000_100,
    });
  });

  it('returns an empty array only when the contract confirms no triggers', async () => {
    const client = makeClient();
    wireCall(client, []);

    await expect(client.getFundTriggers('fund_001')).resolves.toEqual([]);
  });

  it('throws NetworkError when the RPC call fails', async () => {
    const client = makeClient();
    wireCallRejecting(client, new Error('rpc unavailable'));

    await expect(client.getFundTriggers('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('throws NetworkError (not an empty array) when decoding fails', async () => {
    const client = makeClient();
    wireCall(client, [rawTrigger()]);
    mockScValToNative.mockImplementationOnce(() => {
      throw new Error('decode boom');
    });

    await expect(client.getFundTriggers('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('throws NetworkError when the contract response is not a list', async () => {
    const client = makeClient();
    wireCall(client, { not: 'a list' });

    await expect(client.getFundTriggers('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});

// ── getFundAllocations ────────────────────────────────────────────────────────

describe('EmergencyFundsClient.getFundAllocations', () => {
  beforeEach(() => {
    mockScValToNative.mockReset();
    mockScValToNative.mockImplementation((v: any) => v);
  });

  it('queries get_fund_allocations for the requested fund', async () => {
    const client = makeClient();
    const call = wireCall(client, []);

    await client.getFundAllocations('fund_001');

    expect(call).toHaveBeenCalledWith('get_fund_allocations', 'fund_001');
  });

  it('decodes non-empty contract records into FundAllocation[]', async () => {
    const client = makeClient();
    wireCall(client, [rawAllocation()]);

    const allocations: FundAllocation[] = await client.getFundAllocations(
      'fund_001'
    );

    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toEqual({
      sector: 'food',
      amount: '1000',
      beneficiaries: [
        'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYZ7RJC5R4M4Q6R7T2G6JQ6R4M4Q',
      ],
      proofOfNeed: 'famine relief',
      allocatedAt: 1_700_000_200,
      minAmount: '100',
      maxAmount: '5000',
    });
  });

  it('returns an empty array only when the contract confirms no allocations', async () => {
    const client = makeClient();
    wireCall(client, []);

    await expect(client.getFundAllocations('fund_001')).resolves.toEqual([]);
  });

  it('throws NetworkError when the RPC call fails', async () => {
    const client = makeClient();
    wireCallRejecting(client, new Error('rpc unavailable'));

    await expect(client.getFundAllocations('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('throws NetworkError (not an empty array) when decoding fails', async () => {
    const client = makeClient();
    wireCall(client, [rawAllocation()]);
    mockScValToNative.mockImplementationOnce(() => {
      throw new Error('decode boom');
    });

    await expect(client.getFundAllocations('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('throws NetworkError when the contract response is not a list', async () => {
    const client = makeClient();
    wireCall(client, 'not-a-list');

    await expect(client.getFundAllocations('fund_001')).rejects.toBeInstanceOf(
      NetworkError
    );
  });
});