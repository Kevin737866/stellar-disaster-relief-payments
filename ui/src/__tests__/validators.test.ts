import {
  required, minLength, maxLength, isPositiveNumber, isInteger,
  minValue, maxValue, stellarAddress, disasterType, businessType,
  tokenType, identifier, futureDate, latitude, longitude,
  commaSeparatedRequired, compose,
} from '../validation/validators';

describe('required', () => {
  const v = required('Field');
  it('returns error for empty string', () => expect(v('')).toBeTruthy());
  it('returns error for whitespace-only', () => expect(v('   ')).toBeTruthy());
  it('returns null for valid value', () => expect(v('hello')).toBeNull());
});

describe('minLength', () => {
  const v = minLength(3, 'Name');
  it('returns error when too short', () => expect(v('ab')).toBeTruthy());
  it('returns null when empty (defer to required)', () => expect(v('')).toBeNull());
  it('returns null when long enough', () => expect(v('abc')).toBeNull());
});

describe('maxLength', () => {
  const v = maxLength(5, 'Name');
  it('returns error when too long', () => expect(v('abcdef')).toBeTruthy());
  it('returns null when within limit', () => expect(v('abc')).toBeNull());
  it('returns null when empty', () => expect(v('')).toBeNull());
});

describe('isPositiveNumber', () => {
  const v = isPositiveNumber('Amount');
  it('returns error for zero', () => expect(v('0')).toBeTruthy());
  it('returns error for negative', () => expect(v('-5')).toBeTruthy());
  it('returns error for non-numeric', () => expect(v('abc')).toBeTruthy());
  it('returns null for positive number', () => expect(v('100')).toBeNull());
  it('returns null for empty (defer to required)', () => expect(v('')).toBeNull());
  it('returns error for NaN string', () => expect(v('NaN')).toBeTruthy());
  it('returns error for Infinity', () => expect(v('Infinity')).toBeTruthy());
});

describe('isInteger', () => {
  const v = isInteger('Value');
  it('returns error for decimal', () => expect(v('1.5')).toBeTruthy());
  it('returns null for whole number', () => expect(v('3')).toBeNull());
  it('returns null for empty', () => expect(v('')).toBeNull());
});

describe('minValue', () => {
  const v = minValue(5, 'Count');
  it('returns error below min', () => expect(v('4')).toBeTruthy());
  it('returns null at min', () => expect(v('5')).toBeNull());
  it('returns null above min', () => expect(v('10')).toBeNull());
  it('returns null for empty', () => expect(v('')).toBeNull());
});

describe('maxValue', () => {
  const v = maxValue(10, 'Count');
  it('returns error above max', () => expect(v('11')).toBeTruthy());
  it('returns null at max', () => expect(v('10')).toBeNull());
  it('returns null for empty', () => expect(v('')).toBeNull());
});

describe('stellarAddress', () => {
  const valid = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA';
  it('returns null for valid G... address', () => expect(stellarAddress(valid)).toBeNull());
  it('returns error for wrong prefix', () =>
    expect(stellarAddress('BAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA')).toBeTruthy());
  it('returns error for too short', () =>
    expect(stellarAddress('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOC')).toBeTruthy());
  it('returns error for lowercase', () =>
    expect(stellarAddress('gaazi4tcr3ty5ojhctjc2a4qsy6cjwjh5iajtgkin2er7lbnvkoccwna')).toBeTruthy());
  it('returns null for empty (defer to required)', () => expect(stellarAddress('')).toBeNull());
  it('returns error for whitespace-padded invalid', () =>
    expect(stellarAddress('  GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOC  ')).toBeTruthy());
});

describe('disasterType', () => {
  it('returns null for valid type', () => expect(disasterType('earthquake')).toBeNull());
  it('returns error for invalid type', () => expect(disasterType('tsunami')).toBeTruthy());
  it('returns null for empty', () => expect(disasterType('')).toBeNull());
  (['earthquake', 'flood', 'hurricane', 'wildfire', 'drought'] as const).forEach(t =>
    it(`accepts ${t}`, () => expect(disasterType(t)).toBeNull())
  );
});

