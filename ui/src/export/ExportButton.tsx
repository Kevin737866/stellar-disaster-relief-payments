import React, { useState } from 'react';
import { ExportAuthorization, ExportField, ExportFormat, exportData } from './exportUtils';

interface ExportButtonProps<T> {
  rows: T[];
  fields: ExportField<T>[];
  filenamePrefix: string;
  authorization: ExportAuthorization;
  disabled?: boolean;
  label?: string;
}

/**
 * Export controls require an authenticated authorization context. Personal
 * fields require a separate consent action and are limited to admin/auditor.
 */
export function ExportButton<T>({
  rows,
  fields,
  filenamePrefix,
  authorization,
  disabled = false,
  label = 'Export',
}: ExportButtonProps<T>): React.ReactElement {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includePersonalData, setIncludePersonalData] = useState(false);
  const hasPersonalFields = fields.some(field => field.classification === 'personal');
  const canRequestPersonalData =
    authorization.role === 'admin' || authorization.role === 'auditor';

  const handleExport = async (format: ExportFormat) => {
    setError(null);
    setExporting(format);
    try {
      await exportData(rows, fields, format, filenamePrefix, authorization, includePersonalData);
    } catch {
      setError('Export was blocked or could not be completed. Check your permissions and try again.');
    } finally {
      setExporting(null);
    }
  };

  const base = 'px-3 py-1.5 text-sm rounded focus:outline-none focus:ring-2 disabled:opacity-50';

  return (
    <div className="flex flex-col items-start gap-2">
      {hasPersonalFields && canRequestPersonalData && (
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includePersonalData}
            onChange={event => setIncludePersonalData(event.target.checked)}
          />
          I have consent to include the minimum necessary personal beneficiary data.
        </label>
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{label}:</span>
        <button
          onClick={() => handleExport('csv')}
          disabled={disabled || !authorization.canExport || rows.length === 0 || exporting !== null}
          aria-label="Export as CSV"
          className={`${base} bg-green-600 text-white hover:bg-green-700 focus:ring-green-500`}
        >
          {exporting === 'csv' ? 'Exporting…' : 'CSV'}
        </button>
        <button
          onClick={() => handleExport('json')}
          disabled={disabled || !authorization.canExport || rows.length === 0 || exporting !== null}
          aria-label="Export as JSON"
          className={`${base} bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500`}
        >
          {exporting === 'json' ? 'Exporting…' : 'JSON'}
        </button>
        {rows.length === 0 && <span className="text-xs text-gray-400">No data to export</span>}
      </div>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
