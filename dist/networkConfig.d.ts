/**
 * Stellar Network Configuration System
 *
 * Provides type-safe network configuration with:
 * - Built-in defaults for testnet, mainnet, and standalone
 * - Custom network registration without code changes
 * - Robust validation with actionable error messages
 * - Environment variable overrides
 * - Backward compatibility with existing NetworkConfig
 */
export interface ContractIds {
    platform: string;
    aidRegistry: string;
    beneficiaryManager: string;
    merchantNetwork: string;
    cashTransfer: string;
    supplyChainTracker: string;
    antiFraud: string;
}
/** Extended network configuration with all environment-specific settings. */
export interface StellarNetworkConfig {
    /** Network identifier. Use "custom" for user-defined networks. */
    network: 'testnet' | 'mainnet' | 'standalone' | 'custom' | string;
    /** Soroban RPC endpoint URL */
    rpcUrl: string;
    /** Horizon REST API endpoint URL */
    horizonUrl: string;
    /** Stellar network passphrase used for transaction signing */
    networkPassphrase: string;
    /** Block explorer base URL (optional) */
    explorerUrl?: string;
    /** Deployed contract addresses */
    contractIds: ContractIds;
}
/** Partial config accepted for custom network registration. */
export type CustomNetworkInput = Omit<StellarNetworkConfig, 'network'> & {
    network?: string;
};
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare const TESTNET_DEFAULTS: StellarNetworkConfig;
export declare const MAINNET_DEFAULTS: StellarNetworkConfig;
export declare const STANDALONE_DEFAULTS: StellarNetworkConfig;
/**
 * Register a custom network configuration.
 * Throws if the network name conflicts with a built-in network.
 *
 * @example
 * registerNetwork('staging', {
 *   rpcUrl: 'https://rpc.staging.example.com',
 *   horizonUrl: 'https://horizon.staging.example.com',
 *   networkPassphrase: 'Staging Network ; 2024',
 *   contractIds: { ... }
 * });
 */
export declare function registerNetwork(name: string, config: CustomNetworkInput): void;
/**
 * Retrieve a registered network configuration by name.
 * Returns a copy to prevent mutation of the registry entry.
 * Returns undefined if not found.
 */
export declare function getNetwork(name: string): StellarNetworkConfig | undefined;
/** List all registered network names. */
export declare function listNetworks(): string[];
/**
 * Validate a network configuration object.
 * Returns a result with all errors found (not just the first).
 */
export declare function validateNetworkConfig(config: unknown): ValidationResult;
/**
 * Assert that a config is valid, throwing with all errors if not.
 * Use this at application startup or before connection attempts.
 */
export declare function assertValidNetworkConfig(config: unknown): asserts config is StellarNetworkConfig;
/**
 * Environment variable names used for overrides.
 * All are optional; only set values override the base config.
 */
export declare const ENV_VARS: {
    readonly NETWORK: "STELLAR_NETWORK";
    readonly RPC_URL: "STELLAR_RPC_URL";
    readonly HORIZON_URL: "STELLAR_HORIZON_URL";
    readonly NETWORK_PASSPHRASE: "STELLAR_NETWORK_PASSPHRASE";
    readonly EXPLORER_URL: "STELLAR_EXPLORER_URL";
    readonly CONTRACT_PLATFORM: "STELLAR_CONTRACT_PLATFORM";
    readonly CONTRACT_AID_REGISTRY: "STELLAR_CONTRACT_AID_REGISTRY";
    readonly CONTRACT_BENEFICIARY_MANAGER: "STELLAR_CONTRACT_BENEFICIARY_MANAGER";
    readonly CONTRACT_MERCHANT_NETWORK: "STELLAR_CONTRACT_MERCHANT_NETWORK";
    readonly CONTRACT_CASH_TRANSFER: "STELLAR_CONTRACT_CASH_TRANSFER";
    readonly CONTRACT_SUPPLY_CHAIN_TRACKER: "STELLAR_CONTRACT_SUPPLY_CHAIN_TRACKER";
    readonly CONTRACT_ANTI_FRAUD: "STELLAR_CONTRACT_ANTI_FRAUD";
};
/**
 * Apply environment variable overrides to a base config.
 * Only variables that are set (non-empty) override the base values.
 */
export declare function applyEnvOverrides(base: StellarNetworkConfig): StellarNetworkConfig;
export interface LoadNetworkConfigOptions {
    /** Skip validation after loading (not recommended for production). */
    skipValidation?: boolean;
    /** Apply environment variable overrides. Defaults to true. */
    applyEnv?: boolean;
}
/**
 * Load a network configuration by name, with optional env overrides.
 *
 * Resolution order:
 * 1. STELLAR_NETWORK env var (if set, used as network name)
 * 2. `name` parameter
 * 3. Falls back to "testnet" if neither is set
 *
 * @throws if the network name is not registered
 * @throws if the resulting config is invalid (unless skipValidation is true)
 *
 * @example
 * // Load testnet with env overrides
 * const config = loadNetworkConfig('testnet');
 *
 * // Load a custom registered network
 * registerNetwork('staging', { ... });
 * const config = loadNetworkConfig('staging');
 */
export declare function loadNetworkConfig(name?: string, options?: LoadNetworkConfigOptions): StellarNetworkConfig;
/**
 * Convert a legacy NetworkConfig (from types.ts) to a StellarNetworkConfig.
 * Fills in networkPassphrase from built-in defaults when possible.
 */
export declare function fromLegacyConfig(legacy: {
    network: string;
    rpcUrl: string;
    horizonUrl: string;
    contractIds: ContractIds;
}): StellarNetworkConfig;
//# sourceMappingURL=networkConfig.d.ts.map