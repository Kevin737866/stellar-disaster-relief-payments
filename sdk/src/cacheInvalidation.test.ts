/**
 * Cache-invalidation tests for representative SDK write paths.
 *
 * The read cache is only useful if successful writes evict the entries they
 * make stale. Each test seeds the cache with the relevant read key(s), runs a
 * write, and verifies the next read goes back to the loader.
 */

import { Keypair, StrKey } from 'stellar-sdk';
import { AidClient } from './aidClient';
import { BeneficiaryClient } from './beneficiaryClient';
import { MerchantClient } from './merchantClient';
import { TransferClient } from './transferClient';
import { TrackerClient } from './trackerClient';
import { NetworkConfig } from './types';

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Server: jest.fn().mockImplementation(() => ({})),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
    nativeToScVal: jest.fn((value: unknown) => value),
    scValToNative: jest.fn((value: any) => value?.value ?? value),
  };
});

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

function makeServer() {
  return {
    getAccount: jest.fn().mockResolvedValue({}),
    sendTransaction: jest.fn().mockResolvedValue({
      status: 'SUCCESS',
      result: { retval: true },
      resultMetaXdr: ['id_0', 'id_1'],
    }),
  };
}

function makeContract() {
  return { call: jest.fn().mockReturnValue({}) };
}

function wire(client: any) {
  client.server = makeServer();
  client.contract = makeContract();
  return client;
}

async function seed(cache: any, key: string): Promise<jest.Mock> {
  const loader = jest.fn().mockResolvedValue(`cached:${key}`);
  await cache.get(key, loader);
  expect(loader).toHaveBeenCalledTimes(1);
  return loader;
}

async function expectReloaded(cache: any, key: string, loader: jest.Mock) {
  await cache.get(key, loader);
  expect(loader).toHaveBeenCalledTimes(2);
}

