import { DonorTransparencyClient, InvalidProofTransitionError } from './donorTransparency';
import { UnauthorizedError, ValidationError } from './errors';
import type { ProofOfImpact } from './donorTransparency';

class MemoryStorage {
  private data: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.data).length;
  }

  key(index: number): string | null {
    return Object.keys(this.data)[index] ?? null;
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.data[key];
  }

  clear(): void {
    this.data = {};
  }
}

const storage = new MemoryStorage();
const REVIEWER = 'reviewer-alpha';
const PROOF_KEY_PREFIX = 'donor_transparency_proof_';

function createClient(reviewers: string[] = [REVIEWER]): DonorTransparencyClient {
  return new DonorTransparencyClient(undefined, reviewers);
}

async function submitProof(client: DonorTransparencyClient): Promise<ProofOfImpact> {
  return client.submitProofOfImpact(
    'fund-1',
    'disbursement-1',
    'field-worker-1',
    { latitude: 9.0765, longitude: 7.3986, address: 'Abuja, Nigeria' },
    12,
    'Food distribution',
    'QmMediaHash',
    'worker-signature'
  );
}

async function readStoredProof(proofId: string): Promise<ProofOfImpact | null> {
  const raw = storage.getItem(`${PROOF_KEY_PREFIX}${proofId}`);
  return raw ? JSON.parse(raw) : null;
}

async function expectProofUnchanged(proofId: string): Promise<void> {
  const proof = await readStoredProof(proofId);
  expect(proof?.verificationStatus).toBe('pending');
  expect(proof?.dispute).toBeUndefined();
  expect(proof?.reviewHistory).toEqual([]);
}

beforeAll(() => {
  (globalThis as any).localStorage = storage;
});

beforeEach(() => {
  storage.clear();
});

describe('DonorTransparencyClient.disputeProof', () => {
  it('disputes a pending proof and retains an auditable dispute record', async () => {
    const client = createClient();
    const proof = await submitProof(client);

    const updated = await client.disputeProof(proof.id, REVIEWER, 'Duplicate media hash');

    expect(updated.verificationStatus).toBe('disputed');
    expect(updated.dispute).toMatchObject({
      reason: 'Duplicate media hash',
      disputedBy: REVIEWER,
      previousStatus: 'pending',
    });
    expect(typeof updated.dispute?.timestamp).toBe('number');

    expect(updated.signature).toBe('worker-signature');
    expect(updated.mediaHash).toBe('QmMediaHash');
    expect(updated.fieldWorkerId).toBe('field-worker-1');
    expect(updated.beneficiaryCount).toBe(12);
    expect(updated.location.address).toBe('Abuja, Nigeria');

    expect(updated.reviewHistory).toHaveLength(1);
    expect(updated.reviewHistory?.[0]).toMatchObject({
      action: 'disputed',
      actor: REVIEWER,
      fromStatus: 'pending',
      toStatus: 'disputed',
      reason: 'Duplicate media hash',
    });

    expect(await readStoredProof(proof.id)).toEqual(updated);
    expect(await client.getProofOfImpact(proof.id)).toEqual(updated);
  });

  it('disputes a verified proof while preserving the original verification', async () => {
    const client = createClient();
    const proof = await submitProof(client);
    await client.verifyProof(proof.id, 'verifier-1');

    const updated = await client.disputeProof(proof.id, REVIEWER, 'Beneficiary count mismatch');

    expect(updated.verificationStatus).toBe('disputed');
    expect(updated.verifiedBy).toBe('verifier-1');
    expect(updated.dispute).toMatchObject({
      reason: 'Beneficiary count mismatch',
      disputedBy: REVIEWER,
      previousStatus: 'verified',
    });
    expect(updated.reviewHistory?.map(record => record.action)).toEqual(['verified', 'disputed']);
    expect(updated.reviewHistory?.[1]).toMatchObject({
      actor: REVIEWER,
      fromStatus: 'verified',
      toStatus: 'disputed',
    });
  });

  it('trims surrounding whitespace from the reason', async () => {
    const client = createClient();
    const proof = await submitProof(client);

    const updated = await client.disputeProof(proof.id, REVIEWER, '  Wrong location  ');

    expect(updated.dispute?.reason).toBe('Wrong location');
    expect(updated.reviewHistory?.[0].reason).toBe('Wrong location');
  });

  it.each(['', '   ', '\n\t'])('rejects an empty reason (%p) without modifying the proof', async reason => {
    const client = createClient();
    const proof = await submitProof(client);

    await expect(client.disputeProof(proof.id, REVIEWER, reason)).rejects.toBeInstanceOf(ValidationError);
    await expectProofUnchanged(proof.id);
  });

  it('rejects a missing reason without modifying the proof', async () => {
    const client = createClient();
    const proof = await submitProof(client);

    await expect(client.disputeProof(proof.id, REVIEWER, undefined as any)).rejects.toBeInstanceOf(ValidationError);
    await expectProofUnchanged(proof.id);
  });

  it('rejects an unauthorized reviewer without modifying the proof', async () => {
    const client = createClient();
    const proof = await submitProof(client);

    await expect(client.disputeProof(proof.id, 'stranger', 'Reason')).rejects.toBeInstanceOf(UnauthorizedError);
    await expectProofUnchanged(proof.id);
  });

  it('rejects an empty reviewer id without modifying the proof', async () => {
    const client = createClient();
    const proof = await submitProof(client);

    await expect(client.disputeProof(proof.id, '   ', 'Reason')).rejects.toBeInstanceOf(ValidationError);
    await expectProofUnchanged(proof.id);
  });

  it('rejects a dispute when no reviewers are authorized', async () => {
    const client = createClient([]);
    const proof = await submitProof(client);

    await expect(client.disputeProof(proof.id, REVIEWER, 'Reason')).rejects.toBeInstanceOf(UnauthorizedError);
    await expectProofUnchanged(proof.id);
  });

  it('rejects a repeated dispute and keeps the original audit record intact', async () => {
    const client = createClient();
    const proof = await submitProof(client);
    await client.disputeProof(proof.id, REVIEWER, 'First reason');
    const firstDispute = await readStoredProof(proof.id);

    await expect(client.disputeProof(proof.id, REVIEWER, 'Second reason')).rejects.toBeInstanceOf(
      InvalidProofTransitionError
    );

    const after = await readStoredProof(proof.id);
    expect(after).toEqual(firstDispute);
    expect(after?.dispute?.reason).toBe('First reason');
    expect(after?.reviewHistory).toHaveLength(1);
  });

  it('rejects a dispute from an unsupported state without modifying the proof', async () => {
    const client = createClient();
    const proof = await submitProof(client);
    const stored = await readStoredProof(proof.id);
    stored!.verificationStatus = 'archived' as any;
    storage.setItem(`${PROOF_KEY_PREFIX}${proof.id}`, JSON.stringify(stored));
    const before = await readStoredProof(proof.id);

    await expect(client.disputeProof(proof.id, REVIEWER, 'Reason')).rejects.toBeInstanceOf(
      InvalidProofTransitionError
    );
    expect(await readStoredProof(proof.id)).toEqual(before);
  });

  it('rejects a dispute for an unknown proof', async () => {
    const client = createClient();

    await expect(client.disputeProof('missing-proof', REVIEWER, 'Reason')).rejects.toThrow(/not found/i);
  });
});

