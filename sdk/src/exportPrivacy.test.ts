import {
  exportData,
  selectExportFields,
  ExportAuthorization,
  ExportField,
} from '../../ui/src/export/exportUtils';

type Beneficiary = { id: string; district: string; fullName: string; phone: string; medicalNotes: string };

const fields: ExportField<Beneficiary>[] = [
  { key: 'id', label: 'ID', classification: 'operational', value: row => row.id },
  { key: 'district', label: 'District', classification: 'public', value: row => row.district },
  { key: 'fullName', label: 'Name', classification: 'personal', value: row => row.fullName },
  { key: 'phone', label: 'Phone', classification: 'personal', value: row => row.phone },
  { key: 'medicalNotes', label: 'Medical notes', classification: 'sensitive', value: row => row.medicalNotes },
];

const authorization = (overrides: Partial<ExportAuthorization> = {}): ExportAuthorization => ({
  actorId: 'auditor-17',
  role: 'auditor',
  canExport: true,
  consentVerified: true,
  consentReference: 'consent-record-2026-01',
  auditExport: jest.fn(),
  ...overrides,
});

describe('privacy-aware exports', () => {
  it('exports only public and operational fields by default', () => {
    const selected = selectExportFields(fields, false, authorization());
    expect(selected.map(field => field.key)).toEqual(['id', 'district']);
  });

  it('requires verified consent and an eligible role for personal fields', () => {
    expect(selectExportFields(fields, true, authorization()).map(field => field.key))
      .toEqual(['id', 'district', 'fullName', 'phone']);
    expect(selectExportFields(fields, true, authorization({ consentVerified: false })).map(field => field.key))
      .toEqual(['id', 'district']);
    expect(selectExportFields(fields, true, authorization({ role: 'ngo' })).map(field => field.key))
      .toEqual(['id', 'district']);
  });

  it('never exports sensitive fields', () => {
    expect(selectExportFields(fields, true, authorization()).some(field => field.key === 'medicalNotes'))
      .toBe(false);
  });

  it('blocks unauthorized exports and does not audit them as successful', async () => {
    const auditExport = jest.fn();
    await expect(exportData([], fields, 'csv', 'beneficiaries', authorization({
      canExport: false,
      auditExport,
    }))).rejects.toThrow('not authorized');
    expect(auditExport).not.toHaveBeenCalled();
  });

  it('writes an audit event before export generation', async () => {
    const auditExport = jest.fn();
    await exportData([], fields, 'json', 'beneficiaries', authorization({ auditExport }));
    expect(auditExport).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'auditor-17',
      role: 'auditor',
      format: 'json',
      rowCount: 0,
      exportedFields: ['id', 'district'],
    }));
  });
});
