import { StrKey } from 'stellar-sdk';
import {
  MAINNET_CONFIG,
  TESTNET_CONFIG,
  assertValidNetworkConfig,
  createDisasterReliefSDK,
  isPlaceholderContractId,
} from '../index';

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

describe('SDK initialization contract ID guard (#161)', () => {
  it('rejects TESTNET_CONFIG and MAINNET_CONFIG templates with actionable errors', () => {
    expect(isPlaceholderContractId('CONTRACT_ID_HERE')).toBe(true);
    expect(isPlaceholderContractId(TESTNET_CONFIG.contractIds.platform)).toBe(true);
    expect(isPlaceholderContractId(MAINNET_CONFIG.contractIds.aidRegistry)).toBe(true);

    expect(() => createDisasterReliefSDK(TESTNET_CONFIG)).toThrow(
      /contractIds\.platform is still a placeholder/i
    );
    expect(() => createDisasterReliefSDK(MAINNET_CONFIG)).toThrow(
      /Deploy the contracts/i
    );
  });

  it('rejects malformed non-C contract IDs', () => {
    const badConfig = {
      ...TESTNET_CONFIG,
      contractIds: {
        platform: 'not-a-contract-id',
        aidRegistry: contractId(1),
        beneficiaryManager: contractId(2),
        merchantNetwork: contractId(3),
        cashTransfer: contractId(4),
        supplyChainTracker: contractId(5),
        antiFraud: contractId(6),
      },
    };
    expect(() => assertValidNetworkConfig(badConfig)).toThrow(/not a valid Soroban contract address/i);
  });

  it('initializes all clients cleanly when valid deployed C... contract IDs are supplied', () => {
    const validConfig = {
      network: 'testnet' as const,
      rpcUrl: TESTNET_CONFIG.rpcUrl,
      horizonUrl: TESTNET_CONFIG.horizonUrl,
      contractIds: {
        platform: contractId(0),
        aidRegistry: contractId(1),
        beneficiaryManager: contractId(2),
        merchantNetwork: contractId(3),
        cashTransfer: contractId(4),
        supplyChainTracker: contractId(5),
        antiFraud: contractId(6),
      },
    };
    const sdk = createDisasterReliefSDK(validConfig);
    expect(sdk.aidClient).toBeDefined();
    expect(sdk.beneficiaryClient).toBeDefined();
    expect(sdk.merchantClient).toBeDefined();
    expect(sdk.transferClient).toBeDefined();
    expect(sdk.trackerClient).toBeDefined();
  });
});
