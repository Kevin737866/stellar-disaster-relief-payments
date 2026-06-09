/**
 * Tests for the Stellar Network Configuration System
 *
 * Covers: network registration, config loading, validation failures,
 * environment overrides, endpoint resolution, custom network switching,
 * and compatibility with existing Stellar environments.
 */

import {
  validateNetworkConfig,
  assertValidNetworkConfig,
  registerNetwork,
  getNetwork,
  listNetworks,
  applyEnvOverrides,
  loadNetworkConfig,
  fromLegacyConfig,
  TESTNET_DEFAULTS,
  MAINNET_DEFAULTS,
  STANDALONE_DEFAULTS,
  ENV_VARS,
  StellarNetworkConfig,
} from '../../../sdk/src/networkConfig';
import { TESTNET_CONFIG, MAINNET_CONFIG } from '../../../sdk/src/index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CONTRACTS = {
  platform: 'CABC123',
  aidRegistry: 'CABC124',
  beneficiaryManager: 'CABC125',
  merchantNetwork: 'CABC126',
  cashTransfer: 'CABC127',
  supplyChainTracker: 'CABC128',
  antiFraud: 'CABC129',
};

const VALID_CONFIG: StellarNetworkConfig = {
  network: 'custom',
  rpcUrl: 'https://rpc.example.com',
  horizonUrl: 'https://horizon.example.com',
  networkPassphrase: 'Test Network ; 2024',
  contractIds: { ...VALID_CONTRACTS },
};

// ─── Built-in network defaults ────────────────────────────────────────────────

