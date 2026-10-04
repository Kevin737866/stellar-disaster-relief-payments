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
});
