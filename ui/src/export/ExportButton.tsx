import React, { useState } from 'react';
import { ExportField, ExportFormat, exportData } from './exportUtils';

interface ExportButtonProps<T> {
  rows: T[];
  fields: ExportField<T>[];
  filenamePrefix: string;
  disabled?: boolean;
  label?: string;
}

/**
 * Renders CSV and JSON export buttons for any transaction list.
 * Handles loading state and error feedback inline.
 */
export function ExportButton<T>({
  rows,
  fields,
  filenamePrefix,
  disabled = false,
  label = 'Export',
}: ExportButtonProps<T>): React.ReactElement {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = (format: ExportFormat) => {
    setError(null);
    setExporting(format);
    try {
      exportData(rows, fields, format, filenamePrefix);
    } catch (e) {
      setError('Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const base = 'px-3 py-1.5 text-sm rounded focus:outline-none focus:ring-2 disabled:opacity-50';

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">{label}:</span>
      <button
        onClick={() => handleExport('csv')}
        disabled={disabled || rows.length === 0 || exporting !== null}
        aria-label="Export as CSV"
        className={`${base} bg-green-600 text-white hover:bg-green-700 focus:ring-green-500`}
      >
        {exporting === 'csv' ? 'Exporting…' : 'CSV'}
      </button>
      <button
        onClick={() => handleExport('json')}
        disabled={disabled || rows.length === 0 || exporting !== null}
        aria-label="Export as JSON"
        className={`${base} bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500`}
      >
        {exporting === 'json' ? 'Exporting…' : 'JSON'}
      </button>
      {rows.length === 0 && (
        <span className="text-xs text-gray-400">No data to export</span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
