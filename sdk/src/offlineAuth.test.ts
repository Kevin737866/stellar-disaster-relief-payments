import { MAX_PAPER_BACKUP_CODES, OfflineAuthClient } from './offlineAuth';

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
