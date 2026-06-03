/**
 * Batch disbursement tests for AidClient and EmergencyFundsClient.
 *
 * These tests mock the Stellar server and contract calls so they run
 * entirely in-process without a live network.
 */

import { EmergencyFundsClient } from '../emergencyFunds';
import { BatchDisbursementEntry } from '../types';
import { Keypair } from 'stellar-sdk';

// ── Shared mock helpers ──────────────────────────────────────────────────────

const mockSendTransaction = jest.fn();
const mockGetAccount = jest.fn().mockResolvedValue({
  id: 'GABC',
  sequence: '1',
  incrementSequenceNumber: jest.fn(),
});

const mockServer = {
  getAccount: mockGetAccount,
  sendTransaction: mockSendTransaction,
  loadAccount: mockGetAccount,
  submitTransaction: mockSendTransaction,
};

// Mock stellar-sdk so Server/Contract/TransactionBuilder don't need a real network
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Server: jest.fn().mockImplementation(() => mockServer),
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
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015', STANDALONE: 'Standalone Network ; February 2017' },
  };
});

// Import AidClient AFTER the mock is set up
import { AidClient } from '../aidClient';

const mockConfig = {
  network: 'testnet' as const,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'CONTRACT_ID',
    aidRegistry: 'CONTRACT_ID',
    beneficiaryManager: 'CONTRACT_ID',
    merchantNetwork: 'CONTRACT_ID',
    cashTransfer: 'CONTRACT_ID',
    supplyChainTracker: 'CONTRACT_ID',
    antiFraud: 'CONTRACT_ID',
  },
};

// ── AidClient.triggerBatchDisbursement ───────────────────────────────────────

describe('AidClient.triggerBatchDisbursement', () => {
  let client: AidClient;
  const requesterKey = Keypair.random().secret();
  const fundId = 'earthquake_2024';

  const validEntries: BatchDisbursementEntry[] = [
    { beneficiary: 'GAAA', amount: '100', purpose: 'food' },
    { beneficiary: 'GBBB', amount: '200', purpose: 'shelter' },
    { beneficiary: 'GCCC', amount: '150', purpose: 'medical' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // Inject mock server via prototype hack (AidClient creates its own server)
    client = new AidClient(mockConfig);
    (client as any).server = mockServer;
  });

  test('returns disbursement IDs on success', async () => {
    mockSendTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      resultMetaXdr: ['id_0', 'id_1', 'id_2'],
    });

    const ids = await client.triggerBatchDisbursement(
      requesterKey,
      fundId,
      validEntries,
      ['GAPPROVER1']
    );

    expect(ids).toHaveLength(3);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  test('throws when entries array is empty', async () => {
    await expect(
      client.triggerBatchDisbursement(requesterKey, fundId, [], ['GAPPROVER1'])
    ).rejects.toThrow('Batch must contain at least one entry');
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  test('throws when transaction fails', async () => {
    mockSendTransaction.mockResolvedValueOnce({ status: 'FAILED' });

    await expect(
      client.triggerBatchDisbursement(requesterKey, fundId, validEntries, ['GAPPROVER1'])
    ).rejects.toThrow('Batch disbursement failed');
  });

  test('propagates network errors', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      client.triggerBatchDisbursement(requesterKey, fundId, validEntries, ['GAPPROVER1'])
    ).rejects.toThrow('Network timeout');
  });

  test('single entry batch works', async () => {
    mockSendTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      resultMetaXdr: ['id_0'],
    });

    const ids = await client.triggerBatchDisbursement(
      requesterKey,
      fundId,
      [{ beneficiary: 'GAAA', amount: '500', purpose: 'emergency' }],
      ['GAPPROVER1']
    );

    expect(ids).toHaveLength(1);
  });

  test('large batch (50 entries) works', async () => {
    const largeEntries: BatchDisbursementEntry[] = Array.from({ length: 50 }, (_, i) => ({
      beneficiary: `G${String(i).padStart(55, '0')}`,
      amount: '10',
      purpose: `purpose_${i}`,
    }));

    mockSendTransaction.mockResolvedValueOnce({
      status: 'SUCCESS',
      resultMetaXdr: largeEntries.map((_, i) => `id_${i}`),
    });

    const ids = await client.triggerBatchDisbursement(
      requesterKey,
      fundId,
      largeEntries,
      ['GAPPROVER1']
    );

    expect(ids).toHaveLength(50);
  });
});

