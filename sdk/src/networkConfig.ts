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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEHOLDER = 'CONTRACT_ID_HERE';

const REQUIRED_URL_FIELDS: (keyof StellarNetworkConfig)[] = ['rpcUrl', 'horizonUrl'];

// ─── Built-in network defaults ────────────────────────────────────────────────

const PLACEHOLDER_CONTRACTS: ContractIds = {
  platform: PLACEHOLDER,
  aidRegistry: PLACEHOLDER,
  beneficiaryManager: PLACEHOLDER,
  merchantNetwork: PLACEHOLDER,
  cashTransfer: PLACEHOLDER,
  supplyChainTracker: PLACEHOLDER,
  antiFraud: PLACEHOLDER,
};

export const TESTNET_DEFAULTS: StellarNetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  contractIds: { ...PLACEHOLDER_CONTRACTS },
};

export const MAINNET_DEFAULTS: StellarNetworkConfig = {
  network: 'mainnet',
  rpcUrl: 'https://soroban.stellar.org',
  horizonUrl: 'https://horizon.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  explorerUrl: 'https://stellar.expert/explorer/public',
  contractIds: { ...PLACEHOLDER_CONTRACTS },
};

export const STANDALONE_DEFAULTS: StellarNetworkConfig = {
  network: 'standalone',
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  horizonUrl: 'http://localhost:8000',
  networkPassphrase: 'Standalone Network ; February 2017',
  contractIds: { ...PLACEHOLDER_CONTRACTS },
};

// ─── Network Registry ─────────────────────────────────────────────────────────

const registry = new Map<string, StellarNetworkConfig>([
  ['testnet', { ...TESTNET_DEFAULTS }],
  ['mainnet', { ...MAINNET_DEFAULTS }],
  ['standalone', { ...STANDALONE_DEFAULTS }],
]);

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
export function registerNetwork(name: string, config: CustomNetworkInput): void {
  if (['testnet', 'mainnet', 'standalone'].includes(name)) {
    throw new Error(
      `Cannot override built-in network "${name}". Use a different name for custom networks.`
    );
  }
  const full: StellarNetworkConfig = { ...config, network: name };
  const result = validateNetworkConfig(full);
  if (!result.valid) {
    throw new Error(
      `Invalid configuration for network "${name}":\n  - ${result.errors.join('\n  - ')}`
    );
  }
  registry.set(name, full);
}

/**
 * Retrieve a registered network configuration by name.
 * Returns a copy to prevent mutation of the registry entry.
 * Returns undefined if not found.
 */
export function getNetwork(name: string): StellarNetworkConfig | undefined {
  const entry = registry.get(name);
  if (!entry) return undefined;
  return { ...entry, contractIds: { ...entry.contractIds } };
}

