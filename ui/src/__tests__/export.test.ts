import {
  escapeCsvCell, toCSV, toJSON, buildFilename, formatTimestamp, exportData,
  ExportField, ExportFormat,
} from '../export/exportUtils';
import {
  conditionalTransferFields, transferTransactionFields,
  disbursementFields, emergencyFundFields, merchantFields,
} from '../export/exportFields';
import { ConditionalTransfer, TransferTransaction, DisbursementRecord, EmergencyFund, Merchant } from '../../../sdk/src/types';

// ─── formatTimestamp ──────────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns ISO-8601 UTC string', () => {
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });
  it('is timezone-safe (always UTC)', () => {
    const ts = Date.UTC(2024, 0, 15, 12, 30, 0);
    expect(formatTimestamp(ts)).toBe('2024-01-15T12:30:00.000Z');
  });
});

// ─── escapeCsvCell ────────────────────────────────────────────────────────────

describe('escapeCsvCell', () => {
  it('returns empty string for null', () => expect(escapeCsvCell(null)).toBe(''));
  it('returns empty string for undefined', () => expect(escapeCsvCell(undefined)).toBe(''));
  it('passes through plain strings', () => expect(escapeCsvCell('hello')).toBe('hello'));
  it('wraps in quotes when comma present', () => expect(escapeCsvCell('a,b')).toBe('"a,b"'));
  it('escapes internal quotes by doubling', () => expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""'));
  it('wraps when newline present', () => expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"'));
  it('wraps when carriage return present', () => expect(escapeCsvCell('a\rb')).toBe('"a\rb"'));
  it('wraps when leading space', () => expect(escapeCsvCell(' value')).toBe('" value"'));
  it('wraps when trailing space', () => expect(escapeCsvCell('value ')).toBe('"value "'));
  it('handles boolean true', () => expect(escapeCsvCell(true)).toBe('true'));
  it('handles number', () => expect(escapeCsvCell(42)).toBe('42'));
  it('handles Unicode', () => expect(escapeCsvCell('café')).toBe('café'));
  it('handles emoji', () => expect(escapeCsvCell('🌍')).toBe('🌍'));
});

// ─── toCSV ────────────────────────────────────────────────────────────────────

const simpleFields: ExportField<{ id: string; amount: string }>[] = [
  { key: 'id', label: 'ID', value: r => r.id },
  { key: 'amount', label: 'Amount', value: r => r.amount },
];

describe('toCSV', () => {
  it('produces header row', () => {
    const csv = toCSV([], simpleFields);
    expect(csv.split('\r\n')[0]).toBe('ID,Amount');
  });

  it('produces correct data rows', () => {
    const rows = [{ id: 'T1', amount: '100' }, { id: 'T2', amount: '200' }];
    const lines = toCSV(rows, simpleFields).split('\r\n');
    expect(lines[1]).toBe('T1,100');
    expect(lines[2]).toBe('T2,200');
  });

  it('handles empty dataset (header only)', () => {
    const csv = toCSV([], simpleFields);
    expect(csv).toBe('ID,Amount\r\n');
  });

  it('escapes special characters in cells', () => {
    const rows = [{ id: 'T,1', amount: '"500"' }];
    const csv = toCSV(rows, simpleFields);
    expect(csv).toContain('"T,1"');
    expect(csv).toContain('"""500"""');
  });

  it('uses CRLF line endings (RFC 4180)', () => {
    const rows = [{ id: 'A', amount: '1' }];
    expect(toCSV(rows, simpleFields)).toContain('\r\n');
  });

  it('handles large dataset without error', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => ({ id: `T${i}`, amount: String(i) }));
    const csv = toCSV(rows, simpleFields);
    expect(csv.split('\r\n').length).toBe(10001); // header + 10000 rows
  });

  it('handles Unicode in values', () => {
    const rows = [{ id: 'T1', amount: 'café €100' }];
    expect(toCSV(rows, simpleFields)).toContain('café €100');
  });
});

// ─── toJSON ───────────────────────────────────────────────────────────────────

