/**
 * Intentional type-check negative fixture.
 *
 * This file is excluded from `npm run typecheck:examples` and is checked only
 * by `npm run typecheck:examples:negative`, which must fail. It proves that
 * the example configuration actually validates calls against the public SDK
 * API instead of silently accepting any shape.
 */
import { createDisasterReliefSDK, TESTNET_CONFIG } from 'stellar-disaster-relief-sdk';

const sdk = createDisasterReliefSDK(TESTNET_CONFIG);

// Not part of the public SDK API — the negative check must report an error.
sdk.aidClient.deployEmergencyFundThatDoesNotExist();
