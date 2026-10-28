import { DonorTransparencyClient, TransparencyEntry } from '../donorTransparency';

describe('DonorTransparencyClient - Issues #317 & #318', () => {
  let client: DonorTransparencyClient;
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => mockStorage.get(key) || null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
      key: (i: number) => Array.from(mockStorage.keys())[i] || null,
      get length() {
        return mockStorage.size;
      },
    };
    (global as any).localStorage = fakeLocalStorage;
    client = new DonorTransparencyClient();
  });

  describe('Issue #318: Validate donor transparency entry types and amounts', () => {
    it.each([
      'fund_created',
      'allocation',
      'disbursement',
      'recall',
    ] as TransparencyEntry['transactionType'][])('accepts valid transactionType "%s"', async (type) => {
      const entry = await client.createTransparencyEntry(
        'fund-1',
        type,
        '1000000',
        'Valid entry'
      );
      expect(entry.transactionType).toBe(type);
      expect(entry.amount).toBe('1000000');
      expect(mockStorage.size).toBe(1);
    });

    it('rejects unsupported transactionType values', async () => {
      await expect(
        client.createTransparencyEntry('fund-1', 'unknown_type' as any, '1000', 'desc')
      ).rejects.toThrow(/Invalid transactionType/);
      expect(mockStorage.size).toBe(0);
    });

    it('rejects empty or non-string fundId', async () => {
      await expect(
        client.createTransparencyEntry('', 'allocation', '1000', 'desc')
      ).rejects.toThrow(/Invalid fundId/);
      expect(mockStorage.size).toBe(0);
    });

    it.each([
      ['fractional amount', '100.5'],
      ['negative amount', '-500'],
      ['non-numeric string', 'not-a-number'],
      ['empty string', ''],
      ['whitespace string', '   '],
    ])('rejects invalid amount (%s: %p) and avoids persisting record', async (_label, badAmount) => {
      await expect(
        client.createTransparencyEntry('fund-1', 'allocation', badAmount, 'desc')
      ).rejects.toThrow(/Invalid amount/);
      expect(mockStorage.size).toBe(0);
    });

    it('preserves exact large integer amount representations without overflow', async () => {
      const largeAmount = '9007199254740991000000'; // Exceeds Number.MAX_SAFE_INTEGER
      const entry = await client.createTransparencyEntry(
        'fund-1',
        'fund_created',
        largeAmount,
        'Initial endowment'
      );
      expect(entry.amount).toBe(largeAmount);
    });
  });

  describe('Issue #317: Aggregate repeated allocations in donor fund-flow summaries', () => {
    it('sums multiple allocations under the same category prefix', async () => {
      await client.createTransparencyEntry('fund-1', 'fund_created', '10000', 'Initial fund');
      await client.createTransparencyEntry('fund-1', 'allocation', '3000', 'Medical Supplies: Phase 1');
      await client.createTransparencyEntry('fund-1', 'allocation', '2000', 'Medical Supplies: Phase 2');
      await client.createTransparencyEntry('fund-1', 'allocation', '1500', 'Shelter: Emergency tents');

      const flow = await client.trackFundFlow('fund-1', 'G-DONOR');

      expect(flow.allocationBreakdown['Medical Supplies']).toBe('5000');
      expect(flow.allocationBreakdown['Shelter']).toBe('1500');
    });

    it('falls back to "Other" for allocations without a colon prefix and aggregates them', async () => {
      await client.createTransparencyEntry('fund-1', 'fund_created', '5000', 'Initial');
      await client.createTransparencyEntry('fund-1', 'allocation', '1000', 'Miscellaneous expense A');
      await client.createTransparencyEntry('fund-1', 'allocation', '800', 'Miscellaneous expense B');
      await client.createTransparencyEntry('fund-1', 'allocation', '200', '');

      const flow = await client.trackFundFlow('fund-1', 'G-DONOR');

      expect(flow.allocationBreakdown['Miscellaneous expense A']).toBe('1000');
      expect(flow.allocationBreakdown['Miscellaneous expense B']).toBe('800');
      expect(flow.allocationBreakdown['Other']).toBe('200');
    });

    it('handles large integer amounts during allocation aggregation without floating point inaccuracy', async () => {
      const a = '5000000000000000000000';
      const b = '7000000000000000000000';
      const expectedSum = '12000000000000000000000';

      await client.createTransparencyEntry('fund-1', 'allocation', a, 'Logistics: Fleet');
      await client.createTransparencyEntry('fund-1', 'allocation', b, 'Logistics: Air transport');

      const flow = await client.trackFundFlow('fund-1', 'G-DONOR');

      expect(flow.allocationBreakdown['Logistics']).toBe(expectedSum);
    });
  });
});
