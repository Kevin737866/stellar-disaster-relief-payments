/**
 * Tests for the TOML parser used by discoverMerchantsFromStellarToml.
 *
 * The parser must handle the constructs found in real stellar.toml files:
 * array-of-tables (`[[MERCHANTS]]`), comments, quoted strings, arrays,
 * numbers, and booleans. Discovered merchant records are validated — entries
 * without a name are skipped.
 */

import { parseTomlTables } from './merchantClient';

const REALISTIC_TOML = `# Sample stellar.toml with merchant entries
VERSION = "2.0"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

[DOCUMENTATION]
ORG_NAME = "Relief Org"
ORG_URL = "https://relief.example"

[[MERCHANTS]]
name = "Maria's Market"
business_type = "grocery"
owner = "GD1234567890"
contact_info = "maria@market.example"
latitude = 18.4861
longitude = -69.9312
address = "Av. Bolivar 45"
city = "Santo Domingo"
country = "DO"
postal_code = "10210"
accepted_tokens = ["XLM", "USDC"]
daily_limit = "5000"
monthly_limit = "50000"

[[MERCHANTS]]
name = "Pedro's Pharmacy"
business_type = "pharmacy"
owner = "GD9876543210"
contact_info = "pedro@pharmacy.example"
latitude = 19.0
longitude = -70.5
city = "Santiago"
country = "DO"
accepted_tokens = ["USDC"]
daily_limit = "3000"
monthly_limit = "30000"

[[MERCHANTS]]
# Entry without a name — should be skipped
business_type = "unknown"
`;

describe('parseTomlTables', () => {
  test('parses array-of-tables sections', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants).toHaveLength(3);
  });

  test('parses top-level key-value pairs', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const top = tables.find(([name]) => name === '');
    expect(top).toBeDefined();
    expect(top![1]['VERSION']).toBe('2.0');
    expect(top![1]['NETWORK_PASSPHRASE']).toBe('Test SDF Network ; September 2015');
  });

  test('parses [DOCUMENTATION] section', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const doc = tables.find(([name]) => name === 'DOCUMENTATION');
    expect(doc).toBeDefined();
    expect(doc![1]['ORG_NAME']).toBe('Relief Org');
  });

  test('parses double-quoted strings with comments on the same line', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe("Maria's Market");
    expect(merchants[1][1]['name']).toBe("Pedro's Pharmacy");
  });

  test('parses single-quoted strings', () => {
    const toml = `[[MERCHANTS]]
name = 'Literal Name'
business_type = 'general'
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe('Literal Name');
  });

  test('parses arrays of strings', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['accepted_tokens']).toEqual(['XLM', 'USDC']);
    expect(merchants[1][1]['accepted_tokens']).toEqual(['USDC']);
  });

  test('parses numbers (floats and integers)', () => {
    const tables = parseTomlTables(REALISTIC_TOML);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['latitude']).toBe(18.4861);
    expect(merchants[0][1]['longitude']).toBe(-69.9312);
    expect(merchants[1][1]['latitude']).toBe(19.0);
  });

  test('handles empty array', () => {
    const toml = `[[MERCHANTS]]
name = "Test"
accepted_tokens = []
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['accepted_tokens']).toEqual([]);
  });

  test('skips blank lines and comments', () => {
    const toml = `# This is a comment

# Another comment

[[MERCHANTS]]
# Comment before key
name = "Test"  # Inline comment
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe('Test');
  });

  test('handles = inside quoted string values', () => {
    const toml = `[[MERCHANTS]]
name = "Shop = Equal Sign"
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe('Shop = Equal Sign');
  });

  test('returns empty array for empty input', () => {
    const tables = parseTomlTables('');
    expect(tables).toHaveLength(0);
  });

  test('returns empty array for input with only comments', () => {
    const tables = parseTomlTables('# just a comment\n# another\n');
    expect(tables).toHaveLength(0);
  });

  test('handles booleans', () => {
    const toml = `[[MERCHANTS]]
name = "Test"
is_active = true
is_verified = false
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['is_active']).toBe(true);
    expect(merchants[0][1]['is_verified']).toBe(false);
  });

  test('handles escaped quotes in double-quoted strings', () => {
    const toml = `[[MERCHANTS]]
name = "Say \\"Hello\\" Shop"
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe('Say "Hello" Shop');
  });

  test('does not strip # inside quoted strings as comments', () => {
    const toml = `[[MERCHANTS]]
name = "Shop #1 Best"
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants[0][1]['name']).toBe('Shop #1 Best');
  });

  test('parses multiple sections in order', () => {
    const toml = `[DOCUMENTATION]
ORG_NAME = "Test"

[[CURRENCIES]]
code = "USDC"
issuer = "G..."

[[MERCHANTS]]
name = "Merchant A"

[[MERCHANTS]]
name = "Merchant B"
`;
    const tables = parseTomlTables(toml);
    const merchants = tables.filter(([name]) => name === 'MERCHANTS');
    expect(merchants).toHaveLength(2);
    expect(merchants[0][1]['name']).toBe('Merchant A');
    expect(merchants[1][1]['name']).toBe('Merchant B');
  });
});
