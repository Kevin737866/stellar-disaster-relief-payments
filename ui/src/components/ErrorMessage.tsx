import React from 'react';

interface ErrorMessageProps {
  error: string | null;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Converts raw SDK/network error strings into user-friendly messages.
 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/network|fetch|connection|timeout/i.test(raw)) {
    return 'Connection problem. Check your internet and try again.';
  }
  if (/unauthorized|forbidden|403|401/i.test(raw)) {
    return 'You don\'t have permission to do that. Check your credentials.';
  }
  if (/not found|404/i.test(raw)) {
    return 'The requested record was not found.';
  }
  if (/already exists|duplicate/i.test(raw)) {
    return 'A record with that ID already exists. Use a different ID.';
  }
  if (/insufficient|balance|funds/i.test(raw)) {
    return 'Insufficient funds to complete this transaction.';
  }
  if (/expired/i.test(raw)) {
    return 'This transfer or fund has expired and can no longer be used.';
  }
  if (/spending rule|rule violation|category/i.test(raw)) {
    return 'This payment was blocked by a spending rule. Check the category or amount.';
  }
  if (/invalid.*key|keypair|secret/i.test(raw)) {
    return 'Invalid signing key. Please check your credentials.';
  }
  if (/transaction.*failed|status.*failed/i.test(raw)) {
    return 'The blockchain transaction failed. Please try again.';
  }
  if (/verification.*failed|trust.*score/i.test(raw)) {
    return 'Identity verification failed. Check the provided factors and try again.';
  }

  // Fallback: strip technical noise but keep the message readable
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ error, onDismiss, className = '' }) => {
  if (!error) return null;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}
    >
      <svg
        className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        />
      </svg>
      <p className="text-red-700 text-sm flex-1">{error}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-600 flex-shrink-0"
          aria-label="Dismiss error"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
