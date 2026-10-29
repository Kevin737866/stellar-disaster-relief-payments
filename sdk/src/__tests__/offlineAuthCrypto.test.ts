import { OfflineAuthClient } from '../offlineAuth';
import { BeneficiaryIdentity } from '../types';

describe('OfflineAuthClient Cryptographic Authentication (#321)', () => {
  const SIGNING_SECRET = 'super_secret_offline_signing_key_32_bytes_long!!';
  const VERIFIER_KEY = 'super_secret_offline_signing_key_32_bytes_long!!';
  const ATTACKER_SECRET = 'malicious_attacker_unauthorized_key_99999999';

  const sampleIdentity: BeneficiaryIdentity = {
    idHash: 'id_hash_beneficiary_alpha_999',
    campLocation: 'Camp Alpha Zone 4',
    trustScore: 85,
    registrationDate: 1680000000000,
    disbursementHistory: [],
    verificationFactors: [],
    backupCodesRemaining: 5,
    isSuspended: false,
  };

  describe('QR Code Cryptographic Authentication', () => {
    it('generates and validates authentic QR credentials with configured secret', () => {
      const issuer = new OfflineAuthClient({ signingSecret: SIGNING_SECRET });
      const verifier = new OfflineAuthClient({ trustedVerificationKeys: [VERIFIER_KEY] });

      const qrCode = issuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 30);
      expect(qrCode.type).toBe('qr');
      expect(qrCode.code).toBeDefined();

      const result = verifier.validateQRCode(qrCode.code);
      expect(result.isValid).toBe(true);
      expect(result.idHash).toBe(sampleIdentity.idHash);
      expect(result.trustScore).toBe(85);
      expect(result.campLocation).toBe('Camp Alpha Zone 4');
      expect(result.reason).toBeUndefined();
    });

    it('rejects forged QR codes generated with an untrusted/attacker secret', () => {
      const attackerIssuer = new OfflineAuthClient({ signingSecret: ATTACKER_SECRET });
      const verifier = new OfflineAuthClient({ trustedVerificationKeys: [VERIFIER_KEY] });

      const forgedQR = attackerIssuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 30);
      const result = verifier.validateQRCode(forgedQR.code);

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/invalid signature|untrusted signer/i);
    });

    it('invalidates QR credentials if identity fields (trustScore, campLocation) are tampered with', () => {
      const issuer = new OfflineAuthClient({ signingSecret: SIGNING_SECRET });
      const verifier = new OfflineAuthClient({ trustedVerificationKeys: [VERIFIER_KEY] });

      const qrCode = issuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 30);
      const data = JSON.parse(qrCode.code);

      // Tamper with trust score
      const tamperedTrust = { ...data, trust: 99 };
      expect(verifier.validateQRCode(JSON.stringify(tamperedTrust)).isValid).toBe(false);

      // Tamper with location
      const tamperedLoc = { ...data, loc: 'VIP Unauthorized Sector' };
      expect(verifier.validateQRCode(JSON.stringify(tamperedLoc)).isValid).toBe(false);

      // Tamper with ID
      const tamperedId = { ...data, id: 'id_hash_another_user' };
      expect(verifier.validateQRCode(JSON.stringify(tamperedId)).isValid).toBe(false);
    });

    it('invalidates QR credentials if expiration timestamp is extended or tampered', () => {
      const issuer = new OfflineAuthClient({ signingSecret: SIGNING_SECRET });
      const verifier = new OfflineAuthClient({ trustedVerificationKeys: [VERIFIER_KEY] });

      const qrCode = issuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 10);
      const data = JSON.parse(qrCode.code);

      // Extend expiration into future
      const tamperedExp = { ...data, exp: data.exp + 100000000 };
      expect(verifier.validateQRCode(JSON.stringify(tamperedExp)).isValid).toBe(false);
    });

    it('rejects expired QR credentials', () => {
      const issuer = new OfflineAuthClient({ signingSecret: SIGNING_SECRET });
      const verifier = new OfflineAuthClient({ trustedVerificationKeys: [VERIFIER_KEY] });

      // Generate with -5 minutes validity (already expired)
      const qrCode = issuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, -5);
      const result = verifier.validateQRCode(qrCode.code);

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it('fails closed when verifier has no trusted verification keys configured', () => {
      const issuer = new OfflineAuthClient({ signingSecret: SIGNING_SECRET });
      const unconfiguredVerifier = new OfflineAuthClient(); // No trusted keys

      const qrCode = issuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 30);
      const result = unconfiguredVerifier.validateQRCode(qrCode.code);

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/invalid signature|untrusted signer/i);
    });

    it('fails closed when generating QR code without configured signing secret', () => {
      const unconfiguredIssuer = new OfflineAuthClient(); // No signing secret

      expect(() => {
        unconfiguredIssuer.generateQRCode(sampleIdentity.idHash, sampleIdentity, 30);
      }).toThrow(/without configured signingSecret/i);
    });
  });

  describe('USSD / SMS Cryptographic Authentication', () => {
    const USSD_SECRET = 'ussd_telco_verifier_secret_key_888888';
    const PHONE = '+15551234567';

    it('generates and validates SMS/USSD codes with verifier secret', () => {
      const client = new OfflineAuthClient({ ussdSecret: USSD_SECRET });

      const smsCode = client.generateSMSCode(sampleIdentity.idHash, PHONE, 15);
      expect(smsCode.type).toBe('sms');
      expect(smsCode.code).toMatch(/^\d{6}$/);

      const isValid = client.validateSMSCode(
        smsCode.code,
        PHONE,
        smsCode.signature,
        smsCode.expiresAt,
        sampleIdentity.idHash
      );
      expect(isValid).toBe(true);
    });

    it('rejects tampered USSD code numbers or altered phone numbers', () => {
      const client = new OfflineAuthClient({ ussdSecret: USSD_SECRET });
      const smsCode = client.generateSMSCode(sampleIdentity.idHash, PHONE, 15);

      // Tampered code
      const wrongCode = smsCode.code === '123456' ? '654321' : '123456';
      expect(
        client.validateSMSCode(wrongCode, PHONE, smsCode.signature, smsCode.expiresAt, sampleIdentity.idHash)
      ).toBe(false);

      // Tampered phone number
      expect(
        client.validateSMSCode(smsCode.code, '+15559999999', smsCode.signature, smsCode.expiresAt, sampleIdentity.idHash)
      ).toBe(false);
    });

    it('rejects forged USSD signatures generated without verifier secret', () => {
      const verifier = new OfflineAuthClient({ ussdSecret: USSD_SECRET });

      // Unkeyed hash or forged signature
      const forgedSig = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const isValid = verifier.validateSMSCode('123456', PHONE, forgedSig, Date.now() + 60000, sampleIdentity.idHash);

      expect(isValid).toBe(false);
    });

    it('rejects expired SMS/USSD codes', () => {
      const client = new OfflineAuthClient({ ussdSecret: USSD_SECRET });
      const smsCode = client.generateSMSCode(sampleIdentity.idHash, PHONE, -1); // Expired

      const isValid = client.validateSMSCode(
        smsCode.code,
        PHONE,
        smsCode.signature,
        smsCode.expiresAt,
        sampleIdentity.idHash
      );
      expect(isValid).toBe(false);
    });

    it('fails closed when verifier has no USSD secret configured', () => {
      const clientWithSecret = new OfflineAuthClient({ ussdSecret: USSD_SECRET });
      const clientWithoutSecret = new OfflineAuthClient();

      const smsCode = clientWithSecret.generateSMSCode(sampleIdentity.idHash, PHONE, 15);
      const isValid = clientWithoutSecret.validateSMSCode(
        smsCode.code,
        PHONE,
        smsCode.signature,
        smsCode.expiresAt,
        sampleIdentity.idHash
      );

      expect(isValid).toBe(false);
    });
  });
});
