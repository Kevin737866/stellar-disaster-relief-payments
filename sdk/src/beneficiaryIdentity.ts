import { 
  Server, 
  TransactionBuilder, 
  Networks, 
  Keypair, 
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
import { createHash, SHA256 } from 'crypto-js';
import { 
  BeneficiaryIdentity, 
  IdentityFactor, 
  GeofenceZone,
  SocialRecoveryRequest 
} from './types';

export class BeneficiaryIdentityClient {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.beneficiaryManager);
  }

  /**
   * Create identity from multiple factors (NO BIOMETRICS)
   * Factors include: knowledge, possession, social, behavioral, institutional
   */
  async createIdentity(
    registrarKey: string,
    factors: IdentityFactor[],
    recoveryContacts: string[], // Stellar addresses
    campLocation: string,
    walletAddress: string,
    duressPin?: string
  ): Promise<string> {
    if (factors.length < 3) {
      throw new Error('Minimum 3 identity factors required for security');
    }

    const registrarKeypair = Keypair.fromSecret(registrarKey);
    const registrarAccount = await this.server.getAccount(registrarKeypair.publicKey());

    // Hash factors for privacy
    const hashedFactors = factors.map(f => ({
      ...f,
      factorHash: this.hashFactor(f.value)
    }));

    const tx = new TransactionBuilder(registrarAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "create_identity_from_factors",
          ...[
            new Address(registrarKeypair.publicKey()).toScVal(),
            nativeToScVal(hashedFactors),
            nativeToScVal(recoveryContacts.map(addr => new Address(addr).toScVal())),
            nativeToScVal(campLocation),
            new Address(walletAddress).toScVal(),
            duressPin ? nativeToScVal(duressPin) : nativeToScVal(null)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(registrarKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      const idHash = scValToNative(result.result.retval);
      return idHash;
    } else {
      throw new Error(`Failed to create identity: ${result.status}`);
    }
  }

  /**
   * Generate identity factors from various sources
   */
  generateFactors(options: {
    // Knowledge factors (what they know)
    pin?: string;
    mothersMaidenName?: string;
    birthCity?: string;
    
    // Possession factors (what they have)
    phoneNumber?: string;
    simCardId?: string;
    aidRationCard?: string;
    nfcWristband?: string;
    
    // Social factors (who vouches for them)
    communityVouchers?: string[]; // Addresses of community members
    
    // Behavioral factors (patterns)
    deviceFingerprint?: string;
    typingPattern?: string;
    locationHistory?: string[];
    
    // Institutional factors
    ngoAttestation?: string;
    campRegistrationId?: string;
  }): IdentityFactor[] {
    const factors: IdentityFactor[] = [];
    const currentTime = Date.now();

    // Knowledge factors
    if (options.pin) {
      factors.push({
        factorType: 'knowledge',
        value: options.pin,
        factorHash: this.hashFactor(options.pin),
        weight: 25,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.mothersMaidenName) {
      factors.push({
        factorType: 'knowledge',
        value: options.mothersMaidenName,
        factorHash: this.hashFactor(options.mothersMaidenName),
        weight: 20,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.birthCity) {
      factors.push({
        factorType: 'knowledge',
        value: options.birthCity,
        factorHash: this.hashFactor(options.birthCity),
        weight: 15,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    // Possession factors
    if (options.phoneNumber) {
      factors.push({
        factorType: 'possession',
        value: options.phoneNumber,
        factorHash: this.hashFactor(options.phoneNumber),
        weight: 30,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.simCardId) {
      factors.push({
        factorType: 'possession',
        value: options.simCardId,
        factorHash: this.hashFactor(options.simCardId),
        weight: 25,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.aidRationCard) {
      factors.push({
        factorType: 'possession',
        value: options.aidRationCard,
        factorHash: this.hashFactor(options.aidRationCard),
        weight: 30,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.nfcWristband) {
      factors.push({
        factorType: 'possession',
        value: options.nfcWristband,
        factorHash: this.hashFactor(options.nfcWristband),
        weight: 35,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    // Social factors
    if (options.communityVouchers && options.communityVouchers.length >= 3) {
      factors.push({
        factorType: 'social',
        value: options.communityVouchers.join(','),
        factorHash: this.hashFactor(options.communityVouchers.join(',')),
        weight: 40,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    // Behavioral factors
    if (options.deviceFingerprint) {
      factors.push({
        factorType: 'behavioral',
        value: options.deviceFingerprint,
        factorHash: this.hashFactor(options.deviceFingerprint),
        weight: 20,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.typingPattern) {
      factors.push({
        factorType: 'behavioral',
        value: options.typingPattern,
        factorHash: this.hashFactor(options.typingPattern),
        weight: 15,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.locationHistory) {
      factors.push({
        factorType: 'behavioral',
        value: options.locationHistory.join('|'),
        factorHash: this.hashFactor(options.locationHistory.join('|')),
        weight: 25,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    // Institutional factors
    if (options.ngoAttestation) {
      factors.push({
        factorType: 'institutional',
        value: options.ngoAttestation,
        factorHash: this.hashFactor(options.ngoAttestation),
        weight: 45,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    if (options.campRegistrationId) {
      factors.push({
        factorType: 'institutional',
        value: options.campRegistrationId,
        factorHash: this.hashFactor(options.campRegistrationId),
        weight: 40,
        verifiedAt: currentTime,
        verifier: null
      });
    }

    return factors;
  }

  /**
   * Social recovery: Initiate recovery with trusted contacts
   */
  async restoreIdentity(
    idHash: string,
    approvingContactKey: string,
    newWalletAddress: string
  ): Promise<boolean> {
    const contactKeypair = Keypair.fromSecret(approvingContactKey);
    const contactAccount = await this.server.getAccount(contactKeypair.publicKey());

    const tx = new TransactionBuilder(contactAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "social_recovery",
          ...[
            nativeToScVal(idHash),
            new Address(contactKeypair.publicKey()).toScVal(),
            new Address(newWalletAddress).toScVal()
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(contactKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new Error(`Failed to restore identity: ${result.status}`);
    }
  }

  /**
   * Verify identity without revealing factors (zero-knowledge proof simulation)
   */
  async verifyIdentityWithoutReveal(
    idHash: string,
    challengeFactors: IdentityFactor[]
  ): Promise<boolean> {
    try {
      // Get identity from blockchain
      const identity = await this.getIdentity(idHash);
      if (!identity) {
        return false;
      }

      // Verify factors match without revealing actual values
      let matchedWeight = 0;
      let totalWeight = 0;

      for (const storedFactor of identity.creationFactors) {
        totalWeight += storedFactor.weight;
        
        for (const challengeFactor of challengeFactors) {
          if (storedFactor.factorType === challengeFactor.factorType) {
            const challengeHash = this.hashFactor(challengeFactor.value);
            if (storedFactor.factorHash === challengeHash) {
              matchedWeight += storedFactor.weight;
              break;
            }
          }
        }
      }

      // Require 70% match for verification
      const verificationScore = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 0;
      return verificationScore >= 70;
    } catch (error) {
      console.error('Verification failed:', error);
      return false;
    }
  }

  /**
   * Update trust score based on activity
   */
  async updateTrustScore(
    idHash: string,
    activityType: string,
    isPositive: boolean
  ): Promise<void> {
    try {
      await this.contract.call(
        "update_trust_score",
        ...[
          nativeToScVal(idHash),
          nativeToScVal(activityType),
          nativeToScVal(isPositive)
        ]
      );
    } catch (error) {
      console.error('Failed to update trust score:', error);
    }
  }

  /**
   * Generate QR access code for offline verification
   */
  generateQRAccess(
    idHash: string,
    identity: BeneficiaryIdentity,
    validityMinutes: number = 30
  ): string {
    const expiresAt = Date.now() + (validityMinutes * 60 * 1000);
    
    const qrData = {
      type: 'identity_verification',
      idHash,
      trustScore: identity.trustScore,
      campLocation: identity.campLocation,
      expiresAt,
      timestamp: Date.now(),
      signature: this.signQRData(idHash, expiresAt)
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate QR access code
   */
  validateQRAccess(qrCodeData: string): boolean {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'identity_verification') {
        return false;
      }

      // Check expiration
      if (Date.now() > data.expiresAt) {
        return false;
      }

      // Verify signature
      const expectedSignature = this.signQRData(data.idHash, data.expiresAt);
      return data.signature === expectedSignature;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create temporary credentials for shared devices
   */
  async createTemporaryCredentials(
    idHash: string,
    ownerKey: string,
    deviceFingerprint: string,
    durationMinutes: number = 60
  ): Promise<string> {
    const ownerKeypair = Keypair.fromSecret(ownerKey);
    const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());

    const durationSeconds = durationMinutes * 60;

    const tx = new TransactionBuilder(ownerAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "temporary_credentials",
          ...[
            nativeToScVal(idHash),
            new Address(ownerKeypair.publicKey()).toScVal(),
            nativeToScVal(deviceFingerprint),
            nativeToScVal(durationSeconds)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(ownerKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new Error(`Failed to create temporary credentials: ${result.status}`);
    }
  }

  /**
   * Transfer identity across camp locations
   */
  async transferIdentity(
    idHash: string,
    ownerKey: string,
    newCampLocation: string,
    newGeofence?: GeofenceZone
  ): Promise<void> {
    const ownerKeypair = Keypair.fromSecret(ownerKey);
    const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());

    const tx = new TransactionBuilder(ownerAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "identity_portability",
          ...[
            nativeToScVal(idHash),
            new Address(ownerKeypair.publicKey()).toScVal(),
            nativeToScVal(newCampLocation),
            newGeofence ? nativeToScVal(newGeofence) : nativeToScVal(null)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(ownerKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status !== 'SUCCESS') {
      throw new Error(`Failed to transfer identity: ${result.status}`);
    }
  }

  /**
   * Verify identity with duress mode check
   */
  async verifyWithDuressCheck(
    idHash: string,
    pin: string
  ): Promise<{ isValid: boolean; isDuress: boolean }> {
    try {
      const result = await this.contract.call(
        "verify_identity_with_duress",
        ...[
          nativeToScVal(idHash),
          nativeToScVal(pin)
        ]
      );

      const [isValid, isDuress] = scValToNative(result.result.retval);
      return { isValid, isDuress };
    } catch (error) {
      console.error('Duress check failed:', error);
      return { isValid: false, isDuress: false };
    }
  }

  /**
   * Check if identity is within safe geofence
   */
  async checkGeofence(
    idHash: string,
    latitude: number,
    longitude: number
  ): Promise<boolean> {
    try {
      // Scale coordinates by 1e6 for precision
      const scaledLat = Math.round(latitude * 1e6);
      const scaledLon = Math.round(longitude * 1e6);

      const result = await this.contract.call(
        "check_geofence",
        ...[
          nativeToScVal(idHash),
          nativeToScVal(scaledLat),
          nativeToScVal(scaledLon)
        ]
      );

      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Geofence check failed:', error);
      return false;
    }
  }

  /**
   * Get identity information
   */
  async getIdentity(idHash: string): Promise<BeneficiaryIdentity | null> {
    try {
      const result = await this.contract.call("get_identity", nativeToScVal(idHash));
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get identity:', error);
      return null;
    }
  }

  /**
   * Hash a factor value for privacy
   */
  private hashFactor(value: string): string {
    return SHA256(value).toString();
  }

  /**
   * Sign QR data for verification
   */
  private signQRData(idHash: string, expiresAt: number): string {
    const data = `${idHash}_${expiresAt}_${this.config.contractIds.beneficiaryManager}`;
    return SHA256(data).toString();
  }

  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return 'Test SDF Network ; September 2015';
      case 'mainnet':
        return 'Public Global Stellar Network ; September 2015';
      case 'standalone':
        return 'Standalone Network ; February 2017';
      default:
        throw new Error('Unsupported network');
    }
  }
}