describe('toJSON', () => {
  it('produces valid JSON array', () => {
    const rows = [{ id: 'T1', amount: '100' }];
    const parsed = JSON.parse(toJSON(rows, simpleFields));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ id: 'T1', amount: '100' });
  });

  it('uses field keys (not labels) as JSON keys', () => {
    const parsed = JSON.parse(toJSON([{ id: 'X', amount: '5' }], simpleFields));
    expect(Object.keys(parsed[0])).toEqual(['id', 'amount']);
  });

  it('returns empty array for empty dataset', () => {
    expect(JSON.parse(toJSON([], simpleFields))).toEqual([]);
  });

  it('preserves field ordering', () => {
    const parsed = JSON.parse(toJSON([{ id: 'A', amount: '1' }], simpleFields));
    expect(Object.keys(parsed[0])).toEqual(['id', 'amount']);
  });

  it('handles Unicode', () => {
    const rows = [{ id: '🌍', amount: 'café' }];
    const parsed = JSON.parse(toJSON(rows, simpleFields));
    expect(parsed[0].id).toBe('🌍');
    expect(parsed[0].amount).toBe('café');
  });

  it('handles null values', () => {
    const fields: ExportField<{ id: string; amount: string }>[] = [
      { key: 'id', label: 'ID', value: r => r.id },
      { key: 'amount', label: 'Amount', value: () => null },
    ];
    const parsed = JSON.parse(toJSON([{ id: 'T1', amount: '' }], fields));
    expect(parsed[0].amount).toBeNull();
  });
});

// ─── buildFilename ────────────────────────────────────────────────────────────

describe('buildFilename', () => {
  it('includes prefix', () => expect(buildFilename('transfers', 'csv')).toMatch(/^transfers_/));
  it('ends with correct extension', () => {
    expect(buildFilename('transfers', 'csv')).toMatch(/\.csv$/);
    expect(buildFilename('transfers', 'json')).toMatch(/\.json$/);
  });
  it('includes UTC marker', () => expect(buildFilename('x', 'csv')).toMatch(/Z\.csv$/));
  it('produces filesystem-safe name (no colons)', () => {
    expect(buildFilename('x', 'csv')).not.toContain(':');
  });
  it('is deterministic within same second', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-15T12:30:00Z'));
    expect(buildFilename('transfers', 'csv')).toBe('transfers_2024-01-15T12-30-00Z.csv');
    jest.useRealTimers();
  });
});

// ─── exportData (no-DOM environment) ─────────────────────────────────────────

describe('exportData', () => {
  it('returns the generated filename', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-06-01T00:00:00Z'));
    const rows = [{ id: 'T1', amount: '100' }];
    const filename = exportData(rows, simpleFields, 'csv', 'transfers');
    expect(filename).toBe('transfers_2024-06-01T00-00-00Z.csv');
    jest.useRealTimers();
  });

  it('does not throw in non-browser environment', () => {
    expect(() => exportData([], simpleFields, 'json', 'test')).not.toThrow();
  });
});

// ─── Field definitions ────────────────────────────────────────────────────────

const mockTransfer: ConditionalTransfer = {
  id: 'CT_001', beneficiaryId: 'B_001', creator: 'ADMIN',
  amount: '1000', token: 'XLM', spentAmount: '200', remainingAmount: '800',
  purpose: 'Emergency food', isActive: true,
  createdAt: Date.UTC(2024, 0, 1), expiresAt: Date.UTC(2024, 3, 1),
  spendingRules: [],
};

describe('conditionalTransferFields', () => {
  it('maps all required fields', () => {
    const csv = toCSV([mockTransfer], conditionalTransferFields);
    expect(csv).toContain('CT_001');
    expect(csv).toContain('B_001');
    expect(csv).toContain('1000');
    expect(csv).toContain('XLM');
    expect(csv).toContain('Emergency food');
    expect(csv).toContain('2024-01-01T00:00:00.000Z');
  });
  it('has correct header labels', () => {
    const header = toCSV([mockTransfer], conditionalTransferFields).split('\r\n')[0];
    expect(header).toContain('Transfer ID');
    expect(header).toContain('Beneficiary ID');
    expect(header).toContain('Token');
  });
});

const mockTxn: TransferTransaction = {
  id: 'TXN_001', transferId: 'CT_001', merchantId: 'M_001',
  amount: '50', category: 'food', location: 'Santo Domingo',
  isApproved: true, rejectionReason: '',
  timestamp: Date.UTC(2024, 0, 15),
};

