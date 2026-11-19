/**
 * Unit tests for TrackerClient — covering:
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
import { NetworkConfig } from './types';

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

// ── Issue #183: getShipmentStatistics uncertainty guards ────────────────────

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