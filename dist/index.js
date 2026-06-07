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
exports.BUSINESS_TYPES = exports.SUPPLY_TYPES = exports.DISASTER_TYPES = exports.createDisasterReliefSDK = exports.MAINNET_CONFIG = exports.TESTNET_CONFIG = exports.MerchantApp = exports.MerchantNetworkSDK = exports.DonorTransparencyClient = exports.EmergencyFundsClient = exports.TrackerClient = exports.TransferClient = exports.MerchantClient = exports.OfflineAuthClient = exports.BeneficiaryIdentityClient = exports.BeneficiaryClient = exports.AidClient = void 0;
// Export all clients
var aidClient_1 = require("./aidClient");
Object.defineProperty(exports, "AidClient", { enumerable: true, get: function () { return aidClient_1.AidClient; } });
var beneficiaryClient_1 = require("./beneficiaryClient");
Object.defineProperty(exports, "BeneficiaryClient", { enumerable: true, get: function () { return beneficiaryClient_1.BeneficiaryClient; } });
var beneficiaryIdentity_1 = require("./beneficiaryIdentity");
Object.defineProperty(exports, "BeneficiaryIdentityClient", { enumerable: true, get: function () { return beneficiaryIdentity_1.BeneficiaryIdentityClient; } });
var offlineAuth_1 = require("./offlineAuth");
Object.defineProperty(exports, "OfflineAuthClient", { enumerable: true, get: function () { return offlineAuth_1.OfflineAuthClient; } });
var merchantClient_1 = require("./merchantClient");
Object.defineProperty(exports, "MerchantClient", { enumerable: true, get: function () { return merchantClient_1.MerchantClient; } });
var transferClient_1 = require("./transferClient");
Object.defineProperty(exports, "TransferClient", { enumerable: true, get: function () { return transferClient_1.TransferClient; } });
var trackerClient_1 = require("./trackerClient");
Object.defineProperty(exports, "TrackerClient", { enumerable: true, get: function () { return trackerClient_1.TrackerClient; } });
// Export Emergency Funds SDK
var emergencyFunds_1 = require("./emergencyFunds");
Object.defineProperty(exports, "EmergencyFundsClient", { enumerable: true, get: function () { return emergencyFunds_1.EmergencyFundsClient; } });
var donorTransparency_1 = require("./donorTransparency");
Object.defineProperty(exports, "DonorTransparencyClient", { enumerable: true, get: function () { return donorTransparency_1.DonorTransparencyClient; } });
// Export Merchant Network SDK
var merchantNetwork_1 = require("./merchantNetwork");
Object.defineProperty(exports, "MerchantNetworkSDK", { enumerable: true, get: function () { return merchantNetwork_1.MerchantNetworkSDK; } });
var merchantApp_1 = require("./merchantApp");
Object.defineProperty(exports, "MerchantApp", { enumerable: true, get: function () { return merchantApp_1.MerchantApp; } });
// Export all types
__exportStar(require("./types"), exports);
// Export network configurations
exports.TESTNET_CONFIG = {
    network: 'testnet',
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
exports.MAINNET_CONFIG = {
    network: 'mainnet',
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
const createDisasterReliefSDK = (config) => ({
    aidClient: new AidClient(config),
    beneficiaryClient: new BeneficiaryClient(config),
    merchantClient: new MerchantClient(config),
    transferClient: new TransferClient(config),
    trackerClient: new TrackerClient(config)
});
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