/**
 * Robustness tests for MerchantClient.getMerchantStatistics (#180).
 *
 * Contract values are decoded with scValToNative, which can yield strings,
 * numbers or BigInts. Malformed limits must never make the statistics call
 * throw: the client must fall back to well-defined values instead.
 */

import { StrKey } from 'stellar-sdk';
import { MerchantClient } from './merchantClient';
import { Merchant, NetworkConfig, Transaction } from './types';

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const TESTNET_CONFIG: NetworkConfig = {
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

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: 'mer_1',
    name: 'Corner Shop',
    owner: 'owner_1',
    businessType: 'food',
    location: {
      latitude: 0,
      longitude: 0,
      address: '',
      city: '',
      country: '',
      postalCode: '',
    },
    contactInfo: '',
    registrationDate: 0,
    isVerified: true,
    verificationDocuments: [],
    stellarTomlUrl: '',
    acceptedTokens: ['XLM'],
    dailyLimit: '1000',
    monthlyLimit: '1000',
    currentMonthVolume: '250',
    reputationScore: 50,
    isActive: true,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    merchantId: 'mer_1',
    beneficiaryId: 'ben_1',
    amount: '100',
    token: 'XLM',
    timestamp: 0,
    purpose: 'food',
    merchantSignature: '',
    beneficiarySignature: '',
    isSettled: true,
    ...overrides,
  };
}

describe('MerchantClient.getMerchantStatistics (#180)', () => {
  let client: MerchantClient;

  beforeEach(() => {
    client = new MerchantClient(TESTNET_CONFIG);
    jest.spyOn(client, 'getMerchantTransactions').mockResolvedValue([
      makeTransaction({ id: 'tx_1', amount: '100' }),
      makeTransaction({ id: 'tx_2', amount: '50' }),
    ]);
  });

  /** Point the client at the supplied merchant fixture. */
  function givenMerchant(overrides: Partial<Merchant> = {}): void {
    jest.spyOn(client, 'getMerchant').mockResolvedValue(makeMerchant(overrides));
  }

  test('computes monthlyUtilization from well-formed limit strings', async () => {
    givenMerchant({ monthlyLimit: '1000', currentMonthVolume: '250' });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(25);
    expect(stats.totalTransactions).toBe(2);
    expect(stats.totalVolume).toBe('150');
    expect(stats.averageTransaction).toBe('75');
  });

  test('tolerates whitespace around numeric strings', async () => {
    givenMerchant({ monthlyLimit: ' 1000 ', currentMonthVolume: ' 250 ' });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(25);
  });

  test('accepts numeric (non-string) limits from the contract', async () => {
    givenMerchant({
      monthlyLimit: 1000 as any,
      currentMonthVolume: 250 as any,
    });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(25);
  });

  test('returns zero utilization instead of throwing for a malformed monthlyLimit', async () => {
    givenMerchant({ monthlyLimit: 'not-a-number' });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(0);
    expect(stats.totalTransactions).toBe(2);
    expect(stats.totalVolume).toBe('150');
  });

  test('returns zero utilization instead of throwing for a malformed currentMonthVolume', async () => {
    givenMerchant({ currentMonthVolume: '12.5' });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(0);
  });

  test('treats negative and zero limits as no utilization', async () => {
    givenMerchant({ monthlyLimit: '-1000', currentMonthVolume: '-10' });
    expect((await client.getMerchantStatistics('mer_1')).monthlyUtilization).toBe(0);

    givenMerchant({ monthlyLimit: '0', currentMonthVolume: '250' });
    expect((await client.getMerchantStatistics('mer_1')).monthlyUtilization).toBe(0);
  });

  test('handles missing limit fields without throwing', async () => {
    givenMerchant({
      monthlyLimit: undefined as any,
      currentMonthVolume: null as any,
    });

    const stats = await client.getMerchantStatistics('mer_1');

    expect(stats.monthlyUtilization).toBe(0);
  });
});
