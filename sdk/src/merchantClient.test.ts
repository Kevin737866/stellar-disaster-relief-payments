/**
 * Unit tests for MerchantClient — specifically the `registerMerchant` contract
 * argument alignment (Issue #175).
 *
 * These tests verify that:
 * 1. `registerMerchant` calls the contract with the 14 parameters that
 *    `register_merchant` in merchant_network.rs expects (excluding `env`):
 *    owner, merchant_id, name, business_type, category, location_lat_lng,
 *    location_address, location_city, location_country, location_postal_code,
 *    contact_info, accepted_tokens, vouchers, emergency_fast_track.
 * 2. Legacy fields (stellarTomlUrl, dailyLimit, monthlyLimit,
 *    verificationDocuments) are NOT forwarded to the contract.
 * 3. `buildOfflineRegisterMerchant` produces the same parameter layout.
 * 4. `createOnboardingRequest` helper returns a fully-populated
 *    `MerchantOnboardingRequest` object with the new shape.
 */

import { Keypair, StrKey } from 'stellar-sdk';
import { MerchantClient } from './merchantClient';
import { MerchantOnboardingRequest, NetworkConfig } from './types';

// ── Stellar SDK mock ────────────────────────────────────────────────────────

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({}),
        sendTransaction: jest.fn().mockResolvedValue({
          status: 'SUCCESS',
          result: { retval: true },
        }),
      })),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
        toXDR: jest.fn(() => 'mock-xdr'),
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
    })),
    nativeToScVal: jest.fn((v: unknown) => v),
    scValToNative: jest.fn((v: any) => v?.value ?? v),
    Address: jest.fn().mockImplementation((addr: string) => ({
      toScVal: () => addr,
    })),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
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

const SAMPLE_REQUEST: MerchantOnboardingRequest = {
  name: 'Relief Market',
  businessType: 'food',
  category: 0,
  locationLatLng: '18.4861,-69.9312',
  locationAddress: '123 Aid St',
  locationCity: 'Santo Domingo',
  locationCountry: 'Dominican Republic',
  locationPostalCode: '10100',
  contactInfo: '+1-555-0100',
  acceptedTokens: ['XLM'],
  vouchers: ['ben_001', 'ben_002', 'ben_003'],
  emergencyFastTrack: false,
};

async function captureContractCall(
  client: any,
  action: () => Promise<unknown>
): Promise<{ method: string; args: unknown[] }> {
  const call = jest.fn().mockReturnValue({});
  client.contract = { call };
  client.server = {
    getAccount: jest.fn().mockResolvedValue({}),
    sendTransaction: jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      result: { retval: true },
    }),
  };
  await action();
  expect(call).toHaveBeenCalledTimes(1);
  const [method, ...args] = call.mock.calls[0];
  return { method, args };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MerchantClient.registerMerchant — contract alignment (Issue #175)', () => {
  const ownerKeypair = Keypair.random();

  test('calls "register_merchant" with exactly 14 contract arguments', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );

    expect(method).toBe('register_merchant');
    // owner, merchant_id, name, business_type, category, location_lat_lng,
    // location_address, location_city, location_country, location_postal_code,
    // contact_info, accepted_tokens, vouchers, emergency_fast_track = 14
    expect(args).toHaveLength(14);
  });

  test('passes category as the 5th argument (index 4)', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );
    // index 0 = owner (Address ScVal), 1 = merchantId, 2 = name, 3 = businessType,
    // 4 = category
    expect(args[4]).toBe(0); // category: 0 (food)
  });

  test('passes locationLatLng as the 6th argument (index 5)', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );
    expect(args[5]).toBe('18.4861,-69.9312');
  });

  test('passes vouchers as the 13th argument (index 12)', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );
    expect(args[12]).toEqual(['ben_001', 'ben_002', 'ben_003']);
  });

  test('passes emergencyFastTrack as the 14th argument (index 13)', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );
    expect(args[13]).toBe(false);
  });

  test('emergencyFastTrack=true is forwarded correctly', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const fastTrackRequest: MerchantOnboardingRequest = {
      ...SAMPLE_REQUEST,
      emergencyFastTrack: true,
      vouchers: [],
    };
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_fast_1', fastTrackRequest)
    );
    expect(args[13]).toBe(true);
  });

  test('does NOT pass legacy fields (stellarTomlUrl, dailyLimit, monthlyLimit, verificationDocuments)', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.registerMerchant(ownerKeypair.secret(), 'mer_test_1', SAMPLE_REQUEST)
    );
    // None of the 14 positional arg values should be a URL or a "1000"/"10000" limit string
    const argValues = args.map(String);
    expect(argValues).not.toContain('https://stellar.expert/explorer/testnet/account/');
    expect(argValues).not.toContain('1000');
    expect(argValues).not.toContain('10000');
  });
});

describe('MerchantClient.buildOfflineRegisterMerchant — contract alignment (Issue #175)', () => {
  const ownerKeypair = Keypair.random();

  test('calls "register_merchant" with exactly 14 arguments', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureContractCall(client, () =>
      client.buildOfflineRegisterMerchant(
        ownerKeypair.publicKey(),
        'mer_offline_1',
        SAMPLE_REQUEST
      )
    );
    expect(method).toBe('register_merchant');
    expect(args).toHaveLength(14);
  });
});

describe('MerchantClient.createOnboardingRequest — helper produces aligned shape', () => {
  test('returns MerchantOnboardingRequest with all required contract fields', () => {
    const client = new MerchantClient(CONFIG);
    const request = client.createOnboardingRequest(
      'Relief Shop',
      'food',
      0,
      '18.4861,-69.9312',
      '123 Aid St',
      'Santo Domingo',
      'Dominican Republic',
      '10100',
      '+1-555-0100',
      ['ben_001'],
      false
    );

    expect(request.name).toBe('Relief Shop');
    expect(request.businessType).toBe('food');
    expect(request.category).toBe(0);
    expect(request.locationLatLng).toBe('18.4861,-69.9312');
    expect(request.locationAddress).toBe('123 Aid St');
    expect(request.locationCity).toBe('Santo Domingo');
    expect(request.locationCountry).toBe('Dominican Republic');
    expect(request.locationPostalCode).toBe('10100');
    expect(request.contactInfo).toBe('+1-555-0100');
    expect(request.acceptedTokens).toEqual(['XLM']);
    expect(request.vouchers).toEqual(['ben_001']);
    expect(request.emergencyFastTrack).toBe(false);

    // Old fields must no longer be present
    expect((request as any).stellarTomlUrl).toBeUndefined();
    expect((request as any).dailyLimit).toBeUndefined();
    expect((request as any).monthlyLimit).toBeUndefined();
    expect((request as any).verificationDocuments).toBeUndefined();
  });

  test('defaults vouchers to [] and emergencyFastTrack to false', () => {
    const client = new MerchantClient(CONFIG);
    const request = client.createOnboardingRequest(
      'Basic Shop', 'clothing', 4,
      '0.0,0.0', 'addr', 'city', 'country', '00000', 'contact'
    );
    expect(request.vouchers).toEqual([]);
    expect(request.emergencyFastTrack).toBe(false);
  });
});
