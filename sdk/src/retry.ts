export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown
  ) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Operation failed after ${attempts} attempt(s): ${msg}`);
    this.name = 'RetryExhaustedError';
  }
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 4,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
};

/**
 * Returns true for errors that are transient and safe to retry.
 * Non-retryable: validation errors, auth failures, permission errors, bad requests.
 */
export function isTransientError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Non-retryable patterns
  const nonRetryable = [
    'unauthorized', 'forbidden', 'invalid', 'not found', 'bad request',
    'malformed', 'authentication', 'permission', 'access denied',
    'tx_bad_auth', 'tx_bad_seq', 'op_not_authorized', 'op_no_trust',
    'op_low_reserve', 'op_underfunded',
  ];
  if (nonRetryable.some(p => msg.includes(p))) return false;

  // Retryable patterns
  const retryable = [
    'timeout', 'timed out', 'econnreset', 'econnrefused', 'enotfound',
    'network', 'socket', 'connection', 'rate limit', 'too many requests',
    '429', '500', '502', '503', '504', 'internal server error',
    'bad gateway', 'service unavailable', 'gateway timeout',
    'try_again_later', 'pending',
  ];
  if (retryable.some(p => msg.includes(p))) return true;

  // Check HTTP status codes on error objects
  const errObj = error as Record<string, unknown>;
  const responseObj = errObj?.response as Record<string, unknown> | undefined;
  const status = errObj?.status ?? errObj?.statusCode ?? responseObj?.status;
  if (typeof status === 'number') {
    if (status === 429 || (status >= 500 && status <= 599)) return true;
    if (status >= 400 && status < 500) return false;
  }

  // Default: retry unknown errors (network-level failures)
  return true;
}

/**
 * Computes exponential backoff delay with full jitter.
 */
export function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Executes `fn` with automatic retry on transient errors using exponential backoff + jitter.
 * Non-transient errors are thrown immediately without retry.
 * Throws RetryExhaustedError when all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error)) {
        throw error;
      }

      if (attempt < maxAttempts - 1) {
        const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw new RetryExhaustedError(maxAttempts, lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
