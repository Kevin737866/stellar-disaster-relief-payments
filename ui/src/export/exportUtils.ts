/**
 * Privacy-aware export helpers.
 *
 * Export authorization is supplied by the authenticated application session.
 * The caller must connect auditExport to a trusted server-side audit endpoint;
 * browser-only logging is not a security boundary.
 */
export type ExportFormat = 'csv' | 'json';
export type ExportRole = 'admin' | 'auditor' | 'ngo' | 'government' | 'un';

export type ExportClassification = 'public' | 'operational' | 'personal' | 'sensitive';

export interface ExportField<T> {
  key: string;
  label: string;
  classification: ExportClassification;
  value: (row: T) => string | number | boolean | null;
}

export interface ExportAuthorization {
  actorId: string;
  role: ExportRole;
  canExport: boolean;
  /** Consent must be verified against a trusted consent record, not inferred from this UI. */
  consentVerified: boolean;
  consentReference?: string;
  /** Must persist the audit event server-side before the file is generated. */
  auditExport: (event: {
    actorId: string;
    role: ExportRole;
    format: ExportFormat;
    rowCount: number;
    exportedFields: string[];
    exportedAt: string;
    consentReference?: string;
  }) => void;
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Default exports include only public/operational fields. Personal fields are
 * included only after explicit consent from an admin/auditor. Sensitive fields
 * are never exported by this UI helper.
 */
export function selectExportFields<T>(
  fields: ExportField<T>[],
  includePersonalData: boolean,
  authorization: ExportAuthorization
): ExportField<T>[] {
  if (!authorization.canExport || !authorization.actorId.trim()) {
    throw new Error('You are not authorized to export this data.');
  }
  const mayExportPersonal =
    includePersonalData && authorization.consentVerified && Boolean(authorization.consentReference?.trim()) &&
    (authorization.role === 'admin' || authorization.role === 'auditor');
  return fields.filter(field =>
    field.classification === 'public' ||
    field.classification === 'operational' ||
    (field.classification === 'personal' && mayExportPersonal)
  );
}

export function toCSV<T>(rows: T[], fields: ExportField<T>[]): string {
  const header = fields.map(f => escapeCsvCell(f.label)).join(',');
  const body = rows.map(row => fields.map(f => escapeCsvCell(f.value(row))).join(',')).join('\r\n');
  return header + '\r\n' + body;
}

export function toJSON<T>(rows: T[], fields: ExportField<T>[]): string {
  const mapped = rows.map(row => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) obj[f.key] = f.value(row);
    return obj;
  });
  return JSON.stringify(mapped, null, 2);
}

export function buildFilename(prefix: string, format: ExportFormat): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'export';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  return `${safePrefix}_${ts}.${format}`;
}

export function triggerDownload(content: string, filename: string, format: ExportFormat): void {
  if (typeof document === 'undefined') return;
  const mime = format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json';
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Authorize, minimize, audit, then generate and download an export. */
export function exportData<T>(
  rows: T[],
  fields: ExportField<T>[],
  format: ExportFormat,
  filenamePrefix: string,
  authorization: ExportAuthorization,
  includePersonalData = false
): string {
  const permittedFields = selectExportFields(fields, includePersonalData, authorization);
  if (permittedFields.length === 0) {
    throw new Error('There are no fields permitted for this export.');
  }
  authorization.auditExport({
    actorId: authorization.actorId,
    role: authorization.role,
    format,
    rowCount: rows.length,
    exportedFields: permittedFields.map(field => field.key),
    exportedAt: new Date().toISOString(),
    ...(includePersonalData ? { consentReference: authorization.consentReference } : {}),
  });
  const content = format === 'csv'
    ? toCSV(rows, permittedFields)
    : toJSON(rows, permittedFields);
  const filename = buildFilename(filenamePrefix, format);
  triggerDownload(content, filename, format);
  return filename;
}
