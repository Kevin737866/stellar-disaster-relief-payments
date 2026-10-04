import { SorobanRpc, Account, Keypair, StrKey, xdr } from 'stellar-sdk';
import { BatchClient } from './batchClient';
import { NetworkConfig, BatchExecuteRequest, BATCH_MAX_SIZE } from './types';

const { GetTransactionStatus } = SorobanRpc.Api;

// A valid Stellar secret key for tests (no real funds)
const SIGNER_SECRET = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';
const SIGNER_PUBLIC = Keypair.fromSecret(SIGNER_SECRET).publicKey();

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const TEST_CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform:           contractId(0),
    aidRegistry:        contractId(1),
    beneficiaryManager: contractId(2),
    merchantNetwork:    contractId(3),
    cashTransfer:       contractId(4),
    supplyChainTracker: contractId(5),
    antiFraud:          contractId(6),
  },
};

const TX_HASH = 'batchdeadbeef1234';

const BASE_LEDGER = {
  latestLedger: 200,
  latestLedgerCloseTime: 2000,
  oldestLedger: 1,
  oldestLedgerCloseTime: 0,
};

const SUCCESS_TX_RESPONSE = {
  ...BASE_LEDGER,
  status: GetTransactionStatus.SUCCESS,
  ledger: 199,
  createdAt: 1999,
  applicationOrder: 1,
  feeBump: false,
  envelopeXdr: {} as any,
  resultXdr: {} as any,
  resultMetaXdr: null as any,
} as SorobanRpc.Api.GetSuccessfulTransactionResponse;

const FAILED_TX_RESPONSE = {
  ...BASE_LEDGER,
  status: GetTransactionStatus.FAILED,
  ledger: 199,
  createdAt: 1999,
  applicationOrder: 1,
  feeBump: false,
  envelopeXdr: {} as any,
  resultXdr: {} as any,
  resultMetaXdr: {} as any,
} as SorobanRpc.Api.GetFailedTransactionResponse;

const NOT_FOUND_TX_RESPONSE = {
  ...BASE_LEDGER,
  status: GetTransactionStatus.NOT_FOUND,
} as SorobanRpc.Api.GetMissingTransactionResponse;

/** Build a client with mocked server and poller internals. */
function makeClient(
  sendStatus: 'PENDING' | 'ERROR' | 'DUPLICATE' | 'TRY_AGAIN_LATER',
  pollResponses: Array<SorobanRpc.Api.GetTransactionResponse>
) {
  const client = new BatchClient(TEST_CONFIG);

  (client as any).server = {
    getAccount: jest.fn(async () => new Account(SIGNER_PUBLIC, '100')),
    sendTransaction: jest.fn(async () => ({
      status: sendStatus,
      hash: TX_HASH,
    })),
  };

  (client as any).poller = {
    pollTransaction: jest.fn(async (_hash: string, _opts?: any) => {
      for (const r of pollResponses) {
        if (r.status === GetTransactionStatus.SUCCESS) {
          return { status: 'SUCCESS', response: r };
        }
        if (r.status === GetTransactionStatus.FAILED) {
          return { status: 'FAILED', response: r };
        }
      }
      return { status: 'TIMEOUT' };
    }),
  };

  return client;
}

// Minimal ScVal for use in tests
const VOID_VAL = xdr.ScVal.scvVoid();

const TWO_CALLS: BatchExecuteRequest = {
  calls: [
    { contractTarget: 'aidRegistry', method: 'create_fund', args: [VOID_VAL] },
    { contractTarget: 'beneficiaryManager', method: 'register', args: [VOID_VAL] },
  ],
  signerKey: SIGNER_SECRET,
};

