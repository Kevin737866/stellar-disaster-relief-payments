/**
 * Performance tests for SDK methods and contract call patterns.
 * Validates that operations complete within acceptable time budgets.
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

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function measureAsync(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// ─── BeneficiaryClient performance ──────────────────────────────────────────

describe('BeneficiaryClient — local method performance', () => {
  let client: BeneficiaryClient;

  beforeEach(() => {
    client = new BeneficiaryClient(TESTNET_CONFIG);
  });

  it('creates verification factors in under 50ms', () => {
    const elapsed = measure(() => {
      client.createVerificationFactors(
        ['phone', 'id_card', 'family_photo'],
        ['signature', 'voice'],
        ['community_leader', 'neighbor']
      );
    });
    expect(elapsed).toBeLessThan(50);
  });

  it('generates recovery codes in under 100ms', () => {
    const elapsed = measure(() => {
      client.generateRecoveryCodes('BEN-PERF-001');
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('generates 100 beneficiary QR codes in under 200ms', () => {
    const mockProfile = {
      id: 'BEN-001',
      name: 'Test User',
      disasterId: 'EQ-2024',
      location: 'City',
      registrationDate: Date.now(),
      lastVerified: Date.now(),
      verificationFactors: [{ factorType: 'possession', value: 'phone', weight: 30, verifiedAt: Date.now() }],
      walletAddress: 'GABC',
      isActive: true,
      familySize: 3,
      specialNeeds: [],
      trustScore: 80,
    };

    const elapsed = measure(() => {
      for (let i = 0; i < 100; i++) {
        client.generateBeneficiaryQRCode(`BEN-${i}`, { ...mockProfile, id: `BEN-${i}` });
      }
    });
    expect(elapsed).toBeLessThan(200);
  });

  it('creates USSD session in under 20ms', () => {
    const elapsed = measure(() => {
      client.createUSSDSession('+254700000000');
    });
    expect(elapsed).toBeLessThan(20);
  });

  it('processes 50 sequential USSD inputs in under 100ms', () => {
    const session = client.createUSSDSession('+254700000000');
    const elapsed = measure(() => {
      for (let i = 0; i < 50; i++) {
        client.processUSSDInput(session.sessionId, '1', 'welcome');
      }
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('validates 50 malformed QR codes in under 150ms', async () => {
    const elapsed = await measureAsync(async () => {
      const checks = Array.from({ length: 50 }, () =>
        client.validateBeneficiaryQRCode('{invalid}')
      );
      await Promise.all(checks);
    });
    expect(elapsed).toBeLessThan(150);
  });
});

// ─── TransferClient performance ──────────────────────────────────────────────

describe('TransferClient — local method performance', () => {
  let client: TransferClient;

  beforeEach(() => {
    client = new TransferClient(TESTNET_CONFIG);
  });

  it('creates category limit rule in under 5ms', () => {
    const elapsed = measure(() => {
      client.createCategoryLimitRule('food', '500');
    });
    expect(elapsed).toBeLessThan(5);
  });

  it('creates time window rule in under 5ms', () => {
    const now = Date.now();
    const elapsed = measure(() => {
      client.createTimeWindowRule(now, now + 86400000);
    });
    expect(elapsed).toBeLessThan(5);
  });

  it('creates location rule in under 5ms', () => {
    const elapsed = measure(() => {
      client.createLocationRule('Kampala, Uganda');
    });
    expect(elapsed).toBeLessThan(5);
  });

  it('builds 1000 spending rules in under 100ms', () => {
    const elapsed = measure(() => {
      const rules = [];
      for (let i = 0; i < 1000; i++) {
        rules.push(client.createCategoryLimitRule('food', String(i * 10)));
      }
    });
    expect(elapsed).toBeLessThan(100);
  });

  it('creates emergency transfer in under 20ms', () => {
    const elapsed = measure(() => {
      client.createEmergencyTransfer('BEN-001', '1000', 'earthquake');
    });
    expect(elapsed).toBeLessThan(20);
  });

  it('creates 500 emergency transfers in under 500ms', () => {
    const elapsed = measure(() => {
      for (let i = 0; i < 500; i++) {
        client.createEmergencyTransfer(`BEN-${i}`, '1000', 'flood');
      }
    });
    expect(elapsed).toBeLessThan(500);
  });

  it('generates QR code for transfer in under 10ms', () => {
    const mockTransfer = {
      id: 'TXF-001',
      beneficiaryId: 'BEN-001',
      amount: '1000',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      spendingRules: [{ ruleType: 'category_limit', parameters: {}, limit: '500', currentUsage: '0' }],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '1000',
      creator: 'ADMIN',
      purpose: 'Food',
    };

    const elapsed = measure(() => {
      client.generateTransferQRCode('TXF-001', mockTransfer);
    });
    expect(elapsed).toBeLessThan(10);
  });

  it('generates 200 transfer QR codes in under 100ms', () => {
    const mockTransfer = {
      id: 'TXF-001',
      beneficiaryId: 'BEN-001',
      amount: '1000',
      token: 'XLM',
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      spendingRules: [],
      isActive: true,
      spentAmount: '0',
      remainingAmount: '1000',
      creator: 'ADMIN',
      purpose: 'Food',
    };

    const elapsed = measure(() => {
      for (let i = 0; i < 200; i++) {
        client.generateTransferQRCode(`TXF-${i}`, mockTransfer);
      }
    });
    expect(elapsed).toBeLessThan(100);
  });
});

// ─── Concurrent operation performance ───────────────────────────────────────

describe('Concurrent SDK operations performance', () => {
  it('handles 100 concurrent QR validation calls in under 500ms', async () => {
    const beneficiaryClient = new BeneficiaryClient(TESTNET_CONFIG);
    const transferClient = new TransferClient(TESTNET_CONFIG);

    const invalidQR = '{"type":"wrong","id":"1"}';

    const elapsed = await measureAsync(async () => {
      await Promise.all([
        ...Array.from({ length: 50 }, () => beneficiaryClient.validateBeneficiaryQRCode(invalidQR)),
        ...Array.from({ length: 50 }, () => transferClient.validateTransferQRCode(invalidQR)),
      ]);
    });

    expect(elapsed).toBeLessThan(500);
  });

  it('processes mixed beneficiary operations in under 200ms', async () => {
    const client = new BeneficiaryClient(TESTNET_CONFIG);

    const elapsed = await measureAsync(async () => {
      const session = client.createUSSDSession('+254000000000');
      const factors = client.createVerificationFactors(['phone'], ['sig'], ['community']);
      const codes = client.generateRecoveryCodes('BEN-PERF');

      await client.validateBeneficiaryQRCode('{"type":"wrong"}');

      expect(session.sessionId).toBeTruthy();
      expect(factors.length).toBeGreaterThan(0);
      expect(codes.length).toBe(3);
    });

    expect(elapsed).toBeLessThan(200);
  });
});