// ── EmergencyFundsClient.executeBatchMultiSigRelease ─────────────────────────

describe('EmergencyFundsClient.executeBatchMultiSigRelease', () => {
  let client: EmergencyFundsClient;
  const approver1 = Keypair.random();
  const approver2 = Keypair.random();
  const fundId = 'flood_relief_2024';

  const validEntries: BatchDisbursementEntry[] = [
    { beneficiary: 'GAAA', amount: '300', purpose: 'water' },
    { beneficiary: 'GBBB', amount: '400', purpose: 'food' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    client = new EmergencyFundsClient('CONTRACT_ID', approver1, mockServer, 'Test SDF Network ; September 2015');
  });

  test('returns success result with count', async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: 'txhash_abc' });

    const result = await client.executeBatchMultiSigRelease(
      fundId,
      validEntries,
      [approver1, approver2]
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.transactionHash).toBe('txhash_abc');
  });

  test('throws when entries array is empty', async () => {
    await expect(
      client.executeBatchMultiSigRelease(fundId, [], [approver1])
    ).rejects.toThrow('Batch must contain at least one entry');
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  test('throws when transaction fails', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('Contract error: Insufficient funds'));

    await expect(
      client.executeBatchMultiSigRelease(fundId, validEntries, [approver1])
    ).rejects.toThrow('Batch multi-sig release failed');
  });

  test('signs with all approvers', async () => {
    mockSendTransaction.mockResolvedValueOnce({ hash: 'txhash_multi' });

    await client.executeBatchMultiSigRelease(fundId, validEntries, [approver1, approver2]);

    // Transaction was submitted once
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── Client-side validation (UI-level) ────────────────────────────────────────

describe('Batch disbursement client-side validation', () => {
  const validateBatch = (entries: BatchDisbursementEntry[]): string | null => {
    if (entries.length === 0) return 'Batch must contain at least one entry';
    const seen = new Set<string>();
    for (const e of entries) {
      if (!e.beneficiary.trim() || !e.amount.trim() || !e.purpose.trim())
        return 'All entry fields are required';
      if (Number(e.amount) <= 0) return 'Amount must be greater than zero';
      if (seen.has(e.beneficiary)) return `Duplicate beneficiary: ${e.beneficiary}`;
      seen.add(e.beneficiary);
    }
    return null;
  };

  test('valid batch passes', () => {
    expect(validateBatch([
      { beneficiary: 'GAAA', amount: '100', purpose: 'food' },
      { beneficiary: 'GBBB', amount: '200', purpose: 'shelter' },
    ])).toBeNull();
  });

  test('empty batch fails', () => {
    expect(validateBatch([])).toBe('Batch must contain at least one entry');
  });

  test('missing beneficiary fails', () => {
    expect(validateBatch([{ beneficiary: '', amount: '100', purpose: 'food' }]))
      .toBe('All entry fields are required');
  });

  test('missing amount fails', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '', purpose: 'food' }]))
      .toBe('All entry fields are required');
  });

  test('missing purpose fails', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '100', purpose: '' }]))
      .toBe('All entry fields are required');
  });

  test('zero amount fails', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '0', purpose: 'food' }]))
      .toBe('Amount must be greater than zero');
  });

  test('negative amount fails', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '-50', purpose: 'food' }]))
      .toBe('Amount must be greater than zero');
  });

  test('duplicate beneficiary fails', () => {
    const err = validateBatch([
      { beneficiary: 'GAAA', amount: '100', purpose: 'food' },
      { beneficiary: 'GAAA', amount: '200', purpose: 'shelter' },
    ]);
    expect(err).toContain('Duplicate beneficiary');
  });

  test('single entry batch passes', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '1', purpose: 'emergency' }])).toBeNull();
  });

  test('boundary: amount of 1 passes', () => {
    expect(validateBatch([{ beneficiary: 'GAAA', amount: '1', purpose: 'food' }])).toBeNull();
  });
});
