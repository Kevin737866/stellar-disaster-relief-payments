import { OfflineAuthClient } from '../offlineAuth';

describe('OfflineAuthClient.generatePaperBackupCodes', () => {
  let client: OfflineAuthClient;

  beforeEach(() => {
    client = new OfflineAuthClient({});
  });

  it('generates the requested number of unique formatted codes with valid checksums', () => {
    const codes = client.generatePaperBackupCodes('beneficiary-hash-123', 10);
    expect(codes).toHaveLength(10);

    const uniqueCodes = new Set(codes.map((c) => c.code));
    expect(uniqueCodes.size).toBe(10);

    for (const entry of codes) {
      expect(entry.code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(entry.checksum).toMatch(/^[0-9A-F]{8}$/);
      expect(client.validatePaperBackupCode(entry.code, entry.checksum)).toBe(true);
    }
  });

  it('rejects invalid or excessive code counts', () => {
    expect(() => client.generatePaperBackupCodes('id', 0)).toThrow(/Invalid backup code count/);
    expect(() => client.generatePaperBackupCodes('id', -5)).toThrow(/Invalid backup code count/);
    expect(() => client.generatePaperBackupCodes('id', 1.5)).toThrow(/Invalid backup code count/);
    expect(() => client.generatePaperBackupCodes('id', 101)).toThrow(/Invalid backup code count/);
    expect(() => client.generatePaperBackupCodes('id', Number.NaN)).toThrow(/Invalid backup code count/);
  });

  it('fails explicitly when no cryptographically secure random provider is available', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
    });

    const cryptoModule = require('crypto');
    const originalRandomBytes = cryptoModule.randomBytes;
    cryptoModule.randomBytes = undefined;

    try {
      expect(() => client.generatePaperBackupCodes('id', 5)).toThrow(
        /Cryptographically secure random number generator is unavailable/
      );
    } finally {
      cryptoModule.randomBytes = originalRandomBytes;
      if (originalCrypto) {
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
      }
    }
  });
});