describe('transferTransactionFields', () => {
  it('maps all required fields', () => {
    const csv = toCSV([mockTxn], transferTransactionFields);
    expect(csv).toContain('TXN_001');
    expect(csv).toContain('M_001');
    expect(csv).toContain('food');
    expect(csv).toContain('Santo Domingo');
    expect(csv).toContain('2024-01-15T00:00:00.000Z');
  });
});

const mockDisbursement: DisbursementRecord = {
  id: 'D_001', fundId: 'F_001', beneficiary: 'B_001',
  amount: '500', purpose: 'Medical supplies',
  approvedBy: ['ADMIN', 'NGO'], transactionHash: 'abc123',
  timestamp: Date.UTC(2024, 1, 1),
};

describe('disbursementFields', () => {
  it('maps all required fields', () => {
    const csv = toCSV([mockDisbursement], disbursementFields);
    expect(csv).toContain('D_001');
    expect(csv).toContain('F_001');
    expect(csv).toContain('Medical supplies');
    expect(csv).toContain('abc123');
  });
  it('joins approvedBy array with semicolon', () => {
    const csv = toCSV([mockDisbursement], disbursementFields);
    expect(csv).toContain('ADMIN; NGO');
  });
});

const mockFund: EmergencyFund = {
  id: 'F_001', name: 'Haiti Relief', description: 'Earthquake response',
  totalAmount: '1000000', releasedAmount: '200000',
  disasterType: 'earthquake', geographicScope: 'Port-au-Prince',
  isActive: true, releaseTriggers: [], requiredSignatures: 2,
  createdAt: Date.UTC(2024, 0, 1), expiresAt: Date.UTC(2024, 6, 1),
};

describe('emergencyFundFields', () => {
  it('maps all required fields', () => {
    const csv = toCSV([mockFund], emergencyFundFields);
    expect(csv).toContain('F_001');
    expect(csv).toContain('Haiti Relief');
    expect(csv).toContain('earthquake');
    expect(csv).toContain('1000000');
    expect(csv).toContain('2024-01-01T00:00:00.000Z');
  });
});

const mockMerchant: Merchant = {
  id: 'M_001', name: 'Corner Store', owner: 'OWNER_KEY',
  businessType: 'grocery', contactInfo: '+1-555-0100',
  registrationDate: Date.UTC(2024, 0, 1),
  isVerified: true, isActive: true, reputationScore: 85,
  acceptedTokens: ['XLM', 'USDC'], dailyLimit: '1000', monthlyLimit: '10000',
  currentMonthVolume: '3000', verificationDocuments: [], stellarTomlUrl: '',
  location: { latitude: 18.5, longitude: -72.3, address: '123 Main St', city: 'Port-au-Prince', country: 'Haiti', postalCode: 'HT6110' },
};

describe('merchantFields', () => {
  it('maps all required fields', () => {
    const csv = toCSV([mockMerchant], merchantFields);
    expect(csv).toContain('M_001');
    expect(csv).toContain('Corner Store');
    expect(csv).toContain('grocery');
    expect(csv).toContain('Port-au-Prince');
    expect(csv).toContain('Haiti');
  });
  it('joins acceptedTokens with semicolon', () => {
    const csv = toCSV([mockMerchant], merchantFields);
    expect(csv).toContain('XLM; USDC');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles special characters in purpose field', () => {
    const t = { ...mockTransfer, purpose: 'Food, water & "shelter"' };
    const csv = toCSV([t], conditionalTransferFields);
    expect(csv).toContain('"Food, water & ""shelter"""');
  });

  it('JSON export handles special characters correctly', () => {
    const t = { ...mockTransfer, purpose: 'Food, water & "shelter"' };
    const parsed = JSON.parse(toJSON([t], conditionalTransferFields));
    expect(parsed[0].purpose).toBe('Food, water & "shelter"');
  });

  it('empty rows produce header-only CSV', () => {
    const csv = toCSV([], conditionalTransferFields);
    expect(csv.split('\r\n').length).toBe(2); // header + empty line
    expect(csv.split('\r\n')[1]).toBe('');
  });

  it('empty rows produce empty JSON array', () => {
    expect(JSON.parse(toJSON([], conditionalTransferFields))).toEqual([]);
  });
});
