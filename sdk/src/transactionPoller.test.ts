import { SorobanRpc } from 'stellar-sdk';
import { TransactionPoller, TransactionPollResult } from './transactionPoller';
import { NetworkConfig } from './types';

const { GetTransactionStatus } = SorobanRpc.Api;

// Minimal NetworkConfig for tests
const TEST_CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: '',
    aidRegistry: '',
    beneficiaryManager: '',
    merchantNetwork: '',
    cashTransfer: '',
    supplyChainTracker: '',
    antiFraud: '',
  },
};

const HASH = 'abc123';

// Base fields shared by all GetTransactionResponse shapes
const BASE = {
  latestLedger: 100,
  latestLedgerCloseTime: 1000,
  oldestLedger: 1,
  oldestLedgerCloseTime: 0,
};

const SUCCESS_RESPONSE = {
  ...BASE,
  status: GetTransactionStatus.SUCCESS,
  ledger: 99,
  createdAt: 999,
  applicationOrder: 1,
  feeBump: false,
  envelopeXdr: {} as any,
  resultXdr: {} as any,
  resultMetaXdr: {} as any,
} as SorobanRpc.Api.GetSuccessfulTransactionResponse;

const FAILED_RESPONSE = {
  ...BASE,
  status: GetTransactionStatus.FAILED,
  ledger: 99,
  createdAt: 999,
  applicationOrder: 1,
  feeBump: false,
  envelopeXdr: {} as any,
  resultXdr: {} as any,
  resultMetaXdr: {} as any,
} as SorobanRpc.Api.GetFailedTransactionResponse;

const NOT_FOUND_RESPONSE = {
  ...BASE,
  status: GetTransactionStatus.NOT_FOUND,
} as SorobanRpc.Api.GetMissingTransactionResponse;

// Helper: build a poller with a mocked getTransaction
function makePoller(responses: Array<SorobanRpc.Api.GetTransactionResponse | Error>) {
  const poller = new TransactionPoller(TEST_CONFIG);
  let call = 0;
  (poller as any).server = {
    getTransaction: jest.fn(async () => {
      const r = responses[Math.min(call++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  return poller;
}

describe('TransactionPoller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns SUCCESS immediately when transaction is already successful', async () => {
    const poller = makePoller([SUCCESS_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('SUCCESS');
    expect((result as Extract<TransactionPollResult, { status: 'SUCCESS' }>).response).toBe(SUCCESS_RESPONSE);
  });

  it('returns FAILED when transaction fails', async () => {
    const poller = makePoller([FAILED_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('FAILED');
    expect((result as Extract<TransactionPollResult, { status: 'FAILED' }>).response).toBe(FAILED_RESPONSE);
  });

  it('aliases pollTransactionStatus to pollTransaction', async () => {
    const poller = makePoller([SUCCESS_RESPONSE]);
    const promise = poller.pollTransactionStatus(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('SUCCESS');
    expect((result as Extract<TransactionPollResult, { status: 'SUCCESS' }>).response).toBe(SUCCESS_RESPONSE);
  });

  it('polls until terminal state after NOT_FOUND responses', async () => {
    const poller = makePoller([NOT_FOUND_RESPONSE, NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('SUCCESS');
    expect((poller as any).server.getTransaction).toHaveBeenCalledTimes(3);
  });

  it('returns TIMEOUT when deadline is exceeded', async () => {
    const poller = makePoller([NOT_FOUND_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 250 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('TIMEOUT');
  });

  it('retries after a transient network error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const poller = makePoller([new Error('network error'), SUCCESS_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('SUCCESS');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('deduplicates concurrent polls for the same hash', async () => {
    const poller = makePoller([NOT_FOUND_RESPONSE, SUCCESS_RESPONSE]);
    const p1 = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    const p2 = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    // Both calls must return the exact same Promise instance
    expect(Object.is(p1, p2)).toBe(true);
    await jest.runAllTimersAsync();
    await p1;
    // Only one poll loop should have run (not two independent ones)
    expect((poller as any).server.getTransaction).toHaveBeenCalledTimes(2);
  });

  it('stops polling immediately once a terminal state is reached', async () => {
    const poller = makePoller([SUCCESS_RESPONSE, NOT_FOUND_RESPONSE]);
    const promise = poller.pollTransaction(HASH, { intervalMs: 100, timeoutMs: 5000 });
    await jest.runAllTimersAsync();
    await promise;
    // Only one call should have been made — no extra poll after SUCCESS
    expect((poller as any).server.getTransaction).toHaveBeenCalledTimes(1);
  });

  it('reads intervalMs and timeoutMs from config when options are not provided', async () => {
    const configWithDefaults = { ...TEST_CONFIG, pollIntervalMs: 50, pollTimeoutMs: 150 };
    const poller = new TransactionPoller(configWithDefaults as any);
    (poller as any).server = {
      getTransaction: jest.fn(async () => NOT_FOUND_RESPONSE),
    };
    const promise = poller.pollTransaction(HASH);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe('TIMEOUT');
  });
});