/** List all registered network names. */
export function listNetworks(): string[] {
  return Array.from(registry.keys());
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a network configuration object.
 * Returns a result with all errors found (not just the first).
 */
export function validateNetworkConfig(config: unknown): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object'] };
  }

  const c = config as Record<string, unknown>;

  if (!c.network || typeof c.network !== 'string' || c.network.trim() === '') {
    errors.push('network: must be a non-empty string (e.g. "testnet", "mainnet", or a custom name)');
  }

  for (const field of REQUIRED_URL_FIELDS) {
    const val = c[field];
    if (!val || typeof val !== 'string') {
      errors.push(`${field}: required, must be a string URL`);
    } else if (!isValidUrl(val)) {
      errors.push(`${field}: "${val}" is not a valid http/https URL`);
    }
  }

  if (!c.networkPassphrase || typeof c.networkPassphrase !== 'string' || (c.networkPassphrase as string).trim() === '') {
    errors.push('networkPassphrase: required, must be a non-empty string');
  }

  if (c.explorerUrl !== undefined && c.explorerUrl !== null) {
    if (typeof c.explorerUrl !== 'string' || !isValidUrl(c.explorerUrl as string)) {
      errors.push(`explorerUrl: "${c.explorerUrl}" is not a valid http/https URL`);
    }
  }

  if (!c.contractIds || typeof c.contractIds !== 'object') {
    errors.push('contractIds: required, must be an object with contract address fields');
  } else {
    const required: (keyof ContractIds)[] = [
      'platform', 'aidRegistry', 'beneficiaryManager',
      'merchantNetwork', 'cashTransfer', 'supplyChainTracker', 'antiFraud',
    ];
    const ids = c.contractIds as Record<string, unknown>;
    for (const key of required) {
      if (!ids[key] || typeof ids[key] !== 'string') {
        errors.push(`contractIds.${key}: required, must be a non-empty string`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assert that a config is valid, throwing with all errors if not.
 * Use this at application startup or before connection attempts.
 */
export function assertValidNetworkConfig(config: unknown): asserts config is StellarNetworkConfig {
  const result = validateNetworkConfig(config);
  if (!result.valid) {
    throw new Error(
      `Invalid Stellar network configuration:\n  - ${result.errors.join('\n  - ')}`
    );
  }
}

// ─── Environment Variable Overrides ──────────────────────────────────────────

/**
 * Environment variable names used for overrides.
 * All are optional; only set values override the base config.
 */
export const ENV_VARS = {
  NETWORK: 'STELLAR_NETWORK',
  RPC_URL: 'STELLAR_RPC_URL',
  HORIZON_URL: 'STELLAR_HORIZON_URL',
  NETWORK_PASSPHRASE: 'STELLAR_NETWORK_PASSPHRASE',
  EXPLORER_URL: 'STELLAR_EXPLORER_URL',
  CONTRACT_PLATFORM: 'STELLAR_CONTRACT_PLATFORM',
  CONTRACT_AID_REGISTRY: 'STELLAR_CONTRACT_AID_REGISTRY',
  CONTRACT_BENEFICIARY_MANAGER: 'STELLAR_CONTRACT_BENEFICIARY_MANAGER',
  CONTRACT_MERCHANT_NETWORK: 'STELLAR_CONTRACT_MERCHANT_NETWORK',
  CONTRACT_CASH_TRANSFER: 'STELLAR_CONTRACT_CASH_TRANSFER',
  CONTRACT_SUPPLY_CHAIN_TRACKER: 'STELLAR_CONTRACT_SUPPLY_CHAIN_TRACKER',
  CONTRACT_ANTI_FRAUD: 'STELLAR_CONTRACT_ANTI_FRAUD',
} as const;

function env(key: string): string | undefined {
  // Works in Node.js; gracefully returns undefined in browser environments
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

/**
 * Apply environment variable overrides to a base config.
 * Only variables that are set (non-empty) override the base values.
 */
export function applyEnvOverrides(base: StellarNetworkConfig): StellarNetworkConfig {
  const overridden: StellarNetworkConfig = {
    ...base,
    contractIds: { ...base.contractIds },
  };

  const network = env(ENV_VARS.NETWORK);
  if (network) overridden.network = network;

  const rpcUrl = env(ENV_VARS.RPC_URL);
  if (rpcUrl) overridden.rpcUrl = rpcUrl;

  const horizonUrl = env(ENV_VARS.HORIZON_URL);
  if (horizonUrl) overridden.horizonUrl = horizonUrl;

  const passphrase = env(ENV_VARS.NETWORK_PASSPHRASE);
  if (passphrase) overridden.networkPassphrase = passphrase;

  const explorerUrl = env(ENV_VARS.EXPLORER_URL);
  if (explorerUrl) overridden.explorerUrl = explorerUrl;

  const contractMap: [string, keyof ContractIds][] = [
    [ENV_VARS.CONTRACT_PLATFORM, 'platform'],
    [ENV_VARS.CONTRACT_AID_REGISTRY, 'aidRegistry'],
    [ENV_VARS.CONTRACT_BENEFICIARY_MANAGER, 'beneficiaryManager'],
    [ENV_VARS.CONTRACT_MERCHANT_NETWORK, 'merchantNetwork'],
    [ENV_VARS.CONTRACT_CASH_TRANSFER, 'cashTransfer'],
    [ENV_VARS.CONTRACT_SUPPLY_CHAIN_TRACKER, 'supplyChainTracker'],
    [ENV_VARS.CONTRACT_ANTI_FRAUD, 'antiFraud'],
  ];

  for (const [envKey, contractKey] of contractMap) {
    const val = env(envKey);
    if (val) overridden.contractIds[contractKey] = val;
  }

  return overridden;
}

// ─── Config Loader ────────────────────────────────────────────────────────────

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
export function loadNetworkConfig(
  name?: string,
  options: LoadNetworkConfigOptions = {}
): StellarNetworkConfig {
  const { skipValidation = false, applyEnv = true } = options;

  // Determine network name: env var > parameter > default
  const networkName = (applyEnv ? env(ENV_VARS.NETWORK) : undefined) || name || 'testnet';

  const base = registry.get(networkName);
  if (!base) {
    const available = listNetworks().join(', ');
    throw new Error(
      `Unknown network "${networkName}". Available networks: ${available}. ` +
      `Register custom networks with registerNetwork().`
    );
  }

  const config = applyEnv ? applyEnvOverrides(base) : { ...base, contractIds: { ...base.contractIds } };

  if (!skipValidation) {
    assertValidNetworkConfig(config);
  }

  return config;
}

// ─── Backward-compatible helpers ─────────────────────────────────────────────

/**
 * Convert a legacy NetworkConfig (from types.ts) to a StellarNetworkConfig.
 * Fills in networkPassphrase from built-in defaults when possible.
 */
export function fromLegacyConfig(legacy: {
  network: string;
  rpcUrl: string;
  horizonUrl: string;
  contractIds: ContractIds;
}): StellarNetworkConfig {
  const defaults = registry.get(legacy.network);
  return {
    networkPassphrase: defaults?.networkPassphrase ?? '',
    explorerUrl: defaults?.explorerUrl,
    ...legacy,
  };
}
