import { Keypair } from 'stellar-sdk';
import { EmergencyFundsClient } from '../emergencyFunds';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(mockServer?: object): EmergencyFundsClient {
  const signingKey = Keypair.random();
  const server = mockServer ?? {
    loadAccount: jest.fn().mockResolvedValue({ id: 'mock', sequence: '0' }),
    submitTransaction: jest.fn().mockResolvedValue({ hash: 'mock-hash' }),
  };
  return new EmergencyFundsClient('CONTRACT_ID', signingKey, server as any);
}

const ADMIN = Keypair.random().publicKey();
const SIGNER = Keypair.random().publicKey();
const FUTURE = Date.now() + 90 * 24 * 60 * 60 * 1000; // 90 days from now
const PAST = Date.now() - 1000;
const NOW = Date.now();

/** Call createFund with all-valid defaults, overriding specific args by position. */
function callCreateFund(
  client: EmergencyFundsClient,
  overrides: {
    fundId?: string;
    totalAmount?: string;
    expiresAt?: number;
  } = {}
) {
  return client.createFund(
    ADMIN,
    overrides.fundId ?? 'earthquake_response_2024',
    'Earthquake Emergency Response',
    'Rapid response funding',
    overrides.totalAmount ?? '1000000',
    'seismic',
    'Santo Domingo',
    overrides.expiresAt ?? FUTURE,
    [SIGNER],
    1
  );
}

/**
 * For "valid input" tests we only care that validation passes (no validation error thrown)
 * and that the network layer is reached (loadAccount is called).
 * The actual transaction may fail due to mock contract ID — that's expected in unit tests.
 */
async function assertValidationPasses(
  client: EmergencyFundsClient,
  overrides: { fundId?: string; totalAmount?: string; expiresAt?: number } = {}
) {
  try {
    await callCreateFund(client, overrides);
  } catch (err: any) {
    // Validation errors are thrown before the try/catch in createFund, so they
    // surface as-is. Network/contract errors are wrapped in "Fund creation failed:".
    // If the error is a validation error, re-throw so the test fails.
    if (
      err.message === 'fund_id must not be empty' ||
      err.message === 'total_amount must be greater than zero' ||
      err.message === 'expires_at must be a future timestamp'
    ) {
      throw err;
    }
    // Otherwise it's a downstream error (invalid contract ID etc.) — validation passed.
  }
}

// ---------------------------------------------------------------------------
// Unit tests – fund_id validation
// ---------------------------------------------------------------------------

