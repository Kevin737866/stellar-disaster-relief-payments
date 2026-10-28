import { OfflineAuthClient } from '../offlineAuth';

describe('OfflineAuthClient - Single-use SMS/USSD Challenges (#323)', () => {
  let client: OfflineAuthClient;
  let mockStorage: Map<string, string>;

  beforeEach(() => {
    mockStorage = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => mockStorage.get(key) || null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
      key: (i: number) => Array.from(mockStorage.keys())[i] || null,
      get length() {
        return mockStorage.size;
      },
    };
    (global as any).localStorage = fakeLocalStorage;
    client = new OfflineAuthClient({});
  });

  it('accepts a valid SMS challenge on first verification', () => {
    const challenge = client.generateSMSCode('beneficiary-1', '+1234567890', 15);
    expect(challenge.challengeId).toBeDefined();

    const res = client.validateSMSChallenge(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(res.isValid).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('rejects replayed SMS challenge as already_consumed', () => {
    const challenge = client.generateSMSCode('beneficiary-2', '+1234567890', 15);

    const first = client.validateSMSCode(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(first).toBe(true);

    const second = client.validateSMSChallenge(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(second.isValid).toBe(false);
    expect(second.reason).toBe('already_consumed');
  });

  it('rejects expired SMS challenge with expired reason', () => {
    const challenge = client.generateSMSCode('beneficiary-3', '+1234567890', -5); // Already expired

    const res = client.validateSMSChallenge(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe('expired');
  });

  it('rejects tampered or invalid signature', () => {
    const challenge = client.generateSMSCode('beneficiary-4', '+1234567890', 15);

    const res = client.validateSMSChallenge(
      '999999', // Tampered code
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toBe('invalid_signature');
  });

  it('persists and synchronizes consumed challenges across verifier restarts', () => {
    const challenge = client.generateSMSCode('beneficiary-5', '+1234567890', 15);
    client.validateSMSCode(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );

    // Create a new client instance simulating verifier restart
    const restoredClient = new OfflineAuthClient({});
    expect(restoredClient.getConsumedChallenges()).toContain(challenge.challengeId);

    const replayAttempt = restoredClient.validateSMSChallenge(
      challenge.code,
      '+1234567890',
      challenge.signature,
      challenge.expiresAt,
      challenge.challengeId
    );
    expect(replayAttempt.isValid).toBe(false);
    expect(replayAttempt.reason).toBe('already_consumed');
  });
});
