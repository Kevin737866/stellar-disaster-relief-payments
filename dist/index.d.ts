export { AidClient } from './aidClient';
export { BeneficiaryClient } from './beneficiaryClient';
export { BeneficiaryIdentityClient } from './beneficiaryIdentity';
export { OfflineAuthClient } from './offlineAuth';
export { MerchantClient } from './merchantClient';
export { TransferClient } from './transferClient';
export { TrackerClient } from './trackerClient';
export { EmergencyFundsClient } from './emergencyFunds';
export { DonorTransparencyClient } from './donorTransparency';
export { MerchantNetworkSDK } from './merchantNetwork';
export { MerchantApp } from './merchantApp';
export * from './types';
export declare const TESTNET_CONFIG: {
    network: "testnet";
    rpcUrl: string;
    horizonUrl: string;
    contractIds: {
        platform: string;
        aidRegistry: string;
        beneficiaryManager: string;
        merchantNetwork: string;
        cashTransfer: string;
        supplyChainTracker: string;
        antiFraud: string;
    };
};
export declare const MAINNET_CONFIG: {
    network: "mainnet";
    rpcUrl: string;
    horizonUrl: string;
    contractIds: {
        platform: string;
        aidRegistry: string;
        beneficiaryManager: string;
        merchantNetwork: string;
        cashTransfer: string;
        supplyChainTracker: string;
        antiFraud: string;
    };
};
export declare const createDisasterReliefSDK: (config: any) => {
    aidClient: any;
    beneficiaryClient: any;
    merchantClient: any;
    transferClient: any;
    trackerClient: any;
};
export declare const DISASTER_TYPES: {
    readonly EARTHQUAKE: "earthquake";
    readonly FLOOD: "flood";
    readonly HURRICANE: "hurricane";
    readonly WILDFIRE: "wildfire";
    readonly DROUGHT: "drought";
    readonly PANDEMIC: "pandemic";
    readonly CONFLICT: "conflict";
    readonly TSUNAMI: "tsunami";
};
export declare const SUPPLY_TYPES: {
    readonly FOOD: "food";
    readonly WATER: "water";
    readonly MEDICINE: "medicine";
    readonly SHELTER: "shelter";
    readonly CLOTHING: "clothing";
    readonly HYGIENE: "hygiene";
    readonly TOOLS: "tools";
    readonly FUEL: "fuel";
};
export declare const BUSINESS_TYPES: {
    readonly GROCERY: "grocery";
    readonly PHARMACY: "pharmacy";
    readonly HARDWARE: "hardware";
    readonly FUEL_STATION: "fuel_station";
    readonly CLOTHING: "clothing";
    readonly RESTAURANT: "restaurant";
    readonly TRANSPORT: "transport";
    readonly COMMUNICATION: "communication";
};
//# sourceMappingURL=index.d.ts.map