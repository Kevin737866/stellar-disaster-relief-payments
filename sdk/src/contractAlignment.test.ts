/**
 * Contract-shape alignment checks.
 *
 * Heavy mocking can hide mismatches between the SDK's contract invocations and
 * the actual Rust contract signatures. These tests parse the contract source
 * and compare the method name + argument count emitted by the SDK against it.
 *
 * Known, intentionally documented divergences are listed in KNOWN_DIVERGENCES
 * (see docs/TESTING.md). Any *new* divergence fails this suite.
 */

import * as fs from 'fs';
import * as path from 'path';
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
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
        toXDR: jest.fn(() => 'mock-xdr'),
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
    })),
    nativeToScVal: jest.fn((value: unknown) => value),
    scValToNative: jest.fn((value: any) => value?.value ?? value),
  };
});

type ContractArities = Map<string, number>;

const CONTRACT_FILES = [
  'aid_registry.rs',
  'beneficiary_manager.rs',
  'merchant_network.rs',
  'cash_transfer.rs',
  'supply_chain_tracker.rs',
];

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of input) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function loadContractArities(): ContractArities {
  const arities: ContractArities = new Map();
  for (const file of CONTRACT_FILES) {
    const fullPath = path.join(process.cwd(), 'src', file);
    if (!fs.existsSync(fullPath)) continue;
    const source = fs
      .readFileSync(fullPath, 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const fnPattern = /pub\s+fn\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:->[^{]*)?\{/g;
    let match: RegExpExecArray | null;
    while ((match = fnPattern.exec(source)) !== null) {
      const [, name, params] = match;
      const args = splitTopLevel(params)
        .map(p => p.trim())
        .filter(Boolean)
        // `env: Env` is injected by the runtime, not supplied by callers.
        .filter(p => !/^env\s*:/.test(p));
      if (!arities.has(name)) arities.set(name, args.length);
    }
  }
  return arities;
}

/**
 * Divergences that pre-date the alignment checks. Each entry documents the
 * contract-side arity and the current SDK-side arity. Remove an entry once the
 * SDK call is aligned.
 */
const KNOWN_DIVERGENCES: Record<string, { contract: number; sdk: number; reason: string }> = {
  create_fund: {
    contract: 11,
    sdk: 10,
    reason: 'SDK facade does not expose the optional metadata map yet',
  },
  register_merchant: {
    contract: 10,
    sdk: 11,
    reason: 'SDK still sends the legacy onboarding fields (toml/daily/monthly/documents)',
  },
};

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
      resultMetaXdr: [],
    }),
  };
}

async function captureCall(
  client: any,
  action: () => Promise<unknown>
): Promise<{ method: string; args: unknown[] }> {
  const call = jest.fn().mockReturnValue({});
  client.contract = { call };
  client.server = makeServer();

  await action();

  expect(call).toHaveBeenCalledTimes(1);
  const [method, ...args] = call.mock.calls[0];
  return { method, args };
}

