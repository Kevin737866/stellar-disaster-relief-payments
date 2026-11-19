/**
 * Tests for fund expiry input validation.
 *
 * #200 — the deployer passed `new Date(value).getTime()` straight to the
 * contract with no guards, so an invalid entry produced NaN on-chain.
 */
import { parseExpiryInput, MAX_EXPIRY_YEARS } from '../validation/expiry';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

describe('parseExpiryInput', () => {
  it('accepts a valid future datetime-local value', () => {
    const result = parseExpiryInput('2026-02-01T09:00', NOW);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; timestamp: number }).timestamp).toBe(
      new Date('2026-02-01T09:00').getTime()
    );
  });

  it('rejects an empty value', () => {
    const result = parseExpiryInput('', NOW);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/required/i);
  });

  it('rejects a whitespace-only value', () => {
    expect(parseExpiryInput('   ', NOW).ok).toBe(false);
  });

  // #200 — the core defect. This used to reach the contract as NaN.
  it('rejects an unparseable date instead of returning NaN', () => {
    const result = parseExpiryInput('not-a-date', NOW);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/not a valid date/i);
  });

  it('never yields a NaN timestamp', () => {
    for (const input of ['not-a-date', '2026-13-45T99:99', 'abc', '']) {
      const result = parseExpiryInput(input, NOW);
      if (result.ok) {
        expect(Number.isFinite((result as { ok: true; timestamp: number }).timestamp)).toBe(true);
      } else {
        expect(result.ok).toBe(false);
      }
    }
  });

  it('rejects a date in the past', () => {
    const result = parseExpiryInput('2026-01-01T09:00', NOW);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/future/i);
  });

  it('rejects a date exactly at now', () => {
    expect(parseExpiryInput('2026-01-15T12:00', NOW).ok).toBe(false);
  });

  // #200 — "clamp to sensible ranges".
  it('rejects an expiry beyond the maximum horizon', () => {
    const far = new Date(NOW + (MAX_EXPIRY_YEARS + 1) * 365.25 * 24 * 60 * 60 * 1000);
    const result = parseExpiryInput(far.toISOString().slice(0, 16), NOW);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/within/i);
  });

  it('accepts an expiry just inside the maximum horizon', () => {
    const near = new Date(NOW + (MAX_EXPIRY_YEARS - 1) * 365.25 * 24 * 60 * 60 * 1000);
    expect(parseExpiryInput(near.toISOString().slice(0, 16), NOW).ok).toBe(true);
  });

  it('returns a human-readable reason for every failure', () => {
    const result = parseExpiryInput('bad', NOW);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason.length).toBeGreaterThan(0);
  });
});