describe('createFund – fund_id validation', () => {
  let client: EmergencyFundsClient;
  beforeEach(() => { client = makeClient(); });

  it('throws when fund_id is an empty string', async () => {
    await expect(callCreateFund(client, { fundId: '' }))
      .rejects.toThrow('fund_id must not be empty');
  });

  it('throws when fund_id is whitespace only', async () => {
    await expect(callCreateFund(client, { fundId: '   ' }))
      .rejects.toThrow('fund_id must not be empty');
  });

  it('accepts a valid non-empty fund_id (validation passes)', async () => {
    await expect(assertValidationPasses(client)).resolves.toBeUndefined();
  });

  it('accepts a single-character fund_id (validation passes)', async () => {
    await expect(assertValidationPasses(client, { fundId: 'x' })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests – total_amount validation
// ---------------------------------------------------------------------------

describe('createFund – total_amount validation', () => {
  let client: EmergencyFundsClient;
  beforeEach(() => { client = makeClient(); });

  it('throws when total_amount is zero', async () => {
    await expect(callCreateFund(client, { totalAmount: '0' }))
      .rejects.toThrow('total_amount must be greater than zero');
  });

  it('throws when total_amount is negative', async () => {
    await expect(callCreateFund(client, { totalAmount: '-1' }))
      .rejects.toThrow('total_amount must be greater than zero');
  });

  it('accepts total_amount of 1 (boundary, validation passes)', async () => {
    await expect(assertValidationPasses(client, { totalAmount: '1' })).resolves.toBeUndefined();
  });

  it('accepts a large total_amount (validation passes)', async () => {
    await expect(assertValidationPasses(client, { totalAmount: '999999999999' })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests – expires_at validation
// ---------------------------------------------------------------------------

describe('createFund – expires_at validation', () => {
  let client: EmergencyFundsClient;
  beforeEach(() => { client = makeClient(); });

  it('throws when expires_at is in the past', async () => {
    await expect(callCreateFund(client, { expiresAt: PAST }))
      .rejects.toThrow('expires_at must be a future timestamp');
  });

  it('throws when expires_at equals current time', async () => {
    await expect(callCreateFund(client, { expiresAt: NOW }))
      .rejects.toThrow('expires_at must be a future timestamp');
  });

  it('accepts expires_at strictly in the future (validation passes)', async () => {
    await expect(assertValidationPasses(client, { expiresAt: FUTURE })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests – validation order and multiple invalid fields
// ---------------------------------------------------------------------------

describe('createFund – validation order', () => {
  let client: EmergencyFundsClient;
  beforeEach(() => { client = makeClient(); });

  it('reports fund_id error first when fund_id and total_amount are both invalid', async () => {
    await expect(callCreateFund(client, { fundId: '', totalAmount: '0' }))
      .rejects.toThrow('fund_id must not be empty');
  });

  it('reports total_amount error when fund_id is valid but amount is zero', async () => {
    await expect(callCreateFund(client, { totalAmount: '0' }))
      .rejects.toThrow('total_amount must be greater than zero');
  });

  it('reports expires_at error when fund_id and amount are valid but timestamp is past', async () => {
    await expect(callCreateFund(client, { expiresAt: PAST }))
      .rejects.toThrow('expires_at must be a future timestamp');
  });
});

// ---------------------------------------------------------------------------
// Integration tests – validation does not call network layer
// ---------------------------------------------------------------------------

describe('createFund – network layer interaction', () => {
  it('calls server.loadAccount when validation passes', async () => {
    const mockServer = {
      loadAccount: jest.fn().mockResolvedValue({ id: 'mock', sequence: '0' }),
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'tx-hash-123' }),
    };
    const client = makeClient(mockServer);

    // Validation passes; downstream may fail due to mock contract ID — that's fine
    await assertValidationPasses(client);

    expect(mockServer.loadAccount).toHaveBeenCalledWith(ADMIN);
  });

  it('does not call server.loadAccount when fund_id validation fails', async () => {
    const mockServer = {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
    };
    const client = makeClient(mockServer);

    await expect(callCreateFund(client, { fundId: '' })).rejects.toThrow('fund_id must not be empty');

    expect(mockServer.loadAccount).not.toHaveBeenCalled();
    expect(mockServer.submitTransaction).not.toHaveBeenCalled();
  });

  it('does not call server.loadAccount when total_amount validation fails', async () => {
    const mockServer = {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
    };
    const client = makeClient(mockServer);

    await expect(callCreateFund(client, { totalAmount: '0' })).rejects.toThrow('total_amount must be greater than zero');

    expect(mockServer.loadAccount).not.toHaveBeenCalled();
  });

  it('does not call server.loadAccount when expires_at validation fails', async () => {
    const mockServer = {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
    };
    const client = makeClient(mockServer);

    await expect(callCreateFund(client, { expiresAt: PAST })).rejects.toThrow('expires_at must be a future timestamp');

    expect(mockServer.loadAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E2E-style tests – full failure paths
// ---------------------------------------------------------------------------

describe('createFund – e2e failure scenarios', () => {
  it('all three fields invalid: fund_id error surfaces first', async () => {
    const client = makeClient();
    await expect(
      callCreateFund(client, { fundId: '', totalAmount: '0', expiresAt: PAST })
    ).rejects.toThrow('fund_id must not be empty');
  });

  it('valid fund_id, zero amount, past expiry: amount error surfaces', async () => {
    const client = makeClient();
    await expect(
      callCreateFund(client, { totalAmount: '0', expiresAt: PAST })
    ).rejects.toThrow('total_amount must be greater than zero');
  });

  it('valid fund_id, valid amount, past expiry: expiry error surfaces', async () => {
    const client = makeClient();
    await expect(
      callCreateFund(client, { expiresAt: PAST })
    ).rejects.toThrow('expires_at must be a future timestamp');
  });
});

// ---------------------------------------------------------------------------
// E2E-style tests – full happy path (validation passes, network reached)
// ---------------------------------------------------------------------------

describe('createFund – e2e happy path', () => {
  it('valid inputs: validation passes and loadAccount is called', async () => {
    const mockServer = {
      loadAccount: jest.fn().mockResolvedValue({ id: 'mock', sequence: '0' }),
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'tx-hash-123' }),
    };
    const client = makeClient(mockServer);

    await assertValidationPasses(client, {
      fundId: 'flood_relief_2024',
      totalAmount: '500000',
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
    });

    expect(mockServer.loadAccount).toHaveBeenCalledTimes(1);
  });
});
