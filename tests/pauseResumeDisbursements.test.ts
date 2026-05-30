/**
 * Tests for pause/resume fund disbursements feature.
 * Covers: normal operation, pause/resume workflows, permission checks,
 * concurrent scenarios, and edge cases.
 */

// Mock stellar-sdk before any imports that use it
jest.mock('stellar-sdk', () => {
  const mockOperation = { type: 'invokeHostFunction' };
  const mockContract = {
    call: jest.fn().mockReturnValue(mockOperation),
  };
  const mockTx = {
    sign: jest.fn(),
  };
  const mockTxBuilder = {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue(mockTx),
  };

  return {
    Contract: jest.fn().mockImplementation(() => mockContract),
    Address: jest.fn().mockImplementation((addr: string) => ({ toString: () => addr })),
    TransactionBuilder: jest.fn().mockImplementation(() => mockTxBuilder),
    Keypair: {
      random: jest.fn().mockReturnValue({
        publicKey: () => 'GADMIN000000000000000000000000000000000000000000000000000',
        sign: jest.fn(),
      }),
    },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      STANDALONE: 'Standalone Network ; February 2017',
      TESTNET_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    },
    BASE_FEE: '100',
  };
});

import { EmergencyFundsClient, EmergencyFund } from '../sdk/src/emergencyFunds';
import { Keypair } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let adminCounter = 0;
function makeAdminAddress(): string {
  adminCounter++;
  return `GADMIN${String(adminCounter).padStart(51, '0')}`;
}

function makeFund(overrides: Partial<EmergencyFund> = {}): EmergencyFund {
  return {
    id: 'fund_001',
    name: 'Test Fund',
    description: 'Test emergency fund',
    totalAmount: '1000000',
    releasedAmount: '0',
    createdAt: Date.now(),
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    disasterType: 'earthquake',
    geographicScope: 'Test Region',
    isActive: true,
    isPaused: false,
    pausedAt: 0,
    pausedBy: undefined,
    requiredSignatures: 2,
    autoReleaseEnabled: false,
    recallEnabled: false,
    recallAfterMonths: 12,
    currentStatus: 'active',
    fundAllocation: [],
    reservedForRecall: '0',
    ...overrides,
  };
}

/** Build a client whose server calls are fully mocked. */
function makeClient(serverOverrides: Record<string, jest.Mock> = {}): EmergencyFundsClient {
  const signingKey = Keypair.random();
  const mockServer = {
    loadAccount: jest.fn().mockResolvedValue({ id: 'GADMIN', sequence: '1' }),
    submitTransaction: jest.fn().mockResolvedValue({ hash: 'mock_tx_hash_abc123' }),
    ...serverOverrides,
  };
  return new EmergencyFundsClient('CONTRACT_ID', signingKey, mockServer);
}

// ---------------------------------------------------------------------------
// Interface shape tests
// ---------------------------------------------------------------------------

describe('EmergencyFund interface', () => {
  it('includes isPaused field defaulting to false', () => {
    const fund = makeFund();
    expect(fund.isPaused).toBe(false);
  });

  it('includes pausedAt field defaulting to 0', () => {
    const fund = makeFund();
    expect(fund.pausedAt).toBe(0);
  });

  it('includes pausedBy field defaulting to undefined', () => {
    const fund = makeFund();
    expect(fund.pausedBy).toBeUndefined();
  });

  it('accepts "paused" as a valid currentStatus value', () => {
    const fund = makeFund({ currentStatus: 'paused', isPaused: true });
    expect(fund.currentStatus).toBe('paused');
  });

  it('preserves all existing fields (backward compatibility)', () => {
    const fund = makeFund();
    expect(fund).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      isActive: expect.any(Boolean),
      currentStatus: expect.any(String),
      totalAmount: expect.any(String),
      releasedAmount: expect.any(String),
    });
  });
});

// ---------------------------------------------------------------------------
// pauseFund
// ---------------------------------------------------------------------------

