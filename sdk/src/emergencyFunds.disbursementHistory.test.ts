import { Keypair, Networks } from 'stellar-sdk';
import { EmergencyFundsClient } from './emergencyFunds';

const mockContractCall = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockScValToNative = jest.fn();
const mockNativeToScVal = jest.fn();
const mockBuild = jest.fn();

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Account: jest.fn().mockImplementation((accountId: string, sequence: string) => ({
      accountId,
      sequence,
    })),
    Contract: jest.fn().mockImplementation(() => ({ call: mockContractCall })),
    nativeToScVal: jest.fn((value: unknown) => mockNativeToScVal(value)),
    scValToNative: jest.fn((value: unknown) => mockScValToNative(value)),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: mockBuild,
    })),
  };
});

const signingKey = Keypair.random();
const fundId = 'fund-123';
const server = { simulateTransaction: mockSimulateTransaction };

const rawRecord = {
  id: 'disb-1',
  fund_id: fundId,
  beneficiary: 'GABC...',
  amount: '250',
  timestamp: 1_700_000_000,
  purpose: 'medical supplies',
  approved_by: ['GAPPROVER1', 'GAPPROVER2'],
  transaction_hash: 'tx-hash-1',
  trigger_id: 'trigger-9',
  is_auto_released: true,
};

const expectedRecord = {
  id: 'disb-1',
  fundId,
  beneficiary: 'GABC...',
  amount: '250',
  timestamp: 1_700_000_000,
  purpose: 'medical supplies',
  approvedBy: ['GAPPROVER1', 'GAPPROVER2'],
  transactionHash: 'tx-hash-1',
  triggerId: 'trigger-9',
  isAutoReleased: true,
};

describe('EmergencyFundsClient.getDisbursementHistory', () => {
  let client: EmergencyFundsClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeToScVal.mockImplementation((value: unknown) => ({ native: value }));
    mockScValToNative.mockImplementation((value: unknown) => value);
    mockBuild.mockReturnValue({ sign: jest.fn() });
    mockSimulateTransaction.mockResolvedValue({});
    client = new EmergencyFundsClient(
      'CCONTRACTID',
      signingKey,
      server as any,
      Networks.TESTNET
    );
  });

  test('returns the first page decoded from the contract result', async () => {
    const page = {
      records: [rawRecord],
      total_count: 3,
      has_more: true,
    };
    mockContractCall.mockResolvedValue({ result: { retval: page } });

    const result = await client.getDisbursementHistory(fundId, 0, 2);

    expect(mockContractCall).toHaveBeenCalledWith(
      'get_disbursements',
      { native: fundId },
      { native: 0 },
      { native: 2 }
    );
    expect(result).toEqual({
      records: [expectedRecord],
      totalCount: 3,
      hasMore: true,
    });
    expect(mockScValToNative).toHaveBeenCalledWith(page);
    expect(mockScValToNative).toHaveBeenCalledWith(rawRecord);
  });

  test('passes subsequent offset/limit to the contract and decodes the next page', async () => {
    const nextRecord = { ...rawRecord, id: 'disb-3' };
    mockContractCall.mockResolvedValue({
      result: {
        retval: {
          records: [nextRecord],
          totalCount: 3,
          hasMore: false,
        },
      },
    });

    const result = await client.getDisbursementHistory(fundId, 2, 2);

    expect(mockContractCall).toHaveBeenCalledWith(
      'get_disbursements',
      { native: fundId },
      { native: 2 },
      { native: 2 }
    );
    expect(result.records).toEqual([{ ...expectedRecord, id: 'disb-3' }]);
    expect(result.totalCount).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  test('returns an empty page only when the contract query succeeds with no records', async () => {
    mockContractCall.mockResolvedValue({
      result: { retval: { records: [], total_count: 0, has_more: false } },
    });

    const result = await client.getDisbursementHistory(fundId);

    expect(mockContractCall).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ records: [], totalCount: 0, hasMore: false });
  });

  test('derives hasMore from totalCount when the contract omits it', async () => {
    mockContractCall.mockResolvedValue({
      result: { retval: [[rawRecord], 4] },
    });

    const result = await client.getDisbursementHistory(fundId, 0, 1);

    expect(result).toEqual({
      records: [expectedRecord],
      totalCount: 4,
      hasMore: true,
    });
  });

  test.each([
    ['negative offset', -1, 10, /offset must be a non-negative integer/],
    ['fractional offset', 1.5, 10, /offset must be a non-negative integer/],
    ['zero limit', 0, 0, /limit must be an integer between 1 and 100/],
    ['negative limit', 0, -1, /limit must be an integer between 1 and 100/],
    ['limit above maximum', 0, 101, /limit must be an integer between 1 and 100/],
    ['fractional limit', 0, 2.5, /limit must be an integer between 1 and 100/],
  ])('rejects invalid page arguments: %s', async (_name, offset, limit, expectedError) => {
    await expect(client.getDisbursementHistory(fundId, offset, limit)).rejects.toThrow(expectedError);
    expect(mockContractCall).not.toHaveBeenCalled();
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  test('reports contract RPC failures as errors', async () => {
    mockContractCall.mockRejectedValue(new Error('RPC unavailable'));

    await expect(client.getDisbursementHistory(fundId, 0, 10)).rejects.toThrow(/RPC unavailable/);
  });

  test('rejects malformed record data instead of returning an empty page', async () => {
    mockContractCall.mockResolvedValue({
      result: { retval: { records: 'not-an-array', total_count: 5, has_more: true } },
    });

    await expect(client.getDisbursementHistory(fundId, 0, 10)).rejects.toThrow(/records array/);
  });

  test('reports result decoding failures as errors', async () => {
    mockContractCall.mockResolvedValue({ result: { retval: { value: 'bad xdr' } } });
    mockScValToNative.mockImplementation(() => {
      throw new Error('invalid xdr');
    });

    await expect(client.getDisbursementHistory(fundId, 0, 10)).rejects.toThrow(
      /failed to decode contract result/
    );
  });

  test('simulates the contract read when call returns an operation', async () => {
    mockContractCall.mockResolvedValue({ type: 'operation' });
    mockSimulateTransaction.mockResolvedValue({
      results: [{ returnValue: { records: [rawRecord], total_count: 1, has_more: false } }],
    });

    const result = await client.getDisbursementHistory(fundId, 0, 10);

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      records: [expectedRecord],
      totalCount: 1,
      hasMore: false,
    });
  });

  test('reports simulation RPC failures as errors', async () => {
    mockContractCall.mockResolvedValue({ type: 'operation' });
    mockSimulateTransaction.mockRejectedValue(new Error('simulation network error'));

    await expect(client.getDisbursementHistory(fundId, 0, 10)).rejects.toThrow(
      /simulation network error/
    );
  });

  test('reports simulation error responses as errors', async () => {
    mockContractCall.mockResolvedValue({ type: 'operation' });
    mockSimulateTransaction.mockResolvedValue({ error: 'contract trapped' });

    await expect(client.getDisbursementHistory(fundId, 0, 10)).rejects.toThrow(/contract trapped/);
  });
});
