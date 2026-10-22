/**
 * Unit tests for TrackerClient — covering:
 *
 * Issue #181: createShipment must pass 17 flat arguments matching the Rust
 *   create_shipment contract (location objects flattened to lat_lng/address/
 *   facility/contact strings; temperatureRequirements serialised as Option).
 *
 * Issue #183: getShipmentStatistics must handle:
 *   - Missing / null quantityVerified on a checkpoint (returns uncertain instead
 *     of throwing from BigInt()).
 *   - Zero initialQuantity (returns uncertain instead of dividing by zero).
 *   - Normal happy path (returns numeric percentages).
 *   - No-checkpoint path (returns 0% loss, not uncertain).
 */

import { Keypair, StrKey } from 'stellar-sdk';
import { TrackerClient } from './trackerClient';
import { SupplyChainRequest, NetworkConfig } from './types';

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

const SAMPLE_REQUEST: SupplyChainRequest = {
  donorId: 'WHO_MEDICAL',
  supplyType: 'medicine',
  quantity: '50000',
  unit: 'units',
  originLatLng: '46.2044,6.1432',
  originAddress: 'WHO Headquarters',
  originFacility: 'WHO Distribution Center',
  originContact: 'Supply Coordinator',
  destinationLatLng: '-1.2921,36.8219',
  destinationAddress: 'Nairobi Hospital',
  destinationFacility: 'Regional Hub',
  destinationContact: 'Regional Manager',
  estimatedArrival: Date.now() + 7 * 24 * 60 * 60 * 1000,
  temperatureRequirements: { minTemp: 2, maxTemp: 8, critical: true },
  specialHandling: ['refrigerated', 'fragile'],
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

// ── Issue #181: createShipment contract alignment ───────────────────────────

describe('TrackerClient.createShipment — contract alignment (Issue #181)', () => {
  const donorKeypair = Keypair.random();

  test('calls "create_shipment" with exactly 17 contract arguments', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { method, args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );

    expect(method).toBe('create_shipment');
    // donor, shipment_id, donor_id, supply_type, quantity, unit,
    // origin_lat_lng, origin_address, origin_facility, origin_contact,
    // destination_lat_lng, destination_address, destination_facility, destination_contact,
    // estimated_arrival, temperature_requirements, special_handling = 17
    expect(args).toHaveLength(17);
  });

  test('passes originLatLng as the 7th argument (index 6)', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );
    // index 0=donor, 1=shipmentId, 2=donorId, 3=supplyType, 4=quantity, 5=unit
    // 6=originLatLng
    expect(args[6]).toBe('46.2044,6.1432');
  });

  test('passes destinationLatLng as the 11th argument (index 10)', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );
    expect(args[10]).toBe('-1.2921,36.8219');
  });

  test('serialises temperatureRequirements object as Some value (index 15)', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );
    // Should be the temperatureRequirements object (Some), not null
    expect(args[15]).toEqual({ minTemp: 2, maxTemp: 8, critical: true });
  });

  test('serialises null temperatureRequirements as None (null) at index 15', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const noTempRequest: SupplyChainRequest = { ...SAMPLE_REQUEST, temperatureRequirements: null };
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), noTempRequest)
    );
    expect(args[15]).toBeNull();
  });

  test('serialises undefined temperatureRequirements as None (null) at index 15', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const noTempRequest: SupplyChainRequest = { ...SAMPLE_REQUEST, temperatureRequirements: undefined };
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), noTempRequest)
    );
    expect(args[15]).toBeNull();
  });

  test('passes specialHandling as the 17th argument (index 16)', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );
    expect(args[16]).toEqual(['refrigerated', 'fragile']);
  });

  test('does NOT pass Location objects (no origin.latitude in any arg)', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { args } = await captureContractCall(client, () =>
      client.createShipment(donorKeypair.secret(), SAMPLE_REQUEST)
    );
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        expect((arg as any).latitude).toBeUndefined();
        expect((arg as any).longitude).toBeUndefined();
      }
    }
  });
});

