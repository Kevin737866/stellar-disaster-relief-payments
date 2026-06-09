import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Account,
  Transaction,
} from 'stellar-sdk';
import { MultiSigManager, MultiSigState } from './multiSig';

/** Build a minimal valid Stellar transaction for testing. */
function buildTestTx(sourceKeypair: Keypair): Transaction {
  const account = new Account(sourceKeypair.publicKey(), '0');
  return new TransactionBuilder(account, {
    fee: '100',
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
}

describe('MultiSigManager', () => {
  let signer1: Keypair;
  let signer2: Keypair;
  let signer3: Keypair;
  let sourceTx: Transaction;

  beforeEach(() => {
    signer1 = Keypair.random();
    signer2 = Keypair.random();
    signer3 = Keypair.random();
    sourceTx = buildTestTx(signer1);
  });

  // ── create() validation ──────────────────────────────────────────────────

  test('create() throws when authorizedSigners is empty', () => {
    expect(() =>
      MultiSigManager.create(sourceTx, Networks.TESTNET, [], 1)
    ).toThrow('authorizedSigners must not be empty');
  });

  test('create() throws when threshold is 0', () => {
    expect(() =>
      MultiSigManager.create(sourceTx, Networks.TESTNET, [signer1.publicKey()], 0)
    ).toThrow('threshold must be between 1');
  });

  test('create() throws when threshold exceeds signer count', () => {
    expect(() =>
      MultiSigManager.create(sourceTx, Networks.TESTNET, [signer1.publicKey()], 2)
    ).toThrow('threshold must be between 1');
  });

  test('create() deduplicates authorizedSigners', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer1.publicKey()],
      1
    );
    expect(mgr.getProgress().signaturesRequired).toBe(1);
  });

  // ── initial state ────────────────────────────────────────────────────────

  test('initial status is pending', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    const p = mgr.getProgress();
    expect(p.status).toBe('pending');
    expect(p.signaturesCollected).toBe(0);
    expect(p.signaturesRemaining).toBe(2);
    expect(p.collectedSigners).toHaveLength(0);
    expect(p.remainingSigners).toContain(signer1.publicKey());
    expect(p.remainingSigners).toContain(signer2.publicKey());
    expect(mgr.isReady()).toBe(false);
  });

  // ── addSignature() ───────────────────────────────────────────────────────

  test('addSignature() rejects unauthorized signer', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey()],
      1
    );
    expect(() => mgr.addSignature(signer2.secret())).toThrow('not authorized');
  });

  test('addSignature() rejects duplicate signer', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    mgr.addSignature(signer1.secret());
    expect(() => mgr.addSignature(signer1.secret())).toThrow('already signed');
  });

  test('addSignature() tracks partial signing state', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey(), signer3.publicKey()],
      3
    );
    const p = mgr.addSignature(signer1.secret());
    expect(p.status).toBe('pending');
    expect(p.signaturesCollected).toBe(1);
    expect(p.signaturesRemaining).toBe(2);
    expect(p.collectedSigners).toContain(signer1.publicKey());
    expect(mgr.isReady()).toBe(false);
  });

  test('addSignature() transitions to ready when threshold met', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    mgr.addSignature(signer1.secret());
    const p = mgr.addSignature(signer2.secret());
    expect(p.status).toBe('ready');
    expect(p.signaturesCollected).toBe(2);
    expect(p.signaturesRemaining).toBe(0);
    expect(mgr.isReady()).toBe(true);
  });

  test('threshold of 1 becomes ready after single signature', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      1
    );
    mgr.addSignature(signer1.secret());
    expect(mgr.isReady()).toBe(true);
    expect(mgr.getProgress().status).toBe('ready');
  });

  // ── submit() ─────────────────────────────────────────────────────────────

  test('submit() throws when threshold not met', async () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    mgr.addSignature(signer1.secret());
    const mockServer = { sendTransaction: jest.fn() };
    await expect(mgr.submit(mockServer)).rejects.toThrow('1 more signature(s) required');
    expect(mockServer.sendTransaction).not.toHaveBeenCalled();
  });

  test('submit() calls sendTransaction when threshold met', async () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    mgr.addSignature(signer1.secret());
    mgr.addSignature(signer2.secret());

    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    const result = await mgr.submit(mockServer);

    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SUCCESS');
    expect(mgr.getProgress().status).toBe('submitted');
  });

  test('submit() throws on second call after submission', async () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey()],
      1
    );
    mgr.addSignature(signer1.secret());
    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    await mgr.submit(mockServer);
    await expect(mgr.submit(mockServer)).rejects.toThrow('already been submitted');
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  test('addSignature() throws after submission', async () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      1
    );
    mgr.addSignature(signer1.secret());
    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    await mgr.submit(mockServer);
    expect(() => mgr.addSignature(signer2.secret())).toThrow('already been submitted');
  });

  // ── state serialization ──────────────────────────────────────────────────

  test('toState() / fromState() round-trips correctly', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey(), signer2.publicKey()],
      2
    );
    mgr.addSignature(signer1.secret());

    const state: MultiSigState = mgr.toState();
    const restored = MultiSigManager.fromState(state);

    expect(restored.getProgress().signaturesCollected).toBe(1);
    expect(restored.getProgress().status).toBe('pending');
    expect(restored.isReady()).toBe(false);

    // Can continue signing after restore
    restored.addSignature(signer2.secret());
    expect(restored.isReady()).toBe(true);
  });

  test('toState() snapshot is immutable from external mutation', () => {
    const mgr = MultiSigManager.create(
      sourceTx,
      Networks.TESTNET,
      [signer1.publicKey()],
      1
    );
    const state = mgr.toState();
    state.collectedSigners.push('FAKE');
    // Internal state should not be affected
    expect(mgr.getProgress().signaturesCollected).toBe(0);
  });
});
