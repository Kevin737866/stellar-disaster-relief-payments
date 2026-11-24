"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_TYPES = exports.SUPPLY_TYPES = exports.DISASTER_TYPES = exports.createDisasterReliefSDK = exports.MAINNET_CONFIG = exports.TESTNET_CONFIG = exports.ERROR_MESSAGES = exports.defaultI18n = exports.I18nManager = exports.MerchantApp = exports.MerchantNetworkSDK = exports.DuplicatePreventionClient = exports.FundExpiryNotificationsClient = exports.DonorTransparencyClient = exports.EmergencyFundsClient = exports.ReadCache = exports.TrackerClient = exports.TransferClient = exports.MAX_MERCHANT_PAGE_SIZE = exports.DEFAULT_MERCHANT_PAGE_SIZE = exports.MerchantClient = exports.OfflineAuthClient = exports.BeneficiaryIdentityClient = exports.isDisbursementPurposeCategory = exports.validatePurpose = exports.classifyPurpose = exports.categorizePurpose = exports.normalizePurpose = exports.MAX_BENEFICIARY_PAGE_SIZE = exports.DEFAULT_BENEFICIARY_PAGE_SIZE = exports.BeneficiaryClient = exports.estimateTotalCost = exports.estimateMultipleContractCosts = exports.estimateContractCost = exports.CostEstimationClient = exports.MIN_BATCH_SIZE = exports.MAX_BATCH_SIZE = exports.AidClient = void 0;
// Export all clients
var aidClient_1 = require("./aidClient");
Object.defineProperty(exports, "AidClient", { enumerable: true, get: function () { return aidClient_1.AidClient; } });
Object.defineProperty(exports, "MAX_BATCH_SIZE", { enumerable: true, get: function () { return aidClient_1.MAX_BATCH_SIZE; } });
Object.defineProperty(exports, "MIN_BATCH_SIZE", { enumerable: true, get: function () { return aidClient_1.MIN_BATCH_SIZE; } });
var costEstimation_1 = require("./costEstimation");
Object.defineProperty(exports, "CostEstimationClient", { enumerable: true, get: function () { return costEstimation_1.CostEstimationClient; } });
var costEstimation_2 = require("./costEstimation");
Object.defineProperty(exports, "estimateContractCost", { enumerable: true, get: function () { return costEstimation_2.estimateContractCost; } });
Object.defineProperty(exports, "estimateMultipleContractCosts", { enumerable: true, get: function () { return costEstimation_2.estimateMultipleContractCosts; } });
Object.defineProperty(exports, "estimateTotalCost", { enumerable: true, get: function () { return costEstimation_2.estimateTotalCost; } });
var beneficiaryClient_1 = require("./beneficiaryClient");
Object.defineProperty(exports, "BeneficiaryClient", { enumerable: true, get: function () { return beneficiaryClient_1.BeneficiaryClient; } });
Object.defineProperty(exports, "DEFAULT_BENEFICIARY_PAGE_SIZE", { enumerable: true, get: function () { return beneficiaryClient_1.DEFAULT_BENEFICIARY_PAGE_SIZE; } });
Object.defineProperty(exports, "MAX_BENEFICIARY_PAGE_SIZE", { enumerable: true, get: function () { return beneficiaryClient_1.MAX_BENEFICIARY_PAGE_SIZE; } });
var purposeTaxonomy_1 = require("./purposeTaxonomy");
Object.defineProperty(exports, "normalizePurpose", { enumerable: true, get: function () { return purposeTaxonomy_1.normalizePurpose; } });
Object.defineProperty(exports, "categorizePurpose", { enumerable: true, get: function () { return purposeTaxonomy_1.categorizePurpose; } });
Object.defineProperty(exports, "classifyPurpose", { enumerable: true, get: function () { return purposeTaxonomy_1.classifyPurpose; } });
Object.defineProperty(exports, "validatePurpose", { enumerable: true, get: function () { return purposeTaxonomy_1.validatePurpose; } });
Object.defineProperty(exports, "isDisbursementPurposeCategory", { enumerable: true, get: function () { return purposeTaxonomy_1.isDisbursementPurposeCategory; } });
var beneficiaryIdentity_1 = require("./beneficiaryIdentity");
Object.defineProperty(exports, "BeneficiaryIdentityClient", { enumerable: true, get: function () { return beneficiaryIdentity_1.BeneficiaryIdentityClient; } });
var offlineAuth_1 = require("./offlineAuth");
Object.defineProperty(exports, "OfflineAuthClient", { enumerable: true, get: function () { return offlineAuth_1.OfflineAuthClient; } });
var merchantClient_1 = require("./merchantClient");
Object.defineProperty(exports, "MerchantClient", { enumerable: true, get: function () { return merchantClient_1.MerchantClient; } });
Object.defineProperty(exports, "DEFAULT_MERCHANT_PAGE_SIZE", { enumerable: true, get: function () { return merchantClient_1.DEFAULT_MERCHANT_PAGE_SIZE; } });
Object.defineProperty(exports, "MAX_MERCHANT_PAGE_SIZE", { enumerable: true, get: function () { return merchantClient_1.MAX_MERCHANT_PAGE_SIZE; } });
var transferClient_1 = require("./transferClient");
Object.defineProperty(exports, "TransferClient", { enumerable: true, get: function () { return transferClient_1.TransferClient; } });
var trackerClient_1 = require("./trackerClient");
Object.defineProperty(exports, "TrackerClient", { enumerable: true, get: function () { return trackerClient_1.TrackerClient; } });
var readCache_1 = require("./readCache");
Object.defineProperty(exports, "ReadCache", { enumerable: true, get: function () { return readCache_1.ReadCache; } });
const aidClient_2 = require("./aidClient");
const feeBumpClient_1 = require("./feeBumpClient");
const transactionSimulator_1 = require("./transactionSimulator");
const logger_1 = require("./logger");
const beneficiaryClient_2 = require("./beneficiaryClient");
const merchantClient_2 = require("./merchantClient");
const transferClient_2 = require("./transferClient");
const trackerClient_2 = require("./trackerClient");
// Export Emergency Funds SDK
var emergencyFunds_1 = require("./emergencyFunds");
Object.defineProperty(exports, "EmergencyFundsClient", { enumerable: true, get: function () { return emergencyFunds_1.EmergencyFundsClient; } });
var donorTransparency_1 = require("./donorTransparency");
Object.defineProperty(exports, "DonorTransparencyClient", { enumerable: true, get: function () { return donorTransparency_1.DonorTransparencyClient; } });
var fundExpiryNotifications_1 = require("./fundExpiryNotifications");
Object.defineProperty(exports, "FundExpiryNotificationsClient", { enumerable: true, get: function () { return fundExpiryNotifications_1.FundExpiryNotificationsClient; } });
var duplicatePrevention_1 = require("./duplicatePrevention");
Object.defineProperty(exports, "DuplicatePreventionClient", { enumerable: true, get: function () { return duplicatePrevention_1.DuplicatePreventionClient; } });
// Export Merchant Network SDK
var merchantNetwork_1 = require("./merchantNetwork");
Object.defineProperty(exports, "MerchantNetworkSDK", { enumerable: true, get: function () { return merchantNetwork_1.MerchantNetworkSDK; } });
var merchantApp_1 = require("./merchantApp");
Object.defineProperty(exports, "MerchantApp", { enumerable: true, get: function () { return merchantApp_1.MerchantApp; } });
// Export i18n (Internationalization) Support
var i18n_1 = require("./i18n");
Object.defineProperty(exports, "I18nManager", { enumerable: true, get: function () { return i18n_1.I18nManager; } });
Object.defineProperty(exports, "defaultI18n", { enumerable: true, get: function () { return i18n_1.defaultI18n; } });
Object.defineProperty(exports, "ERROR_MESSAGES", { enumerable: true, get: function () { return i18n_1.ERROR_MESSAGES; } });
// Export all types
__exportStar(require("./types"), exports);
// Export error types
__exportStar(require("./errors"), exports);
// Export network configurations
// Note: RPC/Horizon URLs and network passphrases below are real network endpoints.
// The contractIds values are PLACEHOLDERS and must be replaced with live deployed contract
// addresses (e.g. starting with 'C...') produced by `soroban contract deploy`.
exports.TESTNET_CONFIG = {
    network: 'testnet',
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
exports.MAINNET_CONFIG = {
    network: 'mainnet',
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
const createDisasterReliefSDK = (config) => {
    if (config.logging) {
        logger_1.logger.configure(config.logging);
    }
    return {
        aidClient: new aidClient_2.AidClient(config),
        beneficiaryClient: new beneficiaryClient_2.BeneficiaryClient(config),
        merchantClient: new merchantClient_2.MerchantClient(config),
        transferClient: new transferClient_2.TransferClient(config),
        trackerClient: new trackerClient_2.TrackerClient(config),
        feeBumpClient: new feeBumpClient_1.FeeBumpClient(config),
        transactionSimulator: new transactionSimulator_1.TransactionSimulator(config),
    };
};
exports.createDisasterReliefSDK = createDisasterReliefSDK;
// Export constants
exports.DISASTER_TYPES = {
    EARTHQUAKE: 'earthquake',
    FLOOD: 'flood',
    HURRICANE: 'hurricane',
    WILDFIRE: 'wildfire',
    DROUGHT: 'drought',
    PANDEMIC: 'pandemic',
    CONFLICT: 'conflict',
    TSUNAMI: 'tsunami'
};
exports.SUPPLY_TYPES = {
    FOOD: 'food',
    WATER: 'water',
    MEDICINE: 'medicine',
    SHELTER: 'shelter',
    CLOTHING: 'clothing',
    HYGIENE: 'hygiene',
    TOOLS: 'tools',
    FUEL: 'fuel'
};
exports.BUSINESS_TYPES = {
    GROCERY: 'grocery',
    PHARMACY: 'pharmacy',
    HARDWARE: 'hardware',
    FUEL_STATION: 'fuel_station',
    CLOTHING: 'clothing',
    RESTAURANT: 'restaurant',
    TRANSPORT: 'transport',
    COMMUNICATION: 'communication'
};
//# sourceMappingURL=index.js.map