describe('Built-in network defaults', () => {
  it('testnet has correct RPC and Horizon URLs', () => {
    expect(TESTNET_DEFAULTS.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(TESTNET_DEFAULTS.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('testnet has correct network passphrase', () => {
    expect(TESTNET_DEFAULTS.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('mainnet has correct network passphrase', () => {
    expect(MAINNET_DEFAULTS.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
  });

  it('standalone has localhost endpoints', () => {
    expect(STANDALONE_DEFAULTS.rpcUrl).toContain('localhost');
    expect(STANDALONE_DEFAULTS.horizonUrl).toContain('localhost');
  });

  it('testnet has explorer URL', () => {
    expect(TESTNET_DEFAULTS.explorerUrl).toContain('stellar.expert');
  });

  it('getNetwork returns a copy, not the original', () => {
    const config = getNetwork('testnet')!;
    config.rpcUrl = 'https://mutated.example.com';
    // Original default should be unchanged
    expect(TESTNET_DEFAULTS.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    // Registry entry should also be unchanged
    expect(getNetwork('testnet')!.rpcUrl).toBe('https://soroban-testnet.stellar.org');
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validateNetworkConfig', () => {
  it('returns valid for a complete correct config', () => {
    const result = validateNetworkConfig(VALID_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid for null', () => {
    const result = validateNetworkConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns invalid for non-object', () => {
    const result = validateNetworkConfig('testnet');
    expect(result.valid).toBe(false);
  });

  it('reports missing network field', () => {
    const { network, ...rest } = VALID_CONFIG;
    const result = validateNetworkConfig(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('network'))).toBe(true);
  });

  it('reports missing rpcUrl', () => {
    const { rpcUrl, ...rest } = VALID_CONFIG;
    const result = validateNetworkConfig(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rpcUrl'))).toBe(true);
  });

  it('reports invalid rpcUrl (not a URL)', () => {
    const result = validateNetworkConfig({ ...VALID_CONFIG, rpcUrl: 'not-a-url' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rpcUrl'))).toBe(true);
  });

  it('rejects non-http/https URLs', () => {
    const result = validateNetworkConfig({ ...VALID_CONFIG, rpcUrl: 'ftp://example.com' });
    expect(result.valid).toBe(false);
  });

  it('reports missing networkPassphrase', () => {
    const { networkPassphrase, ...rest } = VALID_CONFIG;
    const result = validateNetworkConfig(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('networkPassphrase'))).toBe(true);
  });

  it('reports invalid explorerUrl when provided', () => {
    const result = validateNetworkConfig({ ...VALID_CONFIG, explorerUrl: 'not-a-url' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('explorerUrl'))).toBe(true);
  });

  it('accepts config without explorerUrl (optional)', () => {
    const { explorerUrl, ...rest } = VALID_CONFIG;
    const result = validateNetworkConfig(rest);
    expect(result.valid).toBe(true);
  });

  it('reports missing contractIds', () => {
    const { contractIds, ...rest } = VALID_CONFIG;
    const result = validateNetworkConfig(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contractIds'))).toBe(true);
  });

  it('reports missing individual contract fields', () => {
    const result = validateNetworkConfig({
      ...VALID_CONFIG,
      contractIds: { platform: 'CABC123' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contractIds.aidRegistry'))).toBe(true);
  });

  it('collects all errors, not just the first', () => {
    const result = validateNetworkConfig({
      network: '',
      rpcUrl: 'bad',
      horizonUrl: 'bad',
      networkPassphrase: '',
      contractIds: {},
    });
    expect(result.errors.length).toBeGreaterThan(3);
  });
});

describe('assertValidNetworkConfig', () => {
  it('does not throw for valid config', () => {
    expect(() => assertValidNetworkConfig(VALID_CONFIG)).not.toThrow();
  });

  it('throws with all errors for invalid config', () => {
    expect(() => assertValidNetworkConfig({ network: '' })).toThrow(
      /Invalid Stellar network configuration/
    );
  });

  it('error message lists specific problems', () => {
    try {
      assertValidNetworkConfig({ network: 'test', rpcUrl: 'bad' });
    } catch (e: unknown) {
      expect((e as Error).message).toContain('rpcUrl');
    }
  });
});

// ─── Network Registry ─────────────────────────────────────────────────────────

describe('registerNetwork / getNetwork / listNetworks', () => {
  it('registers a valid custom network', () => {
    registerNetwork('reg-test-net', { ...VALID_CONFIG });
    const retrieved = getNetwork('reg-test-net');
    expect(retrieved).toBeDefined();
    expect(retrieved!.network).toBe('reg-test-net');
    expect(retrieved!.rpcUrl).toBe(VALID_CONFIG.rpcUrl);
  });

  it('lists registered networks including custom ones', () => {
    registerNetwork('list-test-net', { ...VALID_CONFIG });
    const networks = listNetworks();
    expect(networks).toContain('testnet');
    expect(networks).toContain('mainnet');
    expect(networks).toContain('standalone');
    expect(networks).toContain('list-test-net');
  });

  it('throws when trying to override built-in testnet', () => {
    expect(() =>
      registerNetwork('testnet', { ...VALID_CONFIG })
    ).toThrow(/Cannot override built-in network/);
  });

  it('throws when trying to override built-in mainnet', () => {
    expect(() =>
      registerNetwork('mainnet', { ...VALID_CONFIG })
    ).toThrow(/Cannot override built-in network/);
  });

  it('throws when registering invalid custom config', () => {
    expect(() =>
      registerNetwork('bad-net', {
        rpcUrl: 'not-a-url',
        horizonUrl: 'not-a-url',
        networkPassphrase: '',
        contractIds: {} as any,
      })
    ).toThrow(/Invalid configuration for network/);
  });

  it('returns undefined for unknown network', () => {
    expect(getNetwork('nonexistent-network-xyz')).toBeUndefined();
  });

  it('sets network field to the registered name', () => {
    registerNetwork('auto-name-test', { ...VALID_CONFIG });
    expect(getNetwork('auto-name-test')!.network).toBe('auto-name-test');
  });

  it('getNetwork returns a copy — mutations do not affect registry', () => {
    registerNetwork('copy-test-net', { ...VALID_CONFIG });
    const copy = getNetwork('copy-test-net')!;
    copy.rpcUrl = 'https://mutated.example.com';
    expect(getNetwork('copy-test-net')!.rpcUrl).toBe(VALID_CONFIG.rpcUrl);
  });
});

// ─── Environment Variable Overrides ──────────────────────────────────────────

describe('applyEnvOverrides', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns base config unchanged when no env vars set', () => {
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.rpcUrl).toBe(TESTNET_DEFAULTS.rpcUrl);
    expect(result.networkPassphrase).toBe(TESTNET_DEFAULTS.networkPassphrase);
  });

  it('overrides rpcUrl from env', () => {
    process.env[ENV_VARS.RPC_URL] = 'https://custom-rpc.example.com';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.rpcUrl).toBe('https://custom-rpc.example.com');
  });

  it('overrides horizonUrl from env', () => {
    process.env[ENV_VARS.HORIZON_URL] = 'https://custom-horizon.example.com';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.horizonUrl).toBe('https://custom-horizon.example.com');
  });

  it('overrides networkPassphrase from env', () => {
    process.env[ENV_VARS.NETWORK_PASSPHRASE] = 'Custom Passphrase ; 2024';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.networkPassphrase).toBe('Custom Passphrase ; 2024');
  });

  it('overrides explorerUrl from env', () => {
    process.env[ENV_VARS.EXPLORER_URL] = 'https://custom-explorer.example.com';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.explorerUrl).toBe('https://custom-explorer.example.com');
  });

  it('overrides individual contract IDs from env', () => {
    process.env[ENV_VARS.CONTRACT_AID_REGISTRY] = 'CNEWCONTRACT123';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.contractIds.aidRegistry).toBe('CNEWCONTRACT123');
  });

  it('overrides network name from env', () => {
    process.env[ENV_VARS.NETWORK] = 'staging';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.network).toBe('staging');
  });

  it('does not mutate the base config', () => {
    process.env[ENV_VARS.RPC_URL] = 'https://mutated.example.com';
    applyEnvOverrides(TESTNET_DEFAULTS);
    expect(TESTNET_DEFAULTS.rpcUrl).toBe('https://soroban-testnet.stellar.org');
  });

  it('ignores empty string env vars', () => {
    process.env[ENV_VARS.RPC_URL] = '';
    const result = applyEnvOverrides(TESTNET_DEFAULTS);
    expect(result.rpcUrl).toBe(TESTNET_DEFAULTS.rpcUrl);
  });
});

// ─── Config Loader ────────────────────────────────────────────────────────────

describe('loadNetworkConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads testnet by name', () => {
    const config = loadNetworkConfig('testnet', { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('testnet');
    expect(config.rpcUrl).toBe(TESTNET_DEFAULTS.rpcUrl);
  });

  it('loads mainnet by name', () => {
    const config = loadNetworkConfig('mainnet', { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('mainnet');
  });

  it('loads standalone by name', () => {
    const config = loadNetworkConfig('standalone', { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('standalone');
  });

  it('defaults to testnet when no name provided', () => {
    const config = loadNetworkConfig(undefined, { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('testnet');
  });

  it('throws for unknown network name', () => {
    expect(() => loadNetworkConfig('nonexistent-xyz')).toThrow(/Unknown network/);
  });

  it('error message lists available networks', () => {
    try {
      loadNetworkConfig('nonexistent-xyz');
    } catch (e: unknown) {
      expect((e as Error).message).toContain('testnet');
      expect((e as Error).message).toContain('mainnet');
    }
  });

  it('uses STELLAR_NETWORK env var over parameter', () => {
    process.env[ENV_VARS.NETWORK] = 'testnet';
    const config = loadNetworkConfig('mainnet', { skipValidation: true });
    expect(config.network).toBe('testnet');
  });

  it('applies env overrides by default', () => {
    process.env[ENV_VARS.RPC_URL] = 'https://override.example.com';
    const config = loadNetworkConfig('testnet', { skipValidation: true });
    expect(config.rpcUrl).toBe('https://override.example.com');
  });

  it('skips env overrides when applyEnv is false', () => {
    process.env[ENV_VARS.RPC_URL] = 'https://override.example.com';
    const config = loadNetworkConfig('testnet', { skipValidation: true, applyEnv: false });
    expect(config.rpcUrl).toBe(TESTNET_DEFAULTS.rpcUrl);
  });

  it('loads a custom registered network', () => {
    registerNetwork('loader-test-net', { ...VALID_CONFIG });
    const config = loadNetworkConfig('loader-test-net', { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('loader-test-net');
    expect(config.rpcUrl).toBe(VALID_CONFIG.rpcUrl);
  });

  it('does not mutate the registry entry', () => {
    const config = loadNetworkConfig('testnet', { skipValidation: true, applyEnv: false });
    config.rpcUrl = 'https://mutated.example.com';
    const config2 = loadNetworkConfig('testnet', { skipValidation: true, applyEnv: false });
    expect(config2.rpcUrl).toBe(TESTNET_DEFAULTS.rpcUrl);
  });
});

// ─── fromLegacyConfig ─────────────────────────────────────────────────────────

describe('fromLegacyConfig', () => {
  it('fills in networkPassphrase from built-in defaults for testnet', () => {
    const result = fromLegacyConfig({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      contractIds: { ...VALID_CONTRACTS },
    });
    expect(result.networkPassphrase).toBe(TESTNET_DEFAULTS.networkPassphrase);
  });

  it('fills in networkPassphrase for mainnet', () => {
    const result = fromLegacyConfig({
      network: 'mainnet',
      rpcUrl: 'https://soroban.stellar.org',
      horizonUrl: 'https://horizon.stellar.org',
      contractIds: { ...VALID_CONTRACTS },
    });
    expect(result.networkPassphrase).toBe(MAINNET_DEFAULTS.networkPassphrase);
  });

  it('uses empty passphrase for unknown network', () => {
    const result = fromLegacyConfig({
      network: 'unknown-net',
      rpcUrl: 'https://rpc.example.com',
      horizonUrl: 'https://horizon.example.com',
      contractIds: { ...VALID_CONTRACTS },
    });
    expect(result.networkPassphrase).toBe('');
  });

  it('preserves all original fields', () => {
    const legacy = {
      network: 'testnet',
      rpcUrl: 'https://custom-rpc.example.com',
      horizonUrl: 'https://custom-horizon.example.com',
      contractIds: { ...VALID_CONTRACTS },
    };
    const result = fromLegacyConfig(legacy);
    expect(result.rpcUrl).toBe(legacy.rpcUrl);
    expect(result.horizonUrl).toBe(legacy.horizonUrl);
    expect(result.contractIds).toEqual(legacy.contractIds);
  });

  it('includes explorerUrl from built-in defaults', () => {
    const result = fromLegacyConfig({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      contractIds: { ...VALID_CONTRACTS },
    });
    expect(result.explorerUrl).toBe(TESTNET_DEFAULTS.explorerUrl);
  });
});

// ─── Custom network switching ─────────────────────────────────────────────────

describe('Custom network switching', () => {
  it('can switch between testnet and mainnet', () => {
    const testnet = loadNetworkConfig('testnet', { skipValidation: true, applyEnv: false });
    const mainnet = loadNetworkConfig('mainnet', { skipValidation: true, applyEnv: false });
    expect(testnet.networkPassphrase).not.toBe(mainnet.networkPassphrase);
    expect(testnet.rpcUrl).not.toBe(mainnet.rpcUrl);
  });

  it('can register and switch to a custom network', () => {
    registerNetwork('switch-test-net', {
      rpcUrl: 'https://rpc.switch-test.example.com',
      horizonUrl: 'https://horizon.switch-test.example.com',
      networkPassphrase: 'Switch Test Network ; 2024',
      contractIds: { ...VALID_CONTRACTS },
    });
    const config = loadNetworkConfig('switch-test-net', { skipValidation: true, applyEnv: false });
    expect(config.network).toBe('switch-test-net');
    expect(config.networkPassphrase).toBe('Switch Test Network ; 2024');
  });

  it('env var STELLAR_NETWORK switches active network', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, [ENV_VARS.NETWORK]: 'mainnet' };
    try {
      const config = loadNetworkConfig('testnet', { skipValidation: true });
      expect(config.network).toBe('mainnet');
    } finally {
      process.env = originalEnv;
    }
  });
});

// ─── Endpoint resolution ──────────────────────────────────────────────────────

describe('Endpoint resolution', () => {
  it('testnet RPC URL is reachable format', () => {
    expect(TESTNET_DEFAULTS.rpcUrl).toMatch(/^https?:\/\//);
  });

  it('mainnet Horizon URL is reachable format', () => {
    expect(MAINNET_DEFAULTS.horizonUrl).toMatch(/^https?:\/\//);
  });

  it('standalone uses localhost', () => {
    expect(STANDALONE_DEFAULTS.rpcUrl).toMatch(/localhost/);
  });

  it('custom network can use any valid http/https URL', () => {
    expect(() =>
      registerNetwork('endpoint-test-net', {
        rpcUrl: 'http://192.168.1.100:8000/soroban/rpc',
        horizonUrl: 'http://192.168.1.100:8000',
        networkPassphrase: 'Local Dev Network ; 2024',
        contractIds: { ...VALID_CONTRACTS },
      })
    ).not.toThrow();
  });
});

// ─── Backward compatibility ───────────────────────────────────────────────────

describe('Backward compatibility with existing NetworkConfig', () => {
  it('TESTNET_CONFIG from index has networkPassphrase', () => {
    expect((TESTNET_CONFIG as any).networkPassphrase).toBeDefined();
    expect((TESTNET_CONFIG as any).networkPassphrase).toBe(TESTNET_DEFAULTS.networkPassphrase);
  });

  it('MAINNET_CONFIG from index has networkPassphrase', () => {
    expect((MAINNET_CONFIG as any).networkPassphrase).toBeDefined();
  });

  it('TESTNET_CONFIG has explorerUrl', () => {
    expect((TESTNET_CONFIG as any).explorerUrl).toBeDefined();
  });

  it('existing NetworkConfig type fields are still present in StellarNetworkConfig', () => {
    const config: StellarNetworkConfig = {
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractIds: { ...VALID_CONTRACTS },
    };
    expect(config.network).toBeDefined();
    expect(config.rpcUrl).toBeDefined();
    expect(config.horizonUrl).toBeDefined();
    expect(config.contractIds).toBeDefined();
  });
});