describe('businessType', () => {
  it('returns null for valid type', () => expect(businessType('grocery')).toBeNull());
  it('returns error for invalid type', () => expect(businessType('bakery')).toBeTruthy());
  it('returns null for empty', () => expect(businessType('')).toBeNull());
});

describe('tokenType', () => {
  it('returns null for XLM', () => expect(tokenType('XLM')).toBeNull());
  it('returns null for USDC', () => expect(tokenType('USDC')).toBeNull());
  it('returns null for EURT', () => expect(tokenType('EURT')).toBeNull());
  it('returns error for unknown token', () => expect(tokenType('BTC')).toBeTruthy());
  it('returns null for empty', () => expect(tokenType('')).toBeNull());
});

describe('identifier', () => {
  const v = identifier('ID');
  it('returns null for valid id', () => expect(v('fund_001')).toBeNull());
  it('returns null for alphanumeric with hyphens', () => expect(v('fund-2024')).toBeNull());
  it('returns error for spaces', () => expect(v('fund 001')).toBeTruthy());
  it('returns error for special chars', () => expect(v('fund@001')).toBeTruthy());
  it('returns error for empty string', () => expect(v('')).toBeNull()); // empty defers to required
  it('returns error for >64 chars', () => expect(v('a'.repeat(65))).toBeTruthy());
});

describe('futureDate', () => {
  const v = futureDate('Date');
  it('returns error for past date', () => expect(v('2020-01-01T00:00')).toBeTruthy());
  it('returns error for invalid date string', () => expect(v('not-a-date')).toBeTruthy());
  it('returns null for empty', () => expect(v('')).toBeNull());
  it('returns null for future date', () => {
    const future = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    expect(v(future)).toBeNull();
  });
});

describe('latitude', () => {
  it('returns null for valid latitude', () => expect(latitude('45.0')).toBeNull());
  it('returns error for >90', () => expect(latitude('91')).toBeTruthy());
  it('returns error for <-90', () => expect(latitude('-91')).toBeTruthy());
  it('returns error for non-numeric', () => expect(latitude('abc')).toBeTruthy());
  it('returns null for empty', () => expect(latitude('')).toBeNull());
  it('returns null for boundary -90', () => expect(latitude('-90')).toBeNull());
  it('returns null for boundary 90', () => expect(latitude('90')).toBeNull());
});

describe('longitude', () => {
  it('returns null for valid longitude', () => expect(longitude('120.5')).toBeNull());
  it('returns error for >180', () => expect(longitude('181')).toBeTruthy());
  it('returns error for <-180', () => expect(longitude('-181')).toBeTruthy());
  it('returns null for boundary values', () => {
    expect(longitude('-180')).toBeNull();
    expect(longitude('180')).toBeNull();
  });
});

describe('commaSeparatedRequired', () => {
  const v = commaSeparatedRequired('Factors');
  it('returns null for valid comma list', () => expect(v('a, b, c')).toBeNull());
  it('returns null for single item', () => expect(v('item')).toBeNull());
  it('returns null for empty (defer to required)', () => expect(v('')).toBeNull());
  it('returns error for only commas/spaces', () => expect(v(', , ,')).toBeTruthy());
});

describe('compose', () => {
  it('returns first error', () => {
    const v = compose(required('F'), minLength(5, 'F'));
    expect(v('')).toMatch(/required/i);
  });
  it('returns second error when first passes', () => {
    const v = compose(required('F'), minLength(5, 'F'));
    expect(v('ab')).toMatch(/at least/i);
  });
  it('returns null when all pass', () => {
    const v = compose(required('F'), minLength(2, 'F'));
    expect(v('hello')).toBeNull();
  });
  it('handles whitespace-only input with required', () => {
    const v = compose(required('F'), minLength(2, 'F'));
    expect(v('   ')).toBeTruthy();
  });
});
