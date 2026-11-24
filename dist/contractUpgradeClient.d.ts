import { NetworkConfig, ContractUpgradeRequest, ContractUpgradeResult } from './types';
import { PollOptions } from './transactionPoller';
/**
 * Client for upgrading already-deployed Soroban contracts.
 *
 * The upgrade flow follows the Soroban contract-upgrade pattern:
 *   1. Validate inputs.
 *   2. Build a transaction that invokes the contract's `upgrade` function
 *      with the new WASM hash.
 *   3. Sign and submit the transaction.
 *   4. Poll until the transaction reaches a terminal state.
 *
 * The contract identifier is preserved — only the executing WASM changes.
 */
export declare class ContractUpgradeClient {
    private server;
    private config;
    private poller;
    constructor(config: NetworkConfig);
    /**
     * Upgrade a deployed contract to a new WASM hash.
     *
     * @param request - Upgrade parameters (target, newWasmHash, adminKey).
     * @param pollOptions - Optional polling configuration.
     * @returns Upgrade result including the preserved contractId and tx hash.
     * @throws Error on invalid inputs, authorization failure, or network error.
     */
    upgradeContract(request: ContractUpgradeRequest, pollOptions?: PollOptions): Promise<ContractUpgradeResult>;
    private validateRequest;
    private resolveContractId;
    /**
     * Decode a WASM hash supplied as hex or base64 into a Buffer.
     * Soroban expects a 32-byte hash.
     */
    private decodeWasmHash;
    private getNetworkPassphrase;
}
//# sourceMappingURL=contractUpgradeClient.d.ts.map