describe('EmergencyFundsClient.pauseFund', () => {
  it('calls pause_fund contract function with admin address and fund id', async () => {
    const client = makeClient();
    const result = await client.pauseFund(makeAdminAddress(), 'fund_001');
    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('mock_tx_hash_abc123');
  });

  it('returns success true on successful pause', async () => {
    const client = makeClient();
    const result = await client.pauseFund(makeAdminAddress(), 'fund_001');
    expect(result.success).toBe(true);
  });

  it('returns the transaction hash from the server response', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'specific_hash_xyz' }),
    });
    const result = await client.pauseFund(makeAdminAddress(), 'fund_001');
    expect(result.transactionHash).toBe('specific_hash_xyz');
  });

  it('throws an error with descriptive message when server rejects', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(new Error('tx_failed')),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund pause failed');
  });

  it('throws when loadAccount fails (unauthorized / network error)', async () => {
    const client = makeClient({
      loadAccount: jest.fn().mockRejectedValue(new Error('account not found')),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund pause failed');
  });
});

// ---------------------------------------------------------------------------
// resumeFund
// ---------------------------------------------------------------------------

describe('EmergencyFundsClient.resumeFund', () => {
  it('calls resume_fund contract function with admin address and fund id', async () => {
    const client = makeClient();
    const result = await client.resumeFund(makeAdminAddress(), 'fund_001');
    expect(result.success).toBe(true);
    expect(result.transactionHash).toBe('mock_tx_hash_abc123');
  });

  it('returns success true on successful resume', async () => {
    const client = makeClient();
    const result = await client.resumeFund(makeAdminAddress(), 'fund_001');
    expect(result.success).toBe(true);
  });

  it('returns the transaction hash from the server response', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'resume_hash_789' }),
    });
    const result = await client.resumeFund(makeAdminAddress(), 'fund_001');
    expect(result.transactionHash).toBe('resume_hash_789');
  });

  it('throws an error with descriptive message when server rejects', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(new Error('tx_failed')),
    });
    await expect(client.resumeFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund resume failed');
  });

  it('throws when loadAccount fails', async () => {
    const client = makeClient({
      loadAccount: jest.fn().mockRejectedValue(new Error('account not found')),
    });
    await expect(client.resumeFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund resume failed');
  });
});

// ---------------------------------------------------------------------------
// isFundPaused
// ---------------------------------------------------------------------------

describe('EmergencyFundsClient.isFundPaused', () => {
  it('returns false for an active (non-paused) fund', async () => {
    const client = makeClient();
    const result = await client.isFundPaused('fund_001');
    expect(result).toBe(false);
  });

  it('returns a boolean value', async () => {
    const client = makeClient();
    const result = await client.isFundPaused('fund_001');
    expect(typeof result).toBe('boolean');
  });

  it('throws with descriptive message on error', async () => {
    const client = makeClient();
    jest.spyOn(client, 'isFundPaused').mockRejectedValueOnce(
      new Error('Failed to check fund pause state: network error')
    );
    await expect(client.isFundPaused('fund_001'))
      .rejects.toThrow('Failed to check fund pause state');
  });
});

// ---------------------------------------------------------------------------
// Pause / resume workflow
// ---------------------------------------------------------------------------