describe('DonorTransparencyClient reviewer registry', () => {
  it('starts with the reviewers supplied to the constructor', () => {
    expect(createClient([REVIEWER, 'second-reviewer']).getAuthorizedReviewers()).toEqual([
      REVIEWER,
      'second-reviewer',
    ]);
  });

  it('supports adding and removing authorized reviewers', async () => {
    const client = createClient([]);
    const proof = await submitProof(client);

    expect(client.isAuthorizedReviewer(REVIEWER)).toBe(false);
    client.addAuthorizedReviewer(REVIEWER);
    expect(client.isAuthorizedReviewer(REVIEWER)).toBe(true);

    const updated = await client.disputeProof(proof.id, REVIEWER, 'Reason');
    expect(updated.verificationStatus).toBe('disputed');

    client.removeAuthorizedReviewer(REVIEWER);
    expect(client.isAuthorizedReviewer(REVIEWER)).toBe(false);
  });

  it('rejects an empty reviewer id when adding to the registry', () => {
    expect(() => createClient().addAuthorizedReviewer('  ')).toThrow(ValidationError);
  });
});

describe('DonorTransparencyClient.getProofReviewHistory', () => {
  it('returns the audit trail in chronological order', async () => {
    const client = createClient();
    const proof = await submitProof(client);
    await client.verifyProof(proof.id, 'verifier-1');
    await client.disputeProof(proof.id, REVIEWER, 'Reason');

    const history = await client.getProofReviewHistory(proof.id);

    expect(history.map(record => record.action)).toEqual(['verified', 'disputed']);
    expect(history[1].reason).toBe('Reason');
    expect(history[1].actor).toBe(REVIEWER);
  });

  it('returns a defensive copy of the audit trail', async () => {
    const client = createClient();
    const proof = await submitProof(client);
    await client.disputeProof(proof.id, REVIEWER, 'Reason');

    const history = await client.getProofReviewHistory(proof.id);
    history.length = 0;

    expect(await client.getProofReviewHistory(proof.id)).toHaveLength(1);
  });
});
