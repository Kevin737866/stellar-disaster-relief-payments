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

const fundId = 'fund-123';
const signingKey = Keypair.random();
const metadata = {
  disaster_type: 'hurricane',
  region: 'Caribbean',
  'contact.email': 'ops@example.org',
};

describe('EmergencyFundsClient.getMetadata', () => {
  let client: EmergencyFundsClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeToScVal.mockImplementation((value: unknown) => ({ native: value }));
    mockScValToNative.mockImplementation((value: unknown) => value);
    mockBuild.mockReturnValue({ sign: jest.fn() });
    client = new EmergencyFundsClient(
      'CCONTRACTID',
      signingKey,
      { simulateTransaction: mockSimulateTransaction } as any,
      Networks.TESTNET
    );
  });

  test('returns on-chain metadata for the requested fund', async () => {
    mockContractCall.mockResolvedValue({ result: { retval: metadata } });

    const result = await client.getMetadata(fundId);

    expect(mockContractCall).toHaveBeenCalledWith('get_metadata', { native: fundId });
    expect(result).toEqual(metadata);
  });

  test('simulates the read when contract.call returns an operation', async () => {
    mockContractCall.mockResolvedValue({ type: 'operation' });
    mockSimulateTransaction.mockResolvedValue({ results: [{ returnValue: metadata }] });

    const result = await client.getMetadata(fundId);

    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual(metadata);
  });

  test('returns an empty map when the contract confirms metadata is empty', async () => {
    mockContractCall.mockResolvedValue({ result: { retval: {} } });

    const result = await client.getMetadata(fundId);

    expect(mockContractCall).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });

  test('decodes metadata supplied as an array of key/value pairs', async () => {
    mockContractCall.mockResolvedValue({
      result: { retval: [['disaster_type', 'flood'], ['region', 'Sahel']] },
    });

    const result = await client.getMetadata(fundId);

    expect(result).toEqual({ disaster_type: 'flood', region: 'Sahel' });
  });

  test('rejects non-string metadata values instead of returning a partial map', async () => {
    mockContractCall.mockResolvedValue({ result: { retval: { valid: 'ok', invalid: 42 } } });

    await expect(client.getMetadata(fundId)).rejects.toThrow(/non-string metadata value/);
  });

  test('surfaces unknown-fund errors from the contract', async () => {
    mockContractCall.mockResolvedValue({ type: 'operation' });
    mockSimulateTransaction.mockResolvedValue({ error: 'fund not found' });

    await expect(client.getMetadata(fundId)).rejects.toThrow(/fund not found/);
  });

  test('surfaces RPC failures instead of returning an empty map', async () => {
    mockContractCall.mockRejectedValue(new Error('RPC unavailable'));

    await expect(client.getMetadata(fundId)).rejects.toThrow(/RPC unavailable/);
  });

  test('surfaces decode failures instead of returning an empty map', async () => {
    mockContractCall.mockResolvedValue({ result: { retval: { value: 'bad xdr' } } });
    mockScValToNative.mockImplementation(() => {
      throw new Error('invalid xdr');
    });

    await expect(client.getMetadata(fundId)).rejects.toThrow(/failed to decode metadata/);
  });

  test('surfaces missing return values instead of returning an empty map', async () => {
    client = new EmergencyFundsClient('CCONTRACTID', signingKey, {} as any, Networks.TESTNET);
    mockContractCall.mockResolvedValue({ type: 'operation' });

    await expect(client.getMetadata(fundId)).rejects.toThrow(/simulateTransaction is unavailable/);
  });
});
