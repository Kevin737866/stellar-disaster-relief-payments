/**
 * Tests for the SDK's offline envelope builders.
 *
 * These exercise the full client -> TransactionBuilder -> OfflineSigner path
 * using a real TransactionBuilder/Contract (no network) so the serialized XDR
 * is genuine and can be round-tripped, signed, and submitted.
 */

import {
  Account,
  Keypair,
  Networks,
  StrKey,
  Transaction,
  nativeToScVal,
  scValToNative,
} from 'stellar-sdk';
import { AidClient } from './aidClient';
import { BeneficiaryClient } from './beneficiaryClient';
import { MerchantClient, PAYMENT_OFFLINE } from './merchantClient';
import { TransferClient } from './transferClient';
import { TrackerClient } from './trackerClient';
import { OfflineSigner, NetworkMismatchError } from './offlineSigner';
import { NetworkConfig } from './types';

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const TESTNET_CONFIG: NetworkConfig = {
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

const MAINNET_CONFIG: NetworkConfig = { ...TESTNET_CONFIG, network: 'mainnet' };

function withServer<T>(client: T, publicKey: string): T {
  (client as any).server = {
    getAccount: jest.fn(async () => new Account(publicKey, '0')),
    sendTransaction: jest.fn(),
  };
  return client;
}

const source = Keypair.random();

function expectUnsignedEnvelope(envelope: any, passphrase = Networks.TESTNET) {
  expect(envelope.networkPassphrase).toBe(passphrase);
  expect(envelope.signedBy).toEqual([]);
  expect(envelope.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const tx = OfflineSigner.deserialize(envelope);
  expect(tx).toBeInstanceOf(Transaction);
  expect(tx.operations).toHaveLength(1);
  expect(tx.signatures).toHaveLength(0);
  return tx;
}

describe('offline envelope builders', () => {
  test('AidClient.buildOfflineDeployFund produces a signable envelope', async () => {
    const client = withServer(new AidClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineDeployFund(
      source.publicKey(), 'fund_1', 'Fund', 'desc', '1000', 'flood',
      'region', Date.now() + 60_000, [Keypair.random().publicKey()], 1
    );

    const tx = expectUnsignedEnvelope(envelope);
    expect((tx.operations[0] as any).type).toBe('invokeHostFunction');

    const signed = OfflineSigner.sign(envelope, source.secret());
    expect(signed.signedBy).toEqual([source.publicKey()]);
    expect(OfflineSigner.deserialize(signed).signatures).toHaveLength(1);
  });

  test('AidClient.buildOfflineDisbursement produces a signable envelope', async () => {
    const client = withServer(new AidClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineDisbursement(
      source.publicKey(), 'fund_1', Keypair.random().publicKey(),
      '10', 'food', [Keypair.random().publicKey()]
    );

    expectUnsignedEnvelope(envelope);
    expect(OfflineSigner.deserialize(
      OfflineSigner.sign(envelope, source.secret())
    ).signatures).toHaveLength(1);
  });

  test('BeneficiaryClient.buildOfflineRegister produces a signable envelope', async () => {
    const client = withServer(new BeneficiaryClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineRegister(
      source.publicKey(), 'ben_1', 'Amina', 'dis_1', 'Camp',
      Keypair.random().publicKey(), 4, ['medical'], []
    );

    expectUnsignedEnvelope(envelope);
  });

  test('MerchantClient.buildOfflineRegisterMerchant produces a signable envelope', async () => {
    const client = withServer(new MerchantClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineRegisterMerchant(
      source.publicKey(), 'mer_1',
      {
        name: 'Shop',
        businessType: 'food',
        location: 'Camp',
        contactInfo: '123',
        stellarTomlUrl: '',
        acceptedTokens: ['XLM'],
        dailyLimit: '100',
        monthlyLimit: '1000',
        verificationDocuments: [],
      }
    );

    expectUnsignedEnvelope(envelope);
  });

  test('MerchantClient.buildOfflineApproveMerchant produces a signable envelope', async () => {
    const client = withServer(new MerchantClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineApproveMerchant(
      source.publicKey(), 'mer_1', true, 'verified'
    );

    expectUnsignedEnvelope(envelope);
  });

  test('MerchantClient.buildOfflinePayment produces a signable envelope', async () => {
    const client = withServer(new MerchantClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflinePayment(
      source.publicKey(), Keypair.random().publicKey(),
      'mer_1', 'ben_1', '25', 'XLM', 'food'
    );

    expectUnsignedEnvelope(envelope);
  });

  test('MerchantClient.buildMultiSigPayment preserves the unsigned envelope for collection', async () => {
    const client = withServer(new MerchantClient(TESTNET_CONFIG), source.publicKey());
    const signerA = Keypair.random();
    const manager = await client.buildMultiSigPayment(
      source.publicKey(), Keypair.random().publicKey(),
      'mer_1', 'ben_1', '25', 'XLM', 'food',
      [signerA.publicKey()], 1
    );

    expect(manager.getProgress().status).toBe('pending');
    manager.addSignature(signerA.secret());
    expect(manager.isReady()).toBe(true);
  });

  test('TransferClient.buildOfflineCreateTransfer produces a signable envelope', async () => {
    const client = withServer(new TransferClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineCreateTransfer(
      source.publicKey(), 'tr_1', 'ben_1', '100', 'XLM',
      Date.now() + 60_000, [], 'food'
    );

    expectUnsignedEnvelope(envelope);
  });

  test('TransferClient.buildOfflineCreateTransfer accepts typed SpendingRule[]', async () => {
    const client = withServer(new TransferClient(TESTNET_CONFIG), source.publicKey());
    const rules = [
      client.createCategoryLimitRule('food', '50'),
      client.createTimeWindowRule(1000, 2000),
    ];
    const envelope = await client.buildOfflineCreateTransfer(
      source.publicKey(), 'tr_typed', 'ben_1', '100', 'XLM',
      Date.now() + 60_000, rules, 'emergency food'
    );

    expectUnsignedEnvelope(envelope);
  });

  test('TrackerClient.buildOfflineCreateShipment produces a signable envelope', async () => {
    const client = withServer(new TrackerClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineCreateShipment(source.publicKey(), {
      donorId: 'don_1',
      supplyType: 'water',
      quantity: '100',
      unit: 'liters',
      origin: 'A',
      destination: 'B',
      estimatedArrival: Date.now() + 60_000,
      temperatureRequirements: null,
      specialHandling: [],
    });

    expectUnsignedEnvelope(envelope);
  });

  test('signed envelopes can be serialized, decoded, and submitted online', async () => {
    const client = withServer(new AidClient(TESTNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineDisbursement(
      source.publicKey(), 'fund_1', Keypair.random().publicKey(),
      '10', 'food', [Keypair.random().publicKey()]
    );

    const signed = OfflineSigner.sign(envelope, source.secret(), Networks.TESTNET);
    const transported = OfflineSigner.decode(OfflineSigner.encode(signed));
    const server = { sendTransaction: jest.fn(async () => ({ status: 'PENDING' })) };

    const response = await OfflineSigner.submit(transported, server as any);

    expect(response.status).toBe('PENDING');
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
    const submitted = server.sendTransaction.mock.calls[0][0];
    expect(submitted).toBeInstanceOf(Transaction);
    expect(submitted.signatures).toHaveLength(1);
  });

  test('envelopes built for one network cannot be signed for another', async () => {
    const client = withServer(new AidClient(MAINNET_CONFIG), source.publicKey());
    const envelope = await client.buildOfflineDisbursement(
      source.publicKey(), 'fund_1', Keypair.random().publicKey(),
      '10', 'food', [Keypair.random().publicKey()]
    );

    expect(envelope.networkPassphrase).toBe(Networks.PUBLIC);
    expect(() => OfflineSigner.sign(envelope, source.secret(), Networks.TESTNET))
      .toThrow(NetworkMismatchError);
  });

  test('all payment builders share one process_payment invocation shape (Issue #179)', async () => {
    const client = withServer(new MerchantClient(TESTNET_CONFIG), source.publicKey());
    (client as any).server.sendTransaction = jest.fn(async () => ({
      status: 'SUCCESS',
      result: { retval: nativeToScVal('payment_result') },
    }));

    const merchant = source;
    const beneficiary = Keypair.random();
    const signer = Keypair.random();

    const invocation = (tx: Transaction) => {
      const op = tx.operations[0] as any;
      expect(op.type).toBe('invokeHostFunction');
      const call = op.func.invokeContract();
      return {
        fn: String(call.functionName()),
        args: call.args().map((arg: any) => scValToNative(arg)),
      };
    };

    const offlineTx = OfflineSigner.deserialize(
      await client.buildOfflinePayment(
        merchant.publicKey(), beneficiary.publicKey(),
        'mer_1', 'ben_1', '25', 'XLM', 'food', PAYMENT_OFFLINE
      )
    );

    const manager = await client.buildMultiSigPayment(
      merchant.publicKey(), beneficiary.publicKey(),
      'mer_1', 'ben_1', '25', 'XLM', 'food',
      [signer.publicKey()], 1, PAYMENT_OFFLINE
    );
    const managerState = manager.toState();
    const multiSigTx = new Transaction(managerState.txXdr, managerState.networkPassphrase);

    await client.processPayment(
      merchant.secret(), beneficiary.secret(),
      'mer_1', 'ben_1', '25', 'XLM', 'food', PAYMENT_OFFLINE
    );
    const onlineTx = (client as any).server.sendTransaction.mock.calls[0][0] as Transaction;

    const expected = invocation(offlineTx);
    expect(expected.fn).toBe('process_payment');
    expect(expected.args).toEqual([
      merchant.publicKey(), beneficiary.publicKey(),
      'mer_1', 'ben_1', '25', 'XLM', 'food', BigInt(PAYMENT_OFFLINE),
    ]);
    expect(invocation(multiSigTx)).toEqual(expected);
    expect(invocation(onlineTx)).toEqual(expected);
  });
});