describe('SDK <-> contract shape alignment', () => {
  const arities = loadContractArities();
  const signer = Keypair.random();
  const approver = Keypair.random();

  function expectShape(label: string, method: string, argCount: number) {
    expect(arities.has(method)).toBe(true);
    const contractArity = arities.get(method)!;
    const known = KNOWN_DIVERGENCES[method];

    if (known) {
      // Keep documented divergences visible and stable.
      expect({ label, contract: contractArity, sdk: argCount }).toEqual({
        label,
        contract: known.contract,
        sdk: known.sdk,
      });
    } else {
      expect({ label, contractArity, sdkArity: argCount }).toEqual({
        label,
        contractArity,
        sdkArity: contractArity,
      });
    }
  }

  test('AidClient.deployEmergencyFund -> create_fund', async () => {
    const client = new AidClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.deployEmergencyFund(
        signer.secret(), 'fund_1', 'Fund', 'desc', '1000', 'flood',
        'region', Date.now() + 60_000, [approver.publicKey()], 1
      )
    );
    expectShape('deployEmergencyFund', method, args.length);
  });

  test('AidClient.triggerDisbursement -> submit_disbursement', async () => {
    const client = new AidClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.triggerDisbursement(
        signer.secret(), 'fund_1', Keypair.random().publicKey(),
        '10', 'food', [approver.publicKey()]
      )
    );
    expectShape('triggerDisbursement', method, args.length);
  });

  test('AidClient.triggerBatchDisbursement -> submit_batch_disbursement', async () => {
    const client = new AidClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.triggerBatchDisbursement(
        signer.secret(), 'fund_1',
        [
          { beneficiary: Keypair.random().publicKey(), amount: '10', purpose: 'food' },
          { beneficiary: Keypair.random().publicKey(), amount: '20', purpose: 'water' },
        ],
        [approver.publicKey()]
      )
    );
    expectShape('triggerBatchDisbursement', method, args.length);
  });

  test('AidClient.buildOfflineDeployFund -> create_fund', async () => {
    const client = new AidClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.buildOfflineDeployFund(
        signer.publicKey(), 'fund_1', 'Fund', 'desc', '1000', 'flood',
        'region', Date.now() + 60_000, [approver.publicKey()], 1
      )
    );
    expectShape('buildOfflineDeployFund', method, args.length);
  });

  test('AidClient.buildOfflineDisbursement -> submit_disbursement', async () => {
    const client = new AidClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.buildOfflineDisbursement(
        signer.publicKey(), 'fund_1', Keypair.random().publicKey(),
        '10', 'food', [approver.publicKey()]
      )
    );
    expectShape('buildOfflineDisbursement', method, args.length);
  });

  test('BeneficiaryClient.registerBeneficiary -> register_beneficiary', async () => {
    const client = new BeneficiaryClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.registerBeneficiary(
        signer.secret(), 'ben_1', 'Amina', 'dis_1', 'Camp',
        Keypair.random().publicKey(), 4, ['medical'], []
      )
    );
    expectShape('registerBeneficiary', method, args.length);
  });

  test('BeneficiaryClient.verifyBeneficiary -> verify_beneficiary', async () => {
    const client = new BeneficiaryClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.verifyBeneficiary(signer.secret(), 'ben_1', [])
    );
    expectShape('verifyBeneficiary', method, args.length);
  });

  test('BeneficiaryClient.buildOfflineRegister -> register_beneficiary', async () => {
    const client = new BeneficiaryClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.buildOfflineRegister(
        signer.publicKey(), 'ben_1', 'Amina', 'dis_1', 'Camp',
        Keypair.random().publicKey(), 4, [], []
      )
    );
    expectShape('buildOfflineRegister', method, args.length);
  });

  test('MerchantClient.registerMerchant -> register_merchant', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.registerMerchant(signer.secret(), 'mer_1', {
        name: 'Shop',
        businessType: 'food',
        location: 'Camp',
        contactInfo: '123',
        stellarTomlUrl: '',
        acceptedTokens: ['XLM'],
        dailyLimit: '100',
        monthlyLimit: '1000',
        verificationDocuments: [],
      })
    );
    expectShape('registerMerchant', method, args.length);
  });

  test('MerchantClient.processPayment -> process_payment', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.processPayment(
        signer.secret(), approver.secret(), 'mer_1', 'ben_1',
        '25', 'XLM', 'food'
      )
    );
    expectShape('processPayment', method, args.length);
    expect(args[7]).toBe(4); // Default PAYMENT_ONLINE
  });

  test('MerchantClient.processPayment with explicit payment_method', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.processPayment(
        signer.secret(), approver.secret(), 'mer_1', 'ben_1',
        '25', 'XLM', 'food', 0 // PAYMENT_QR
      )
    );
    expectShape('processPayment', method, args.length);
    expect(args[7]).toBe(0);
  });

  test('MerchantClient.buildOfflineRegisterMerchant -> register_merchant', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.buildOfflineRegisterMerchant(signer.publicKey(), 'mer_1', {
        name: 'Shop',
        businessType: 'food',
        location: 'Camp',
        contactInfo: '123',
        stellarTomlUrl: '',
        acceptedTokens: ['XLM'],
        dailyLimit: '100',
        monthlyLimit: '1000',
        verificationDocuments: [],
      })
    );
    expectShape('buildOfflineRegisterMerchant', method, args.length);
  });

  test('MerchantClient.verifyMerchant -> review_trial_merchant', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.verifyMerchant(signer.secret(), 'mer_1', true, 'verified')
    );
    expectShape('verifyMerchant', method, args.length);
  });

  test('MerchantClient.buildOfflineApproveMerchant -> review_trial_merchant', async () => {
    const client = new MerchantClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.buildOfflineApproveMerchant(signer.publicKey(), 'mer_1', true, 'verified')
    );
    expectShape('buildOfflineApproveMerchant', method, args.length);
  });

  test('TransferClient.createTransfer -> create_transfer', async () => {
    const client = new TransferClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.createTransfer(
        signer.secret(), 'tr_1', 'ben_1', '100', 'XLM',
        Date.now() + 60_000, [], 'food'
      )
    );
    expectShape('createTransfer', method, args.length);
  });

  test('TrackerClient.createShipment -> create_shipment', async () => {
    const client = new TrackerClient(CONFIG) as any;
    const { method, args } = await captureCall(client, () =>
      client.createShipment(signer.secret(), {
        donorId: 'don_1',
        supplyType: 'water',
        quantity: '100',
        unit: 'liters',
        origin: 'A',
        destination: 'B',
        estimatedArrival: Date.now() + 60_000,
        temperatureRequirements: null,
        specialHandling: [],
      })
    );
    expectShape('createShipment', method, args.length);
  });
});
