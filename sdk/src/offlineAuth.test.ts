import {
  InMemorySMSChallengeStateStore,
  MAX_PAPER_BACKUP_CODES,
  OfflineAuthClient,
} from './offlineAuth';

// Use the same module object the implementation's dynamic require() resolves.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeCrypto = require('crypto');

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

describe('offline auth paper backup codes', () => {
  let mathRandom: jest.SpyInstance;

  beforeEach(() => {
    mathRandom = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      delete (globalThis as any).crypto;
    }
  });

  function removeWebCrypto(): void {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  }

  function expectPrintable(code: { code: string; checksum: string }): void {
    expect(code.code).toMatch(/^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
    expect(code.checksum).toMatch(/^[0-9A-F]{8}$/);
  }

  it('generates the default count in the documented printable format', () => {
    const client = new OfflineAuthClient({});
    const codes = client.generatePaperBackupCodes('identity-hash');

    expect(codes).toHaveLength(10);
    codes.forEach(expectPrintable);
    codes.forEach((code, index) => {
      expect(code.instructions).toContain(`Code ${index + 1} of 10`);
    });
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('accepts the smallest and largest valid counts', () => {
    const client = new OfflineAuthClient({});

    expect(client.generatePaperBackupCodes('id', 1)).toHaveLength(1);
    const maximum = client.generatePaperBackupCodes('id', MAX_PAPER_BACKUP_CODES);
    expect(maximum).toHaveLength(MAX_PAPER_BACKUP_CODES);
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_PAPER_BACKUP_CODES + 1])(
    'rejects invalid count %s before requesting entropy',
    count => {
      const client = new OfflineAuthClient({});
      const entropySpy = jest.spyOn(client as any, 'getSecureRandomBytes');

      expect(() => client.generatePaperBackupCodes('id', count)).toThrow(
        new RegExp(`integer between 1 and ${MAX_PAPER_BACKUP_CODES}`)
      );
      expect(entropySpy).not.toHaveBeenCalled();
    }
  );

  it('generates codes unique within a single issuance', () => {
    const client = new OfflineAuthClient({});
    const codes = client.generatePaperBackupCodes('id', MAX_PAPER_BACKUP_CODES);

    expect(new Set(codes.map(code => code.code)).size).toBe(MAX_PAPER_BACKUP_CODES);
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('uses Web Crypto getRandomValues in browser environments', () => {
    const getRandomValues = jest.fn((array: Uint8Array) => {
      array.set([1, 2, 3, 4, 5, 6, 7, 8]);
      return array;
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
    });
    const randomBytesSpy = jest.spyOn(nodeCrypto, 'randomBytes');

    const [code] = new OfflineAuthClient({}).generatePaperBackupCodes('id', 1);

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(8);
    expect(randomBytesSpy).not.toHaveBeenCalled();
    expect(code.code).toBe('0102-0304-0506-0708');
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('uses Node crypto.randomBytes when Web Crypto is unavailable', () => {
    removeWebCrypto();
    const randomBytesSpy = jest
      .spyOn(nodeCrypto, 'randomBytes')
      .mockReturnValue(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11]));

    const [code] = new OfflineAuthClient({}).generatePaperBackupCodes('id', 1);

    expect(randomBytesSpy).toHaveBeenCalledWith(8);
    expect(code.code).toBe('AABB-CCDD-EEFF-0011');
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('fails explicitly when no secure random provider is available', () => {
    removeWebCrypto();
    jest.spyOn(nodeCrypto, 'randomBytes').mockImplementation(() => {
      throw new Error('unavailable');
    });

    expect(() => new OfflineAuthClient({}).generatePaperBackupCodes('id', 1)).toThrow(
      /Cryptographically secure random source unavailable/
    );
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('retries duplicate random values and fails closed if uniqueness is impossible', () => {
    const client = new OfflineAuthClient({});
    const duplicateSpy = jest
      .spyOn(client as any, 'generateRandomPaperCode')
      .mockReturnValue('DEADBEEFDEADBEEF');

    expect(() => client.generatePaperBackupCodes('id', 2)).toThrow(
      /Unable to generate unique paper backup codes/
    );
    // One success for the first code, then ten rejected duplicates for the second.
    expect(duplicateSpy).toHaveBeenCalledTimes(11);
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('treats the checksum as a transcription check, not an authenticity proof', () => {
    const client = new OfflineAuthClient({});
    const [code] = client.generatePaperBackupCodes('id', 1);

    expect(client.validatePaperBackupCode(code.code, code.checksum)).toBe(true);

    const replacement = code.code[0] === 'F' ? '0' : 'F';
    const typo = replacement + code.code.slice(1);
    expect(client.validatePaperBackupCode(typo, code.checksum)).toBe(false);

    const timestampBefore = code.createdAt;
    expect(timestampBefore).toBeGreaterThan(0);
  });
});

describe('offline auth SMS/USSD single-use challenges', () => {
  const PHONE = '+962791234567';
  const VERIFIER = 'desk-a';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup() {
    const store = new InMemorySMSChallengeStateStore();
    const issuer = new OfflineAuthClient({ challengeStateStore: store });
    const verifier = new OfflineAuthClient({ challengeStateStore: store, verifierId: VERIFIER });
    return { store, issuer, verifier };
  }

  function validate(
    verifier: OfflineAuthClient,
    challenge: { challengeId?: string; code: string; signature: string; expiresAt: number },
    verifierId: string = VERIFIER
  ) {
    return verifier.validateSMSCode(
      challenge.challengeId!,
      challenge.code,
      PHONE,
      challenge.signature,
      challenge.expiresAt,
      verifierId
    );
  }

  it('generates explicit, unique challenge IDs', () => {
    const { issuer } = setup();
    const challenges = Array.from({ length: 20 }, () => issuer.generateSMSCode('id', PHONE));

    challenges.forEach(challenge => {
      expect(challenge.challengeId).toMatch(/^[0-9a-f]{32}$/);
    });
    expect(new Set(challenges.map(challenge => challenge.challengeId)).size).toBe(20);
  });

  it('accepts a challenge once and rejects a replay by the same verifier', () => {
    const { store, issuer, verifier } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE);

    const first = validate(verifier, challenge);
    expect(first).toMatchObject({
      isValid: true,
      reason: 'valid',
      challengeId: challenge.challengeId,
      verifierId: VERIFIER,
    });
    expect(store.getConsumed(VERIFIER, challenge.challengeId!)).toBeDefined();

    const replay = validate(verifier, challenge);
    expect(replay).toMatchObject({ isValid: false, reason: 'already_consumed' });
    expect(replay.consumedAt).toBe(first.consumedAt);
  });

  it('scopes consumption to one verifier authority', () => {
    const { store, issuer, verifier } = setup();
    const other = new OfflineAuthClient({ challengeStateStore: store, verifierId: 'desk-b' });
    const challenge = issuer.generateSMSCode('id', PHONE);

    expect(validate(verifier, challenge, VERIFIER).isValid).toBe(true);
    expect(validate(other, challenge, 'desk-b').isValid).toBe(true);
    expect(validate(other, challenge, 'desk-b').reason).toBe('already_consumed');
  });

  it('rejects an expired challenge with a distinct outcome', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2024, 0, 1));
    const { issuer, verifier } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE, 15);
    now.mockReturnValue(challenge.expiresAt + 1);

    expect(validate(verifier, challenge).reason).toBe('expired');
  });

  it('rejects unknown challenge IDs and missing verifier IDs distinctly', () => {
    const { issuer, verifier } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE);

    const unknown = verifier.validateSMSCode(
      'not-a-challenge',
      challenge.code,
      PHONE,
      challenge.signature,
      challenge.expiresAt,
      VERIFIER
    );
    expect(unknown.reason).toBe('unknown_challenge');

    const missingVerifier = validate(verifier, challenge, '');
    expect(missingVerifier.reason).toBe('invalid_verifier');
  });

  it('rejects a tampered signature', () => {
    const { issuer, verifier } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE);

    const result = verifier.validateSMSCode(
      challenge.challengeId!,
      challenge.code,
      PHONE,
      'tampered-signature',
      challenge.expiresAt,
      VERIFIER
    );

    expect(result.reason).toBe('invalid_signature');
  });

  it('accepts only one of two concurrent attempts', async () => {
    const { issuer, verifier } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE);

    const results = await Promise.all([
      Promise.resolve().then(() => validate(verifier, challenge)),
      Promise.resolve().then(() => validate(verifier, challenge)),
    ]);

    expect(results.filter(result => result.isValid)).toHaveLength(1);
    expect(results.map(result => result.reason).sort()).toEqual(['already_consumed', 'valid']);
  });

  it('keeps consumption after a verifier restart with a durable store', () => {
    const { issuer, store } = setup();
    const challenge = issuer.generateSMSCode('id', PHONE);

    const firstVerifier = new OfflineAuthClient({ challengeStateStore: store, verifierId: VERIFIER });
    expect(validate(firstVerifier, challenge).isValid).toBe(true);

    const restarted = new OfflineAuthClient({ challengeStateStore: store, verifierId: VERIFIER });
    expect(validate(restarted, challenge).reason).toBe('already_consumed');
  });

  it('reconciles offline devices, keeps the earliest tombstone, and reports conflicts', () => {
    const now = jest.spyOn(Date, 'now');
    const baseTime = Date.UTC(2024, 0, 1);
    now.mockReturnValue(baseTime);

    const storeA = new InMemorySMSChallengeStateStore();
    const storeB = new InMemorySMSChallengeStateStore();
    const issuerA = new OfflineAuthClient({ challengeStateStore: storeA });
    const deviceA = new OfflineAuthClient({ challengeStateStore: storeA, verifierId: VERIFIER });
    const deviceB = new OfflineAuthClient({ challengeStateStore: storeB, verifierId: VERIFIER });
    const challenge = issuerA.generateSMSCode('id', PHONE);

    // Share issuance metadata, then let both devices work offline.
    deviceB.reconcileChallengeState(VERIFIER, [
      { issued: storeA.listIssued(), consumed: [] },
    ]);

    now.mockReturnValue(baseTime + 1000);
    expect(validate(deviceA, challenge).isValid).toBe(true);
    now.mockReturnValue(baseTime + 2000);
    expect(validate(deviceB, challenge).isValid).toBe(true);

    const reconciliation = deviceA.reconcileChallengeState(VERIFIER, [
      deviceB.exportChallengeState(VERIFIER),
    ]);
    expect(reconciliation.conflicts).toContain(challenge.challengeId);
    expect(deviceA.exportChallengeState(VERIFIER).consumed[0].consumedAt).toBe(baseTime + 1000);

    deviceB.reconcileChallengeState(VERIFIER, [deviceA.exportChallengeState(VERIFIER)]);
    expect(validate(deviceB, challenge).reason).toBe('already_consumed');
  });

  it('fails explicitly instead of resetting state when no store is configured', () => {
    const client = new OfflineAuthClient({ verifierId: VERIFIER });

    expect(() => client.generateSMSCode('id', PHONE)).toThrow(/challenge state store is not configured/i);
    expect(() =>
      client.validateSMSCode('anything', '000000', PHONE, 'sig', Date.now(), VERIFIER)
    ).toThrow(/challenge state store is not configured/i);
  });
});
