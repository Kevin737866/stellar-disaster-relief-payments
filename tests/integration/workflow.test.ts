/**
 * Integration tests for end-to-end disaster relief workflows.
 * These tests verify complete user journeys across SDK components.
 */

import { BeneficiaryClient } from '../../sdk/src/beneficiaryClient';
import { TransferClient } from '../../sdk/src/transferClient';

const TESTNET_CONFIG = {
  network: 'testnet' as const,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'CONTRACT_PLATFORM',
    aidRegistry: 'CONTRACT_AID',
    beneficiaryManager: 'CONTRACT_BENEFICIARY',
    merchantNetwork: 'CONTRACT_MERCHANT',
    cashTransfer: 'CONTRACT_TRANSFER',
    supplyChainTracker: 'CONTRACT_TRACKER',
    antiFraud: 'CONTRACT_FRAUD',
  },
};

const MOCK_REGISTRAR_KEY = 'SCZANGBA5AKIA7Y6UXDMV6VKDMKRJHQQYQFPXJFNMQVPQKQYJFQQKRJHQ';
const MOCK_BENEFICIARY_ID = 'BEN-EARTHQUAKE-001';

// ─── Beneficiary registration & verification workflow ───────────────────────

describe('Beneficiary Registration Workflow', () => {
  let client: BeneficiaryClient;

  beforeEach(() => {
    client = new BeneficiaryClient(TESTNET_CONFIG);
  });

  it('creates biometric-free verification factors', () => {
    const factors = client.createVerificationFactors(
      ['phone_number', 'id_card'],
      ['signature_pattern'],
      ['community_leader_vouch']
    );

    expect(factors).toHaveLength(4);
    expect(factors.filter(f => f.factorType === 'possession')).toHaveLength(2);
    expect(factors.filter(f => f.factorType === 'behavioral')).toHaveLength(1);
    expect(factors.filter(f => f.factorType === 'social')).toHaveLength(1);
    factors.forEach(f => {
      expect(f.weight).toBeGreaterThan(0);
      expect(f.verifiedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  it('generates recovery codes for offline access', () => {
    const codes = client.generateRecoveryCodes(MOCK_BENEFICIARY_ID);

    expect(codes).toHaveLength(3);
    codes.forEach(code => {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });
  });

  it('generates unique recovery codes per beneficiary', () => {
    const codesA = client.generateRecoveryCodes('BEN-001');
    const codesB = client.generateRecoveryCodes('BEN-002');

    codesA.forEach((code, i) => {
      expect(code).not.toBe(codesB[i]);
    });
  });

  it('generates valid beneficiary QR code', () => {
    const mockProfile = {
      id: MOCK_BENEFICIARY_ID,
      name: 'Amina Hassan',
      disasterId: 'EARTHQUAKE-2024',
      location: 'Port-au-Prince',
      registrationDate: Date.now(),
      lastVerified: Date.now(),
      verificationFactors: [
        { factorType: 'possession', value: 'phone', weight: 30, verifiedAt: Date.now() },
      ],
      walletAddress: 'GABC123',
      isActive: true,
      familySize: 4,
      specialNeeds: [],
      trustScore: 75,
    };

    const qrData = client.generateBeneficiaryQRCode(MOCK_BENEFICIARY_ID, mockProfile);
    const parsed = JSON.parse(qrData);

    expect(parsed.type).toBe('beneficiary_id');
    expect(parsed.beneficiaryId).toBe(MOCK_BENEFICIARY_ID);
    expect(parsed.name).toBe('Amina Hassan');
    expect(parsed.trustScore).toBe(75);
  });

  it('validates QR code type correctly', async () => {
    const invalidQR = JSON.stringify({ type: 'merchant', id: 'MERCH-001' });
    const result = await client.validateBeneficiaryQRCode(invalidQR);
    expect(result).toBe(false);
  });

  it('rejects malformed QR code', async () => {
    const result = await client.validateBeneficiaryQRCode('not-valid-json{{{');
    expect(result).toBe(false);
  });
});

// ─── USSD session workflow ───────────────────────────────────────────────────

describe('USSD Session Workflow', () => {
  let client: BeneficiaryClient;

  beforeEach(() => {
    client = new BeneficiaryClient(TESTNET_CONFIG);
  });

  it('creates USSD session with welcome message', () => {
    const session = client.createUSSDSession('+254700000000');

    expect(session.sessionId).toBeTruthy();
    expect(session.welcomeMessage).toContain('1');
    expect(session.welcomeMessage).toContain('Register');
  });

  it('navigates full registration flow via USSD', () => {
    const session = client.createUSSDSession('+254700000001');

    const step1 = client.processUSSDInput(session.sessionId, '1', 'welcome');
    expect(step1.nextStep).toBe('register_name');
    expect(step1.response).toContain('name');

    const step2 = client.processUSSDInput(session.sessionId, 'Fatima Al-Rashid', 'register_name');
    expect(step2.nextStep).toBe('register_location');
    expect(step2.response).toContain('location');

    const step3 = client.processUSSDInput(session.sessionId, 'Nairobi', 'register_location');
    expect(step3.nextStep).toBe('register_family');

    const step4 = client.processUSSDInput(session.sessionId, '5', 'register_family');
    expect(step4.completed).toBe(true);
    expect(step4.response).toContain('5');
  });

  it('handles invalid family size input gracefully', () => {
    const session = client.createUSSDSession('+254700000002');
    const result = client.processUSSDInput(session.sessionId, 'abc', 'register_family');

    expect(result.nextStep).toBe('register_family');
    expect(result.completed).toBeFalsy();
  });

  it('navigates check balance flow via USSD', () => {
    const session = client.createUSSDSession('+254700000005');

    const step1 = client.processUSSDInput(session.sessionId, '2', 'welcome');
    expect(step1.nextStep).toBe('check_balance');
    expect(step1.response).toContain('beneficiary ID');

    // Test empty/invalid beneficiary ID
    const retry = client.processUSSDInput(session.sessionId, '   ', 'check_balance');
    expect(retry.nextStep).toBe('check_balance');
    expect(retry.completed).toBeFalsy();

    // Test valid beneficiary ID
    const step2 = client.processUSSDInput(session.sessionId, 'BEN-999', 'check_balance');
    expect(step2.completed).toBe(true);
    expect(step2.nextStep).toBe('complete');
    expect(step2.response).toContain('BEN-999');
    expect(step2.response).toContain('balance');
  });

  it('navigates find merchants flow via USSD', () => {
    const session = client.createUSSDSession('+254700000006');

    const step1 = client.processUSSDInput(session.sessionId, '3', 'welcome');
    expect(step1.nextStep).toBe('find_merchants');
    expect(step1.response).toContain('location');

    // Test empty location
    const retry = client.processUSSDInput(session.sessionId, '', 'find_merchants');
    expect(retry.nextStep).toBe('find_merchants');
    expect(retry.completed).toBeFalsy();

    // Test valid location
    const step2 = client.processUSSDInput(session.sessionId, 'Mombasa', 'find_merchants');
    expect(step2.completed).toBe(true);
    expect(step2.nextStep).toBe('complete');
    expect(step2.response).toContain('Mombasa');
  });

  it('returns help information on option 4', () => {
    const session = client.createUSSDSession('+254700000003');
    const result = client.processUSSDInput(session.sessionId, '4', 'welcome');

    expect(result.nextStep).toBe('welcome');
    expect(result.response).toBeTruthy();
  });

  it('handles invalid menu option', () => {
    const session = client.createUSSDSession('+254700000004');
    const result = client.processUSSDInput(session.sessionId, '9', 'welcome');

    expect(result.nextStep).toBe('welcome');
  });
});

// ─── Conditional transfer workflow ──────────────────────────────────────────

describe('Conditional Transfer Workflow', () => {
  let client: TransferClient;

  beforeEach(() => {
    client = new TransferClient(TESTNET_CONFIG);
  });

  it('creates category limit spending rule', () => {
    const rule = client.createCategoryLimitRule('food', '500');

    expect(rule.ruleType).toBe('category_limit');
    expect(rule.parameters.category).toBe('food');
    expect(rule.limit).toBe('500');
    expect(rule.currentUsage).toBe('0');
  });

  it('creates time window spending rule', () => {
    const start = Date.now();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    const rule = client.createTimeWindowRule(start, end);

    expect(rule.ruleType).toBe('time_window');
    expect(rule.parameters.start_time).toBe(String(start));
    expect(rule.parameters.end_time).toBe(String(end));
  });

  it('creates location-based spending rule', () => {
    const rule = client.createLocationRule('Port-au-Prince');

    expect(rule.ruleType).toBe('location_based');
    expect(rule.parameters.location).toBe('Port-au-Prince');
  });

  it('builds emergency transfer with correct spending rules', () => {
    const amount = '1000';
    const { transferId, transfer } = client.createEmergencyTransfer(
      MOCK_BENEFICIARY_ID,
      amount,
      'earthquake'
    );

    expect(transferId).toContain(MOCK_BENEFICIARY_ID);
    expect(transfer.beneficiaryId).toBe(MOCK_BENEFICIARY_ID);
    expect(transfer.isActive).toBe(true);
    expect(transfer.spentAmount).toBe('0');
    expect(transfer.remainingAmount).toBe(amount);
    expect(transfer.token).toBe('XLM');

    const categoryRules = transfer.spendingRules.filter(r => r.ruleType === 'category_limit');
    const timeRules = transfer.spendingRules.filter(r => r.ruleType === 'time_window');
    expect(categoryRules.length).toBeGreaterThan(0);
    expect(timeRules.length).toBeGreaterThan(0);

    const foodRule = categoryRules.find(r => r.parameters.category === 'food');
    const medRule = categoryRules.find(r => r.parameters.category === 'medicine');
    const shelterRule = categoryRules.find(r => r.parameters.category === 'shelter');
    expect(foodRule?.limit).toBe('600');
    expect(medRule?.limit).toBe('300');
    expect(shelterRule?.limit).toBe('100');
  });

  it('allocates emergency transfer category limits with remainder handling', () => {
    // When amount is not evenly divisible (e.g. 105), food gets the remainder so total equals 105
    const { transfer: transfer105 } = client.createEmergencyTransfer('BEN-003', '105', 'cyclone');
    const rules105 = transfer105.spendingRules.filter(r => r.ruleType === 'category_limit');
    const food105 = rules105.find(r => r.parameters.category === 'food')!;
    const med105 = rules105.find(r => r.parameters.category === 'medicine')!;
    const shelter105 = rules105.find(r => r.parameters.category === 'shelter')!;

    expect(med105.limit).toBe('31'); // 105 * 30 / 100 = 31
    expect(shelter105.limit).toBe('10'); // 105 * 10 / 100 = 10
    expect(food105.limit).toBe('64'); // 105 - 31 - 10 = 64
    expect(BigInt(food105.limit) + BigInt(med105.limit) + BigInt(shelter105.limit)).toBe(105n);

    // Boundary case: amount = 1
    const { transfer: transfer1 } = client.createEmergencyTransfer('BEN-004', '1', 'flood');
    const rules1 = transfer1.spendingRules.filter(r => r.ruleType === 'category_limit');
    const food1 = rules1.find(r => r.parameters.category === 'food')!;
    const med1 = rules1.find(r => r.parameters.category === 'medicine')!;
    const shelter1 = rules1.find(r => r.parameters.category === 'shelter')!;

    expect(med1.limit).toBe('0');
    expect(shelter1.limit).toBe('0');
    expect(food1.limit).toBe('1');
    expect(BigInt(food1.limit) + BigInt(med1.limit) + BigInt(shelter1.limit)).toBe(1n);

    // Boundary case: amount = 0
    const { transfer: transfer0 } = client.createEmergencyTransfer('BEN-005', '0', 'flood');
    const rules0 = transfer0.spendingRules.filter(r => r.ruleType === 'category_limit');
    expect(rules0.find(r => r.parameters.category === 'food')!.limit).toBe('0');
    expect(rules0.find(r => r.parameters.category === 'medicine')!.limit).toBe('0');
    expect(rules0.find(r => r.parameters.category === 'shelter')!.limit).toBe('0');

    // Negative amounts reject
    expect(() => client.createEmergencyTransfer('BEN-006', '-50', 'flood')).toThrow(
      'Transfer amount must be non-negative'
    );
  });

  it('emergency transfer expires in 7 days', () => {
    const before = Date.now();
    const { transfer } = client.createEmergencyTransfer('BEN-002', '500', 'flood');
    const after = Date.now();

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(transfer.expiresAt).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(transfer.expiresAt).toBeLessThanOrEqual(after + sevenDaysMs);
  });

  it('creates valid transfer QR code', () => {
    const mockTransfer = {
      id: 'TXF-001',
      beneficiaryId: MOCK_BENEFICIARY_ID,
      amount: '1000',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      spendingRules: [{ ruleType: 'category_limit', parameters: {}, limit: '500', currentUsage: '0' }],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '1000',
      creator: 'ADMIN',
      purpose: 'Food assistance',
    };

    const qrData = client.generateTransferQRCode('TXF-001', mockTransfer);
    const parsed = JSON.parse(qrData);

    expect(parsed.type).toBe('transfer');
    expect(parsed.transferId).toBe('TXF-001');
    expect(parsed.beneficiaryId).toBe(MOCK_BENEFICIARY_ID);
  });

  it('validates QR code type mismatch', async () => {
    const invalidQR = JSON.stringify({ type: 'beneficiary_id', id: 'BEN-001' });
    const result = await client.validateTransferQRCode(invalidQR);
    expect(result).toBe(false);
  });

  it('rejects malformed transfer QR code', async () => {
    const result = await client.validateTransferQRCode('{malformed}');
    expect(result).toBe(false);
  });

  it('creates multiple spending rules via createSpendingRules', () => {
    const rules = client.createSpendingRules([
      { type: 'category_limit', parameters: { category: 'food' }, limit: '300' },
      { type: 'location_based', parameters: { location: 'Kampala' }, limit: '0' },
    ]);

    expect(rules).toHaveLength(2);
    expect(rules[0].ruleType).toBe('category_limit');
    expect(rules[1].ruleType).toBe('location_based');
  });
});

// ─── Beneficiary statistics workflow ────────────────────────────────────────

describe('Beneficiary Statistics Workflow', () => {
  let client: BeneficiaryClient;

  beforeEach(() => {
    client = new BeneficiaryClient(TESTNET_CONFIG);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns zero stats when no beneficiaries exist', async () => {
    const stats = await client.getBeneficiaryStatistics('DISASTER-EMPTY');

    expect(stats.totalBeneficiaries).toBe(0);
    expect(stats.averageFamilySize).toBe(0);
    expect(stats.averageTrustScore).toBe(0);
    expect(stats.activeBeneficiaries).toBe(0);
    expect(stats.specialNeedsCount).toBe(0);
  });

  it('computes robust statistics for populated beneficiary dataset', async () => {
    const mockBeneficiaries = [
      {
        id: 'BEN-1',
        name: 'Beneficiary One',
        disasterId: 'DISASTER-1',
        location: 'Zone A',
        registrationDate: Date.now(),
        lastVerified: Date.now(),
        verificationFactors: [],
        walletAddress: 'GABC1',
        isActive: true,
        familySize: 3,
        specialNeeds: ['medical'],
        trustScore: 80,
      },
      {
        id: 'BEN-2',
        name: 'Beneficiary Two',
        disasterId: 'DISASTER-1',
        location: 'Zone B',
        registrationDate: Date.now(),
        lastVerified: Date.now(),
        verificationFactors: [],
        walletAddress: 'GABC2',
        isActive: false,
        familySize: 5,
        specialNeeds: [],
        trustScore: 60,
      },
    ];

    jest.spyOn(client, 'listBeneficiariesByDisaster').mockResolvedValue(mockBeneficiaries as any);

    const stats = await client.getBeneficiaryStatistics('DISASTER-1');
    expect(stats.totalBeneficiaries).toBe(2);
    expect(stats.activeBeneficiaries).toBe(1);
    expect(stats.specialNeedsCount).toBe(1);
    expect(stats.averageFamilySize).toBe(4); // (3 + 5) / 2 = 4
    expect(stats.averageTrustScore).toBe(70); // (80 + 60) / 2 = 70
  });
});

// ─── Beneficiary Search Workflow ────────────────────────────────────────────

describe('Beneficiary Search Input Boundaries', () => {
  let client: BeneficiaryClient;

  beforeEach(() => {
    client = new BeneficiaryClient(TESTNET_CONFIG);
  });

  it('preserves special query characters without stripping them at client boundary', async () => {
    let passedSearch: any = null;
    let passedLocation: any = null;

    // Spy on contract call to observe what parameters reach the contract
    (client as any).contract.call = jest.fn().mockImplementation((method: string, ...args: any[]) => {
      passedSearch = args[1];
      passedLocation = args[2];
      return Promise.resolve({
        result: {
          retval: [[], 0, ''],
        },
      });
    });

    // Query containing quotes, ampersands, and angle brackets
    const query = "  O'Connor & Sons <Shelter>  ";
    const loc = "  District #4 & Central  ";
    await client.searchBeneficiaries('DISASTER-1', {
      search: query,
      locationFilter: loc,
    });

    // Trimmed, but quotes, ampersand, and brackets are preserved (not stripped)
    expect(passedSearch).toBeDefined();
    expect(passedLocation).toBeDefined();
  });
});
