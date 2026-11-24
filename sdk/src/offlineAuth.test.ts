import { SHA256 } from 'crypto-js';
import { Keypair } from 'stellar-sdk';
import { OfflineAuthClient } from './offlineAuth';
import { BeneficiaryIdentity } from './types';

const SIGNING_KEY = 'SCXSVM5RJF6RPESLJ6G7BZH4ARCROWKAIRLJKPX6XQZUUNT7IU64NR35';
const PUBLIC_KEY = Keypair.fromSecret(SIGNING_KEY).publicKey();
const OTHER_KEY = Keypair.random().publicKey();
const ID_HASH = 'beneficiary-hash-0123456789abcdef';
const WRONG_HASH = 'beneficiary-hash-fedcba9876543210';
const PHONE = '+254700000001';
const USSD_SECRET = 'verifier-side-secret';
const NOW = 1_700_000_000_000;

const identity: BeneficiaryIdentity = {
  idHash: ID_HASH,
  creationFactors: [],
  recoveryContacts: [],
  trustScore: 85,
  campLocation: 'Camp Delta',
  createdAt: NOW,
  lastVerified: NOW,
  walletAddress: 'GC2H33LY56GNCN5TYBSX5WHCXXVY67QL7WLYOSZQ222WP7ZYO57GPNBR',
  isActive: true,
  geofenceZones: [],
  temporaryCredentials: [],
  disbursementIds: [],
  transferIds: [],
};

interface QRPayload {
  v: number;
  id: string;
  ts: number;
  exp: number;
  trust: number;
  loc: string;
  sig?: string;
}

function canonicalQR(payload: QRPayload): string {
  return JSON.stringify({
    v: payload.v,
    id: payload.id,
    ts: payload.ts,
    exp: payload.exp,
    trust: payload.trust,
    loc: payload.loc,
  });
}

function signer() {
  return new OfflineAuthClient({
    signingKey: SIGNING_KEY,
    pinnedPublicKeys: [PUBLIC_KEY],
    ussdSecret: USSD_SECRET,
  });
}

describe('OfflineAuthClient authenticated credentials', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('valid QR credential verifies against pinned key and returns full identity hash', () => {
    const client = signer();
    const credential = client.generateQRCode(ID_HASH, identity);
    const payload = JSON.parse(credential.code) as QRPayload;

    expect(payload.id).toBe(ID_HASH);
    expect(payload.id.length).toBeGreaterThan(16);
    expect(client.validateQRCode(credential.code)).toEqual({
      isValid: true,
      idHash: ID_HASH,
      trustScore: 85,
      campLocation: 'Camp Delta',
    });
    expect(client.validateQRCode(credential.code, ID_HASH).isValid).toBe(true);
  });

  test('rejects QR credentials signed with a forged unkeyed SHA256 hash', () => {
    const client = signer();
    const payload = JSON.parse(client.generateQRCode(ID_HASH, identity).code) as QRPayload;
    payload.sig = SHA256(canonicalQR(payload)).toString().substring(0, 32);

    expect(client.validateQRCode(JSON.stringify(payload))).toMatchObject({
      isValid: false,
      reason: 'Invalid signature',
    });
  });

  test.each([
    ['id', WRONG_HASH],
    ['trust', 100],
    ['loc', 'Camp Echo'],
    ['ts', NOW + 1],
    ['exp', credentialExpiry() + 1],
  ])('rejects QR credential with altered %s', (field, value) => {
    const client = signer();
    const payload = JSON.parse(client.generateQRCode(ID_HASH, identity).code) as QRPayload;
    (payload as unknown as Record<string, unknown>)[field] = value;

    expect(client.validateQRCode(JSON.stringify(payload)).isValid).toBe(false);
  });

  test('rejects QR credential presented for a different identity', () => {
    const client = signer();
    const code = client.generateQRCode(ID_HASH, identity).code;

    expect(client.validateQRCode(code, WRONG_HASH)).toMatchObject({
      isValid: false,
      reason: 'Identity mismatch',
    });
  });

  test('rejects expired QR credential', () => {
    const client = signer();
    const code = client.generateQRCode(ID_HASH, identity, 1).code;
    (Date.now as jest.Mock).mockReturnValue(NOW + 61_000);

    expect(client.validateQRCode(code)).toMatchObject({
      isValid: false,
      reason: 'QR code expired',
    });
  });

  test('rejects QR credentials when trusted keys are absent or untrusted', () => {
    const unsignedClient = new OfflineAuthClient({ signingKey: SIGNING_KEY });
    const code = signer().generateQRCode(ID_HASH, identity).code;

    expect(unsignedClient.validateQRCode(code)).toMatchObject({
      isValid: false,
      reason: 'Trusted offline QR public keys are not configured',
    });

    const client = new OfflineAuthClient({ pinnedPublicKeys: [OTHER_KEY] });
    expect(client.validateQRCode(code).isValid).toBe(false);
  });

  test('QR generation fails closed without a signing key', () => {
    expect(() => new OfflineAuthClient({}).generateQRCode(ID_HASH, identity))
      .toThrow('Offline QR signing key is not configured');
  });

  test('valid USSD credential verifies with the verifier secret', () => {
    const client = signer();
    const credential = client.generateSMSCode(ID_HASH, PHONE);

    expect(client.validateSMSCode(
      credential.code,
      PHONE,
      credential.signature,
      credential.expiresAt,
    )).toBe(true);
    expect(client.validateSMSCode(
      credential.code,
      PHONE,
      credential.signature,
      credential.expiresAt,
      ID_HASH,
    )).toBe(true);
  });

  test.each([
    ['code', '000000'],
    ['phone', '+254700000002'],
  ])('rejects USSD credential with altered %s', (field, value) => {
    const client = signer();
    const credential = client.generateSMSCode(ID_HASH, PHONE);
    const code = field === 'code' ? value : credential.code;
    const phone = field === 'phone' ? value : PHONE;

    expect(client.validateSMSCode(code, phone, credential.signature, credential.expiresAt))
      .toBe(false);
  });

  test('rejects USSD credential with a forged unkeyed SHA256 signature', () => {
    const client = signer();
    const credential = client.generateSMSCode(ID_HASH, PHONE);
    const forged = SHA256(`${credential.code}:${PHONE}:${credential.expiresAt}`).toString();

    expect(client.validateSMSCode(
      credential.code,
      PHONE,
      forged,
      credential.expiresAt,
    )).toBe(false);
  });

  test('rejects expired USSD credential and identity mismatch', () => {
    const client = signer();
    const credential = client.generateSMSCode(ID_HASH, PHONE);

    (Date.now as jest.Mock).mockReturnValue(credential.expiresAt + 1);
    expect(client.validateSMSCode(
      credential.code,
      PHONE,
      credential.signature,
      credential.expiresAt,
    )).toBe(false);

    (Date.now as jest.Mock).mockReturnValue(NOW);
    expect(client.validateSMSCode(
      credential.code,
      PHONE,
      credential.signature,
      credential.expiresAt,
      WRONG_HASH,
    )).toBe(false);
  });

  test('USSD generation and validation fail closed without a secret', () => {
    const client = new OfflineAuthClient({ signingKey: SIGNING_KEY });

    expect(() => client.generateSMSCode(ID_HASH, PHONE))
      .toThrow('USSD verification secret is not configured');
    expect(() => client.validateSMSCode('123456', PHONE, 'signature', NOW + 60_000))
      .toThrow('USSD verification secret is not configured');
  });
});

function credentialExpiry(): number {
  return NOW + (30 * 60 * 1000);
}
