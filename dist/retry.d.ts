export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}
export declare class RetryExhaustedError extends Error {
    readonly attempts: number;
    readonly lastError: unknown;
    constructor(attempts: number, lastError: unknown);
}
/**
 * Returns true for errors that are transient and safe to retry.
 * Non-retryable: validation errors, auth failures, permission errors, bad requests.
 */
export declare function isTransientError(error: unknown): boolean;
/**
 * Computes exponential backoff delay with full jitter.
 */
export declare function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number;
/**
 * Executes `fn` with automatic retry on transient errors using exponential backoff + jitter.
 * Non-transient errors are thrown immediately without retry.
 * Throws RetryExhaustedError when all attempts are exhausted.
 */
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
//# sourceMappingURL=retry.d.ts.map