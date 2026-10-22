import { StrKey } from 'stellar-sdk';
import { AidClient, MAX_BATCH_SIZE, MIN_BATCH_SIZE } from './aidClient';
import { BatchDisbursementEntry, NetworkConfig } from './types';

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const TEST_CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: contractId(0),
    aidRegistry: contractId(1),
    beneficiaryManager: contractId(2),
    merchantNetwork: contractId(3),
    cashTransfer: contractId(4),
    supplyChainTracker: contractId(5),
    antiFraud: contractId(6),
  },
};

const ENTRY: BatchDisbursementEntry = {
  beneficiary: 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYZ7RJC5R4M4Q6R7T2G6JQ6R4M4Q',
  amount: '10',
  purpose: 'food',
};

// Validation runs before the key is parsed or the network is contacted, so a
// syntactically invalid secret is fine for the rejection cases.
const UNUSED_SECRET = 'S0000000000000000000000000000000000000000000000000000000';

// A valid test-only secret used to prove an exact-size batch gets past the
// size check and reaches the (mocked) network layer.
const SIGNER_SECRET = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';

describe('AidClient batch size limits', () => {
  const client = new AidClient(TEST_CONFIG);

  it('exposes the shared batch limit', () => {
    expect(MAX_BATCH_SIZE).toBe(100);
    expect(MIN_BATCH_SIZE).toBe(1);
  });

  it('rejects an empty batch before contacting the network', async () => {
    await expect(
      client.triggerBatchDisbursement(UNUSED_SECRET, 'fund_001', [], [])
    ).rejects.toThrow('at least one entry');
  });

  it('rejects a batch larger than the maximum before contacting the network', async () => {
    const entries = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => ENTRY);

    await expect(
      client.triggerBatchDisbursement(UNUSED_SECRET, 'fund_001', entries, [])
    ).rejects.toThrow(`maximum is ${MAX_BATCH_SIZE}`);
  });

  it('does not reject a batch exactly at the maximum for size reasons', async () => {
    const entries = Array.from({ length: MAX_BATCH_SIZE }, () => ENTRY);

    (client as unknown as { server: unknown }).server = {
      getAccount: jest.fn().mockRejectedValue(new Error('invalid test stop')),
    };

    await expect(
      client.triggerBatchDisbursement(SIGNER_SECRET, 'fund_001', entries, [])
    ).rejects.toThrow('invalid test stop');
  });
});
