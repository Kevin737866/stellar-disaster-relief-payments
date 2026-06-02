import React from 'react';

// ─── Spinner ────────────────────────────────────────────────────────────────

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label = 'Loading…',
  className = '',
}) => {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' };
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
    >
      <svg
        className={`animate-spin text-blue-600 ${sizeClasses[size]}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

interface SkeletonProps {
  className?: string;
  'aria-label'?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  'aria-label': ariaLabel = 'Loading content',
}) => (
  <div
    role="status"
    aria-label={ariaLabel}
    className={`animate-pulse bg-gray-200 rounded ${className}`}
  >
    <span className="sr-only">{ariaLabel}</span>
  </div>
);

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

export const SkeletonCard: React.FC = () => (
  <div
    role="status"
    aria-label="Loading card"
    className="border rounded-lg p-4 space-y-3"
  >
    <div className="flex justify-between">
      <div className="space-y-2 flex-1">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="space-y-2 ml-4 w-24">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
    <span className="sr-only">Loading card</span>
  </div>
);

// ─── SkeletonList ─────────────────────────────────────────────────────────────

interface SkeletonListProps {
  count?: number;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ count = 3 }) => (
  <div role="status" aria-label="Loading list" className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
    <span className="sr-only">Loading list</span>
  </div>
);

// ─── ProgressBar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  value: number; // 0–100
  label?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  label = 'Progress',
  className = '',
}) => (
  <div className={`w-full ${className}`}>
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="w-full bg-gray-200 rounded-full h-2"
    >
      <div
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
    <span className="sr-only">{label}: {value}%</span>
  </div>
);

// ─── StatusMessage ────────────────────────────────────────────────────────────

type StatusType = 'loading' | 'success' | 'error' | 'warning' | 'info';

interface StatusMessageProps {
  type: StatusType;
  message: string;
  onDismiss?: () => void;
  className?: string;
}

const STATUS_STYLES: Record<StatusType, { bg: string; text: string; border: string; icon: string }> = {
  loading: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', icon: '⏳' },
  success: { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-200', icon: '✓' },
  error:   { bg: 'bg-red-50',   text: 'text-red-800',   border: 'border-red-200',   icon: '✕' },
  warning: { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', icon: '⚠' },
  info:    { bg: 'bg-gray-50',  text: 'text-gray-800',  border: 'border-gray-200',  icon: 'ℹ' },
};

const ARIA_ROLES: Record<StatusType, string> = {
  loading: 'status',
  success: 'status',
  error:   'alert',
  warning: 'alert',
  info:    'status',
};

export const StatusMessage: React.FC<StatusMessageProps> = ({
  type,
  message,
  onDismiss,
  className = '',
}) => {
  const s = STATUS_STYLES[type];
  return (
    <div
      role={ARIA_ROLES[type]}
      aria-live={type === 'error' || type === 'warning' ? 'assertive' : 'polite'}
      className={`flex items-center justify-between px-4 py-3 rounded border ${s.bg} ${s.text} ${s.border} ${className}`}
    >
      <span className="flex items-center gap-2">
        {type === 'loading' && <Spinner size="sm" />}
        {type !== 'loading' && <span aria-hidden="true">{s.icon}</span>}
        {message}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="ml-4 text-current opacity-60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current rounded"
        >
          ×
        </button>
      )}
    </div>
  );
};

// ─── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  action,
  icon = '📭',
}) => (
  <div
    role="status"
    aria-label={title}
    className="text-center py-12 px-4"
  >
    <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
    <h3 className="text-lg font-semibold text-gray-700 mb-1">{title}</h3>
    {description && <p className="text-gray-500 text-sm mb-4">{description}</p>}
    {action}
  </div>
);

// ─── ErrorState ───────────────────────────────────────────────────────────────

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => (
  <div
    role="alert"
    className="text-center py-8 px-4"
  >
    <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
    <p className="text-red-700 font-medium mb-3">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        Try Again
      </button>
    )}
  </div>
);

// ─── LoadingButton ────────────────────────────────────────────────────────────

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  children: React.ReactNode;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  loading = false,
  loadingLabel,
  children,
  disabled,
  className = '',
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    aria-busy={loading}
    aria-disabled={disabled || loading}
    className={`inline-flex items-center gap-2 ${className} ${loading || disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
  >
    {loading && <Spinner size="sm" label={loadingLabel ?? 'Loading'} />}
    {loading ? (loadingLabel ?? children) : children}
  </button>
);

// ─── PageLoadingOverlay ───────────────────────────────────────────────────────

interface PageLoadingOverlayProps {
  message?: string;
}

export const PageLoadingOverlay: React.FC<PageLoadingOverlayProps> = ({
  message = 'Processing…',
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-label={message}
    className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50"
  >
    <div className="bg-white rounded-lg shadow-xl px-8 py-6 flex flex-col items-center gap-3">
      <Spinner size="lg" label={message} />
      <p className="text-gray-700 font-medium">{message}</p>
    </div>
  </div>
);
