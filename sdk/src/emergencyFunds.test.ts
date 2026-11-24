import {
  EmergencyFundsClient,
  FundStatus,
} from './emergencyFunds';
import { FundNotFoundError, NetworkError } from './errors';

// ─── Mock stellar-sdk ──────────────────────────────────────────────────────

jest.mock('stellar-sdk', () => {
  return {
    Address: jest.fn().mockImplementation((addr: string) => ({
      toScVal: () => addr,
    })),
    Contract: jest.fn().mockImplementation((id: string) => ({
      call: jest.fn(),
    })),
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () => 'GTEST',
        sign: jest.fn(),
      }),
    },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      STANDALONE: 'Standalone Network ; February 2017',
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
    BASE_FEE: '100',
    nativeToScVal: jest.fn((v: unknown) => v),
    scValToNative: jest.fn((v: unknown) => v),
  };
});

// Import after mock setup
const { Contract, scValToNative } = require('stellar-sdk');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeClient(): EmergencyFundsClient {
  const mockServer = {
    loadAccount: jest.fn().mockResolvedValue({ accountId: () => 'GTEST' }),
    submitTransaction: jest.fn().mockResolvedValue({ hash: 'tx_hash' }),
  };
  return new EmergencyFundsClient(
    'contract_id_123',
    { publicKey: () => 'GTEST', sign: jest.fn() } as any,
    mockServer as any,
    'Test SDF Network ; September 2015'
  );
}

/** Set up the contract.call mock to return a specific retval value. */
function mockContractCall(retval: any): jest.Mock {
  const callFn = jest.fn().mockResolvedValue({ result: { retval } });
  (Contract as jest.Mock).mockImplementation(() => ({ call: callFn }));
  return callFn;
}

const VALID_STATUS_RESPONSE = [
  'active',
  BigInt(1000000),
  BigInt(300000),
  BigInt(700000),
  42,
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EmergencyFundsClient – getFundStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: scValToNative passes through the value
    (scValToNative as jest.Mock).mockImplementation((v: unknown) => v);
  });

  it('returns decoded status from contract response on success', async () => {
    const callFn = mockContractCall(VALID_STATUS_RESPONSE);
    const client = makeClient();

    const status = await client.getFundStatus('fund_001');

    expect(callFn).toHaveBeenCalledWith('get_fund_status', 'fund_001');
    expect(status).toEqual({
      status: 'active',
      totalAmount: '1000000',
      releasedAmount: '300000',
      availableAmount: '700000',
      beneficiaryCount: 42,
    });
  });

  it('throws FundNotFoundError when the contract panics (missing fund)', async () => {
    const callFn = jest.fn().mockRejectedValue(new Error('HostError: unwrap failed'));
    (Contract as jest.Mock).mockImplementation(() => ({ call: callFn }));
    const client = makeClient();

    await expect(client.getFundStatus('nonexistent_fund')).rejects.toThrow(
      FundNotFoundError
    );
    await expect(client.getFundStatus('nonexistent_fund')).rejects.toThrow(
      /not found or does not exist/
    );
  });

  it('throws FundNotFoundError when error message mentions "does not exist"', async () => {
    const callFn = jest.fn().mockRejectedValue(new Error('Fund does not exist'));
    (Contract as jest.Mock).mockImplementation(() => ({ call: callFn }));
    const client = makeClient();

    await expect(client.getFundStatus('missing')).rejects.toThrow(FundNotFoundError);
  });

  it('throws NetworkError on RPC/network failure', async () => {
    const callFn = jest.fn().mockRejectedValue(new Error('RPC connection refused'));
    (Contract as jest.Mock).mockImplementation(() => ({ call: callFn }));
    const client = makeClient();

    await expect(client.getFundStatus('fund_001')).rejects.toThrow(NetworkError);
    await expect(client.getFundStatus('fund_001')).rejects.toThrow(/RPC connection refused/);
  });

  it('throws Error on malformed response (not an array)', async () => {
    mockContractCall({ status: 'active' }); // object instead of tuple
    const client = makeClient();

    await expect(client.getFundStatus('fund_001')).rejects.toThrow(
      /Unexpected contract response/
    );
  });

  it('throws Error on malformed response (too few elements)', async () => {
    mockContractCall(['active', BigInt(1000)]); // only 2 elements
    const client = makeClient();

    await expect(client.getFundStatus('fund_001')).rejects.toThrow(
      /Unexpected contract response/
    );
  });

  it('throws Error when status field is not a string', async () => {
    mockContractCall([123, BigInt(1000), BigInt(0), BigInt(1000), 5]);
    const client = makeClient();

    await expect(client.getFundStatus('fund_001')).rejects.toThrow(
      /Unexpected status type/
    );
  });

  it('converts bigint amounts to strings in the returned FundStatus', async () => {
    mockContractCall(['triggered', BigInt(5000000), BigInt(1500000), BigInt(3500000), 10]);
    const client = makeClient();

    const status = await client.getFundStatus('fund_002');

    expect(status.status).toBe('triggered');
    expect(status.totalAmount).toBe('5000000');
    expect(status.releasedAmount).toBe('1500000');
    expect(status.availableAmount).toBe('3500000');
    expect(status.beneficiaryCount).toBe(10);
    // Ensure all amount fields are strings, not bigints
    expect(typeof status.totalAmount).toBe('string');
    expect(typeof status.releasedAmount).toBe('string');
    expect(typeof status.availableAmount).toBe('string');
    expect(typeof status.beneficiaryCount).toBe('number');
  });
});
