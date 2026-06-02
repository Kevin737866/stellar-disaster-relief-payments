/**
 * Core export utilities for transaction history.
 * Pure functions — no DOM side-effects except triggerDownload().
 */

export type ExportFormat = 'csv' | 'json';

export interface ExportField<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | boolean | null;
}

/** Format a Unix ms timestamp as ISO-8601 UTC string (timezone-safe). */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** Escape a single CSV cell value per RFC 4180. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if contains comma, quote, newline, or leading/trailing space
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** Convert an array of records to a CSV string using the provided field definitions. */
export function toCSV<T>(rows: T[], fields: ExportField<T>[]): string {
  const header = fields.map(f => escapeCsvCell(f.label)).join(',');
  const body = rows
    .map(row => fields.map(f => escapeCsvCell(f.value(row))).join(','))
    .join('\r\n');
  return header + '\r\n' + body;
}

/** Convert an array of records to a pretty-printed JSON string. */
export function toJSON<T>(rows: T[], fields: ExportField<T>[]): string {
  const mapped = rows.map(row => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) obj[f.key] = f.value(row);
    return obj;
  });
  return JSON.stringify(mapped, null, 2);
}

/** Build a filename like "transfers_2024-01-15T12-30-00Z.csv" */
export function buildFilename(prefix: string, format: ExportFormat): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  return `${prefix}_${ts}.${format}`;
}

/** Trigger a browser file download. No-op in non-browser environments. */
export function triggerDownload(content: string, filename: string, format: ExportFormat): void {
  if (typeof document === 'undefined') return;
  const mime = format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/json';
  const blob = new Blob(['\uFEFF' + content], { type: mime }); // BOM for Excel UTF-8
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

/** High-level export: build content, trigger download, return filename. */
export function exportData<T>(
  rows: T[],
  fields: ExportField<T>[],
  format: ExportFormat,
  filenamePrefix: string
): string {
  const content = format === 'csv' ? toCSV(rows, fields) : toJSON(rows, fields);
  const filename = buildFilename(filenamePrefix, format);
  triggerDownload(content, filename, format);
  return filename;
}