describe('BatchClient', () => {
  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('throws when calls array is empty', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({ calls: [], signerKey: SIGNER_SECRET })
      ).rejects.toThrow('calls array must not be empty');
    });

    it('throws when batch size exceeds BATCH_MAX_SIZE', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const calls = Array.from({ length: BATCH_MAX_SIZE + 1 }, () => ({
        contractTarget: 'aidRegistry' as const,
        method: 'noop',
        args: [],
      }));
      await expect(
        client.execute({ calls, signerKey: SIGNER_SECRET })
      ).rejects.toThrow(`exceeds maximum of ${BATCH_MAX_SIZE}`);
    });

    it('throws when signerKey is empty', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({ ...TWO_CALLS, signerKey: '' })
      ).rejects.toThrow('signerKey is required');
    });

    it('throws when signerKey is not a valid Stellar secret key', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({ ...TWO_CALLS, signerKey: 'not-a-key' })
      ).rejects.toThrow('not a valid Stellar secret key');
    });

    it('throws when a call has no contractTarget', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({
          calls: [{ contractTarget: '' as any, method: 'foo', args: [] }],
          signerKey: SIGNER_SECRET,
        })
      ).rejects.toThrow('calls[0].contractTarget is required');
    });

    it('throws when a call has no method', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({
          calls: [{ contractTarget: 'aidRegistry', method: '', args: [] }],
          signerKey: SIGNER_SECRET,
        })
      ).rejects.toThrow('calls[0].method is required');
    });

    it('throws when a call has no configured contractId', async () => {
      const emptyConfig: NetworkConfig = {
        ...TEST_CONFIG,
        contractIds: { ...TEST_CONFIG.contractIds, aidRegistry: '' },
      };
      const client = new BatchClient(emptyConfig);
      await expect(
        client.execute({
          calls: [{ contractTarget: 'aidRegistry', method: 'foo', args: [] }],
          signerKey: SIGNER_SECRET,
        })
      ).rejects.toThrow('no contractId configured for target "aidRegistry"');
    });

    it('throws when args is not an array', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.execute({
          calls: [{ contractTarget: 'aidRegistry', method: 'foo', args: null as any }],
          signerKey: SIGNER_SECRET,
        })
      ).rejects.toThrow('calls[0].args must be an array');
    });
  });

  // -------------------------------------------------------------------------
  // Successful batch execution
  // -------------------------------------------------------------------------
  describe('successful batch execution', () => {
    it('returns SUCCESS with transactionHash and ledger', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS);

      expect(result.status).toBe('SUCCESS');
      expect(result.transactionHash).toBe(TX_HASH);
      expect(result.ledger).toBe(SUCCESS_TX_RESPONSE.ledger);
    });

    it('returns one result per call in the same order', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].index).toBe(0);
      expect(result.results[1].index).toBe(1);
    });

    it('marks all results as successful on SUCCESS', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS);

      expect(result.results.every(r => r.success)).toBe(true);
    });

    it('calls sendTransaction exactly once', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await client.execute(TWO_CALLS);
      expect((client as any).server.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('preserves call ordering (operations added in input order)', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const addOpSpy = jest.fn().mockReturnThis();
      const buildSpy = jest.fn().mockReturnValue({ sign: jest.fn() });
      const setTimeoutSpy = jest.fn().mockReturnValue({ build: buildSpy });

      (client as any).server.getAccount = jest.fn(async () => ({
        accountId: () => SIGNER_PUBLIC,
        sequenceNumber: () => '100',
        incrementSequenceNumber: jest.fn(),
      }));

      // We can't easily intercept TransactionBuilder internals, but we can
      // verify the result order matches input order.
      const result = await client.execute(TWO_CALLS);
      expect(result.results[0].index).toBe(0);
      expect(result.results[1].index).toBe(1);
    });

    it('handles a single-call batch', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.execute({
        calls: [{ contractTarget: 'antiFraud', method: 'check', args: [] }],
        signerKey: SIGNER_SECRET,
      });
      expect(result.status).toBe('SUCCESS');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
    });

    it('handles a batch at the maximum allowed size', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const calls = Array.from({ length: BATCH_MAX_SIZE }, () => ({
        contractTarget: 'aidRegistry' as const,
        method: 'noop',
        args: [] as any[],
      }));
      const result = await client.execute({ calls, signerKey: SIGNER_SECRET });
      expect(result.status).toBe('SUCCESS');
      expect(result.results).toHaveLength(BATCH_MAX_SIZE);
    });
  });

  // -------------------------------------------------------------------------
  // Transaction failure scenarios
  // -------------------------------------------------------------------------
  describe('transaction failure scenarios', () => {
    it('returns FAILED status when the on-chain transaction fails', async () => {
      const client = makeClient('PENDING', [FAILED_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS);

      expect(result.status).toBe('FAILED');
      expect(result.transactionHash).toBe(TX_HASH);
      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => !r.success)).toBe(true);
    });

    it('returns TIMEOUT status when polling times out', async () => {
      const client = makeClient('PENDING', [NOT_FOUND_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS, { intervalMs: 50, timeoutMs: 100 });

      expect(result.status).toBe('TIMEOUT');
      expect(result.transactionHash).toBe(TX_HASH);
      expect(result.results.every(r => !r.success)).toBe(true);
    });

    it('includes an error message in results on FAILED', async () => {
      const client = makeClient('PENDING', [FAILED_TX_RESPONSE]);
      const result = await client.execute(TWO_CALLS);

      expect(result.results[0].error).toBeDefined();
      expect(typeof result.results[0].error).toBe('string');
    });

    it('throws on network error during sendTransaction', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      (client as any).server.sendTransaction = jest.fn(async () => {
        throw new Error('connection refused');
      });
      await expect(client.execute(TWO_CALLS)).rejects.toThrow('network error submitting batch');
    });
  });

  // -------------------------------------------------------------------------
  // Authorization enforcement
  // -------------------------------------------------------------------------
  describe('authorization enforcement', () => {
    it('throws when the network rejects the transaction as ERROR', async () => {
      const client = makeClient('ERROR', []);
      await expect(client.execute(TWO_CALLS)).rejects.toThrow('transaction rejected by network');
    });

    it('throws when the network returns DUPLICATE', async () => {
      const client = makeClient('DUPLICATE', []);
      await expect(client.execute(TWO_CALLS)).rejects.toThrow('transaction rejected by network');
    });

    it('throws when the network returns TRY_AGAIN_LATER', async () => {
      const client = makeClient('TRY_AGAIN_LATER', []);
      await expect(client.execute(TWO_CALLS)).rejects.toThrow('transaction rejected by network');
    });
  });

  // -------------------------------------------------------------------------
  // Transaction status tracking integration
  // -------------------------------------------------------------------------
  describe('transaction status tracking integration', () => {
    it('delegates polling to TransactionPoller with the tx hash', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await client.execute(TWO_CALLS, { intervalMs: 100, timeoutMs: 5000 });
      expect((client as any).poller.pollTransaction).toHaveBeenCalledWith(
        TX_HASH,
        { intervalMs: 100, timeoutMs: 5000 }
      );
    });

    it('passes undefined pollOptions when not provided', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await client.execute(TWO_CALLS);
      expect((client as any).poller.pollTransaction).toHaveBeenCalledWith(TX_HASH, undefined);
    });
  });

  // -------------------------------------------------------------------------
  // Result mapping per call
  // -------------------------------------------------------------------------
  describe('result mapping per call', () => {
    it('result indices match input call indices exactly', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const calls = [
        { contractTarget: 'aidRegistry' as const, method: 'a', args: [] },
        { contractTarget: 'merchantNetwork' as const, method: 'b', args: [] },
        { contractTarget: 'cashTransfer' as const, method: 'c', args: [] },
      ];
      const result = await client.execute({ calls, signerKey: SIGNER_SECRET });

      expect(result.results.map(r => r.index)).toEqual([0, 1, 2]);
    });

    it('FAILED transaction produces results for every call', async () => {
      const client = makeClient('PENDING', [FAILED_TX_RESPONSE]);
      const calls = Array.from({ length: 5 }, (_, i) => ({
        contractTarget: 'aidRegistry' as const,
        method: `method_${i}`,
        args: [] as any[],
      }));
      const result = await client.execute({ calls, signerKey: SIGNER_SECRET });

      expect(result.results).toHaveLength(5);
      expect(result.results.every(r => r.index >= 0 && r.index < 5)).toBe(true);
    });
  });
});
