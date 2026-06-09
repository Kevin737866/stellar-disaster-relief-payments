import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
  Asset,
  Account,
  Transaction,
  FeeBumpTransaction,
} from 'stellar-sdk';
import { TransactionSimulator } from '../transactionSimulator';
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

function buildSignedTx(sourceKeypair: Keypair, fee = BASE_FEE): Transaction {
  const account = new Account(sourceKeypair.publicKey(), '100');
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
  return tx;
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
      })),
    },
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        transactions: jest.fn().mockReturnValue({
          transaction: jest.fn().mockReturnValue({
            call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
          }),
        }),
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Shared mock responses
// ---------------------------------------------------------------------------

const SUCCESS_RESPONSE = {
  id: 'sim-1',
  latestLedger: 1000,
  events: [],
  _parsed: true,
  minResourceFee: '500',
  cost: { cpuInsns: '100', memBytes: '200' },
  transactionData: {},
};

const ERROR_RESPONSE = {
  id: 'sim-2',
  latestLedger: 1001,
  events: [],
  _parsed: true,
  error: 'HostError: Value error: invalid argument',
};

const RESTORE_RESPONSE = {
  ...SUCCESS_RESPONSE,
  id: 'sim-3',
  result: { auth: [], xdr: 'AAAA' },
  restorePreamble: {
    minResourceFee: '300',
    transactionData: {},
  },
};

// ---------------------------------------------------------------------------
// TransactionSimulator tests
// ---------------------------------------------------------------------------

