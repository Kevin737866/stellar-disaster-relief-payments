import { Keypair, StrKey } from 'stellar-sdk';
import { TransferClient, validateU256Amount, MAX_U256 } from './transferClient';
import { MerchantClient, PAYMENT_ONLINE, PAYMENT_QR, PAYMENT_OFFLINE } from './merchantClient';
import { ConditionalTransfer, PaymentRequest, SpendingRule, NetworkConfig } from './types';
import { ValidationError } from './errors';

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

describe('TransferClient U256 amount validation (Issue #171)', () => {
  it('accepts valid decimal integer strings within U256 range', () => {
    expect(validateU256Amount('0')).toBe('0');
    expect(validateU256Amount('100')).toBe('100');
    expect(validateU256Amount('  250  ')).toBe('250');
    expect(validateU256Amount('00150')).toBe('150');
    expect(validateU256Amount(MAX_U256.toString())).toBe(MAX_U256.toString());
  });

  it('rejects non-integer decimals, negative values, and non-numeric strings', () => {
    expect(() => validateU256Amount('')).toThrow(ValidationError);
    expect(() => validateU256Amount('   ')).toThrow(ValidationError);
    expect(() => validateU256Amount('12.34')).toThrow(ValidationError);
    expect(() => validateU256Amount('10.0')).toThrow(ValidationError);
    expect(() => validateU256Amount('-50')).toThrow(ValidationError);
    expect(() => validateU256Amount('abc')).toThrow(ValidationError);
    expect(() => validateU256Amount('100px')).toThrow(ValidationError);
    expect(() => validateU256Amount('0x100')).toThrow(ValidationError);
    expect(() => validateU256Amount(null as any)).toThrow(ValidationError);
    expect(() => validateU256Amount(undefined as any)).toThrow(ValidationError);
  });

  it('rejects values exceeding U256 range (> 2^256 - 1)', () => {
    const tooLarge = (MAX_U256 + 1n).toString();
    expect(() => validateU256Amount(tooLarge)).toThrow(ValidationError);
  });

  it('spend throws ValidationError when amount is not a valid U256 decimal string', async () => {
    const client = new TransferClient(CONFIG);
    const key = Keypair.random().secret();

    await expect(
      client.spend(key, 'tr_1', 'mer_1', '12.50', 'food', 'loc_1')
    ).rejects.toThrow(ValidationError);

    await expect(
      client.spend(key, 'tr_1', 'mer_1', '-100', 'food', 'loc_1')
    ).rejects.toThrow(ValidationError);

    await expect(
      client.spend(key, 'tr_1', 'mer_1', 'not-a-number', 'food', 'loc_1')
    ).rejects.toThrow(ValidationError);
  });

  it('createTransfer throws ValidationError when amount is not a valid U256 decimal string', async () => {
    const client = new TransferClient(CONFIG);
    const key = Keypair.random().secret();

    await expect(
      client.createTransfer(key, 'tr_1', 'ben_1', '99.99', 'XLM', Date.now() + 60000, [], 'aid')
    ).rejects.toThrow(ValidationError);
  });
});