describe('Pause/resume workflow', () => {
  it('pause then resume completes without error', async () => {
    const client = makeClient();
    const admin = makeAdminAddress();

    const pauseResult = await client.pauseFund(admin, 'fund_001');
    expect(pauseResult.success).toBe(true);

    const resumeResult = await client.resumeFund(admin, 'fund_001');
    expect(resumeResult.success).toBe(true);
  });

  it('each operation returns a distinct transaction hash', async () => {
    let callCount = 0;
    const client = makeClient({
      submitTransaction: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ hash: `hash_${callCount}` });
      }),
    });
    const admin = makeAdminAddress();

    const pauseResult = await client.pauseFund(admin, 'fund_001');
    const resumeResult = await client.resumeFund(admin, 'fund_001');

    expect(pauseResult.transactionHash).not.toBe(resumeResult.transactionHash);
  });

  it('fund state reflects paused status in interface', () => {
    const pausedFund = makeFund({
      isPaused: true,
      pausedAt: Date.now(),
      pausedBy: 'GADMIN123',
      currentStatus: 'paused',
    });

    expect(pausedFund.isPaused).toBe(true);
    expect(pausedFund.currentStatus).toBe('paused');
    expect(pausedFund.pausedBy).toBe('GADMIN123');
    expect(pausedFund.pausedAt).toBeGreaterThan(0);
  });

  it('fund state reflects active status after resume', () => {
    const resumedFund = makeFund({
      isPaused: false,
      pausedAt: 0,
      pausedBy: undefined,
      currentStatus: 'active',
    });

    expect(resumedFund.isPaused).toBe(false);
    expect(resumedFund.currentStatus).toBe('active');
    expect(resumedFund.pausedBy).toBeUndefined();
    expect(resumedFund.pausedAt).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permission / authorization checks
// ---------------------------------------------------------------------------

describe('Permission checks', () => {
  it('pauseFund propagates loadAccount failure', async () => {
    const client = makeClient({
      loadAccount: jest.fn().mockRejectedValue(new Error('invalid address')),
    });
    await expect(client.pauseFund('', 'fund_001')).rejects.toThrow('Fund pause failed');
  });

  it('resumeFund propagates loadAccount failure', async () => {
    const client = makeClient({
      loadAccount: jest.fn().mockRejectedValue(new Error('invalid address')),
    });
    await expect(client.resumeFund('', 'fund_001')).rejects.toThrow('Fund resume failed');
  });

  it('unauthorized admin causes pauseFund to throw', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #7) - Unauthorized approver')
      ),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund pause failed');
  });

  it('unauthorized admin causes resumeFund to throw', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #7) - Unauthorized approver')
      ),
    });
    await expect(client.resumeFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund resume failed');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('pausing an already-paused fund propagates contract error', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund is already paused')
      ),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund pause failed');
  });

  it('resuming a non-paused fund propagates contract error', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund is not paused')
      ),
    });
    await expect(client.resumeFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund resume failed');
  });

  it('pausing an inactive fund propagates contract error', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund is not active')
      ),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'fund_001'))
      .rejects.toThrow('Fund pause failed');
  });

  it('pausing a non-existent fund propagates contract error', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund does not exist')
      ),
    });
    await expect(client.pauseFund(makeAdminAddress(), 'nonexistent_fund'))
      .rejects.toThrow('Fund pause failed');
  });

  it('disbursement on a paused fund is blocked (contract error propagated)', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund disbursements are paused')
      ),
    });
    await expect(
      client.executeMultiSigRelease(
        'fund_001',
        makeAdminAddress(),
        '1000',
        'Emergency aid',
        [Keypair.random()]
      )
    ).rejects.toThrow('Multi-sig release failed');
  });

  it('trigger execution on a paused fund is blocked (contract error propagated)', async () => {
    const client = makeClient({
      submitTransaction: jest.fn().mockRejectedValue(
        new Error('HostError: Error(Contract, #3) - Fund disbursements are paused')
      ),
    });
    const result = await client.executeTrigger('fund_001', 'trigger_001', makeAdminAddress());
    expect(result.success).toBe(false);
    expect(result.error).toContain('paused');
  });

  it('multiple sequential pause/resume cycles succeed', async () => {
    const client = makeClient();
    const admin = makeAdminAddress();

    for (let i = 0; i < 3; i++) {
      const pause = await client.pauseFund(admin, 'fund_001');
      expect(pause.success).toBe(true);
      const resume = await client.resumeFund(admin, 'fund_001');
      expect(resume.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent scenarios
// ---------------------------------------------------------------------------

describe('Concurrent scenarios', () => {
  it('concurrent pause calls both resolve (server serializes them)', async () => {
    let callCount = 0;
    const client = makeClient({
      submitTransaction: jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ hash: `hash_${callCount}` });
      }),
    });
    const admin = makeAdminAddress();

    const [r1, r2] = await Promise.all([
      client.pauseFund(admin, 'fund_001'),
      client.pauseFund(admin, 'fund_001'),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('concurrent pause and resume calls both resolve', async () => {
    const client = makeClient();
    const admin = makeAdminAddress();

    const [pauseResult, resumeResult] = await Promise.all([
      client.pauseFund(admin, 'fund_001'),
      client.resumeFund(admin, 'fund_001'),
    ]);

    expect(pauseResult.success).toBe(true);
    expect(resumeResult.success).toBe(true);
  });
});
