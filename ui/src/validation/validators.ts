/**
 * Core validation functions for the Stellar Disaster Relief platform.
 * Each validator returns null on success or an error message string on failure.
 */

export type Validator<T = string> = (value: T) => string | null;

// ─── Primitives ────────────────────────────────────────────────────────────────

export const required = (label = 'This field'): Validator => (value) => {
  if (value === null || value === undefined) return `${label} is required.`;
  if (typeof value === 'string' && value.trim() === '') return `${label} is required.`;
  return null;
};

export const minLength =
  (min: number, label = 'This field'): Validator =>
  (value) => {
    if (!value) return null; // let required() handle empty
    if (value.trim().length < min) return `${label} must be at least ${min} characters.`;
    return null;
  };

export const maxLength =
  (max: number, label = 'This field'): Validator =>
  (value) => {
    if (!value) return null;
    if (value.trim().length > max) return `${label} must be at most ${max} characters.`;
    return null;
  };

export const pattern =
  (regex: RegExp, message: string): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    if (!regex.test(value.trim())) return message;
    return null;
  };

// ─── Numeric ───────────────────────────────────────────────────────────────────

export const isPositiveNumber =
  (label = 'Amount'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    const n = Number(value.trim());
    if (isNaN(n) || !isFinite(n)) return `${label} must be a valid number.`;
    if (n <= 0) return `${label} must be greater than 0.`;
    return null;
  };

export const isInteger =
  (label = 'Value'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    if (!/^-?\d+$/.test(value.trim())) return `${label} must be a whole number.`;
    return null;
  };

export const minValue =
  (min: number, label = 'Value'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    const n = Number(value.trim());
    if (isNaN(n)) return null; // let isPositiveNumber handle
    if (n < min) return `${label} must be at least ${min}.`;
    return null;
  };

export const maxValue =
  (max: number, label = 'Value'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    const n = Number(value.trim());
    if (isNaN(n)) return null;
    if (n > max) return `${label} must be at most ${max}.`;
    return null;
  };

// ─── Domain-specific ───────────────────────────────────────────────────────────

/** Stellar public key: starts with G, 56 alphanumeric chars */
export const stellarAddress: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  const v = value.trim();
  if (!/^G[A-Z2-7]{55}$/.test(v))
    return 'Stellar address must start with G and be 56 characters (A-Z, 2-7).';
  return null;
};

export const DISASTER_TYPES = ['earthquake', 'flood', 'hurricane', 'wildfire', 'drought'] as const;
export type DisasterType = (typeof DISASTER_TYPES)[number];

export const disasterType: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  if (!(DISASTER_TYPES as readonly string[]).includes(value.trim()))
    return `Disaster type must be one of: ${DISASTER_TYPES.join(', ')}.`;
  return null;
};

export const BUSINESS_TYPES = [
  'grocery', 'pharmacy', 'hardware', 'fuel_station',
  'clothing', 'restaurant', 'transport', 'communication',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const businessType: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  if (!(BUSINESS_TYPES as readonly string[]).includes(value.trim()))
    return `Business type must be one of: ${BUSINESS_TYPES.join(', ')}.`;
  return null;
};

export const TOKEN_TYPES = ['XLM', 'USDC', 'EURT'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export const tokenType: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  if (!(TOKEN_TYPES as readonly string[]).includes(value.trim()))
    return `Token must be one of: ${TOKEN_TYPES.join(', ')}.`;
  return null;
};

/** Identifier: alphanumeric, underscores, hyphens, 1-64 chars */
export const identifier =
  (label = 'ID'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value.trim()))
      return `${label} must be 1-64 characters (letters, numbers, underscores, hyphens).`;
    return null;
  };

/** Future datetime: value must be a datetime-local string in the future */
export const futureDate =
  (label = 'Date'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    const ts = new Date(value.trim()).getTime();
    if (isNaN(ts)) return `${label} must be a valid date.`;
    if (ts <= Date.now()) return `${label} must be in the future.`;
    return null;
  };

/** Latitude: -90 to 90 */
export const latitude: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  const n = Number(value.trim());
  if (isNaN(n)) return 'Latitude must be a valid number.';
  if (n < -90 || n > 90) return 'Latitude must be between -90 and 90.';
  return null;
};

/** Longitude: -180 to 180 */
export const longitude: Validator = (value) => {
  if (!value || value.trim() === '') return null;
  const n = Number(value.trim());
  if (isNaN(n)) return 'Longitude must be a valid number.';
  if (n < -180 || n > 180) return 'Longitude must be between -180 and 180.';
  return null;
};

/** Comma-separated list: at least one non-empty item */
export const commaSeparatedRequired =
  (label = 'Field'): Validator =>
  (value) => {
    if (!value || value.trim() === '') return null;
    const items = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) return `${label} must contain at least one value.`;
    return null;
  };

// ─── Composer ──────────────────────────────────────────────────────────────────

/** Run validators in order, return first error or null */
export const compose =
  <T = string>(...validators: Validator<T>[]): Validator<T> =>
  (value) => {
    for (const v of validators) {
      const err = v(value);
      if (err) return err;
    }
    return null;
  };
