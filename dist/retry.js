"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetryExhaustedError = void 0;
exports.isTransientError = isTransientError;
exports.computeDelay = computeDelay;
exports.withRetry = withRetry;
class RetryExhaustedError extends Error {
    constructor(attempts, lastError) {
        const msg = lastError instanceof Error ? lastError.message : String(lastError);
        super(`Operation failed after ${attempts} attempt(s): ${msg}`);
        this.attempts = attempts;
        this.lastError = lastError;
        this.name = 'RetryExhaustedError';
    }
}
exports.RetryExhaustedError = RetryExhaustedError;
const DEFAULT_OPTIONS = {
    maxAttempts: 4,
    baseDelayMs: 200,
    maxDelayMs: 10000,
};
/**
 * Returns true for errors that are transient and safe to retry.
 * Non-retryable: validation errors, auth failures, permission errors, bad requests.
 */
function isTransientError(error) {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    // Non-retryable patterns
    const nonRetryable = [
        'unauthorized', 'forbidden', 'invalid', 'not found', 'bad request',
        'malformed', 'authentication', 'permission', 'access denied',
        'tx_bad_auth', 'tx_bad_seq', 'op_not_authorized', 'op_no_trust',
        'op_low_reserve', 'op_underfunded',
    ];
    if (nonRetryable.some(p => msg.includes(p)))
        return false;
    // Retryable patterns
    const retryable = [
        'timeout', 'timed out', 'econnreset', 'econnrefused', 'enotfound',
        'network', 'socket', 'connection', 'rate limit', 'too many requests',
        '429', '500', '502', '503', '504', 'internal server error',
        'bad gateway', 'service unavailable', 'gateway timeout',
        'try_again_later', 'pending',
    ];
    if (retryable.some(p => msg.includes(p)))
        return true;
    // Check HTTP status codes on error objects
    const errObj = error;
    const responseObj = errObj?.response;
    const status = errObj?.status ?? errObj?.statusCode ?? responseObj?.status;
    if (typeof status === 'number') {
        if (status === 429 || (status >= 500 && status <= 599))
            return true;
        if (status >= 400 && status < 500)
            return false;
    }
    // Default: retry unknown errors (network-level failures)
    return true;
}
/**
 * Computes exponential backoff delay with full jitter.
 */
function computeDelay(attempt, baseDelayMs, maxDelayMs) {
    const exponential = baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, maxDelayMs);
    return Math.floor(Math.random() * capped);
}
/**
 * Executes `fn` with automatic retry on transient errors using exponential backoff + jitter.
 * Non-transient errors are thrown immediately without retry.
 * Throws RetryExhaustedError when all attempts are exhausted.
 */
async function withRetry(fn, options = {}) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=retry.js.map