describe('TrackerClient.createSupplyChainRequest — helper produces aligned shape', () => {
  test('returns SupplyChainRequest with flat location fields', () => {
    const client = new TrackerClient(CONFIG);
    const req = client.createSupplyChainRequest(
      'don_1', 'medicine', '1000', 'units',
      '46.2044,6.1432', 'WHO HQ', 'WHO Depot', 'John',
      '-1.2921,36.8219', 'Nairobi Hospital', 'Hub', 'Maria',
      Date.now() + 86400000,
      { minTemp: 2, maxTemp: 8, critical: true },
      ['refrigerated']
    );

    expect(req.originLatLng).toBe('46.2044,6.1432');
    expect(req.originFacility).toBe('WHO Depot');
    expect(req.destinationLatLng).toBe('-1.2921,36.8219');
    expect(req.destinationFacility).toBe('Hub');
    expect(req.temperatureRequirements).toEqual({ minTemp: 2, maxTemp: 8, critical: true });
    expect(req.specialHandling).toEqual(['refrigerated']);

    // Old Location-object fields must not exist on the request
    expect((req as any).origin).toBeUndefined();
    expect((req as any).destination).toBeUndefined();
  });

  test('defaults specialHandling to [] when omitted', () => {
    const client = new TrackerClient(CONFIG);
    const req = client.createSupplyChainRequest(
      'don_2', 'water', '500', 'liters',
      '0.0,0.0', 'addr', 'fac', 'contact',
      '1.0,1.0', 'addr2', 'fac2', 'contact2',
      Date.now() + 86400000
    );
    expect(req.specialHandling).toEqual([]);
  });
});

// ── Issue #183: getShipmentStatistics uncertainty guards ────────────────────

function makeShipment(overrides: Partial<any> = {}): any {
  return {
    quantity: '1000',
    currentStatus: 'in_transit',
    estimatedArrival: Date.now() + 86400000,
    checkpoints: [],
    temperatureRequirements: null,
    ...overrides,
  };
}

function makeCheckpoint(quantityVerified: string | null | undefined): any {
  return {
    timestamp: Date.now(),
    quantityVerified,
    temperature: null,
  };
}

describe('TrackerClient.getShipmentStatistics — uncertainty guards (Issue #183)', () => {
  function wireClient(shipment: any, confirmation?: any): TrackerClient {
    const client = new TrackerClient(CONFIG) as any;
    client.getShipmentHistory = jest.fn().mockResolvedValue({
      shipment,
      confirmation,
    });
    return client;
  }

  test('returns quantityLoss=0 and uncertain=false when no checkpoints', async () => {
    const client = wireClient(makeShipment({ checkpoints: [] }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBe(0);
    expect(stats.quantityLossUncertain).toBe(false);
  });

  test('returns correct quantityLoss for a normal checkpoint with full data', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [makeCheckpoint('900')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    // (1000 - 900) * 100 / 1000 = 10
    expect(stats.quantityLoss).toBe(10);
    expect(stats.quantityLossUncertain).toBe(false);
  });

  test('returns quantityLoss=null and uncertain=true when last checkpoint has null quantityVerified', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [makeCheckpoint(null)],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('returns quantityLoss=null and uncertain=true when last checkpoint has undefined quantityVerified', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [makeCheckpoint(undefined)],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('returns quantityLoss=null and uncertain=true when last checkpoint has empty string quantityVerified', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [makeCheckpoint('')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('returns uncertain=true when initialQuantity is "0"', async () => {
    const client = wireClient(makeShipment({
      quantity: '0',
      checkpoints: [makeCheckpoint('0')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('returns uncertain=true when initialQuantity is null', async () => {
    const client = wireClient(makeShipment({
      quantity: null,
      checkpoints: [makeCheckpoint('100')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('returns uncertain=true when initialQuantity is empty string', async () => {
    const client = wireClient(makeShipment({
      quantity: '',
      checkpoints: [makeCheckpoint('100')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBeNull();
    expect(stats.quantityLossUncertain).toBe(true);
  });

  test('does NOT throw when quantityVerified is missing — returns uncertain instead', async () => {
    const client = wireClient(makeShipment({
      quantity: '500',
      checkpoints: [makeCheckpoint(undefined)],
    }));
    await expect(
      (client as any).getShipmentStatistics('ship_1')
    ).resolves.not.toThrow();
  });

  test('reports 0% loss when initial and final quantities are equal', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [makeCheckpoint('1000')],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.quantityLoss).toBe(0);
    expect(stats.quantityLossUncertain).toBe(false);
  });

  test('throws NetworkError when shipment not found', async () => {
    const client = new TrackerClient(CONFIG) as any;
    client.getShipmentHistory = jest.fn().mockResolvedValue({});
    await expect(
      (client as any).getShipmentStatistics('missing_ship')
    ).rejects.toThrow();
  });

  test('returns correct totalCheckpoints count', async () => {
    const client = wireClient(makeShipment({
      quantity: '1000',
      checkpoints: [
        makeCheckpoint('990'),
        makeCheckpoint('980'),
        makeCheckpoint('970'),
      ],
    }));
    const stats = await (client as any).getShipmentStatistics('ship_1');
    expect(stats.totalCheckpoints).toBe(3);
  });
});
