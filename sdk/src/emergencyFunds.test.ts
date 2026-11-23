/**
 * Tests for emergencyFunds.ts — recallUnusedFunds and decodeRecalledAmount.
 *
 * The stellar-sdk Contract class is mocked at module level so that
 * contract.call() returns a valid inflation operation instead of trying to
 * XDR-encode Soroban arguments. This keeps the test surface focused on:
 *   - correct i128 decoding from resultMetaXdr
 *   - proper error propagation on failed/missing results
 *   - no silent zero on decode failure
 */

// ---------------------------------------------------------------------------
// Module-level mock — must come before any import that touches stellar-sdk
// ---------------------------------------------------------------------------

import { Keypair, xdr, Networks, Operation } from 'stellar-sdk';

// Replace Contract so its instance's call() returns a real XDR operation
// (inflation) that TransactionBuilder can serialize without error.
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(() => actual.Operation.inflation()),
    })),
  };
});

import { EmergencyFundsClient, decodeRecalledAmount } from './emergencyFunds';
import { NetworkError } from './errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DONOR_SECRET = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';
const DONOR_PUBLIC = Keypair.fromSecret(DONOR_SECRET).publicKey();
const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const FUND_ID = 'fund-hurricane-2024';
const TX_HASH = 'abcdef1234567890';

/** Build an i128 ScVal holding the given bigint value. */
function makeI128ScVal(value: bigint): xdr.ScVal {
  const lo = BigInt.asUintN(64, value);
  const hi = BigInt.asIntN(64, value >> 64n);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString(lo.toString()),
      hi: xdr.Int64.fromString(hi.toString()),
    })
  );
}

/** Wrap a ScVal into the resultMetaXdr stub shape that decodeRecalledAmount reads. */
function makeMetaXdr(returnValScVal: xdr.ScVal): any {
  return {
    v3: () => ({
      sorobanMeta: () => ({
        returnValue: () => returnValScVal,
      }),
    }),
  };
}

/** Minimal successful Horizon-style response with a Soroban return value. */
function makeResponse(returnValScVal: xdr.ScVal): any {
  return {
    hash: TX_HASH,
    resultMetaXdr: makeMetaXdr(returnValScVal),
  };
}

/**
 * Build an EmergencyFundsClient with a mocked Horizon server.
 * The loadAccount mock returns a minimal account stub suitable for
 * TransactionBuilder; submitTransaction returns whatever the caller provides.
 */
function makeClient(serverOverrides: Partial<{
  loadAccount: jest.Mock;
  submitTransaction: jest.Mock;
}> = {}): EmergencyFundsClient {
  const signingKey = Keypair.fromSecret(DONOR_SECRET);
  const mockServer = {
    loadAccount: serverOverrides.loadAccount ??
      jest.fn(async () => ({
        accountId: () => DONOR_PUBLIC,
        sequenceNumber: () => '100',
        incrementSequenceNumber: jest.fn(),
      })),
    submitTransaction: serverOverrides.submitTransaction ??
      jest.fn(async () => makeResponse(makeI128ScVal(1000n))),
  };
  return new EmergencyFundsClient(CONTRACT_ID, signingKey, mockServer, Networks.TESTNET);
}

// ---------------------------------------------------------------------------
// decodeRecalledAmount — pure unit tests (no server interaction)
// ---------------------------------------------------------------------------

