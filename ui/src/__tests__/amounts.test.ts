/**
 * Tests for BigInt-safe amount parsing/formatting.
 *
 * #203 — Dashboard used `parseInt` on fund amounts, which silently rounds
 * anything past 2^53-1 and turns garbage into NaN. These cover both.
 */
import {
  tryParseAmount,
  parseAmount,
  sumAmounts,
  formatAmount,
  percentageOf,
} from '../format/amounts';

describe('tryParseAmount', () => {
  it('parses a plain integer string', () => {
    expect(tryParseAmount('1000')).toEqual({ ok: true, value: 1000n });
  });

  it('parses a negative integer string', () => {
    expect(tryParseAmount('-42')).toEqual({ ok: true, value: -42n });
  });

  it('trims surrounding whitespace', () => {
    expect(tryParseAmount('  250  ')).toEqual({ ok: true, value: 250n });
  });

  it('treats absent values as zero', () => {
    expect(tryParseAmount(undefined)).toEqual({ ok: true, value: 0n });
    expect(tryParseAmount(null)).toEqual({ ok: true, value: 0n });
    expect(tryParseAmount('')).toEqual({ ok: true, value: 0n });
    expect(tryParseAmount('   ')).toEqual({ ok: true, value: 0n });
  });

  // #203 — the core failure mode. This value is NOT representable as a
  // double; parseInt would silently round it to 9007199254740996.
  it('parses amounts beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const huge = '9007199254740993000000';
    const result = tryParseAmount(huge);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; value: bigint }).value).toBe(9007199254740993000000n);
    // The whole point: it does NOT equal the lossy double.
    expect((result as { ok: true; value: bigint }).value.toString()).not.toBe(
      String(Number(huge))
    );
  });

  it('rejects non-numeric strings instead of coercing them', () => {
    // parseInt('1,000') === 1, parseInt('12abc') === 12 — both wrong.
    expect(tryParseAmount('1,000').ok).toBe(false);
    expect(tryParseAmount('12abc').ok).toBe(false);
    expect(tryParseAmount('abc').ok).toBe(false);
    expect(tryParseAmount('1.5').ok).toBe(false);
    expect(tryParseAmount('1e6').ok).toBe(false);
    expect(tryParseAmount('NaN').ok).toBe(false);
    expect(tryParseAmount('Infinity').ok).toBe(false);
  });

  it('explains why a value was rejected', () => {
    const result = tryParseAmount('12abc');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain('12abc');
  });

  it('rejects unsafe numbers but accepts safe ones', () => {
    expect(tryParseAmount(42)).toEqual({ ok: true, value: 42n });
    expect(tryParseAmount(1.5).ok).toBe(false);
    expect(tryParseAmount(Number.NaN).ok).toBe(false);
    expect(tryParseAmount(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(tryParseAmount(Number.MAX_SAFE_INTEGER + 2).ok).toBe(false);
  });

  it('passes bigints through unchanged', () => {
    expect(tryParseAmount(7n)).toEqual({ ok: true, value: 7n });
  });

  it('rejects objects', () => {
    expect(tryParseAmount({}).ok).toBe(false);
  });
});

describe('parseAmount', () => {
  it('falls back to zero rather than NaN', () => {
    expect(parseAmount('abc')).toBe(0n);
    expect(parseAmount(undefined)).toBe(0n);
  });

  it('never produces NaN for any input', () => {
    for (const input of ['abc', '', undefined, null, {}, NaN, Infinity, '1.5']) {
      expect(typeof parseAmount(input)).toBe('bigint');
    }
  });
});

describe('sumAmounts', () => {
  it('sums valid amounts without precision loss', () => {
    const result = sumAmounts(['9007199254740993', '9007199254740993']);
    expect(result.total).toBe(18014398509481986n);
    expect(result.invalid).toBe(0);
  });

  it('counts invalid entries instead of propagating NaN', () => {
    const result = sumAmounts(['100', 'abc', '200', '1,000', '3']);
    expect(result.total).toBe(303n);
    expect(result.invalid).toBe(2);
  });

  it('handles an empty list', () => {
    expect(sumAmounts([])).toEqual({ total: 0n, invalid: 0 });
  });
});

describe('formatAmount', () => {
  it('formats small amounts without compact notation when asked', () => {
    expect(formatAmount(1234n, { compact: false })).toBe('1,234');
  });

  it('formats large amounts without losing digits', () => {
    // Compact notation rounds for display; the point is that it does not
    // render the wrong order of magnitude.
    const formatted = formatAmount(9007199254740993000000n);
    expect(formatted).toMatch(/[KMBT]/);
  });

  it('formats zero', () => {
    expect(formatAmount(0n, { compact: false })).toBe('0');
  });

  it('accepts a bigint beyond the safe integer range', () => {
    expect(() => formatAmount(10n ** 30n)).not.toThrow();
  });
});

describe('percentageOf', () => {
  it('computes a whole percentage', () => {
    expect(percentageOf(25n, 100n)).toBe(25);
  });

  it('rounds half-up', () => {
    expect(percentageOf(1n, 3n)).toBe(33);
    expect(percentageOf(2n, 3n)).toBe(67);
  });

  it('returns zero instead of NaN for a zero denominator', () => {
    expect(percentageOf(10n, 0n)).toBe(0);
    expect(percentageOf(0n, 0n)).toBe(0);
  });

  it('clamps to 100 when part exceeds whole', () => {
    expect(percentageOf(150n, 100n)).toBe(100);
  });

  it('clamps to 0 for negative parts', () => {
    expect(percentageOf(-10n, 100n)).toBe(0);
  });

  it('does not lose precision on large totals', () => {
    expect(percentageOf(1n, 9007199254740993n)).toBe(0);
    expect(percentageOf(9007199254740993n, 9007199254740993n)).toBe(100);
  });
});