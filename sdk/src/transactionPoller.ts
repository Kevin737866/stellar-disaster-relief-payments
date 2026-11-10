import { SorobanRpc } from 'stellar-sdk';

const { Server } = SorobanRpc;
type Server = SorobanRpc.Server;
type GetTransactionResponse = SorobanRpc.Api.GetTransactionResponse;
type GetSuccessfulTransactionResponse = SorobanRpc.Api.GetSuccessfulTransactionResponse;
type GetFailedTransactionResponse = SorobanRpc.Api.GetFailedTransactionResponse;
const { GetTransactionStatus } = SorobanRpc.Api;
import { ValidationError } from './errors';
import { NetworkConfig } from './types';

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 60000;

export interface PollOptions {
  /**
   * Polling interval in milliseconds.
   * Must be a positive finite number (> 0). Defaults to 3000.
   */
  intervalMs?: number;
  /**
   * Maximum time to wait in milliseconds.
   * Must be a positive finite number (> 0). Defaults to 60000.
   */
  timeoutMs?: number;
  /**
   * Optional AbortSignal used to cancel a pending poll before its first RPC
   * request, while waiting between polls, or during an in-flight RPC call.
   */
  signal?: AbortSignal;
}

export type TransactionPollResult =
  | { status: 'SUCCESS'; response: GetSuccessfulTransactionResponse }
  | { status: 'FAILED'; response: GetFailedTransactionResponse }
  | { status: 'TIMEOUT' }
  | { status: 'CANCELLED' };

interface ResolvedPollOptions {
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export class TransactionPoller {
  private server: Server;
  private config: NetworkConfig;
  private activePolls = new Map<string, Promise<TransactionPollResult>>();

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
  }

  /**
   * Poll a transaction until it reaches a terminal state (SUCCESS or FAILED),
   * until cancelled via `options.signal` (CANCELLED), or until the timeout is
   * exceeded (TIMEOUT).
   *
   * Validates `intervalMs` and `timeoutMs` (both must be finite numbers > 0)
   * before starting timers or issuing RPC calls.
   *
   * Deduplicates concurrent non-signalled polls for the same hash: if a poll
   * is already in progress for the given hash, the same Promise is returned.
   */
  pollTransaction(
    hash: string,
    options?: PollOptions
  ): Promise<TransactionPollResult> {
    let resolved: ResolvedPollOptions;
    try {
      resolved = this._resolveAndValidateOptions(options);
    } catch (error) {
      return Promise.reject(error);
    }

    const { intervalMs, timeoutMs, signal } = resolved;

    if (signal?.aborted) {
      return Promise.resolve({ status: 'CANCELLED' });
    }

    if (!signal) {
      const existing = this.activePolls.get(hash);
      if (existing) {
        return existing;
      }

      const promise = this._poll(hash, intervalMs, timeoutMs).finally(() => {
        this.activePolls.delete(hash);
      });

      this.activePolls.set(hash, promise);
      return promise;
    }

    const existing = this.activePolls.get(hash);
    if (existing) {
      return this._raceWithSignal(existing, signal);
    }

    return this._poll(hash, intervalMs, timeoutMs, signal);
  }

  /**
   * Poll a transaction until it reaches a terminal completion status.
   *
   * This is a convenience alias for `pollTransaction` that clearly expresses
   * the intent of waiting for final transaction completion.
   */
  pollTransactionStatus(
    hash: string,
    options?: PollOptions
  ): Promise<TransactionPollResult> {
    return this.pollTransaction(hash, options);
  }

  private _resolveAndValidateOptions(options?: PollOptions): ResolvedPollOptions {
    const intervalMs =
      options?.intervalMs ??
      (this.config as any).pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs =
      options?.timeoutMs ??
      (this.config as any).pollTimeoutMs ??
      DEFAULT_TIMEOUT_MS;

    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new ValidationError(
        'intervalMs',
        'Polling intervalMs must be a positive finite number greater than 0',
        { intervalMs }
      );
    }

    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError(
        'timeoutMs',
        'Polling timeoutMs must be a positive finite number greater than 0',
        { timeoutMs }
      );
    }

    return { intervalMs, timeoutMs, signal: options?.signal };
  }

  private _raceWithSignal(
    promise: Promise<TransactionPollResult>,
    signal: AbortSignal
  ): Promise<TransactionPollResult> {
    if (signal.aborted) {
      return Promise.resolve({ status: 'CANCELLED' });
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        resolve({ status: 'CANCELLED' });
      };
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (res) => {
          cleanup();
          resolve(res);
        },
        (err) => {
          cleanup();
          reject(err);
        }
      );
    });
  }

  private async _poll(
    hash: string,
    intervalMs: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<TransactionPollResult> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        return { status: 'CANCELLED' };
      }

      let response: GetTransactionResponse;

      try {
        const fetched = await this._getTransactionWithAbort(hash, signal);
        if (fetched === null) {
          return { status: 'CANCELLED' };
        }
        response = fetched;
      } catch (error) {
        if (signal?.aborted) {
          return { status: 'CANCELLED' };
        }
        // Transient network / RPC error — log and retry after interval
        console.error(`TransactionPoller: transient error polling ${hash}:`, error);
        await this._sleep(intervalMs, signal);
        if (signal?.aborted) {
          return { status: 'CANCELLED' };
        }
        continue;
      }

      if (response.status === GetTransactionStatus.SUCCESS) {
        return { status: 'SUCCESS', response: response as GetSuccessfulTransactionResponse };
      }

      if (response.status === GetTransactionStatus.FAILED) {
        return { status: 'FAILED', response: response as GetFailedTransactionResponse };
      }

      // NOT_FOUND — transaction is still pending; wait and retry
      await this._sleep(intervalMs, signal);
      if (signal?.aborted) {
        return { status: 'CANCELLED' };
      }
    }

    return signal?.aborted ? { status: 'CANCELLED' } : { status: 'TIMEOUT' };
  }

  private _getTransactionWithAbort(
    hash: string,
    signal?: AbortSignal
  ): Promise<GetTransactionResponse | null> {
    if (!signal) {
      return this.server.getTransaction(hash);
    }
    if (signal.aborted) {
      return Promise.resolve(null);
    }

    const rpcPromise = this.server.getTransaction(hash);
    rpcPromise.catch(() => {});

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      rpcPromise.then(
        (res) => {
          cleanup();
          resolve(res);
        },
        (err) => {
          cleanup();
          if (signal.aborted) {
            resolve(null);
          } else {
            reject(err);
          }
        }
      );
    });
  }

  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    if (signal.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
