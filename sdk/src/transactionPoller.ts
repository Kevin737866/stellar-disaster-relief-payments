import { SorobanRpc } from 'stellar-sdk';

const { Server } = SorobanRpc;
type Server = SorobanRpc.Server;
type GetTransactionResponse = SorobanRpc.Api.GetTransactionResponse;
type GetSuccessfulTransactionResponse = SorobanRpc.Api.GetSuccessfulTransactionResponse;
type GetFailedTransactionResponse = SorobanRpc.Api.GetFailedTransactionResponse;
const { GetTransactionStatus } = SorobanRpc.Api;
import { NetworkConfig } from './types';

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 60000;

/** Sentinel used internally to distinguish cancellation from a fetch response. */
const CANCELLED = Symbol('CANCELLED');

export interface PollOptions {
  /** Polling interval in milliseconds. Defaults to 3000. */
  intervalMs?: number;
  /** Maximum time to wait in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /**
   * Optional signal used to cancel polling. Aborting it stops any active wait
   * or in-flight request and makes the poll resolve with `status: 'CANCELLED'`.
   */
  signal?: AbortSignal;
}

export type TransactionPollResult =
  | { status: 'SUCCESS'; response: GetSuccessfulTransactionResponse }
  | { status: 'FAILED'; response: GetFailedTransactionResponse }
  | { status: 'TIMEOUT' }
  /** `response` is optional so existing exhaustive narrowing keeps compiling. */
  | { status: 'CANCELLED'; response?: undefined };

export class TransactionPoller {
  private server: Server;
  private config: NetworkConfig;
  private activePolls = new Map<string, Promise<TransactionPollResult>>();
  private pollControllers = new Map<string, AbortController>();
  private signalCleanups = new Map<string, Array<() => void>>();

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
  }

  /**
   * Poll a transaction until it reaches a terminal state (SUCCESS or FAILED),
   * until the timeout is exceeded, or until the optional signal is aborted.
   *
   * Deduplicates concurrent polls for the same hash: if a poll is already in
   * progress for the given hash, the same Promise is returned. A signal passed
   * to a deduplicated call also cancels the shared poll.
   */
  pollTransaction(
    hash: string,
    options?: PollOptions
  ): Promise<TransactionPollResult> {
    const existing = this.activePolls.get(hash);
    if (existing) {
      const controller = this.pollControllers.get(hash);
      if (options?.signal && controller) {
        this._linkSignal(options.signal, controller, hash);
      }
      return existing;
    }

    const controller = new AbortController();
    this.pollControllers.set(hash, controller);
    if (options?.signal) {
      this._linkSignal(options.signal, controller, hash);
    }

    const promise = this._poll(hash, options, controller.signal).finally(() => {
      this.activePolls.delete(hash);
      this.pollControllers.delete(hash);
      for (const cleanup of this.signalCleanups.get(hash) ?? []) {
        cleanup();
      }
      this.signalCleanups.delete(hash);
    });

    this.activePolls.set(hash, promise);
    return promise;
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

  /**
   * Cancel an in-progress poll for `hash`.
   *
   * Returns true if a poll was active and has been cancelled, false if no poll
   * was running for that hash. The corresponding poll resolves with
   * `status: 'CANCELLED'`.
   */
  cancelPoll(hash: string): boolean {
    const controller = this.pollControllers.get(hash);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  /** Alias for `cancelPoll`. */
  cancel(hash: string): boolean {
    return this.cancelPoll(hash);
  }

  private _linkSignal(
    source: AbortSignal,
    target: AbortController,
    hash: string
  ): void {
    if (source.aborted) {
      target.abort();
      return;
    }

    const onAbort = () => target.abort();
    source.addEventListener('abort', onAbort, { once: true });

    const cleanups = this.signalCleanups.get(hash) ?? [];
    cleanups.push(() => source.removeEventListener('abort', onAbort));
    this.signalCleanups.set(hash, cleanups);
  }

  private async _poll(
    hash: string,
    options: PollOptions | undefined,
    signal: AbortSignal
  ): Promise<TransactionPollResult> {
    const intervalMs =
      options?.intervalMs ??
      (this.config as any).pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs =
      options?.timeoutMs ??
      (this.config as any).pollTimeoutMs ??
      DEFAULT_TIMEOUT_MS;

    const deadline = Date.now() + timeoutMs;

    if (signal.aborted) {
      return { status: 'CANCELLED' };
    }

    while (Date.now() < deadline) {
      if (signal.aborted) {
        return { status: 'CANCELLED' };
      }

      let response: GetTransactionResponse;

      try {
        const fetched = await this._raceCancellation(
          this.server.getTransaction(hash),
          signal
        );
        if (fetched === CANCELLED) {
          return { status: 'CANCELLED' };
        }
        response = fetched;
      } catch (error) {
        if (signal.aborted) {
          return { status: 'CANCELLED' };
        }
        // Transient network / RPC error — log and retry after interval
        console.error(`TransactionPoller: transient error polling ${hash}:`, error);
        if (await this._sleep(intervalMs, signal)) {
          return { status: 'CANCELLED' };
        }
        continue;
      }

      if (signal.aborted) {
        return { status: 'CANCELLED' };
      }

      if (response.status === GetTransactionStatus.SUCCESS) {
        return { status: 'SUCCESS', response: response as GetSuccessfulTransactionResponse };
      }

      if (response.status === GetTransactionStatus.FAILED) {
        return { status: 'FAILED', response: response as GetFailedTransactionResponse };
      }

      // NOT_FOUND — transaction is still pending; wait and retry
      if (await this._sleep(intervalMs, signal)) {
        return { status: 'CANCELLED' };
      }
    }

    return signal.aborted ? { status: 'CANCELLED' } : { status: 'TIMEOUT' };
  }

  /**
   * Resolve early with the cancellation sentinel when `signal` is aborted.
   * The underlying request is not abandoned unhandled: both fulfilment and
   * rejection are observed even if cancellation wins the race.
   */
  private _raceCancellation<T>(
    request: Promise<T>,
    signal: AbortSignal
  ): Promise<T | typeof CANCELLED> {
    if (signal.aborted) {
      return Promise.resolve(CANCELLED);
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => resolve(CANCELLED);
      signal.addEventListener('abort', onAbort, { once: true });

      request.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  /**
   * Wait for `ms`, resolving `true` if cancellation interrupted the wait.
   * Any pending timer is cleared on cancellation so no future poll is scheduled.
   */
  private _sleep(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;

      const onAbort = () => {
        clearTimeout(timer);
        resolve(true);
      };

      timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      }, ms);

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
