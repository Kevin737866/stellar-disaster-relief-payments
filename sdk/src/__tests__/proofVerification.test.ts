/**
 * Security tests for DonorTransparencyClient.verifyProof.
 *
 * Verifies that proof-of-impact attestations can only be transitioned to
 * `verified` when:
 *   - The proof exists in storage.
 *   - The verifier is in the trusted-verifier registry and active.
 *   - The proof carries a non-empty signature.
 *   - The signature validates against the canonical proof message.
 *
 * Covers the following scenarios:
 *   1. Valid signature → proof transitions to `verified`.
 *   2. Tampered proof data → signature mismatch → proof stays unverified.
 *   3. Missing signature → verification fails, status unchanged.
 *   4. Empty/whitespace signature → verification fails, status unchanged.
 *   5. Unauthorized verifier → rejected, status unchanged.
 *   6. Inactive (disabled) verifier → rejected, status unchanged.
 *   7. Verifier-service throws → service error returned, status unchanged.
 *   8. Proof not found → error returned.
 *   9. Already-verified proof → cannot be re-verified by a different verifier.
 *  10. Result shape: failures never return a success-shaped result.
 *  11. No trusted verifiers configured → all verifiers rejected.
 *  12. Fallback (no verifier service) mode still rejects invalid signatures.
 */

import { SHA256 } from 'crypto-js';
import { DonorTransparencyClient } from '../donorTransparency';
import type { ProofOfImpact, TrustedVerifier } from '../donorTransparency';

// ── Test helpers ──────────────────────────────────────────────────────────

/**
 * Build a canonical proof message identical to the one used inside
 * DonorTransparencyClient.buildProofMessage, so tests can precompute
 * the expected signature.
 */