describe('TransactionSimulator', () => {
  let simulator: TransactionSimulator;
  let keypair: Keypair;

  beforeEach(() => {
    jest.clearAllMocks();
    simulator = new TransactionSimulator(TESTNET_CONFIG);
    keypair = Keypair.random();
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  describe('simulate — success', () => {
    beforeEach(() => {
      mockSimulateTransaction.mockResolvedValue(SUCCESS_RESPONSE);
    });

    it('returns success=true for a successful simulation from XDR string', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns the minResourceFee from the network response', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.minResourceFee).toBe('500');
    });

    it('returns the latestLedger from the network response', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.latestLedger).toBe(1000);
    });

    it('returns restoreRequired=false for a plain success', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.restoreRequired).toBe(false);
    });

    it('exposes the raw response', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.raw).toBe(SUCCESS_RESPONSE);
    });

    it('accepts a Transaction object directly (not XDR string)', async () => {
      const tx = buildSignedTx(keypair);
      const result = await simulator.simulate(tx);
      expect(result.success).toBe(true);
      expect(mockSimulateTransaction).toHaveBeenCalledWith(tx);
    });

    it('accepts a FeeBumpTransaction object directly', async () => {
      const innerTx = buildSignedTx(keypair);
      const feeSource = Keypair.random();
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        feeSource,
        String(Number(BASE_FEE) * 10),
        innerTx,
        Networks.TESTNET
      );
      feeBumpTx.sign(feeSource);

      const result = await simulator.simulate(feeBumpTx);
      expect(result.success).toBe(true);
      expect(mockSimulateTransaction).toHaveBeenCalledWith(feeBumpTx);
    });

    it('does not modify on-chain state (sendTransaction is never called)', async () => {
      const xdr = buildSignedTxXdr(keypair);
      await simulator.simulate(xdr);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Restore path
  // -------------------------------------------------------------------------

  describe('simulate — restore required', () => {
    beforeEach(() => {
      mockSimulateTransaction.mockResolvedValue(RESTORE_RESPONSE);
    });

    it('returns success=true when a restore is required', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.success).toBe(true);
    });

    it('returns restoreRequired=true when a restore preamble is present', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.restoreRequired).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Failure path
  // -------------------------------------------------------------------------

  describe('simulate — simulation error', () => {
    beforeEach(() => {
      mockSimulateTransaction.mockResolvedValue(ERROR_RESPONSE);
    });

    it('returns success=false when the simulation reports an error', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.success).toBe(false);
    });

    it('surfaces the error message from the network response', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.error).toBe('HostError: Value error: invalid argument');
    });

    it('returns restoreRequired=false on error', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.restoreRequired).toBe(false);
    });

    it('still returns latestLedger on error', async () => {
      const xdr = buildSignedTxXdr(keypair);
      const result = await simulator.simulate(xdr);
      expect(result.latestLedger).toBe(1001);
    });

    it('does not throw — returns a result with success=false instead', async () => {
      const xdr = buildSignedTxXdr(keypair);
      await expect(simulator.simulate(xdr)).resolves.toMatchObject({ success: false });
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases / invalid inputs
  // -------------------------------------------------------------------------

  describe('simulate — invalid inputs', () => {
    it('throws for an invalid XDR string', async () => {
      await expect(simulator.simulate('not-valid-xdr')).rejects.toThrow(
        'Invalid transaction XDR'
      );
    });

    it('throws for an empty XDR string', async () => {
      await expect(simulator.simulate('')).rejects.toThrow('Invalid transaction XDR');
    });

    it('does not call the RPC server when XDR is invalid', async () => {
      await expect(simulator.simulate('garbage')).rejects.toThrow();
      expect(mockSimulateTransaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Network failure
  // -------------------------------------------------------------------------

  describe('simulate — RPC network failure', () => {
    it('propagates RPC errors as thrown exceptions', async () => {
      mockSimulateTransaction.mockRejectedValue(new Error('connection refused'));
      const xdr = buildSignedTxXdr(keypair);
      await expect(simulator.simulate(xdr)).rejects.toThrow('connection refused');
    });
  });

  // -------------------------------------------------------------------------
  // Consistency: simulate vs actual submission
  // -------------------------------------------------------------------------

  describe('simulate — consistency with submission', () => {
    it('calls simulateTransaction with the same transaction that would be submitted', async () => {
      mockSimulateTransaction.mockResolvedValue(SUCCESS_RESPONSE);
      const tx = buildSignedTx(keypair);
      await simulator.simulate(tx);
      const simulatedTx = mockSimulateTransaction.mock.calls[0][0];
      // The same object reference is passed through unchanged.
      expect(simulatedTx).toBe(tx);
    });

    it('parses XDR to the same transaction that would be submitted', async () => {
      mockSimulateTransaction.mockResolvedValue(SUCCESS_RESPONSE);
      const xdr = buildSignedTxXdr(keypair);
      await simulator.simulate(xdr);
      const simulatedTx = mockSimulateTransaction.mock.calls[0][0];
      // The parsed transaction should round-trip back to the same XDR.
      expect(simulatedTx.toXDR()).toBe(xdr);
    });
  });
});

// ---------------------------------------------------------------------------
// FeeBumpClient.simulateBump tests
// ---------------------------------------------------------------------------

describe('FeeBumpClient.simulateBump', () => {
  let client: FeeBumpClient;
  let feeSourceKeypair: Keypair;
  let innerSourceKeypair: Keypair;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new FeeBumpClient(TESTNET_CONFIG);
    feeSourceKeypair = Keypair.random();
    innerSourceKeypair = Keypair.random();
    mockSimulateTransaction.mockResolvedValue(SUCCESS_RESPONSE);
  });

  // -------------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------------

  describe('simulateBump — success', () => {
    it('returns a successful SimulationResult for a valid fee bump', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      const result = await client.simulateBump({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      expect(result.success).toBe(true);
    });

    it('passes a FeeBumpTransaction to the simulator', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await client.simulateBump({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      const simulatedTx = mockSimulateTransaction.mock.calls[0][0];
      expect(simulatedTx).toBeInstanceOf(FeeBumpTransaction);
    });

    it('does not submit the transaction (sendTransaction not called)', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair);
      await client.simulateBump({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('uses the provided newBaseFee when it meets the minimum', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair, BASE_FEE);
      const minFee = client.getMinBumpFee(xdr);
      const higherFee = String(Number(minFee) + 500);

      const result = await client.simulateBump({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
        newBaseFee: higherFee,
      });
      expect(result.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Validation errors (same guards as bumpFee)
  // -------------------------------------------------------------------------

  describe('simulateBump — input validation', () => {
    it('throws for invalid inner transaction XDR', async () => {
      await expect(
        client.simulateBump({
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
        client.simulateBump({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: feeBumpTx.toXDR(),
        })
      ).rejects.toThrow('Cannot fee bump a fee bump transaction');
    });

    it('throws when newBaseFee is below the required minimum', async () => {
      const xdr = buildSignedTxXdr(innerSourceKeypair, '1000');
      await expect(
        client.simulateBump({
          feeSourceKey: feeSourceKeypair.secret(),
          innerTransactionXdr: xdr,
          newBaseFee: '1',
        })
      ).rejects.toThrow('below the required minimum');
    });
  });

  // -------------------------------------------------------------------------
  // Consistency: simulateBump vs bumpFee
  // -------------------------------------------------------------------------

  describe('simulateBump — consistency with bumpFee', () => {
    it('builds the same fee bump envelope as bumpFee would submit', async () => {
      mockSendTransaction.mockResolvedValue({ hash: 'abc', status: 'PENDING' });
      // Default: transaction is pending (404 from Horizon).
      const { Horizon } = jest.requireMock('stellar-sdk');
      Horizon.Server.mockImplementation(() => ({
        transactions: () => ({
          transaction: () => ({
            call: jest.fn().mockRejectedValue({ response: { status: 404 } }),
          }),
        }),
      }));
      client = new FeeBumpClient(TESTNET_CONFIG);

      const xdr = buildSignedTxXdr(innerSourceKeypair);

      // Run simulation first.
      await client.simulateBump({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      const simulatedTx = mockSimulateTransaction.mock.calls[0][0] as FeeBumpTransaction;

      // Then submit.
      await client.bumpFee({
        feeSourceKey: feeSourceKeypair.secret(),
        innerTransactionXdr: xdr,
      });
      const submittedTx = mockSendTransaction.mock.calls[0][0] as FeeBumpTransaction;

      // Both should be FeeBumpTransactions wrapping the same inner transaction.
      expect(simulatedTx).toBeInstanceOf(FeeBumpTransaction);
      expect(submittedTx).toBeInstanceOf(FeeBumpTransaction);
      // The inner transaction XDR should be identical.
      expect(simulatedTx.innerTransaction.toXDR()).toBe(submittedTx.innerTransaction.toXDR());
    });
  });
});
