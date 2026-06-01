// Export all clients
export { AidClient } from './aidClient';
export { FeeBumpClient } from './feeBumpClient';
export type { FeeBumpOptions, FeeBumpResult } from './feeBumpClient';
export { TransactionSimulator } from './transactionSimulator';
export type { SimulationResult } from './transactionSimulator';
export { logger, validateLoggingConfig } from './logger';
export type { LoggingConfig, LogLevel, LogDestination } from './logger';
export { BeneficiaryClient } from './beneficiaryClient';
export { BeneficiaryIdentityClient } from './beneficiaryIdentity';
export { OfflineAuthClient } from './offlineAuth';
export { MerchantClient } from './merchantClient';
export { TransferClient } from './transferClient';
export { TrackerClient } from './trackerClient';

import { AidClient } from './aidClient';
import { FeeBumpClient } from './feeBumpClient';
import { TransactionSimulator } from './transactionSimulator';
import { logger } from './logger';
import { BeneficiaryClient } from './beneficiaryClient';
import { MerchantClient } from './merchantClient';
import { TransferClient } from './transferClient';
import { TrackerClient } from './trackerClient';

// Export Emergency Funds SDK
export { EmergencyFundsClient } from './emergencyFunds';
export { DonorTransparencyClient } from './donorTransparency';

// Export Merchant Network SDK
export { MerchantNetworkSDK } from './merchantNetwork';
export { MerchantApp } from './merchantApp';

// Export all types
export * from './types';

// Export validation utilities
export { validateAddress, validateAddressList } from './validation';

// Export network configurations
export const TESTNET_CONFIG = {
  network: 'testnet' as const,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'CONTRACT_ID_HERE',
    aidRegistry: 'CONTRACT_ID_HERE',
    beneficiaryManager: 'CONTRACT_ID_HERE',
    merchantNetwork: 'CONTRACT_ID_HERE',
    cashTransfer: 'CONTRACT_ID_HERE',
    supplyChainTracker: 'CONTRACT_ID_HERE',
    antiFraud: 'CONTRACT_ID_HERE'
  }
};

export const MAINNET_CONFIG = {
  network: 'mainnet' as const,
  rpcUrl: 'https://soroban.stellar.org',
  horizonUrl: 'https://horizon.stellar.org',
  contractIds: {
    platform: 'CONTRACT_ID_HERE',
    aidRegistry: 'CONTRACT_ID_HERE',
    beneficiaryManager: 'CONTRACT_ID_HERE',
    merchantNetwork: 'CONTRACT_ID_HERE',
    cashTransfer: 'CONTRACT_ID_HERE',
    supplyChainTracker: 'CONTRACT_ID_HERE',
    antiFraud: 'CONTRACT_ID_HERE'
  }
};

// Export utility functions
export const createDisasterReliefSDK = (config: any) => {
  if (config.logging) {
    logger.configure(config.logging);
  }
  return {
    aidClient: new AidClient(config),
    beneficiaryClient: new BeneficiaryClient(config),
    merchantClient: new MerchantClient(config),
    transferClient: new TransferClient(config),
    trackerClient: new TrackerClient(config),
    feeBumpClient: new FeeBumpClient(config),
    transactionSimulator: new TransactionSimulator(config),
  };
};

// Export constants
export const DISASTER_TYPES = {
  EARTHQUAKE: 'earthquake',
  FLOOD: 'flood',
  HURRICANE: 'hurricane',
  WILDFIRE: 'wildfire',
  DROUGHT: 'drought',
  PANDEMIC: 'pandemic',
  CONFLICT: 'conflict',
  TSUNAMI: 'tsunami'
} as const;

export const SUPPLY_TYPES = {
  FOOD: 'food',
  WATER: 'water',
  MEDICINE: 'medicine',
  SHELTER: 'shelter',
  CLOTHING: 'clothing',
  HYGIENE: 'hygiene',
  TOOLS: 'tools',
  FUEL: 'fuel'
} as const;

export const BUSINESS_TYPES = {
  GROCERY: 'grocery',
  PHARMACY: 'pharmacy',
  HARDWARE: 'hardware',
  FUEL_STATION: 'fuel_station',
  CLOTHING: 'clothing',
  RESTAURANT: 'restaurant',
  TRANSPORT: 'transport',
  COMMUNICATION: 'communication'
} as const;
