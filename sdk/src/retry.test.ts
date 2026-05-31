import { RetryExhaustedError, computeDelay, isTransientError, withRetry } from './retry';

describe('retry utilities', () => {
  test('isTransientError identifies retryable and non-retryable errors', () => {
    expect(isTransientError(new Error('timeout'))).toBe(true);
    expect(isTransientError(new Error('500 internal server error'))).toBe(true);
    expect(isTransientError(new Error('Unauthorized access'))).toBe(false);
    expect(isTransientError({ status: 404, message: 'Not Found' })).toBe(false);
    expect(isTransientError({ status: 503, message: 'Service Unavailable' })).toBe(true);
  });

  test('computeDelay returns value within bounds', () => {
    const value = computeDelay(2, 50, 200);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(200);
  });

  test('withRetry returns the first successful result', async () => {
    let attempt = 0;
    const result = await withRetry(async () => {
      attempt += 1;
      if (attempt < 2) {
        throw new Error('timeout');
      }
      return 'success';
    }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 });

    expect(result).toBe('success');
    expect(attempt).toBe(2);
  });

  test('withRetry throws RetryExhaustedError after retry limit', async () => {
    await expect(withRetry(async () => {
      throw new Error('timeout');
    }, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 })).rejects.toThrow(RetryExhaustedError);
  });

  test('withRetry does not retry non-transient errors', async () => {
    await expect(withRetry(async () => {
      throw new Error('unauthorized');
    }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 })).rejects.toThrow('unauthorized');
  });
});
