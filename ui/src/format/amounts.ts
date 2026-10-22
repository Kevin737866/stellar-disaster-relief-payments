/**
 * BigInt-safe parsing and formatting for on-chain monetary amounts.
 *
 * Amounts cross the wire from Soroban contracts as decimal *strings* (see
 * `sdk/src/types.ts`). Two properties of that representation make `parseInt`
 * and `Number()` the wrong tool for them:
 *
 * 1. **Precision.** A disbursement total can exceed `Number.MAX_SAFE_INTEGER`
 *    (2^53 - 1). `parseInt` silently rounds anything past that, so a large
 *    fund total renders as a plausible-looking but wrong number. This is the
 *    worst kind of bug in a relief dashboard: it looks correct.
 * 2. **Garbage tolerance.** `parseInt('1,000')` is `1` and `parseInt('abc')` is
 *    `NaN`, and `NaN` propagates through a `reduce()` sum and poisons every
 *    later figure, not just the bad row.
 *
 * Everything here works in `bigint` so neither failure mode is reachable.
 */

/** Result of parsing an amount, distinguishing "zero" from "unparseable". */
export type AmountParse =
  | { ok: true; value: bigint }
  | { ok: false; reason: string };

/**
 * Strict integer form. Deliberately rejects `"12abc"`, `"1.5"`, `"1e6"`,
 * `" 12 "` (leading/trailing whitespace is trimmed first, so that is fine),
 * `"0x10"` and every other JavaScript `parseInt` leniency.
 */
const INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Parse an on-chain amount without throwing.
 *
 * Unlike `parseInt`, this never returns `NaN` and never rounds: anything that
 * is not a plain integer is reported as a failure so the caller can decide
 * how to surface it.
 *
 * An absent value (`undefined`, `null`, empty/whitespace-only string) is
 * treated as `0n` rather than an error — a fund that has never released
 * anything legitimately reports no released amount.
 */
export function tryParseAmount(raw: unknown): AmountParse {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 0n };
  }

  if (typeof raw === 'bigint') {
    return { ok: true, value: raw };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { ok: false, reason: `amount "${raw}" is not a finite number` };
    }
    if (!Number.isSafeInteger(raw)) {
      return {
        ok: false,
        reason: `amount "${raw}" exceeds the safe integer range; pass it as a string or bigint`,
      };
    }
    return { ok: true, value: BigInt(raw) };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { ok: true, value: 0n };
    }
    if (!INTEGER_PATTERN.test(trimmed)) {
      return { ok: false, reason: `"${raw}" is not a valid integer amount` };
    }
    return { ok: true, value: BigInt(trimmed) };
  }

  return { ok: false, reason: `amount of type ${typeof raw} is not a string, number or bigint` };
}

/**
 * Parse an on-chain amount, falling back to `0n` when it cannot be read.
 *
 * Use this for totals and roll-ups where one bad row must not take down the
 * whole view. Use {@link tryParseAmount} when the difference matters and you
 * want to tell the operator the data is wrong.
 */
export function parseAmount(raw: unknown): bigint {
  const parsed = tryParseAmount(raw);
  return parsed.ok ? parsed.value : 0n;
}

/** Sums amounts, skipping (and reporting) any element that will not parse. */
export function sumAmounts(values: readonly unknown[]): {
  total: bigint;
  invalid: number;
} {
  let total = 0n;
  let invalid = 0;

  for (const value of values) {
    const parsed = tryParseAmount(value);
    if (parsed.ok) {
      total += parsed.value;
    } else {
      invalid += 1;
    }
  }

  return { total, invalid };
}

export interface FormatAmountOptions {
  /**
   * Abbreviate large values (`1.2M`) instead of writing out every digit.
   * Defaults to `true`, which suits dashboard tiles; set `false` for exact
   * figures in tables or exports.
   */
  compact?: boolean;
  /** Maximum fraction digits. Ignored when `compact` is false. */
  maximumFractionDigits?: number;
}

/**
 * Render an amount for display.
 *
 * `bigint` is passed straight to `Intl.NumberFormat`, so precision is never
 * lost — the formatter reads the exact digits rather than a lossy double.
 */
export function formatAmount(amount: bigint, options: FormatAmountOptions = {}): string {
  const { compact = true, maximumFractionDigits = 1 } = options;

  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? maximumFractionDigits : 0,
  }).format(amount);
}

/**
 * Whole-number percentage of `part` within `whole`, clamped to `0..100`.
 *
 * Done in `bigint` so the ratio cannot overflow: `part * 100n` on a large
 * disbursement total would lose precision as a `number`.
 *
 * Returns `0` when `whole` is zero or negative — an undefined ratio must not
 * render as `NaN%` in the UI.
 */
export function percentageOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) {
    return 0;
  }

  // Scale to 2 decimal places, then round half-up to an integer percent.
  const basisPoints = (part * 10_000n) / whole;
  const rounded = Number((basisPoints + 50n) / 100n);

  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}