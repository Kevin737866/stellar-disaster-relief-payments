import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
  Asset,
  Account,
  FeeBumpTransaction,
  Transaction,
} from 'stellar-sdk';
import { FeeBumpClient } from '../feeBumpClient';
import { NetworkConfig } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TESTNET_CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'C_PLATFORM',
    aidRegistry: 'C_AID',
    beneficiaryManager: 'C_BEN',
    merchantNetwork: 'C_MERCH',
    cashTransfer: 'C_TRANSFER',
    supplyChainTracker: 'C_TRACKER',
    antiFraud: 'C_FRAUD',
  },
};

/** Build a minimal signed transaction XDR for testing. */
function buildSignedTxXdr(
  sourceKeypair: Keypair,
  fee = BASE_FEE,
  sequenceNumber = '100'
): string {
  const account = new Account(sourceKeypair.publicKey(), sequenceNumber);
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      })
    )
    .setTimeout(30)
    .build();
  tx.sign(sourceKeypair);
  return tx.toXDR();
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Mock Horizon.Server so we don't hit the network.
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        transactions: jest.fn().mockReturnValue({
          transaction: jest.fn().mockReturnValue({
            call: jest.fn(),
          }),
        }),
      })),
    },
  };
});

// Mock rpc.Server so we don't hit the network.
const mockSendTransaction = jest.fn();
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => ({
        sendTransaction: mockSendTransaction,
      })),
    },
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        transactions: jest.fn().mockReturnValue({
          transaction: jest.fn().mockReturnValue({
            call: jest.fn(),
          }),
        }),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeeBumpClient', () => {
  let client: FeeBumpClient;
  let feeSourceKeypair: Keypair;
  let innerSourceKeypair: Keypair;
  let horizonCallMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new FeeBumpClient(TESTNET_CONFIG);
    feeSourceKeypair = Keypair.random();
    innerSourceKeypair = Keypair.random();

    // Default: transaction is pending (404 from Horizon).
    horizonCallMock = jest.fn().mockRejectedValue({ response: { status: 404 } });
    const { Horizon } = jest.requireMock('stellar-sdk');
    Horizon.Server.mockImplementation(() => ({
      transactions: () => ({
        transaction: () => ({ call: horizonCallMock }),
      }),
    }));

    // Default: RPC sendTransaction succeeds.
    mockSendTransaction.mockResolvedValue({ hash: 'abc123', status: 'PENDING' });
  });

  // -------------------------------------------------------------------------
  // getMinBumpFee
  // -------------------------------------------------------------------------

  describe('getMinBumpFee', () => {
    it('returns a fee >= BASE_FEE for a standard transaction', () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      const minFee = client.getMinBumpFee(xdr);
      expect(Number(minFee)).toBeGreaterThanOrEqual(Number(BASE_FEE));
    });

    it('returns at least 10x the inner per-op fee', () => {
      const innerFee = '500'; // 500 stroops for 1 op → per-op = 500
      const xdr = buildSignedTxXdr(innerSourceKeypair, innerFee);
      const minFee = client.getMinBumpFee(xdr);
      expect(Number(minFee)).toBeGreaterThanOrEqual(500 * 10);
    });

    it('throws for invalid XDR', () => {
      expect(() => client.getMinBumpFee('not-valid-xdr')).toThrow(
        'Invalid inner transaction XDR'
      );
    });

    it('throws when given a fee bump transaction XDR', () => {
      const innerXdr = buildSignedTxXdr(innerSourceKeypair);
      const innerTx = TransactionBuilder.fromXDR(innerXdr, Networks.TESTNET) as Transaction;
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        feeSourceKeypair,
        String(Number(BASE_FEE) * 10),
        innerTx,
        Networks.TESTNET
      );
      feeBumpTx.sign(feeSourceKeypair);
      expect(() => client.getMinBumpFee(feeBumpTx.toXDR())).toThrow(
        'Cannot compute bump fee for a fee bump transaction'
      );
    });
  });

  // -------------------------------------------------------------------------
  // bumpFee — validation errors
  // -------------------------------------------------------------------------

  describe('bumpFee — input validation', () => {
    it('throws for invalid inner transaction XDR', async () => {
      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: 'garbage',
        })
      ).rejects.toThrow('Invalid inner transaction XDR');
    });

    it('throws when inner XDR is itself a fee bump transaction', async () => {
      const innerXdr = buildSignedTxXdr(innerSourceKeypair);
      const innerTx = TransactionBuilder.fromXDR(innerXdr, Networks.TESTNET) as Transaction;
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        feeSourceKeypair,
        String(Number(BASE_FEE) * 10),
        innerTx,
        Networks.TESTNET
      );
      feeBumpTx.sign(feeSourceKeypair);

      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: feeBumpTx.toXDR(),
        })
      ).rejects.toThrow('Cannot fee bump a fee bump transaction');
    });

    it('throws when newBaseFee is below the required minimum', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair, '1000');
      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: xdr,
          newBaseFee: '1', // way too low
        })
      ).rejects.toThrow('below the required minimum');
    });
  });

  // -------------------------------------------------------------------------
  // bumpFee — already confirmed
  // -------------------------------------------------------------------------

  describe('bumpFee — already confirmed transaction', () => {
    it('throws when the transaction is already confirmed', async () => {
      // Horizon returns 200 (transaction found) → not pending.
      horizonCallMock.mockResolvedValue({ id: 'some-tx' });
      const { Horizon } = jest.requireMock('stellar-sdk');
      Horizon.Server.mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: horizonCallMock }),
        }),
      }));
      client = new FeeBumpClient(TESTNET_CONFIG);

      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: xdr,
        })
      ).rejects.toThrow('already confirmed');
    });
  });

  // -------------------------------------------------------------------------
  // bumpFee — successful fee bump
  // -------------------------------------------------------------------------

  describe('bumpFee — success', () => {
    it('returns hash and status on success', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      const result = await client.bumpFee({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      expect(result.hash).toBe('abc123');
      expect(result.status).toBe('PENDING');
    });

    it('uses the provided newBaseFee when it meets the minimum', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair, BASE_FEE);
      const minFee = client.getMinBumpFee(xdr);
      const higherFee = String(Number(minFee) + 500);

      const result = await client.bumpFee({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
        newBaseFee: higherFee,
      });
      expect(result.status).toBe('PENDING');
      // Verify sendTransaction was called with a FeeBumpTransaction.
      const submittedTx = mockSendTransaction.mock.calls[0][0];
      expect(submittedTx).toBeInstanceOf(FeeBumpTransaction);
    });

    it('defaults to the minimum fee when newBaseFee is omitted', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await client.bumpFee({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // bumpFee — network failure
  // -------------------------------------------------------------------------

  describe('bumpFee — network failure', () => {
    it('throws when the RPC server returns ERROR status', async () => {
      mockSendTransaction.mockResolvedValue({ hash: 'xyz', status: 'ERROR' });
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: xdr,
        })
      ).rejects.toThrow('Fee bump transaction failed');
    });

    it('propagates unexpected Horizon errors', async () => {
      horizonCallMock.mockRejectedValue(new Error('network timeout'));
      const { Horizon } = jest.requireMock('stellar-sdk');
      Horizon.Server.mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({ call: horizonCallMock }),
        }),
      }));
      client = new FeeBumpClient(TESTNET_CONFIG);

      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await expect(
        client.bumpFee({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: xdr,
        })
      ).rejects.toThrow('network timeout');
    });
  });
});
