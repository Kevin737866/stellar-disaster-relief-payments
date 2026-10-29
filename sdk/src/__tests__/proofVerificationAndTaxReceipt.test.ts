import {
  DonorTransparencyClient,
  ProofOfImpact,
  TaxPolicy,
} from '../donorTransparency';

describe('DonorTransparencyClient Hardening (#316, #319, #320)', () => {
  let client: DonorTransparencyClient;
  const TRUSTED_VERIFIER = 'verifier_un_relief_01';
  const AUTHORIZED_REVIEWER = 'auditor_compliance_lead';

  beforeEach(() => {
    // Clear localStorage mock if present
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    client = new DonorTransparencyClient('https://ipfs.io/ipfs/', {
      trustedVerifiers: [TRUSTED_VERIFIER],
      authorizedReviewers: [AUTHORIZED_REVIEWER],
    });
  });

  describe('Issue #316: Verify proof-of-impact signatures & trusted verifiers', () => {
    it('successfully verifies a proof when verifier is trusted and signature is valid', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_101',
        'disb_01',
        'worker_alice',
        { latitude: 18.48, longitude: -69.93, address: 'Distribution Center A' },
        250,
        'Food parcel distribution',
        'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
        'valid_signature_worker_alice_ed25519_verified'
      );

      expect(proof.verificationStatus).toBe('pending');

      const verified = await client.verifyProof(proof.id, TRUSTED_VERIFIER);
      expect(verified).toBe(true);

      const dashboard = await client.generateDonorDashboard('G_DONOR_ANY');
      // Verify internal state update
      const stored = (client as any).retrieveProofOfImpact ? await (client as any).retrieveProofOfImpact(proof.id) : null;
      if (stored) {
        expect(stored.verificationStatus).toBe('verified');
        expect(stored.verifiedBy).toBe(TRUSTED_VERIFIER);
        expect(typeof stored.verifiedAt).toBe('number');
      }
    });

    it('rejects verification if verifier is not in the trusted verifier set', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_101',
        'disb_01',
        'worker_alice',
        { latitude: 18.48, longitude: -69.93, address: 'Center A' },
        100,
        'Water delivery',
        'QmHash123',
        'valid_signature_worker_alice'
      );

      const verified = await client.verifyProof(proof.id, 'untrusted_impersonator');
      expect(verified).toBe(false);

      const stored = await (client as any).retrieveProofOfImpact(proof.id);
      expect(stored.verificationStatus).toBe('pending');
      expect(stored.verifiedBy).toBeUndefined();
    });

    it('rejects verification if signature is tampered or invalid', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_101',
        'disb_01',
        'worker_bob',
        { latitude: 18.48, longitude: -69.93, address: 'Center B' },
        50,
        'Medical supplies',
        'QmHash456',
        'tampered_signature_malformed_bits'
      );

      const verified = await client.verifyProof(proof.id, TRUSTED_VERIFIER);
      expect(verified).toBe(false);

      const stored = await (client as any).retrieveProofOfImpact(proof.id);
      expect(stored.verificationStatus).toBe('pending');
    });

    it('rejects verification when no signature is provided or signature is empty', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_101',
        'disb_01',
        'worker_bob',
        { latitude: 18.48, longitude: -69.93, address: 'Center B' },
        50,
        'Blankets',
        'QmHash789',
        ''
      );

      const verified = await client.verifyProof(proof.id, TRUSTED_VERIFIER);
      expect(verified).toBe(false);
    });

    it('fails closed when no trusted verifiers are configured on the client', async () => {
      const unconfiguredClient = new DonorTransparencyClient();
      const proof = await unconfiguredClient.submitProofOfImpact(
        'fund_101',
        'disb_01',
        'worker_charlie',
        { latitude: 18.48, longitude: -69.93, address: 'Center C' },
        20,
        'Hygiene kits',
        'QmHashABC',
        'valid_signature_charlie'
      );

      const verified = await unconfiguredClient.verifyProof(proof.id, 'any_verifier');
      expect(verified).toBe(false);
    });
  });

  describe('Issue #320: Auditable dispute workflow for proof-of-impact records', () => {
    it('allows an authorized reviewer to dispute a pending proof with reason', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_202',
        'disb_02',
        'worker_dave',
        { latitude: 19.0, longitude: -70.0, address: 'Sector 4' },
        300,
        'Emergency shelter distribution',
        'QmHashShelter',
        'valid_signature_dave'
      );

      const disputed = await client.disputeProof(
        proof.id,
        AUTHORIZED_REVIEWER,
        'Geolocation coordinates mismatch reported field location'
      );

      expect(disputed.verificationStatus).toBe('disputed');
      expect(disputed.dispute).toBeDefined();
      expect(disputed.dispute?.reviewerId).toBe(AUTHORIZED_REVIEWER);
      expect(disputed.dispute?.reason).toBe('Geolocation coordinates mismatch reported field location');
      expect(disputed.dispute?.previousStatus).toBe('pending');
      expect(typeof disputed.dispute?.timestamp).toBe('number');
    });

    it('allows disputing a previously verified proof, recording audit history', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_202',
        'disb_02',
        'worker_dave',
        { latitude: 19.0, longitude: -70.0, address: 'Sector 4' },
        300,
        'Medical tent setup',
        'QmHashMed',
        'valid_signature_dave'
      );

      await client.verifyProof(proof.id, TRUSTED_VERIFIER);

      const disputed = await client.disputeProof(
        proof.id,
        AUTHORIZED_REVIEWER,
        'Post-audit detected duplicate beneficiary IDs'
      );

      expect(disputed.verificationStatus).toBe('disputed');
      expect(disputed.dispute?.previousStatus).toBe('verified');
      expect(disputed.verifiedBy).toBe(TRUSTED_VERIFIER); // Preserves original attestation
    });

    it('rejects dispute by unauthorized reviewer without altering the proof', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_202',
        'disb_02',
        'worker_dave',
        { latitude: 19.0, longitude: -70.0, address: 'Sector 4' },
        50,
        'Food kits',
        'QmHashKits',
        'valid_signature_dave'
      );

      await expect(
        client.disputeProof(proof.id, 'unauthorized_actor', 'Unsubstantiated claim')
      ).rejects.toThrow(/not authorized/i);

      const stored = await (client as any).retrieveProofOfImpact(proof.id);
      expect(stored.verificationStatus).toBe('pending');
    });

    it('rejects dispute with empty or whitespace-only reason', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_202',
        'disb_02',
        'worker_dave',
        { latitude: 19.0, longitude: -70.0, address: 'Sector 4' },
        50,
        'Food kits',
        'QmHashKits',
        'valid_signature_dave'
      );

      await expect(
        client.disputeProof(proof.id, AUTHORIZED_REVIEWER, '   ')
      ).rejects.toThrow(/empty/i);
    });

    it('rejects repeated disputes on already disputed proofs', async () => {
      const proof = await client.submitProofOfImpact(
        'fund_202',
        'disb_02',
        'worker_dave',
        { latitude: 19.0, longitude: -70.0, address: 'Sector 4' },
        50,
        'Food kits',
        'QmHashKits',
        'valid_signature_dave'
      );

      await client.disputeProof(proof.id, AUTHORIZED_REVIEWER, 'Initial dispute reason');

      await expect(
        client.disputeProof(proof.id, AUTHORIZED_REVIEWER, 'Second dispute attempt')
      ).rejects.toThrow(/already in disputed status/i);
    });
  });

  describe('Issue #319: Verified donation dates & explicit tax policy', () => {
    it('sets donationDate to the fund creation event time and applies 100% deduction under tax policy', async () => {
      const historicalDonationTime = 1680000000000; // Historical date in the past

      // Create fund_created entry at historical time
      await client.createTransparencyEntry(
        'fund_303',
        'fund_created',
        '50000',
        'Initial emergency relief contribution',
        undefined,
        undefined,
        undefined
      );

      // Overwrite the timestamp to simulate historical donation
      const entries = await (client as any).retrieveTransparencyEntries('fund_303');
      entries[0].timestamp = historicalDonationTime;
      await (client as any).storeTransparencyEntry(entries[0]);

      const policy: TaxPolicy = {
        jurisdiction: 'US-501c3',
        deductiblePercentage: 100,
        isRecognizedCharity: true,
      };

      const beforeGeneration = Date.now();
      const receipt = await client.generateTaxReceipt(
        'fund_303',
        'G_DONOR_BOB',
        'Bob Donor',
        'bob@example.com',
        policy
      );
      const afterGeneration = Date.now();

      // donationDate must match the historical contribution event, NOT generation time
      expect(receipt.donationDate).toBe(historicalDonationTime);

      // receiptDate is the time receipt was generated
      expect(receipt.receiptDate).toBeGreaterThanOrEqual(beforeGeneration);
      expect(receipt.receiptDate).toBeLessThanOrEqual(afterGeneration);

      // Tax deductible amount computed accurately
      expect(receipt.totalDonation).toBe('50000');
      expect(receipt.taxDeductibleAmount).toBe('50000');
      expect(receipt.isTaxClaimable).toBe(true);
      expect(receipt.jurisdiction).toBe('US-501c3');
    });

    it('computes partial tax deductible amount and caps by maxDeductibleAmount', async () => {
      await client.createTransparencyEntry(
        'fund_404',
        'fund_created',
        '100000',
        'Charitable grant'
      );

      const policy50: TaxPolicy = {
        jurisdiction: 'EU-NGO',
        deductiblePercentage: 50,
      };

      const receipt50 = await client.generateTaxReceipt(
        'fund_404',
        'G_DONOR_CAROL',
        'Carol',
        'carol@example.com',
        policy50
      );
      expect(receipt50.taxDeductibleAmount).toBe('50000'); // 50% of 100000

      // With cap
      const policyCapped: TaxPolicy = {
        jurisdiction: 'EU-NGO',
        deductiblePercentage: 100,
        maxDeductibleAmount: '30000',
      };
      const receiptCapped = await client.generateTaxReceipt(
        'fund_404',
        'G_DONOR_CAROL',
        'Carol',
        'carol@example.com',
        policyCapped
      );
      expect(receiptCapped.taxDeductibleAmount).toBe('30000');
    });

    it('returns 0 deductible amount and non-claimable status when policy is missing or unconfigured', async () => {
      await client.createTransparencyEntry(
        'fund_505',
        'fund_created',
        '25000',
        'General relief'
      );

      // No policy provided
      const receipt = await client.generateTaxReceipt(
        'fund_505',
        'G_DONOR_DAN',
        'Dan',
        'dan@example.com'
      );

      expect(receipt.totalDonation).toBe('25000');
      expect(receipt.taxDeductibleAmount).toBe('0');
      expect(receipt.isTaxClaimable).toBe(false);
      expect(receipt.jurisdiction).toBe('UNSPECIFIED');
    });

    it('fails when no verified contribution or fund creation event exists for the fund', async () => {
      // Do not create any fund_created entry
      await expect(
        client.generateTaxReceipt('fund_ghost', 'G_DONOR_EVE', 'Eve', 'eve@example.com')
      ).rejects.toThrow(/no verified contribution/i);
    });
  });
});