describe('SDK cache invalidation on writes', () => {
  const signer = Keypair.random();
  const otherSigner = Keypair.random();

  describe('AidClient', () => {
    it('deployEmergencyFund evicts the active-funds list', async () => {
      const client = wire(new AidClient(CONFIG)) as any;
      const loader = await seed(client.cache, 'aid:listActiveFunds');

      await client.deployEmergencyFund(
        signer.secret(), 'fund_1', 'Fund', 'desc', '1000', 'flood',
        'region', Date.now() + 60_000, [otherSigner.publicKey()], 1
      );

      await expectReloaded(client.cache, 'aid:listActiveFunds', loader);
    });

    it('triggerDisbursement evicts fund and disbursement reads', async () => {
      const client = wire(new AidClient(CONFIG)) as any;
      const fundLoader = await seed(client.cache, 'aid:fund:fund_1');
      const disbursementLoader = await seed(client.cache, 'aid:disbursements:fund_1');

      await client.triggerDisbursement(
        signer.secret(), 'fund_1', Keypair.random().publicKey(),
        '10', 'food', [otherSigner.publicKey()]
      );

      await expectReloaded(client.cache, 'aid:fund:fund_1', fundLoader);
      await expectReloaded(client.cache, 'aid:disbursements:fund_1', disbursementLoader);
    });

    it('does not evict cache entries when the write fails', async () => {
      const client = wire(new AidClient(CONFIG)) as any;
      client.server.sendTransaction.mockResolvedValueOnce({ status: 'FAILED' });
      const loader = await seed(client.cache, 'aid:fund:fund_1');

      await expect(
        client.triggerDisbursement(
          signer.secret(), 'fund_1', Keypair.random().publicKey(),
          '10', 'food', [otherSigner.publicKey()]
        )
      ).rejects.toThrow('Failed to submit disbursement');

      await client.cache.get('aid:fund:fund_1', loader);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('BeneficiaryClient', () => {
    it('registerBeneficiary evicts the profile and disaster listing', async () => {
      const client = wire(new BeneficiaryClient(CONFIG)) as any;
      const profileLoader = await seed(client.cache, 'beneficiary:ben_1');
      const listLoader = await seed(client.cache, 'beneficiary:disaster:dis_1:page');

      await client.registerBeneficiary(
        signer.secret(), 'ben_1', 'Amina', 'dis_1', 'Camp',
        Keypair.random().publicKey(), 4, [], []
      );

      await expectReloaded(client.cache, 'beneficiary:ben_1', profileLoader);
      await expectReloaded(client.cache, 'beneficiary:disaster:dis_1:page', listLoader);
    });

    it('verifyBeneficiary evicts the verified profile', async () => {
      const client = wire(new BeneficiaryClient(CONFIG)) as any;
      const loader = await seed(client.cache, 'beneficiary:ben_1');

      await client.verifyBeneficiary(signer.secret(), 'ben_1', []);

      await expectReloaded(client.cache, 'beneficiary:ben_1', loader);
    });

    it('updateLocation evicts the profile', async () => {
      const client = wire(new BeneficiaryClient(CONFIG)) as any;
      const loader = await seed(client.cache, 'beneficiary:ben_1');

      await client.updateLocation(signer.secret(), 'ben_1', 'New Camp');

      await expectReloaded(client.cache, 'beneficiary:ben_1', loader);
    });
  });

  describe('MerchantClient', () => {
    it('processPayment evicts merchant profile and transaction history', async () => {
      const client = wire(new MerchantClient(CONFIG)) as any;
      const profileLoader = await seed(client.cache, 'merchant:mer_1');
      const txnsLoader = await seed(client.cache, 'merchant:txns:mer_1');

      await client.processPayment(
        signer.secret(), otherSigner.secret(), 'mer_1', 'ben_1',
        '25', 'XLM', 'food'
      );

      await expectReloaded(client.cache, 'merchant:mer_1', profileLoader);
      await expectReloaded(client.cache, 'merchant:txns:mer_1', txnsLoader);
    });

    it('verifyMerchant evicts the merchant profile', async () => {
      const client = wire(new MerchantClient(CONFIG)) as any;
      const loader = await seed(client.cache, 'merchant:mer_1');

      await client.verifyMerchant(signer.secret(), 'mer_1', true, 'ok');

      await expectReloaded(client.cache, 'merchant:mer_1', loader);
    });
  });

  describe('TransferClient', () => {
    it('createTransfer evicts the beneficiary transfer list', async () => {
      const client = wire(new TransferClient(CONFIG)) as any;
      const loader = await seed(client.cache, 'transfer:beneficiary:ben_1:page');

      await client.createTransfer(
        signer.secret(), 'tr_1', 'ben_1', '100', 'XLM',
        Date.now() + 60_000, [], 'food'
      );

      await expectReloaded(client.cache, 'transfer:beneficiary:ben_1:page', loader);
    });

    it('spend evicts transfer and transaction history', async () => {
      const client = wire(new TransferClient(CONFIG)) as any;
      const transferLoader = await seed(client.cache, 'transfer:tr_1');
      const txnsLoader = await seed(client.cache, 'transfer:transactions:tr_1');

      await client.spend(signer.secret(), 'tr_1', 'mer_1', '5', 'food', 'Camp');

      await expectReloaded(client.cache, 'transfer:tr_1', transferLoader);
      await expectReloaded(client.cache, 'transfer:transactions:tr_1', txnsLoader);
    });
  });

  describe('TrackerClient', () => {
    it('createShipment evicts active shipments and donor listing', async () => {
      const client = wire(new TrackerClient(CONFIG)) as any;
      const activeLoader = await seed(client.cache, 'tracker:activeShipments');
      const donorLoader = await seed(client.cache, 'tracker:donor:don_1:page');

      await client.createShipment(signer.secret(), {
        donorId: 'don_1',
        supplyType: 'water',
        quantity: '100',
        unit: 'liters',
        originLatLng: '18.4861,-69.9312',
        originAddress: '1 Warehouse Rd',
        originFacility: 'Main Depot',
        originContact: 'John',
        destinationLatLng: '18.5000,-70.0000',
        destinationAddress: '5 Camp Rd',
        destinationFacility: 'Relief Camp A',
        destinationContact: 'Maria',
        estimatedArrival: Date.now() + 60_000,
        temperatureRequirements: null,
        specialHandling: [],
      } as any);

      await expectReloaded(client.cache, 'tracker:activeShipments', activeLoader);
      await expectReloaded(client.cache, 'tracker:donor:don_1:page', donorLoader);
    });

    it('addCheckpoint evicts shipment, history, active list, and alerts', async () => {
      const client = wire(new TrackerClient(CONFIG)) as any;
      const shipmentLoader = await seed(client.cache, 'tracker:shipment:ship_1');
      const historyLoader = await seed(client.cache, 'tracker:history:ship_1');
      const activeLoader = await seed(client.cache, 'tracker:activeShipments');
      const alertsLoader = await seed(client.cache, 'tracker:temperatureAlerts');

      await client.addCheckpoint(
        signer.secret(), 'ship_1', 'Camp', '10', 'good', [], 'ok'
      );

      await expectReloaded(client.cache, 'tracker:shipment:ship_1', shipmentLoader);
      await expectReloaded(client.cache, 'tracker:history:ship_1', historyLoader);
      await expectReloaded(client.cache, 'tracker:activeShipments', activeLoader);
      await expectReloaded(client.cache, 'tracker:temperatureAlerts', alertsLoader);
    });
  });
});