function buildCanonicalMessage(proof: Omit<ProofOfImpact, 'signature' | 'verificationStatus' | 'verifiedBy' | 'fieldWorkerPublicKey'>): string {
  const payload = {
    id: proof.id,
    fundId: proof.fundId,
    disbursementId: proof.disbursementId,
    fieldWorkerId: proof.fieldWorkerId,
    timestamp: proof.timestamp,
    location: proof.location,
    beneficiaryCount: proof.beneficiaryCount,
    description: proof.description,
    mediaHash: proof.mediaHash,
  };
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/** Create a minimal valid proof object (without signature/status). */
function makeProofFixture(overrides?: Partial<ProofOfImpact>): Omit<ProofOfImpact, 'signature' | 'verificationStatus' | 'verifiedBy' | 'fieldWorkerPublicKey'> {
  return {
    id: 'test-proof-001',
    fundId: 'FUND-001',
    disbursementId: 'DISB-001',
    fieldWorkerId: 'WORKER-001',
    timestamp: 1700000000000,
    location: { latitude: 18.5944, longitude: -72.3074, address: 'Port-au-Prince, Haiti' },
    beneficiaryCount: 42,
    description: 'Emergency food distribution',
    mediaHash: 'QmHash123abc',
    ...overrides,
  };
}

/** Trusted verifier used across tests. */
const TRUSTED_VERIFIER: TrustedVerifier = {
  verifierId: 'verifier-org-1',
  publicKey: 'ed25519pubkey_hex',
  active: true,
};

/** Set up localStorage mock before each test. */
function setupLocalStorage() {
  const store: Record<string, string> = {};
  const ls = {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
    key: jest.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true, configurable: true });
  return store;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DonorTransparencyClient.verifyProof — security', () => {
  let client: DonorTransparencyClient;
  let store: Record<string, string>;

  beforeEach(() => {
    store = setupLocalStorage();
    client = new DonorTransparencyClient();
    client.registerTrustedVerifier(TRUSTED_VERIFIER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Valid signature ─────────────────────────────────────────────────

  it('transitions a proof to verified when the signature is valid', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    // Inject a verifier service that always confirms the signature.
    client.setVerifierService(async () => true);

    // Store the proof directly in localStorage.
    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    const result = await client.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(true);
    expect(result.verificationStatus).toBe('verified');
    expect(result.error).toBeUndefined();

    // Verify the stored proof is actually verified.
    const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
    expect(stored.verificationStatus).toBe('verified');
    expect(stored.verifiedBy).toBe(TRUSTED_VERIFIER.verifierId);
  });

  // ── 2. Tampered proof data ─────────────────────────────────────────────

  it('rejects a proof whose data was tampered after signing (signature mismatch)', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    // Tamper: change the beneficiaryCount after the signature was computed.
    const tamperedProof: ProofOfImpact = {
      ...proofBase,
      beneficiaryCount: 999, // tampered!
      signature: validSig,    // still the original signature
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${tamperedProof.id}`] = JSON.stringify(tamperedProof);

    // Verifier service computes the hash over the *tampered* data and
    // compares it to the original signature — they won't match.
    client.setVerifierService(async (msgHash, sig) => {
      return msgHash === sig; // signature was hash of original, not tampered
    });

    const result = await client.verifyProof(tamperedProof.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_SIGNATURE');
    expect(result.verificationStatus).toBe('disputed');

    // The stored proof should be disputed, not verified.
    const stored = JSON.parse(store[`donor_transparency_proof_${tamperedProof.id}`]);
    expect(stored.verificationStatus).toBe('disputed');
    expect(stored.verifiedBy).toBeUndefined();
  });

  // ── 3. Missing signature ────────────────────────────────────────────────

  it('fails when the proof has no signature field', async () => {
    const proofBase = makeProofFixture();
    const proofNoSig: ProofOfImpact = {
      ...proofBase,
      signature: '',
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${proofNoSig.id}`] = JSON.stringify(proofNoSig);

    client.setVerifierService(async () => true);

    const result = await client.verifyProof(proofNoSig.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_SIGNATURE');
    expect(result.verificationStatus).toBe('pending');

    // Status unchanged.
    const stored = JSON.parse(store[`donor_transparency_proof_${proofNoSig.id}`]);
    expect(stored.verificationStatus).toBe('pending');
  });

  // ── 4. Whitespace-only signature ───────────────────────────────────────

  it('fails when the signature is only whitespace', async () => {
    const proofBase = makeProofFixture();
    const proofWhitespace: ProofOfImpact = {
      ...proofBase,
      signature: '   ',
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${proofWhitespace.id}`] = JSON.stringify(proofWhitespace);

    client.setVerifierService(async () => true);

    const result = await client.verifyProof(proofWhitespace.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_SIGNATURE');
  });

  // ── 5. Unauthorized verifier ────────────────────────────────────────────

  it('rejects an untrusted verifier identity', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    client.setVerifierService(async () => true);

    const result = await client.verifyProof(fullProof.id, 'untrusted-verifier-id');

    expect(result.success).toBe(false);
    expect(result.error).toBe('UNAUTHORIZED_VERIFIER');
    expect(result.verificationStatus).toBe('pending');

    // Proof status unchanged.
    const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
    expect(stored.verificationStatus).toBe('pending');
    expect(stored.verifiedBy).toBeUndefined();
  });

  // ── 6. Inactive verifier ────────────────────────────────────────────────

  it('rejects a verifier that is registered but inactive', async () => {
    const inactiveVerifier: TrustedVerifier = {
      verifierId: 'inactive-verifier',
      publicKey: 'somekey',
      active: false,
    };
    client.registerTrustedVerifier(inactiveVerifier);

    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    client.setVerifierService(async () => true);

    const result = await client.verifyProof(fullProof.id, inactiveVerifier.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INACTIVE_VERIFIER');

    const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
    expect(stored.verificationStatus).toBe('pending');
  });

  // ── 7. Verifier-service failure ─────────────────────────────────────────

  it('returns a service error and does not transition the proof when the verifier service throws', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    // Service throws — simulating a network or backend failure.
    client.setVerifierService(async () => {
      throw new Error('Connection refused');
    });

    const result = await client.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('VERIFIER_SERVICE_UNAVAILABLE');
    expect(result.verificationStatus).toBe('pending');

    // Proof status unchanged.
    const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
    expect(stored.verificationStatus).toBe('pending');
    expect(stored.verifiedBy).toBeUndefined();
  });

  // ── 8. Proof not found ──────────────────────────────────────────────────

  it('returns PROOF_NOT_FOUND for a non-existent proof ID', async () => {
    const result = await client.verifyProof('nonexistent-proof', TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('PROOF_NOT_FOUND');
    expect(result.verificationStatus).toBe('pending');
  });

  // ── 9. Already verified by a different verifier ─────────────────────────

  it('prevents re-verification of an already-verified proof by a different verifier', async () => {
    const otherVerifier: TrustedVerifier = {
      verifierId: 'verifier-org-2',
      publicKey: 'otherkey',
      active: true,
    };
    client.registerTrustedVerifier(otherVerifier);

    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const verifiedProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'verified',
      verifiedBy: 'verifier-org-1',
    };
    store[`donor_transparency_proof_${verifiedProof.id}`] = JSON.stringify(verifiedProof);

    client.setVerifierService(async () => true);

    const result = await client.verifyProof(verifiedProof.id, otherVerifier.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('PROOF_ALREADY_VERIFIED');
    expect(result.verificationStatus).toBe('verified');

    // The stored proof is unchanged — still verified by the original verifier.
    const stored = JSON.parse(store[`donor_transparency_proof_${verifiedProof.id}`]);
    expect(stored.verificationStatus).toBe('verified');
    expect(stored.verifiedBy).toBe('verifier-org-1');
  });

  // ── 10. Result shape: failure is never success-shaped ───────────────────

  it('never returns success=true on any failure path', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    // Tampered signature
    client.setVerifierService(async () => false);
    const r1 = await client.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);
    expect(r1.success).toBe(false);
    expect(r1).toHaveProperty('error');
    expect(r1).toHaveProperty('message');

    // Reset proof status for next check
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify({
      ...fullProof,
      verificationStatus: 'pending',
    });

    // Unauthorized verifier
    const r2 = await client.verifyProof(fullProof.id, 'bad-verifier');
    expect(r2.success).toBe(false);
    expect(r2).toHaveProperty('error');

    // Missing proof
    const r3 = await client.verifyProof('no-such-proof', TRUSTED_VERIFIER.verifierId);
    expect(r3.success).toBe(false);
    expect(r3).toHaveProperty('error');
  });

  // ── 11. No trusted verifiers configured ────────────────────────────────

  it('rejects all verifiers when no trusted verifiers are configured', async () => {
    const freshClient = new DonorTransparencyClient();
    // No registerTrustedVerifier calls.

    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    freshClient.setVerifierService(async () => true);

    const result = await freshClient.verifyProof(fullProof.id, 'any-verifier');

    expect(result.success).toBe(false);
    expect(result.error).toBe('UNAUTHORIZED_VERIFIER');
  });

  // ── 12. Fallback mode (no verifier service) ──────────────────────────────

  describe('fallback mode (no verifier service injected)', () => {
    it('verifies a proof when the signature equals the SHA-256 hash of the canonical message', async () => {
      // Create a client WITHOUT a verifier service — uses built-in fallback.
      const fallbackClient = new DonorTransparencyClient();
      fallbackClient.registerTrustedVerifier(TRUSTED_VERIFIER);

      const proofBase = makeProofFixture();
      const message = buildCanonicalMessage(proofBase);
      const validSig = SHA256(message).toString();

      const fullProof: ProofOfImpact = {
        ...proofBase,
        signature: validSig,
        verificationStatus: 'pending',
      };
      store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

      const result = await fallbackClient.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);

      expect(result.success).toBe(true);
      expect(result.verificationStatus).toBe('verified');

      const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
      expect(stored.verificationStatus).toBe('verified');
      expect(stored.verifiedBy).toBe(TRUSTED_VERIFIER.verifierId);
    });

    it('rejects a proof with an invalid signature in fallback mode', async () => {
      const fallbackClient = new DonorTransparencyClient();
      fallbackClient.registerTrustedVerifier(TRUSTED_VERIFIER);

      const proofBase = makeProofFixture();
      const fullProof: ProofOfImpact = {
        ...proofBase,
        signature: 'invalid-signature-not-a-hash',
        verificationStatus: 'pending',
      };
      store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

      const result = await fallbackClient.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
      expect(result.verificationStatus).toBe('disputed');
    });
  });

  // ── 13. Revoked verifier ────────────────────────────────────────────────

  it('rejects a verifier that was removed from the registry after registration', async () => {
    const proofBase = makeProofFixture();
    const message = buildCanonicalMessage(proofBase);
    const validSig = SHA256(message).toString();

    const fullProof: ProofOfImpact = {
      ...proofBase,
      signature: validSig,
      verificationStatus: 'pending',
    };
    store[`donor_transparency_proof_${fullProof.id}`] = JSON.stringify(fullProof);

    client.setVerifierService(async () => true);

    // Revoke the trusted verifier.
    client.revokeTrustedVerifier(TRUSTED_VERIFIER.verifierId);

    const result = await client.verifyProof(fullProof.id, TRUSTED_VERIFIER.verifierId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('UNAUTHORIZED_VERIFIER');

    const stored = JSON.parse(store[`donor_transparency_proof_${fullProof.id}`]);
    expect(stored.verificationStatus).toBe('pending');
  });
});
