/**
 * SDK event parsing tests for EmergencyFundsClient.
 */

import { EmergencyFundsClient } from '../emergencyFunds';
import type {
  FundCreatedEvent,
  FundDisbursedEvent,
  BatchDisbursedEvent,
  TriggerActivatedEvent,
} from '../types';
import { Keypair } from 'stellar-sdk';

// ── Shared mock helpers ──────────────────────────────────────────────────────

const mockSubmitTransaction = jest.fn();
const mockTransactions = jest.fn().mockReturnValue({
  transaction: jest.fn().mockReturnValue({
    call: jest.fn(),
  }),
});
const mockLoadAccount = jest.fn().mockResolvedValue({
  id: 'GABC',
  sequence: '1',
  incrementSequenceNumber: jest.fn(),
});

const mockServer = {
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
  transactions: mockTransactions,
};

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({}),
    })),
    Address: jest.fn().mockImplementation((addr: string) => ({ toScVal: () => addr })),
    nativeToScVal: jest.fn((v: unknown) => v),
    scValToNative: jest.fn((v: unknown) => v),
    BASE_FEE: '100',
    xdr: {
      TransactionMeta: {
        fromXDR: jest.fn().mockReturnValue({ v3: null }),
      },
    },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
    },
  };
});

const signer = Keypair.random();
let client: EmergencyFundsClient;

beforeEach(() => {
  jest.clearAllMocks();
  client = new EmergencyFundsClient('CONTRACT_ID', signer, mockServer as any, 'Test SDF Network ; September 2015');
});

// ── parseEvent ───────────────────────────────────────────────────────────────

describe('EmergencyFundsClient.parseEvent', () => {
  test('parses fund_created event', () => {
    const raw = {
      topics: ['fund_created', 'fund_001'],
      data: {
        admin: 'GADMIN',
        totalAmount: '1000000',
        disasterType: 'earthquake',
        expiresAt: 9999999,
      },
    };
    const result = EmergencyFundsClient.parseEvent(raw) as FundCreatedEvent;
    expect(result).not.toBeNull();
    expect(result.type).toBe('fund_created');
    expect(result.fundId).toBe('fund_001');
    expect(result.admin).toBe('GADMIN');
    expect(result.totalAmount).toBe('1000000');
    expect(result.disasterType).toBe('earthquake');
    expect(result.expiresAt).toBe(9999999);
  });

  test('parses fund_disbursed event', () => {
    const raw = {
      topics: ['fund_disbursed', 'fund_001'],
      data: {
        disbursementId: 'fund_001_1234',
        beneficiary: 'GBENEFICIARY',
        amount: '500',
        purpose: 'food',
      },
    };
    const result = EmergencyFundsClient.parseEvent(raw) as FundDisbursedEvent;
    expect(result).not.toBeNull();
    expect(result.type).toBe('fund_disbursed');
    expect(result.fundId).toBe('fund_001');
    expect(result.disbursementId).toBe('fund_001_1234');
    expect(result.beneficiary).toBe('GBENEFICIARY');
    expect(result.amount).toBe('500');
    expect(result.purpose).toBe('food');
  });

  test('parses batch_disbursed event', () => {
    const raw = {
      topics: ['batch_disbursed', 'fund_002'],
      data: {
        count: 5,
        totalAmount: '2500',
      },
    };
    const result = EmergencyFundsClient.parseEvent(raw) as BatchDisbursedEvent;
    expect(result).not.toBeNull();
    expect(result.type).toBe('batch_disbursed');
    expect(result.fundId).toBe('fund_002');
    expect(result.count).toBe(5);
    expect(result.totalAmount).toBe('2500');
  });

  test('parses trigger_activated event', () => {
    const raw = {
      topics: ['trigger_activated', 'fund_003'],
      data: {
        triggerId: 'trigger_seismic_1',
        amountReleased: '10000',
        confirmations: 3,
      },
    };
    const result = EmergencyFundsClient.parseEvent(raw) as TriggerActivatedEvent;
    expect(result).not.toBeNull();
    expect(result.type).toBe('trigger_activated');
    expect(result.fundId).toBe('fund_003');
    expect(result.triggerId).toBe('trigger_seismic_1');
    expect(result.amountReleased).toBe('10000');
    expect(result.confirmations).toBe(3);
  });

  test('returns null for unknown event type', () => {
    const raw = { topics: ['unknown_event', 'fund_001'], data: {} };
    expect(EmergencyFundsClient.parseEvent(raw)).toBeNull();
  });

  test('returns null for event with no topics', () => {
    expect(EmergencyFundsClient.parseEvent({ topics: [], data: {} })).toBeNull();
  });

  test('returns null for malformed event', () => {
    expect(EmergencyFundsClient.parseEvent(null)).toBeNull();
    expect(EmergencyFundsClient.parseEvent({})).toBeNull();
  });

  test('handles missing data fields with safe defaults', () => {
    const raw = { topics: ['fund_created', 'fund_x'], data: {} };
    const result = EmergencyFundsClient.parseEvent(raw) as FundCreatedEvent;
    expect(result).not.toBeNull();
    expect(result.totalAmount).toBe('0');
    expect(result.admin).toBe('');
    expect(result.expiresAt).toBe(0);
  });
});

// ── getEvents ────────────────────────────────────────────────────────────────

describe('EmergencyFundsClient.getEvents', () => {
  test('returns empty array when transaction has no soroban events', async () => {
    const { xdr } = jest.requireMock('stellar-sdk');
    xdr.TransactionMeta.fromXDR.mockReturnValueOnce({ v3: null });
    mockTransactions.mockReturnValueOnce({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValueOnce({ resultMetaXdr: 'AAAA' }),
      }),
    });

    const events = await client.getEvents('txhash_abc');
    expect(events).toEqual([]);
  });

  test('returns empty array when transaction result is missing', async () => {
    mockTransactions.mockReturnValueOnce({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValueOnce(null),
      }),
    });

    const events = await client.getEvents('txhash_missing');
    expect(events).toEqual([]);
  });

  test('throws on server error', async () => {
    mockTransactions.mockReturnValueOnce({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockRejectedValueOnce(new Error('Network error')),
      }),
    });

    await expect(client.getEvents('txhash_fail')).rejects.toThrow('Failed to get events');
  });

  test('parses multiple events from metadata', async () => {
    const { xdr } = jest.requireMock('stellar-sdk');
    xdr.TransactionMeta.fromXDR.mockReturnValueOnce({
      v3: {
        sorobanMeta: {
          events: [
            {
              topics: ['fund_created', 'fund_001'],
              data: { admin: 'GADMIN', totalAmount: '1000', disasterType: 'flood', expiresAt: 9999 },
            },
            {
              topics: ['fund_disbursed', 'fund_001'],
              data: { disbursementId: 'id_1', beneficiary: 'GBEN', amount: '100', purpose: 'water' },
            },
          ],
        },
      },
    });
    mockTransactions.mockReturnValueOnce({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValueOnce({ resultMetaXdr: 'AAAA' }),
      }),
    });

    const events = await client.getEvents('txhash_multi');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('fund_created');
    expect(events[1].type).toBe('fund_disbursed');
  });
});
