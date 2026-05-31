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

export interface PollOptions {
  /** Polling interval in milliseconds. Defaults to 3000. */
  intervalMs?: number;
  /** Maximum time to wait in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
}

export type TransactionPollResult =
  | { status: 'SUCCESS'; response: GetSuccessfulTransactionResponse }
  | { status: 'FAILED'; response: GetFailedTransactionResponse }
  | { status: 'TIMEOUT' };

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
   * or until the timeout is exceeded.
   *
   * Deduplicates concurrent polls for the same hash: if a poll is already in
   * progress for the given hash, the same Promise is returned.
   */
  pollTransaction(
    hash: string,
    options?: PollOptions
  ): Promise<TransactionPollResult> {
    const existing = this.activePolls.get(hash);
    if (existing) {
      return existing;
    }

    const promise = this._poll(hash, options).finally(() => {
      this.activePolls.delete(hash);
    });

    this.activePolls.set(hash, promise);
    return promise;
  }

  private async _poll(
    hash: string,
    options?: PollOptions
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

    while (Date.now() < deadline) {
      let response: GetTransactionResponse;

      try {
        response = await this.server.getTransaction(hash);
      } catch (error) {
        // Transient network / RPC error — log and retry after interval
        console.error(`TransactionPoller: transient error polling ${hash}:`, error);
        await this._sleep(intervalMs);
        continue;
      }

      if (response.status === GetTransactionStatus.SUCCESS) {
        return { status: 'SUCCESS', response: response as GetSuccessfulTransactionResponse };
      }

      if (response.status === GetTransactionStatus.FAILED) {
        return { status: 'FAILED', response: response as GetFailedTransactionResponse };
      }

      // NOT_FOUND — transaction is still pending; wait and retry
      await this._sleep(intervalMs);
    }

    return { status: 'TIMEOUT' };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
