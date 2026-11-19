// Export all clients
export { AidClient, MAX_BATCH_SIZE, MIN_BATCH_SIZE } from './aidClient';
export { CostEstimationClient } from './costEstimation';
export type { CostEstimate, CostEstimationOptions, ContractInteractionType } from './costEstimation';
export { estimateContractCost, estimateMultipleContractCosts, estimateTotalCost } from './costEstimation';
export {
  BeneficiaryClient,
  DEFAULT_BENEFICIARY_PAGE_SIZE,
  MAX_BENEFICIARY_PAGE_SIZE,
} from './beneficiaryClient';
export {
  normalizePurpose,
  categorizePurpose,
  classifyPurpose,
  validatePurpose,
  isDisbursementPurposeCategory,
} from './purposeTaxonomy';
export { BeneficiaryIdentityClient } from './beneficiaryIdentity';
export { OfflineAuthClient } from './offlineAuth';
export {
  MerchantClient,
  DEFAULT_MERCHANT_PAGE_SIZE,
  MAX_MERCHANT_PAGE_SIZE,
} from './merchantClient';
export { TransferClient } from './transferClient';
export { TrackerClient } from './trackerClient';
export { ReadCache } from './readCache';

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
export { FundExpiryNotificationsClient } from './fundExpiryNotifications';
export { DuplicatePreventionClient } from './duplicatePrevention';

// Export Merchant Network SDK
export { MerchantNetworkSDK } from './merchantNetwork';
export { MerchantApp } from './merchantApp';

// Export i18n (Internationalization) Support
export { I18nManager, defaultI18n, ERROR_MESSAGES } from './i18n';
export type { Language, ErrorMessage, LocalizedErrorMessages } from './i18n';

// Export all types
export * from './types';

// Export error types
export * from './errors';

// Export network configurations
// Note: RPC/Horizon URLs and network passphrases below are real network endpoints.
// The contractIds values are PLACEHOLDERS and must be replaced with live deployed contract
// addresses (e.g. starting with 'C...') produced by `soroban contract deploy`.
export const TESTNET_CONFIG = {
  network: 'testnet' as const,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  contractIds: {
    // [PLACEHOLDER] Replace with deployed contract ID (e.g. 'CA...')
    platform: '<PLACEHOLDER_PLATFORM_CONTRACT_ID>',
    aidRegistry: '<PLACEHOLDER_AID_REGISTRY_CONTRACT_ID>',
    beneficiaryManager: '<PLACEHOLDER_BENEFICIARY_MANAGER_CONTRACT_ID>',
    merchantNetwork: '<PLACEHOLDER_MERCHANT_NETWORK_CONTRACT_ID>',
    cashTransfer: '<PLACEHOLDER_CASH_TRANSFER_CONTRACT_ID>',
    supplyChainTracker: '<PLACEHOLDER_SUPPLY_CHAIN_TRACKER_CONTRACT_ID>',
    antiFraud: '<PLACEHOLDER_ANTI_FRAUD_CONTRACT_ID>'
  }
};

export const MAINNET_CONFIG = {
  network: 'mainnet' as const,
  rpcUrl: 'https://soroban.stellar.org',
  horizonUrl: 'https://horizon.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  explorerUrl: 'https://stellar.expert/explorer/public',
  contractIds: {
    // [PLACEHOLDER] Replace with deployed mainnet contract ID (e.g. 'CA...')
    platform: '<PLACEHOLDER_MAINNET_PLATFORM_CONTRACT_ID>',
    aidRegistry: '<PLACEHOLDER_MAINNET_AID_REGISTRY_CONTRACT_ID>',
    beneficiaryManager: '<PLACEHOLDER_MAINNET_BENEFICIARY_MANAGER_CONTRACT_ID>',
    merchantNetwork: '<PLACEHOLDER_MAINNET_MERCHANT_NETWORK_CONTRACT_ID>',
    cashTransfer: '<PLACEHOLDER_MAINNET_CASH_TRANSFER_CONTRACT_ID>',
    supplyChainTracker: '<PLACEHOLDER_MAINNET_SUPPLY_CHAIN_TRACKER_CONTRACT_ID>',
    antiFraud: '<PLACEHOLDER_MAINNET_ANTI_FRAUD_CONTRACT_ID>'
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
