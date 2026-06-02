// Mock stellar-sdk so Contract construction doesn't throw on fake IDs
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  const mockOp = { type: 'invokeHostFunction' };
  const MockContract = jest.fn().mockImplementation(() => ({
    call: jest.fn().mockReturnValue(mockOp),
  }));
  const MockTransactionBuilder = jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ sign: jest.fn() }),
  }));
  return {
    ...actual,
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
  };
});

import { EmergencyFundsClient } from './sdk/src/emergencyFunds';
import { Keypair } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FUTURE = Date.now() + 90 * 24 * 60 * 60 * 1000; // 90 days from now
const PAST = Date.now() - 1000; // 1 second ago
const NOW = Date.now(); // exact now (boundary)

function makeClient() {
  const signingKey = Keypair.random();
  const mockServer = {
    loadAccount: jest.fn().mockResolvedValue({ id: 'mock', sequence: '0' }),
    submitTransaction: jest.fn().mockResolvedValue({ hash: 'mock-hash' }),
  };
  return new EmergencyFundsClient(
    'CONTRACT_ID',
    signingKey,
    mockServer,
  );
}

const VALID_ARGS = {
  adminAddress: Keypair.random().publicKey(),
  fundId: 'earthquake_response_2024',
  name: 'Earthquake Response',
  description: 'Emergency fund',
  totalAmount: '1000000',
  disasterType: 'seismic',
  geographicScope: 'Santo Domingo',
  expiresAt: FUTURE,
  signersArray: [Keypair.random().publicKey()],
  requiredSignatures: 1,
};

// ---------------------------------------------------------------------------
// Unit tests – validation logic (no network calls)
// ---------------------------------------------------------------------------

describe('createFund – fund_id validation', () => {
  test('rejects empty string fund_id', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, '', VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('fund_id cannot be empty');
  });

  test('rejects whitespace-only fund_id', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, '   ', VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('fund_id cannot be empty');
  });

  test('accepts a valid fund_id', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, 'valid-id', VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).resolves.toMatchObject({ success: true, fundId: 'valid-id' });
  });
});

describe('createFund – total_amount validation', () => {
  test('rejects zero total_amount', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '0', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('total_amount must be greater than zero');
  });

  test('rejects negative total_amount', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '-1', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('total_amount must be greater than zero');
  });

  test('accepts total_amount of 1 (boundary)', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '1', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).resolves.toMatchObject({ success: true });
  });

  test('accepts large total_amount', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '999999999999999', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).resolves.toMatchObject({ success: true });
  });
});

describe('createFund – expires_at validation', () => {
  test('rejects past timestamp', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        PAST, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('expires_at must be a future timestamp');
  });

  test('rejects current timestamp (boundary – not strictly future)', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        NOW, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('expires_at must be a future timestamp');
  });

  test('accepts a future timestamp', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        FUTURE, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).resolves.toMatchObject({ success: true });
  });

  test('accepts timestamp 1ms in the future (boundary)', async () => {
    const client = makeClient();
    const nearFuture = Date.now() + 1;
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        nearFuture, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).resolves.toMatchObject({ success: true });
  });
});

// ---------------------------------------------------------------------------
// Integration tests – validation fires before any network call
// ---------------------------------------------------------------------------

describe('createFund – validation fires before network call', () => {
  test('does not call server.loadAccount when fund_id is invalid', async () => {
    const client = makeClient();
    const server = (client as any).server;
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, '', VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow();
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  test('does not call server.loadAccount when total_amount is zero', async () => {
    const client = makeClient();
    const server = (client as any).server;
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '0', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow();
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  test('does not call server.loadAccount when expires_at is in the past', async () => {
    const client = makeClient();
    const server = (client as any).server;
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        PAST, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow();
    expect(server.loadAccount).not.toHaveBeenCalled();
  });

  test('calls server.loadAccount when all inputs are valid', async () => {
    const client = makeClient();
    const server = (client as any).server;
    await client.createFund(
      VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
      VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
      VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
    );
    expect(server.loadAccount).toHaveBeenCalledWith(VALID_ARGS.adminAddress);
  });
});

// ---------------------------------------------------------------------------
// E2E-style tests – full happy path and combined failure scenarios
// ---------------------------------------------------------------------------

describe('createFund – end-to-end scenarios', () => {
  test('happy path returns expected shape', async () => {
    const client = makeClient();
    const result = await client.createFund(
      VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
      VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
      VALID_ARGS.expiresAt, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
    );
    expect(result).toEqual({
      success: true,
      transactionHash: 'mock-hash',
      fundId: VALID_ARGS.fundId,
    });
  });

  test('all three fields invalid – first error thrown is fund_id', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, '', VALID_ARGS.name, VALID_ARGS.description,
        '0', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        PAST, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('fund_id cannot be empty');
  });

  test('fund_id valid but amount and expiry invalid – amount error thrown first', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        '0', VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        PAST, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('total_amount must be greater than zero');
  });

  test('fund_id and amount valid but expiry invalid', async () => {
    const client = makeClient();
    await expect(
      client.createFund(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, VALID_ARGS.name, VALID_ARGS.description,
        VALID_ARGS.totalAmount, VALID_ARGS.disasterType, VALID_ARGS.geographicScope,
        PAST, VALID_ARGS.signersArray, VALID_ARGS.requiredSignatures,
      )
    ).rejects.toThrow('expires_at must be a future timestamp');
  });

  test('other methods are unaffected by fund validation changes', async () => {
    const client = makeClient();
    // addTrigger should still work without validation errors
    await expect(
      client.addTrigger(
        VALID_ARGS.adminAddress, VALID_ARGS.fundId, 'trigger-1',
        'seismic', '7.0', 'usgs', '500000',
        18.5, -72.3, 100, 3,
      )
    ).resolves.toMatchObject({ success: true });
  });
});
