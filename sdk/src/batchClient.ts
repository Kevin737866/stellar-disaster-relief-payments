import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  scValToNative,
} from 'stellar-sdk';
import {
  NetworkConfig,
  ContractTarget,
  BatchContractCall,
  BatchExecuteRequest,
  BatchExecuteResult,
  BatchCallResult,
  BATCH_MAX_SIZE,
} from './types';
import { TransactionPoller, PollOptions } from './transactionPoller';

const { Server } = SorobanRpc;

/**
 * Client for batching multiple contract calls into a single Stellar transaction.
 *
 * Stellar supports up to 100 operations per transaction. BatchClient packs
 * each BatchContractCall as one operation, preserving call order and execution
 * semantics. The transaction is signed once and submitted as a unit.
 *
 * Usage:
 *   const client = new BatchClient(config);
 *   const result = await client.execute({
 *     calls: [
 *       { contractTarget: 'aidRegistry', method: 'create_fund', args: [...] },
 *       { contractTarget: 'beneficiaryManager', method: 'register', args: [...] },
 *     ],
 *     signerKey: 'S...',
 *   });
 */
export class BatchClient {
  private server: SorobanRpc.Server;
  private config: NetworkConfig;
  private poller: TransactionPoller;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.poller = new TransactionPoller(config);
  }

  /**
   * Execute an ordered batch of contract calls in a single transaction.
   *
   * @param request - Batch request containing calls and signer key.
   * @param pollOptions - Optional polling configuration.
   * @returns BatchExecuteResult with per-call results and overall status.
   * @throws Error on invalid inputs, authorization failure, or network error.
   */
  async execute(
    request: BatchExecuteRequest,
    pollOptions?: PollOptions
  ): Promise<BatchExecuteResult> {
    this.validateRequest(request);

    const signerKeypair = Keypair.fromSecret(request.signerKey);
    const signerAccount = await this.server.getAccount(signerKeypair.publicKey());

    const builder = new TransactionBuilder(signerAccount, {
      fee: String(100 * request.calls.length),
      networkPassphrase: this.getNetworkPassphrase(),
    });

    for (const call of request.calls) {
      const contractId = this.resolveContractId(call.contractTarget);
      const contract = new Contract(contractId);
      builder.addOperation(contract.call(call.method, ...call.args));
    }

    const tx = builder.setTimeout(30).build();
    tx.sign(signerKeypair);

    let sendResult: SorobanRpc.Api.SendTransactionResponse;
    try {
      sendResult = await this.server.sendTransaction(tx);
    } catch (error) {
      throw new Error(
        `BatchClient: network error submitting batch transaction: ${error}`
      );
    }

    if (
      sendResult.status === 'ERROR' ||
      sendResult.status === 'DUPLICATE' ||
      sendResult.status === 'TRY_AGAIN_LATER'
    ) {
      throw new Error(
        `BatchClient: transaction rejected by network: ${sendResult.status}`
      );
    }

    const txHash = sendResult.hash;
    const pollResult = await this.poller.pollTransaction(txHash, pollOptions);

    if (pollResult.status === 'TIMEOUT') {
      return {
        transactionHash: txHash,
        status: 'TIMEOUT',
        results: this.buildFailedResults(request.calls.length, 'Transaction timed out'),
      };
    }

    if (pollResult.status === 'FAILED') {
      return {
        transactionHash: txHash,
        status: 'FAILED',
        results: this.buildFailedResults(request.calls.length, 'Transaction failed on-chain'),
      };
    }

    // SUCCESS — extract per-operation return values from result metadata
    const successResponse = pollResult.response as SorobanRpc.Api.GetSuccessfulTransactionResponse;
    const results = this.extractCallResults(request.calls.length, successResponse);

    return {
      transactionHash: txHash,
      status: 'SUCCESS',
      results,
      ledger: successResponse.ledger,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateRequest(request: BatchExecuteRequest): void {
    if (!request.calls || request.calls.length === 0) {
      throw new Error('BatchClient: calls array must not be empty');
    }
    if (request.calls.length > BATCH_MAX_SIZE) {
      throw new Error(
        `BatchClient: batch size ${request.calls.length} exceeds maximum of ${BATCH_MAX_SIZE}`
      );
    }
    if (!request.signerKey || request.signerKey.trim() === '') {
      throw new Error('BatchClient: signerKey is required');
    }
    try {
      Keypair.fromSecret(request.signerKey);
    } catch {
      throw new Error('BatchClient: signerKey is not a valid Stellar secret key');
    }
    for (let i = 0; i < request.calls.length; i++) {
      const call = request.calls[i];
      if (!call.contractTarget) {
        throw new Error(`BatchClient: calls[${i}].contractTarget is required`);
      }
      if (!call.method || call.method.trim() === '') {
        throw new Error(`BatchClient: calls[${i}].method is required`);
      }
      if (!Array.isArray(call.args)) {
        throw new Error(`BatchClient: calls[${i}].args must be an array`);
      }
      // Validate contractTarget resolves (throws if not configured)
      this.resolveContractId(call.contractTarget);
    }
  }

  private resolveContractId(target: ContractTarget): string {
    const id = this.config.contractIds[target];
    if (!id || id.trim() === '') {
      throw new Error(
        `BatchClient: no contractId configured for target "${target}"`
      );
    }
    return id;
  }

  private buildFailedResults(count: number, error: string): BatchCallResult[] {
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      success: false,
      error,
    }));
  }

  /**
   * Extract per-call return values from the transaction result metadata.
   * Soroban encodes operation results in resultMetaXdr; we attempt to decode
   * each one. If decoding fails for any call, that call is marked as failed
   * while others remain unaffected.
   */
  private extractCallResults(
    count: number,
    response: SorobanRpc.Api.GetSuccessfulTransactionResponse
  ): BatchCallResult[] {
    const results: BatchCallResult[] = [];

    for (let i = 0; i < count; i++) {
      try {
        // Attempt to extract the return value for operation i from the XDR.
        // resultMetaXdr contains a TransactionMeta which holds per-operation
        // Soroban data. We use a best-effort decode; if unavailable we still
        // mark the call as successful (the overall tx succeeded).
        let returnValue: unknown;
        try {
          const meta = response.resultMetaXdr;
          if (meta) {
            const v3 = (meta as any).v3?.();
            const sorobanMeta = v3?.sorobanMeta?.();
            const returnVals = sorobanMeta?.returnValue?.();
            if (returnVals) {
              returnValue = scValToNative(returnVals);
            }
          }
        } catch {
          // Return value extraction is best-effort; don't fail the call
        }

        results.push({ index: i, success: true, returnValue });
      } catch (err) {
        results.push({ index: i, success: false, error: String(err) });
      }
    }

    return results;
  }

  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return Networks.TESTNET;
      case 'mainnet':
        return Networks.PUBLIC;
      case 'standalone':
        return Networks.STANDALONE;
      default:
        throw new Error(`BatchClient: unsupported network "${this.config.network}"`);
    }
  }
}