describe('TransferClient processPaymentRequest selection logic (Issue #173)', () => {
  let client: TransferClient;
  const beneficiaryKey = Keypair.random().secret();

  beforeEach(() => {
    client = new TransferClient(CONFIG);
  });

  it('returns error when beneficiary has no active transfers', async () => {
    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([]);

    const result = await client.processPaymentRequest(
      {
        beneficiaryId: 'ben_1',
        merchantId: 'mer_1',
        amount: '50',
        token: 'XLM',
        purpose: 'emergency food',
      },
      beneficiaryKey
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no active transfers found/i);
  });

  it('returns error when all transfers are inactive or expired', async () => {
    const expiredTransfer: ConditionalTransfer = {
      id: 'tr_expired',
      beneficiaryId: 'ben_1',
      amount: '100',
      token: 'XLM',
      createdAt: Date.now() - 100000,
      expiresAt: Date.now() - 1000,
      spendingRules: [],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '100',
      creator: 'org_1',
      purpose: 'food',
    };

    const inactiveTransfer: ConditionalTransfer = {
      ...expiredTransfer,
      id: 'tr_inactive',
      expiresAt: Date.now() + 100000,
      isActive: false,
    };

    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([expiredTransfer, inactiveTransfer]);

    const result = await client.processPaymentRequest(
      {
        beneficiaryId: 'ben_1',
        merchantId: 'mer_1',
        amount: '50',
        token: 'XLM',
        purpose: 'emergency food',
      },
      beneficiaryKey
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inactive or expired/i);
  });

  it('returns error when balance is insufficient across all active transfers', async () => {
    const smallTransfer: ConditionalTransfer = {
      id: 'tr_small',
      beneficiaryId: 'ben_1',
      amount: '30',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      spendingRules: [],
      isActive: true,
      spentAmount: '10',
      remainingAmount: '20',
      creator: 'org_1',
      purpose: 'food',
    };

    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([smallTransfer]);

    const result = await client.processPaymentRequest(
      {
        beneficiaryId: 'ben_1',
        merchantId: 'mer_1',
        amount: '50',
        token: 'XLM',
        purpose: 'food',
      },
      beneficiaryKey
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient remaining balance/i);
  });

  it('infers category from purpose using taxonomy and selects matching transfer', async () => {
    const medicalTransfer: ConditionalTransfer = {
      id: 'tr_med',
      beneficiaryId: 'ben_1',
      amount: '100',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      spendingRules: [
        {
          ruleType: 'category_limit',
          parameters: { category: 'medical' },
          limit: '100',
          currentUsage: '0',
        },
      ],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '100',
      creator: 'org_1',
      purpose: 'medical supplies',
    };

    const foodTransfer: ConditionalTransfer = {
      id: 'tr_food',
      beneficiaryId: 'ben_1',
      amount: '100',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      spendingRules: [
        {
          ruleType: 'category_limit',
          parameters: { category: 'food' },
          limit: '100',
          currentUsage: '0',
        },
      ],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '100',
      creator: 'org_1',
      purpose: 'food ration',
    };

    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([medicalTransfer, foodTransfer]);
    const spendSpy = jest.spyOn(client, 'spend').mockResolvedValue(true);

    const request: PaymentRequest = {
      beneficiaryId: 'ben_1',
      merchantId: 'mer_food',
      amount: '40',
      token: 'XLM',
      purpose: 'emergency food rations', // Should map to 'food'
    };

    const result = await client.processPaymentRequest(request, beneficiaryKey);

    expect(result.success).toBe(true);
    expect(result.transferId).toBe('tr_food');
    expect(spendSpy).toHaveBeenCalledWith(
      beneficiaryKey,
      'tr_food',
      'mer_food',
      '40',
      'food',
      'unknown'
    );
  });

  it('respects explicit request.category over purpose inference', async () => {
    const shelterTransfer: ConditionalTransfer = {
      id: 'tr_shelter',
      beneficiaryId: 'ben_1',
      amount: '100',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      spendingRules: [
        {
          ruleType: 'category_limit',
          parameters: { category: 'shelter' },
          limit: '100',
          currentUsage: '0',
        },
      ],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '100',
      creator: 'org_1',
      purpose: 'shelter',
    };

    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([shelterTransfer]);
    const spendSpy = jest.spyOn(client, 'spend').mockResolvedValue(true);

    const request: PaymentRequest = {
      beneficiaryId: 'ben_1',
      merchantId: 'mer_shelter',
      amount: '25',
      token: 'XLM',
      purpose: 'miscellaneous',
      category: 'shelter',
    };

    const result = await client.processPaymentRequest(request, beneficiaryKey);

    expect(result.success).toBe(true);
    expect(result.transferId).toBe('tr_shelter');
    expect(spendSpy).toHaveBeenCalledWith(
      beneficiaryKey,
      'tr_shelter',
      'mer_shelter',
      '25',
      'shelter',
      'unknown'
    );
  });

  it('returns error when category limit rule would be exceeded', async () => {
    const limitedTransfer: ConditionalTransfer = {
      id: 'tr_limited',
      beneficiaryId: 'ben_1',
      amount: '100',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100000,
      spendingRules: [
        {
          ruleType: 'category_limit',
          parameters: { category: 'food' },
          limit: '50',
          currentUsage: '40', // Only 10 remaining
        },
      ],
      isActive: true,
      spentAmount: '40',
      remainingAmount: '60',
      creator: 'org_1',
      purpose: 'food',
    };

    jest.spyOn(client, 'listBeneficiaryTransfers').mockResolvedValue([limitedTransfer]);

    const result = await client.processPaymentRequest(
      {
        beneficiaryId: 'ben_1',
        merchantId: 'mer_1',
        amount: '20', // Exceeds remaining category allowance of 10
        token: 'XLM',
        purpose: 'groceries',
      },
      beneficiaryKey
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/category limit exceeded/i);
  });
});

describe('MerchantClient payment_method parameter alignment (Issue #176)', () => {
  it('exports valid payment method constants', () => {
    expect(PAYMENT_ONLINE).toBe(4);
    expect(PAYMENT_QR).toBe(0);
    expect(PAYMENT_OFFLINE).toBe(3);
  });
});
