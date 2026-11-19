/**
 * Manual mock for crypto-js (tests/__mocks__/crypto-js.ts).
 *
 * Covers the three export patterns used across the SDK:
 *   import { SHA256 } from 'crypto-js'          — beneficiaryClient, beneficiaryIdentity, offlineAuth
 *   import { SHA256, MD5 } from 'crypto-js'      — offlineAuth
 *   import CryptoJS from 'crypto-js'             — (removed in donorTransparency; kept here for safety)
 *
 * The hash functions return a deterministic hex-like string based on input
 * length for test predictability.  They are not cryptographically correct —
 * that is intentional for unit tests.
 */

/** Produce a deterministic 64-char hex string from any input string. */
function mockHashString(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/** WordArray-like object returned by SHA256 / MD5. */
function mockWordArray(data: string) {
  const hex = mockHashString(data);
  return { toString: jest.fn(() => hex) };
}

/** Named export: SHA256(data).toString() */
export const SHA256 = jest.fn().mockImplementation((data: string) => mockWordArray(String(data)));

/** Named export: MD5(data).toString() */
export const MD5 = jest.fn().mockImplementation((data: string) => mockWordArray(String(data)));

/**
 * Legacy createHash factory — kept for backward compatibility with any tests
 * that still use the `createHash('sha256').update(data).toString()` pattern.
 */
export const createHash = jest.fn().mockImplementation((_algo: string) => {
  let _data = '';
  return {
    update: jest.fn().mockImplementation((data: string) => {
      _data = data;
      return {
        toString: jest.fn().mockImplementation(() => mockHashString(_data)),
      };
    }),
  };
});

/** Default export for `import CryptoJS from 'crypto-js'` usage. */
const CryptoJS = { SHA256, MD5, createHash };
export default CryptoJS;