describe('decodeRecalledAmount', () => {
  describe('non-zero recall', () => {
    it('decodes a positive i128 to its decimal string', () => {
      expect(decodeRecalledAmount(makeResponse(makeI128ScVal(500_000_000n)))).toBe('500000000');
    });

    it('decodes a large i128 value correctly without floating-point loss', () => {
      // 10^18 — well beyond Number.MAX_SAFE_INTEGER
      const large = 1_000_000_000_000_000_000n;
      expect(decodeRecalledAmount(makeResponse(makeI128ScVal(large)))).toBe('1000000000000000000');
    });
  });

  describe('genuine zero recall', () => {
    it('returns "0" when the contract returns zero', () => {
      expect(decodeRecalledAmount(makeResponse(makeI128ScVal(0n)))).toBe('0');
    });
  });

  describe('missing or malformed metadata', () => {
    it('throws NetworkError when resultMetaXdr is absent', () => {
      expect(() => decodeRecalledAmount({ hash: TX_HASH })).toThrow(NetworkError);
    });

    it('throws NetworkError when resultMetaXdr is null', () => {
      expect(() => decodeRecalledAmount({ hash: TX_HASH, resultMetaXdr: null })).toThrow(NetworkError);
    });

    it('throws NetworkError when v3 is missing', () => {
      const meta = { v3: () => null };
      expect(() => decodeRecalledAmount({ hash: TX_HASH, resultMetaXdr: meta })).toThrow(NetworkError);
    });

    it('throws NetworkError when sorobanMeta is missing', () => {
      const meta = { v3: () => ({ sorobanMeta: () => null }) };
      expect(() => decodeRecalledAmount({ hash: TX_HASH, resultMetaXdr: meta })).toThrow(NetworkError);
    });

    it('throws NetworkError when returnValue is missing', () => {
      const meta = { v3: () => ({ sorobanMeta: () => ({ returnValue: () => null }) }) };
      expect(() => decodeRecalledAmount({ hash: TX_HASH, resultMetaXdr: meta })).toThrow(NetworkError);
    });
  });

  describe('unsupported return value types', () => {
    it('throws NetworkError for a void ScVal (decodes to undefined)', () => {
      const response = { hash: TX_HASH, resultMetaXdr: makeMetaXdr(xdr.ScVal.scvVoid()) };
      expect(() => decodeRecalledAmount(response)).toThrow(NetworkError);
    });

    it('throws NetworkError for a boolean ScVal', () => {
      const response = { hash: TX_HASH, resultMetaXdr: makeMetaXdr(xdr.ScVal.scvBool(true)) };
      expect(() => decodeRecalledAmount(response)).toThrow(NetworkError);
    });
  });

  describe('error message', () => {
    it('names the failed operation in the error message', () => {
      let caught: any;
      try {
        decodeRecalledAmount({ hash: TX_HASH });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NetworkError);
      expect(caught.message).toMatch(/decode recalled amount/);
    });
  });
});

// ---------------------------------------------------------------------------
// EmergencyFundsClient.recallUnusedFunds
// ---------------------------------------------------------------------------

describe('EmergencyFundsClient.recallUnusedFunds', () => {
  describe('successful non-zero recall', () => {
    it('returns the amount confirmed by the contract', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => makeResponse(makeI128ScVal(750_000n))),
      });
      const result = await client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID);
      expect(result.success).toBe(true);
      expect(result.recalledAmount).toBe('750000');
      expect(result.transactionHash).toBe(TX_HASH);
    });

    it('handles amounts beyond Number.MAX_SAFE_INTEGER without truncation', async () => {
      const big = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
      const client = makeClient({
        submitTransaction: jest.fn(async () => makeResponse(makeI128ScVal(big))),
      });
      const result = await client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID);
      expect(result.recalledAmount).toBe('9007199254740993');
    });
  });

  describe('genuine zero recall', () => {
    it('returns "0" when the contract confirms no funds were recalled', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => makeResponse(makeI128ScVal(0n))),
      });
      const result = await client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID);
      expect(result.success).toBe(true);
      expect(result.recalledAmount).toBe('0');
    });
  });

  describe('failed transaction submission', () => {
    it('throws NetworkError when submitTransaction rejects', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => { throw new Error('connection refused'); }),
      });
      await expect(client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID)).rejects.toThrow(NetworkError);
    });

    it('throws NetworkError when the server returns a FAILED status', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => ({
          hash: TX_HASH,
          status: 'FAILED',
          resultMetaXdr: makeMetaXdr(makeI128ScVal(0n)),
        })),
      });
      await expect(client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID)).rejects.toThrow(NetworkError);
    });

    it('throws NetworkError when loadAccount rejects', async () => {
      const client = makeClient({
        loadAccount: jest.fn(async () => { throw new Error('account not found'); }),
      });
      await expect(client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID)).rejects.toThrow(NetworkError);
    });
  });

  describe('undecodable result', () => {
    it('throws NetworkError when resultMetaXdr is absent — not a silent zero', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => ({ hash: TX_HASH })),
      });
      await expect(client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID)).rejects.toThrow(NetworkError);
    });

    it('throws NetworkError when the return value is not a numeric type', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => ({
          hash: TX_HASH,
          resultMetaXdr: makeMetaXdr(xdr.ScVal.scvBool(true)),
        })),
      });
      await expect(client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID)).rejects.toThrow(NetworkError);
    });
  });

  describe('error propagation', () => {
    it('error code is NETWORK_ERROR on submission failure', async () => {
      const client = makeClient({
        submitTransaction: jest.fn(async () => { throw new Error('timed out'); }),
      });
      let caught: any;
      try {
        await client.recallUnusedFunds(DONOR_PUBLIC, FUND_ID);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NetworkError);
      expect(caught.code).toBe('NETWORK_ERROR');
    });
  });
});
