import { SorobanRpc, Account, Keypair, StrKey } from 'stellar-sdk';
import { ContractUpgradeClient } from './contractUpgradeClient';
import { NetworkConfig, ContractUpgradeRequest } from './types';

const { GetTransactionStatus } = SorobanRpc.Api;

// A valid Stellar secret key for tests (no real funds)
const ADMIN_SECRET = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';
const ADMIN_PUBLIC = Keypair.fromSecret(ADMIN_SECRET).publicKey();

// Generate valid Stellar contract IDs (C-strkeys)
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

// 32-byte WASM hash as hex (64 chars)
const VALID_WASM_HASH_HEX = 'ab'.repeat(32);
// Same hash as base64
const VALID_WASM_HASH_B64 = Buffer.from('ab'.repeat(32), 'hex').toString('base64');

const TX_HASH = 'deadbeef1234';

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
  resultMetaXdr: {} as any,
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
  pollResponses: Array<SorobanRpc.Api.GetTransactionResponse | Error>
) {
  const client = new ContractUpgradeClient(TEST_CONFIG);

  // Mock server — getAccount returns a real Account so TransactionBuilder works
  (client as any).server = {
    getAccount: jest.fn(async () => new Account(ADMIN_PUBLIC, '100')),
    sendTransaction: jest.fn(async () => ({
      status: sendStatus,
      hash: TX_HASH,
    })),
  };

  // Mock poller
  (client as any).poller = {
    pollTransaction: jest.fn(async (_hash: string, _opts?: any) => {
      for (const r of pollResponses) {
        if (r instanceof Error) continue;
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

describe('ContractUpgradeClient', () => {
  const validRequest: ContractUpgradeRequest = {
    target: 'platform',
    newWasmHash: VALID_WASM_HASH_HEX,
    adminKey: ADMIN_SECRET,
  };

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('input validation', () => {
    it('throws when target is missing', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.upgradeContract({ ...validRequest, target: '' as any })
      ).rejects.toThrow('target is required');
    });

    it('throws when newWasmHash is empty', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.upgradeContract({ ...validRequest, newWasmHash: '' })
      ).rejects.toThrow('newWasmHash is required');
    });

    it('throws when adminKey is empty', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.upgradeContract({ ...validRequest, adminKey: '' })
      ).rejects.toThrow('adminKey is required');
    });

    it('throws when adminKey is not a valid Stellar secret key', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.upgradeContract({ ...validRequest, adminKey: 'not-a-key' })
      ).rejects.toThrow('not a valid Stellar secret key');
    });

    it('throws when newWasmHash is not valid hex or base64', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await expect(
        client.upgradeContract({ ...validRequest, newWasmHash: 'zzzz' })
      ).rejects.toThrow('newWasmHash must be');
    });

    it('accepts a valid 64-char hex WASM hash', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.upgradeContract({ ...validRequest, newWasmHash: VALID_WASM_HASH_HEX });
      expect(result.status).toBe('SUCCESS');
    });

    it('accepts a valid base64 WASM hash', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.upgradeContract({ ...validRequest, newWasmHash: VALID_WASM_HASH_B64 });
      expect(result.status).toBe('SUCCESS');
    });

    it('throws when target has no configured contractId', async () => {
      const emptyConfig: NetworkConfig = {
        ...TEST_CONFIG,
        contractIds: { ...TEST_CONFIG.contractIds, platform: '' },
      };
      const client = new ContractUpgradeClient(emptyConfig);
      await expect(
        client.upgradeContract(validRequest)
      ).rejects.toThrow('no contractId configured for target "platform"');
    });
  });

  // -------------------------------------------------------------------------
  // Successful upgrade
  // -------------------------------------------------------------------------
  describe('successful upgrade', () => {
    it('returns SUCCESS with contractId and transactionHash', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.upgradeContract(validRequest);

      expect(result.status).toBe('SUCCESS');
      expect(result.contractId).toBe(TEST_CONFIG.contractIds.platform);
      expect(result.transactionHash).toBe(TX_HASH);
      expect(result.ledger).toBe(SUCCESS_TX_RESPONSE.ledger);
    });

    it('preserves the original contractId after upgrade', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      const result = await client.upgradeContract({ ...validRequest, target: 'aidRegistry' });

      expect(result.contractId).toBe(TEST_CONFIG.contractIds.aidRegistry);
    });

    it('calls sendTransaction exactly once', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await client.upgradeContract(validRequest);
      expect((client as any).server.sendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Authorization enforcement
  // -------------------------------------------------------------------------
  describe('authorization enforcement', () => {
    it('throws when the network rejects the transaction as ERROR', async () => {
      const client = makeClient('ERROR', []);
      await expect(client.upgradeContract(validRequest)).rejects.toThrow('transaction rejected');
    });

    it('throws when the network returns DUPLICATE', async () => {
      const client = makeClient('DUPLICATE', []);
      await expect(client.upgradeContract(validRequest)).rejects.toThrow('transaction rejected');
    });

    it('throws when the network returns TRY_AGAIN_LATER', async () => {
      const client = makeClient('TRY_AGAIN_LATER', []);
      await expect(client.upgradeContract(validRequest)).rejects.toThrow('transaction rejected');
    });
  });

  // -------------------------------------------------------------------------
  // Transaction failure handling
  // -------------------------------------------------------------------------
  describe('transaction failure handling', () => {
    it('returns FAILED status when the on-chain transaction fails', async () => {
      const client = makeClient('PENDING', [FAILED_TX_RESPONSE]);
      const result = await client.upgradeContract(validRequest);
      expect(result.status).toBe('FAILED');
      expect(result.contractId).toBe(TEST_CONFIG.contractIds.platform);
      expect(result.transactionHash).toBe(TX_HASH);
    });

    it('returns TIMEOUT status when polling times out', async () => {
      const client = makeClient('PENDING', [NOT_FOUND_TX_RESPONSE]);
      const result = await client.upgradeContract(validRequest, { intervalMs: 50, timeoutMs: 100 });
      expect(result.status).toBe('TIMEOUT');
      expect(result.transactionHash).toBe(TX_HASH);
    });

    it('throws on network error during sendTransaction', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      (client as any).server.sendTransaction = jest.fn(async () => {
        throw new Error('connection refused');
      });
      await expect(client.upgradeContract(validRequest)).rejects.toThrow('network error submitting upgrade');
    });
  });

  // -------------------------------------------------------------------------
  // Status tracking integration
  // -------------------------------------------------------------------------
  describe('status tracking integration', () => {
    it('delegates polling to TransactionPoller with the tx hash', async () => {
      const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
      await client.upgradeContract(validRequest, { intervalMs: 100, timeoutMs: 5000 });
      expect((client as any).poller.pollTransaction).toHaveBeenCalledWith(
        TX_HASH,
        { intervalMs: 100, timeoutMs: 5000 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // All contract targets
  // -------------------------------------------------------------------------
  describe('all contract targets', () => {
    const targets: Array<keyof NetworkConfig['contractIds']> = [
      'platform',
      'aidRegistry',
      'beneficiaryManager',
      'merchantNetwork',
      'cashTransfer',
      'supplyChainTracker',
      'antiFraud',
    ];

    for (const target of targets) {
      it(`upgrades target "${target}" and returns its contractId`, async () => {
        const client = makeClient('PENDING', [SUCCESS_TX_RESPONSE]);
        const result = await client.upgradeContract({ ...validRequest, target });
        expect(result.status).toBe('SUCCESS');
        expect(result.contractId).toBe(TEST_CONFIG.contractIds[target]);
      });
    }
  });
});
