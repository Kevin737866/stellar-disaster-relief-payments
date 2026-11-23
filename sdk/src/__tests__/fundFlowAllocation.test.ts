/**
 * Tests for DonorTransparencyClient.trackFundFlow allocation aggregation.
 *
 * Verifies that:
 *   1. Multiple allocations for the same category are summed, not overwritten.
 *   2. Separate categories remain separate.
 *   3. Entries with no category label are grouped under 'Uncategorized'.
 *   4. Large integer amounts are accumulated without floating-point.
 */

import { DonorTransparencyClient } from '../donorTransparency';
import type { TransparencyEntry } from '../donorTransparency';

// ── Test helpers ──────────────────────────────────────────────────────────

const FUND_ID = 'FUND-001';
const DONOR = 'GC2H33LY56GNCN5TYBSX5WHCXXVY67QL7WLYOSZQ222WP7ZYO57GPNBR';
const DATA_KEY = 'donor_transparency_';

function makeEntry(
  id: string,
  transactionType: TransparencyEntry['transactionType'],
  amount: string,
  description: string
): TransparencyEntry {
  return {
    id,
    fundId: FUND_ID,
    timestamp: Date.now(),
    transactionType,
    amount,
    description,
  };
}

/** Set up localStorage mock with pre-seeded entries. */
function setupLocalStorage(entries: TransparencyEntry[]): Record<string, string> {
  const store: Record<string, string> = {};
  for (const entry of entries) {
    store[`${DATA_KEY}entry_${entry.id}`] = JSON.stringify(entry);
  }
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

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DonorTransparencyClient.trackFundFlow — allocation aggregation', () => {
  let client: DonorTransparencyClient;

  beforeEach(() => {
    client = new DonorTransparencyClient();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Repeated category entries are summed ────────────────────────────

  it('sums multiple allocations for the same category instead of overwriting', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '100000', 'Food: rice distribution'),
      makeEntry('e3', 'allocation', '250000', 'Food: canned goods'),
      makeEntry('e4', 'allocation', '50000', 'Food: water bottles'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(flow.allocationBreakdown['Food']).toBe('400000');
  });

  // ── 2. Separate categories remain separate ────────────────────────────

  it('keeps separate categories distinct when multiple categories exist', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '100000', 'Food: rice distribution'),
      makeEntry('e3', 'allocation', '200000', 'Shelter: tents'),
      makeEntry('e4', 'allocation', '50000', 'Food: water bottles'),
      makeEntry('e5', 'allocation', '80000', 'Medical: first aid kits'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(flow.allocationBreakdown['Food']).toBe('150000');
    expect(flow.allocationBreakdown['Shelter']).toBe('200000');
    expect(flow.allocationBreakdown['Medical']).toBe('80000');
  });

  // ── 3. Missing category labels fall back to 'Uncategorized' ───────────

  it('groups entries with no category prefix under "Uncategorized"', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '30000', 'Emergency supplies'),
      makeEntry('e3', 'allocation', '20000', ''),
      makeEntry('e4', 'allocation', '50000', 'Logistics: truck rental'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    // "Emergency supplies" has no colon → prefix is the full string, which is
    // non-empty so it becomes the key itself.
    expect(flow.allocationBreakdown['Emergency supplies']).toBe('30000');
    // Empty description → falls back to 'Uncategorized'.
    expect(flow.allocationBreakdown['Uncategorized']).toBe('20000');
    expect(flow.allocationBreakdown['Logistics']).toBe('50000');
  });

  it('aggregates multiple uncategorized entries into a single sum', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '15000', ''),
      makeEntry('e3', 'allocation', '25000', ''),
      makeEntry('e4', 'allocation', '10000', ''),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(flow.allocationBreakdown['Uncategorized']).toBe('50000');
  });

  // ── 4. Large integer amounts ──────────────────────────────────────────

  it('correctly sums large integer amounts without floating-point loss', async () => {
    const largeAmount = '9007199254740993'; // 2^53 + 1, exceeds JS safe integer
    const entries = [
      makeEntry('e1', 'fund_created', '10000000000000000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', largeAmount, 'Food: bulk grain'),
      makeEntry('e3', 'allocation', largeAmount, 'Food: bulk rice'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    // 2 * (2^53 + 1) = 2^54 + 2 = 18014398509481988
    expect(flow.allocationBreakdown['Food']).toBe('18014398509481986');
  });

  it('handles very large U256-style amounts in allocation sums', async () => {
    const hugeA = '1000000000000000000000'; // 10^21
    const hugeB = '999999999999999999999999'; // ~10^24
    const entries = [
      makeEntry('e1', 'fund_created', '9999999999999999999999999', 'Initial fund creation'),
      makeEntry('e2', 'allocation', hugeA, 'Shelter: prefab units'),
      makeEntry('e3', 'allocation', hugeB, 'Shelter: tarps and blankets'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(flow.allocationBreakdown['Shelter']).toBe('1000999999999999999999999');
  });

  // ── 5. No allocation entries ──────────────────────────────────────────

  it('produces an empty allocationBreakdown when there are no allocations', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '500000', 'Initial fund creation'),
      makeEntry('e2', 'disbursement', '100000', 'Disbursement to field team'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(Object.keys(flow.allocationBreakdown)).toHaveLength(0);
  });

  // ── 6. Whitespace-only prefix falls back to 'Uncategorized' ───────────

  it('treats a whitespace-only category prefix as "Uncategorized"', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '40000', '   : misc items'),
      makeEntry('e3', 'allocation', '60000', 'Food: rice'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    // "   : misc items" → prefix is "   " → trimmed to "" → fallback.
    expect(flow.allocationBreakdown['Uncategorized']).toBe('40000');
    expect(flow.allocationBreakdown['Food']).toBe('60000');
  });

  // ── 7. Trimmed category key ───────────────────────────────────────────

  it('trims whitespace around category prefixes so "Food " and "Food" are the same', async () => {
    const entries = [
      makeEntry('e1', 'fund_created', '1000000', 'Initial fund creation'),
      makeEntry('e2', 'allocation', '100000', 'Food: rice'),
      makeEntry('e3', 'allocation', '50000', '  Food : water'),
    ];
    setupLocalStorage(entries);

    const flow = await client.trackFundFlow(FUND_ID, DONOR);

    expect(flow.allocationBreakdown['Food']).toBe('150000');
  });
});
