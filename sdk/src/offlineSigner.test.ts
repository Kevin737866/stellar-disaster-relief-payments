import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Account,
  Transaction,
} from 'stellar-sdk';
import { OfflineSigner, NetworkMismatchError, OfflineEnvelope } from './offlineSigner';

function buildTx(sourceKeypair: Keypair, passphrase = Networks.TESTNET): Transaction {
  const account = new Account(sourceKeypair.publicKey(), '0');
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: '1',
      })
    )
    .setTimeout(0)
    .build();
}

describe('OfflineSigner', () => {
  let signer1: Keypair;
  let signer2: Keypair;
  let testnetTx: Transaction;
  let mainnetTx: Transaction;

  beforeEach(() => {
    signer1 = Keypair.random();
    signer2 = Keypair.random();
    testnetTx = buildTx(signer1, Networks.TESTNET);
    mainnetTx = buildTx(signer1, Networks.PUBLIC);
  });

  // ── serialize / deserialize ──────────────────────────────────────────────

  test('serialize() produces a valid OfflineEnvelope', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(env.txXdr).toBeTruthy();
    expect(env.networkPassphrase).toBe(Networks.TESTNET);
    expect(env.signedBy).toEqual([]);
    expect(env.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('deserialize() restores the transaction', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const tx = OfflineSigner.deserialize(env);
    expect(tx.toXDR()).toBe(env.txXdr);
  });

  test('deserialize() throws NetworkMismatchError on passphrase mismatch', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(() => OfflineSigner.deserialize(env, Networks.PUBLIC)).toThrow(NetworkMismatchError);
  });

  test('deserialize() succeeds when expectedPassphrase matches', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(() => OfflineSigner.deserialize(env, Networks.TESTNET)).not.toThrow();
  });

  // ── offline sign ─────────────────────────────────────────────────────────

  test('sign() adds a signature and records the signer', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const signed = OfflineSigner.sign(env, signer1.secret());
    expect(signed.signedBy).toContain(signer1.publicKey());
    expect(signed.txXdr).not.toBe(env.txXdr); // XDR changed (signature added)
  });

  test('sign() does not mutate the original envelope', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const originalXdr = env.txXdr;
    OfflineSigner.sign(env, signer1.secret());
    expect(env.txXdr).toBe(originalXdr);
    expect(env.signedBy).toHaveLength(0);
  });

  test('sign() rejects duplicate signer', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const signed = OfflineSigner.sign(env, signer1.secret());
    expect(() => OfflineSigner.sign(signed, signer1.secret())).toThrow('already signed');
  });

  test('sign() throws NetworkMismatchError when expectedPassphrase differs', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(() => OfflineSigner.sign(env, signer1.secret(), Networks.PUBLIC))
      .toThrow(NetworkMismatchError);
  });

  test('sign() accumulates multiple signatures', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const s1 = OfflineSigner.sign(env, signer1.secret());
    const s2 = OfflineSigner.sign(s1, signer2.secret());
    expect(s2.signedBy).toContain(signer1.publicKey());
    expect(s2.signedBy).toContain(signer2.publicKey());
    const tx = OfflineSigner.deserialize(s2);
    expect(tx.signatures).toHaveLength(2);
  });

  // ── network validation ───────────────────────────────────────────────────

  test('validateNetwork() returns true for matching passphrase', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(OfflineSigner.validateNetwork(env, Networks.TESTNET)).toBe(true);
  });

  test('validateNetwork() returns false for mismatched passphrase', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(OfflineSigner.validateNetwork(env, Networks.PUBLIC)).toBe(false);
  });

  test('mainnet envelope cannot be signed with testnet passphrase check', () => {
    const env = OfflineSigner.serialize(mainnetTx);
    expect(() => OfflineSigner.sign(env, signer1.secret(), Networks.TESTNET))
      .toThrow(NetworkMismatchError);
  });

  // ── encode / decode ──────────────────────────────────────────────────────

  test('encode() / decode() round-trips correctly', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const encoded = OfflineSigner.encode(env);
    expect(typeof encoded).toBe('string');
    const decoded = OfflineSigner.decode(encoded);
    expect(decoded.txXdr).toBe(env.txXdr);
    expect(decoded.networkPassphrase).toBe(env.networkPassphrase);
    expect(decoded.signedBy).toEqual([]);
  });

  test('decode() throws on invalid Base64', () => {
    expect(() => OfflineSigner.decode('!!!not-base64!!!')).toThrow('Invalid encoded envelope');
  });

  test('decode() throws on missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ txXdr: 'x' })).toString('base64');
    expect(() => OfflineSigner.decode(bad)).toThrow('missing required fields');
  });

  test('encode/decode preserves signatures', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const signed = OfflineSigner.sign(env, signer1.secret());
    const decoded = OfflineSigner.decode(OfflineSigner.encode(signed));
    expect(decoded.signedBy).toContain(signer1.publicKey());
    const tx = OfflineSigner.deserialize(decoded);
    expect(tx.signatures).toHaveLength(1);
  });

  // ── importSignature ──────────────────────────────────────────────────────

  test('importSignature() rejects duplicate signer', () => {
    const env = OfflineSigner.serialize(testnetTx);
    const signed = OfflineSigner.sign(env, signer1.secret());
    // Try to import a signature for the same key
    const fakeSig = '00'.repeat(64);
    expect(() =>
      OfflineSigner.importSignature(signed, signer1.publicKey(), fakeSig)
    ).toThrow('already signed');
  });

  test('importSignature() rejects wrong-length signature', () => {
    const env = OfflineSigner.serialize(testnetTx);
    expect(() =>
      OfflineSigner.importSignature(env, signer2.publicKey(), 'deadbeef')
    ).toThrow('Invalid signature length');
  });

  // ── submit ───────────────────────────────────────────────────────────────

  test('submit() calls sendTransaction with the signed transaction', async () => {
    const env = OfflineSigner.serialize(testnetTx);
    const signed = OfflineSigner.sign(env, signer1.secret());
    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    const result = await OfflineSigner.submit(signed, mockServer);
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SUCCESS');
  });

  // ── offline-to-online flow ───────────────────────────────────────────────

  test('full offline-to-online flow: serialize → sign offline → encode → decode → submit', async () => {
    // 1. Online: build and serialize
    const env = OfflineSigner.serialize(testnetTx);

    // 2. Offline: encode for transfer
    const encoded = OfflineSigner.encode(env);

    // 3. Air-gapped device: decode and sign
    const decoded = OfflineSigner.decode(encoded);
    expect(OfflineSigner.validateNetwork(decoded, Networks.TESTNET)).toBe(true);
    const signed = OfflineSigner.sign(decoded, signer1.secret(), Networks.TESTNET);

    // 4. Re-encode for transfer back
    const signedEncoded = OfflineSigner.encode(signed);

    // 5. Online: decode and submit
    const final = OfflineSigner.decode(signedEncoded);
    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    const result = await OfflineSigner.submit(final, mockServer);
    expect(result.status).toBe('SUCCESS');
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  // ── multi-sig compatibility ──────────────────────────────────────────────

  test('multi-sig: two offline signers, then submit', async () => {
    const env = OfflineSigner.serialize(testnetTx);

    // Signer 1 signs offline
    const afterS1 = OfflineSigner.sign(env, signer1.secret());
    expect(afterS1.signedBy).toHaveLength(1);

    // Signer 2 signs offline (from restored envelope)
    const afterS2 = OfflineSigner.sign(afterS1, signer2.secret());
    expect(afterS2.signedBy).toHaveLength(2);

    const tx = OfflineSigner.deserialize(afterS2);
    expect(tx.signatures).toHaveLength(2);

    const mockServer = { sendTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }) };
    await OfflineSigner.submit(afterS2, mockServer);
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
  });
});
