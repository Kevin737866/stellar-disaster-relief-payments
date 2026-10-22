/**
 * Validation for fund expiry timestamps.
 *
 * #200 — the deployer was calling `new Date(value).getTime()` straight on the
 * `datetime-local` input and handing the result to the contract. That has two
 * failure modes worth naming, because both reach the chain:
 *
 * 1. **Invalid input yields `NaN`.** `new Date('not-a-date').getTime()` is
 *    `NaN`, and `NaN` marshalled through `nativeToScVal` becomes a garbage
 *    `u64` rather than throwing. The fund is created with an expiry nobody can
 *    reason about, and the UI shows "Invalid Date".
 * 2. **Out-of-range values are silently accepted.** A year-9999 expiry, or one
 *    already in the past, produces a perfectly valid timestamp that no
 *    responder would have intended.
 *
 * Both are caught here before anything is submitted.
 */

/**
 * Upper bound on how far ahead a fund may expire: 10 years.
 *
 * Relief funds are scoped to a response, which is weeks to months. Ten years
 * is far beyond any plausible operational horizon and exists purely to catch
 * fat-fingered year entries, not to constrain legitimate use.
 */
export const MAX_EXPIRY_YEARS = 10;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export type ExpiryParse =
  | { ok: true; timestamp: number }
  | { ok: false; reason: string };

/**
 * Parse and validate a `datetime-local` input into a millisecond timestamp.
 *
 * Checks, in order: non-empty, actually a date, in the future, and within
 * {@link MAX_EXPIRY_YEARS}. Returns the reason rather than throwing so the
 * form can show it inline and keep the operator's input.
 *
 * @param value   Raw `datetime-local` value, e.g. `"2026-01-31T09:00"`.
 * @param now     Injected clock, for tests. Defaults to `Date.now()`.
 */
export function parseExpiryInput(value: string, now: number = Date.now()): ExpiryParse {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: 'Expiry is required.' };
  }

  const timestamp = new Date(value.trim()).getTime();

  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'Expiry is not a valid date and time.' };
  }

  if (timestamp <= now) {
    return { ok: false, reason: 'Expiry must be in the future.' };
  }

  const maxTimestamp = now + MAX_EXPIRY_YEARS * MS_PER_YEAR;
  if (timestamp > maxTimestamp) {
    return { ok: false, reason: `Expiry must be within ${MAX_EXPIRY_YEARS} years.` };
  }

  return { ok: true, timestamp };
}