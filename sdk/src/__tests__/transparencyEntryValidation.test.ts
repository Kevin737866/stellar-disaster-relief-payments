/**
 * Tests for DonorTransparencyClient.createTransparencyEntry validation.
 *
 * Verifies that:
 *   1. Each of the four supported transaction types is accepted.
 *   2. Unknown transaction types are rejected before storage.
 *   3. Malformed, fractional, and negative amounts are rejected.
 *   4. Large integer amounts are accepted and remain exact.
 *   5. Persistence does not occur after validation failure.
 *   6. Empty fund IDs are rejected.
 */

import { DonorTransparencyClient } from '../donorTransparency';
import type { TransparencyEntry } from '../donorTransparency';

// ── Test helpers ──────────────────────────────────────────────────────────

const DATA_KEY = 'donor_transparency_';

/** Set up localStorage mock and return the backing store. */
function setupLocalStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  const ls = {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true, configurable: true });
  return store;
}

/** Count how many entries were written to localStorage. */
function countStoredEntries(store: Record<string, string>): number {
  return Object.keys(store).filter(k => k.startsWith(`${DATA_KEY}entry_`)).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DonorTransparencyClient.createTransparencyEntry — validation', () => {
  let client: DonorTransparencyClient;
  let store: Record<string, string>;

  beforeEach(() => {
    store = setupLocalStorage();
    client = new DonorTransparencyClient();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Supported transaction types ────────────────────────────────────

  describe('supported transaction types', () => {
    const types: Array<{ type: string; description: string }> = [
      { type: 'fund_created', description: 'Initial fund creation' },
      { type: 'allocation', description: 'Food: rice distribution' },
      { type: 'disbursement', description: 'Disbursement to field team' },
      { type: 'recall', description: 'Recall of unused funds' },
    ];

    for (const { type, description } of types) {
      it(`accepts "${type}"`, async () => {
        const entry = await client.createTransparencyEntry(
          'FUND-001',
          type,
          '100000',
          description
        );

        expect(entry.transactionType).toBe(type);
        expect(entry.amount).toBe('100000');
        expect(entry.fundId).toBe('FUND-001');
        expect(countStoredEntries(store)).toBe(1);
      });
    }
  });

  // ── 2. Unknown transaction type ────────────────────────────────────────

  it('rejects an unknown transaction type and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'transfer', '100000', 'Some description')
    ).rejects.toThrow('Unsupported transaction type');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects an empty transaction type', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', '', '100000', 'Some description')
    ).rejects.toThrow('Unsupported transaction type');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects a transaction type with extra whitespace', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', ' allocation ', '100000', 'desc')
    ).rejects.toThrow('Unsupported transaction type');

    expect(countStoredEntries(store)).toBe(0);
  });

  // ── 3. Amount validation ────────────────────────────────────────────────

  it('rejects a fractional amount and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '100.50', 'desc')
    ).rejects.toThrow('non-negative decimal integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects a negative amount and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '-5000', 'desc')
    ).rejects.toThrow('non-negative decimal integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects an empty amount string and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '', 'desc')
    ).rejects.toThrow('must not be empty');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects a whitespace-only amount and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '   ', 'desc')
    ).rejects.toThrow('must not be empty');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects a non-numeric amount and does not persist', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', 'abc', 'desc')
    ).rejects.toThrow('non-negative decimal integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects an amount with a leading plus sign', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '+1000', 'desc')
    ).rejects.toThrow('non-negative decimal integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('rejects an amount with scientific notation', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '1e5', 'desc')
    ).rejects.toThrow('non-negative decimal integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  // ── 4. Large integer amounts ───────────────────────────────────────────

  it('accepts a large integer amount beyond JS safe-integer range and keeps it exact', async () => {
    const large = '9007199254740993'; // 2^53 + 1

    const entry = await client.createTransparencyEntry(
      'FUND-001',
      'allocation',
      large,
      'Large allocation'
    );

    expect(entry.amount).toBe(large);
    expect(countStoredEntries(store)).toBe(1);
  });

  it('accepts a U256 maximum value', async () => {
    const maxU256 = (2n ** 256n - 1n).toString();

    const entry = await client.createTransparencyEntry(
      'FUND-001',
      'fund_created',
      maxU256,
      'Max fund'
    );

    expect(entry.amount).toBe(maxU256);
  });

  it('rejects an amount exceeding U256 maximum', async () => {
    const overU256 = (2n ** 256n).toString();

    await expect(
      client.createTransparencyEntry('FUND-001', 'fund_created', overU256, 'Over max')
    ).rejects.toThrow('256-bit unsigned integer');

    expect(countStoredEntries(store)).toBe(0);
  });

  it('accepts a zero amount', async () => {
    const entry = await client.createTransparencyEntry(
      'FUND-001',
      'allocation',
      '0',
      'Zero allocation'
    );

    expect(entry.amount).toBe('0');
  });

  // ── 5. Persistence does not occur on validation failure ───────────────

  it('does not persist when transaction type is invalid', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'invalid_type', '100', 'desc')
    ).rejects.toThrow();

    expect(countStoredEntries(store)).toBe(0);
  });

  it('does not persist when amount is invalid', async () => {
    await expect(
      client.createTransparencyEntry('FUND-001', 'allocation', '-1', 'desc')
    ).rejects.toThrow();

    expect(countStoredEntries(store)).toBe(0);
  });

  it('does not persist when fund ID is empty', async () => {
    await expect(
      client.createTransparencyEntry('', 'allocation', '100', 'desc')
    ).rejects.toThrow('Fund ID');

    expect(countStoredEntries(store)).toBe(0);
  });

  // ── 6. Fund ID validation ──────────────────────────────────────────────

  it('rejects an empty fund ID', async () => {
    await expect(
      client.createTransparencyEntry('', 'allocation', '100', 'desc')
    ).rejects.toThrow('Fund ID must be a non-empty string');
  });

  it('rejects a whitespace-only fund ID', async () => {
    await expect(
      client.createTransparencyEntry('   ', 'allocation', '100', 'desc')
    ).rejects.toThrow('Fund ID must be a non-empty string');
  });

  // ── 7. Trimming behavior ──────────────────────────────────────────────

  it('trims whitespace from the fund ID in the stored entry', async () => {
    const entry = await client.createTransparencyEntry(
      '  FUND-001  ',
      'allocation',
      '100',
      'desc'
    );

    expect(entry.fundId).toBe('FUND-001');
  });

  it('normalizes the amount by trimming whitespace', async () => {
    const entry = await client.createTransparencyEntry(
      'FUND-001',
      'allocation',
      '  100  ',
      'desc'
    );

    expect(entry.amount).toBe('100');
  });

  // ── 8. Full entry shape on success ────────────────────────────────────

  it('returns a complete entry with all fields on success', async () => {
    const entry = await client.createTransparencyEntry(
      'FUND-001',
      'disbursement',
      '50000',
      'Water distribution',
      'BEN-001',
      { latitude: 18.59, longitude: -72.3, precision: 2 },
      'proof-hash'
    );

    expect(entry.id).toBeDefined();
    expect(entry.fundId).toBe('FUND-001');
    expect(entry.transactionType).toBe('disbursement');
    expect(entry.amount).toBe('50000');
    expect(entry.description).toBe('Water distribution');
    expect(entry.beneficiary).toBe('BEN-001');
    expect(entry.location).toEqual({ latitude: 18.59, longitude: -72.3, precision: 2 });
    expect(entry.proof).toBe('proof-hash');
    expect(typeof entry.timestamp).toBe('number');
  });
});
