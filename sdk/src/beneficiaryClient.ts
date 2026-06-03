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
import {
  BeneficiaryProfile,
  VerificationFactor,
  RecoveryCode,
  MerchantOnboardingRequest,
  PaginatedResponse,
  PaginationOptions,
} from './types';
import { createHash } from 'crypto-js';
import {
  BeneficiaryNotFoundError,
  ValidationError,
  NetworkError,
} from './errors';

export class BeneficiaryClient {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.beneficiaryManager);
  }

  /**
   * Register displaced person without traditional ID
   */
  async registerBeneficiary(
    registrarKey: string,
    beneficiaryId: string,
    name: string,
    disasterId: string,
    location: string,
    walletAddress: string,
    familySize: number,
    specialNeeds: string[],
    verificationFactors: VerificationFactor[]
  ): Promise<string> {
    const registrarKeypair = Keypair.fromSecret(registrarKey);
    const registrarAccount = await this.server.getAccount(registrarKeypair.publicKey());

    const tx = new TransactionBuilder(registrarAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "register_beneficiary",
          ...[
            new Address(registrarKeypair.publicKey()).toScVal(),
            nativeToScVal(beneficiaryId),
            nativeToScVal(name),
            nativeToScVal(disasterId),
            nativeToScVal(location),
            new Address(walletAddress).toScVal(),
            nativeToScVal(familySize),
            nativeToScVal(specialNeeds),
            nativeToScVal(verificationFactors)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(registrarKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Beneficiary ${beneficiaryId} registered successfully`;
    } else {
      throw new NetworkError('register beneficiary', result.status, { beneficiaryId });
    }
  }

  /**
   * Verify beneficiary using behavioral/possession factors
   */
  async verifyBeneficiary(
    verifierKey: string,
    beneficiaryId: string,
    providedFactors: VerificationFactor[]
  ): Promise<boolean> {
    const verifierKeypair = Keypair.fromSecret(verifierKey);
    const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());

    const tx = new TransactionBuilder(verifierAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "verify_beneficiary",
          ...[
            new Address(verifierKeypair.publicKey()).toScVal(),
            nativeToScVal(beneficiaryId),
            nativeToScVal(providedFactors)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(verifierKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new NetworkError('verify beneficiary', result.status, { beneficiaryId });
    }
  }

  /**
   * Restore access using recovery code
   */
  async restoreAccess(
    beneficiaryId: string,
    recoveryCode: string,
    newWalletAddress: string
  ): Promise<boolean> {
    try {
      const result = await this.contract.call(
        "restore_access",
        ...[
          nativeToScVal(beneficiaryId),
          nativeToScVal(recoveryCode),
          new Address(newWalletAddress).toScVal()
        ]
      );
      
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to restore access:', error);
      return false;
    }
  }

  /**
   * Get beneficiary profile
   */
  async getBeneficiary(beneficiaryId: string): Promise<BeneficiaryProfile | null> {
    try {
      const result = await this.contract.call("get_beneficiary", nativeToScVal(beneficiaryId));
      const profile = scValToNative(result.result.retval);
      return profile;
    } catch (error) {
      console.error('Failed to get beneficiary:', error);
      return null;
    }
  }

  /**
   * List beneficiaries by disaster
   */
  async listBeneficiariesByDisaster(disasterId: string): Promise<BeneficiaryProfile[]> {
    try {
      const result = await this.contract.call("list_beneficiaries_by_disaster", nativeToScVal(disasterId));
      const beneficiaries = scValToNative(result.result.retval);
      return beneficiaries;
    } catch (error) {
      console.error('Failed to list beneficiaries:', error);
      return [];
    }
  }

  /**
   * List beneficiaries by disaster with cursor-based pagination.
   *
   * The contract takes split cursor params (cursor_ts: u64, cursor_id: String)
   * to avoid string parsing in the no_std Soroban environment.  This method
   * encodes/decodes the opaque cursor string "<ts>:<id>" client-side so
   * callers see a single opaque cursor token.
   *
   * Validates that `limit` is between 1 and 100 (inclusive).
   * Throws on invalid input so callers receive clear feedback.
   *
   * @param disasterId - The disaster to query.
   * @param options    - Optional `cursor` and `limit` (default 20, max 100).
   * @returns A page of beneficiaries plus a `nextCursor` / `hasMore` flag.
   */
  async listBeneficiariesPaginated(
    disasterId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResponse<BeneficiaryProfile>> {
    const { cursor = '', limit = 20 } = options;

    // Input validation
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    if (cursor !== '' && typeof cursor !== 'string') {
      throw new Error('cursor must be a non-empty string or omitted');
    }

    // Decode opaque cursor "<ts>:<id>" into the two contract params
    let cursorTs = 0;
    let cursorId = '';
    if (cursor) {
      const sep = cursor.indexOf(':');
      if (sep !== -1) {
        cursorTs = parseInt(cursor.slice(0, sep), 10) || 0;
        cursorId = cursor.slice(sep + 1);
      }
    }

    try {
      const result = await this.contract.call(
        'list_beneficiaries_paginated',
        nativeToScVal(disasterId),
        nativeToScVal(cursorTs),
        nativeToScVal(cursorId),
        nativeToScVal(limit),
      );

      // Contract returns a tuple (Vec<BeneficiaryProfile>, u64, String)
      const [beneficiaries, nextTs, nextId]: [BeneficiaryProfile[], number, string] =
        scValToNative(result.result.retval);

      // Encode next cursor; empty when no more data (nextTs === 0 && nextId === '')
      const nextCursor = (nextTs === 0 && (!nextId || nextId === ''))
        ? null
        : `${nextTs}:${nextId}`;

      return {
        items: beneficiaries,
        nextCursor,
        hasMore: nextCursor !== null,
      };
    } catch (error) {
      console.error('Failed to list beneficiaries (paginated):', error);
      return { items: [], nextCursor: null, hasMore: false };
    }
  }

  /**
   * Update beneficiary location
   */
  async updateLocation(
    beneficiaryKey: string,
    beneficiaryId: string,
    newLocation: string
  ): Promise<string> {
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    const beneficiaryAccount = await this.server.getAccount(beneficiaryKeypair.publicKey());

    const tx = new TransactionBuilder(beneficiaryAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "update_location",
          ...[
            new Address(beneficiaryKeypair.publicKey()).toScVal(),
            nativeToScVal(beneficiaryId),
            nativeToScVal(newLocation)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(beneficiaryKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Location updated for beneficiary ${beneficiaryId}`;
    } else {
      throw new NetworkError('update location', result.status, { beneficiaryId });
    }
  }

  /**
   * Generate recovery codes for offline access
   */
  generateRecoveryCodes(beneficiaryId: string): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < 3; i++) {
      const code = this.generateRecoveryCode(beneficiaryId, i);
      codes.push(code);
    }
    
    return codes;
  }

  private generateRecoveryCode(beneficiaryId: string, index: number): string {
    const data = `${beneficiaryId}_${index}_${Date.now()}`;
    return createHash('sha256').update(data).toString();
  }

  /**
   * Create biometric-free identity factors
   */
  createVerificationFactors(
    possessionFactors: string[],
    behavioralFactors: string[],
    socialFactors: string[]
  ): VerificationFactor[] {
    const factors: VerificationFactor[] = [];
    const currentTime = Date.now();

    // Possession factors (items they have)
    possessionFactors.forEach((value, index) => {
      factors.push({
        factorType: 'possession',
        value,
        weight: 30,
        verifiedAt: currentTime
      });
    });

    // Behavioral factors (patterns of behavior)
    behavioralFactors.forEach((value, index) => {
      factors.push({
        factorType: 'behavioral',
        value,
        weight: 40,
        verifiedAt: currentTime
      });
    });

    // Social factors (community verification)
    socialFactors.forEach((value, index) => {
      factors.push({
        factorType: 'social',
        value,
        weight: 30,
        verifiedAt: currentTime
      });
    });

    return factors;
  }

  /**
   * Generate QR code for beneficiary identification
   */
  generateBeneficiaryQRCode(beneficiaryId: string, profile: BeneficiaryProfile): string {
    const qrData = {
      type: 'beneficiary_id',
      beneficiaryId,
      name: profile.name,
      disasterId: profile.disasterId,
      trustScore: profile.trustScore,
      timestamp: Date.now(),
      verificationFactors: profile.verificationFactors.map(f => ({
        type: f.factorType,
        weight: f.weight
      }))
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate beneficiary QR code
   */
  async validateBeneficiaryQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'beneficiary_id') {
        return false;
      }

      // Verify beneficiary exists
      const profile = await this.getBeneficiary(data.beneficiaryId);
      return profile !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create USSD session for feature phone users
   */
  createUSSDSession(phoneNumber: string): {
    sessionId: string;
    welcomeMessage: string;
  } {
    const sessionId = this.generateSessionId(phoneNumber);
    
    return {
      sessionId,
      welcomeMessage: `Welcome to Disaster Relief Aid. Please enter:\n1. Register\n2. Check Balance\n3. Find Merchants\n4. Help`
    };
  }

  /**
   * Process USSD input
   */
  processUSSDInput(
    sessionId: string,
    input: string,
    currentStep: string
  ): {
    response: string;
    nextStep: string;
    completed?: boolean;
  } {
    switch (currentStep) {
      case 'welcome':
        return this.processMainMenu(input);
      case 'register_name':
        return this.processRegistrationName(input);
      case 'register_location':
        return this.processRegistrationLocation(input);
      case 'register_family':
        return this.processRegistrationFamily(input);
      default:
        return {
          response: 'Invalid input. Please try again.',
          nextStep: 'welcome'
        };
    }
  }

  private processMainMenu(input: string): {
    response: string;
    nextStep: string;
  } {
    switch (input) {
      case '1':
        return {
          response: 'Please enter your full name:',
          nextStep: 'register_name'
        };
      case '2':
        return {
          response: 'Please enter your beneficiary ID:',
          nextStep: 'check_balance'
        };
      case '3':
        return {
          response: 'Please enter your location (city/village):',
          nextStep: 'find_merchants'
        };
      case '4':
        return {
          response: 'For help, contact: +1234567890 or visit nearest relief center.',
          nextStep: 'welcome'
        };
      default:
        return {
          response: 'Invalid option. Please enter 1, 2, 3, or 4:',
          nextStep: 'welcome'
        };
    }
  }

  private processRegistrationName(input: string): {
    response: string;
    nextStep: string;
  } {
    return {
      response: `Thank you ${input}. Please enter your current location (city/village):`,
      nextStep: 'register_location'
    };
  }

  private processRegistrationLocation(input: string): {
    response: string;
    nextStep: string;
  } {
    return {
      response: 'Please enter your family size (number of people):',
      nextStep: 'register_family'
    };
  }

  private processRegistrationFamily(input: string): {
    response: string;
    nextStep: string;
    completed?: boolean;
  } {
    const familySize = parseInt(input);
    if (isNaN(familySize) || familySize < 1) {
      return {
        response: 'Invalid family size. Please enter a number greater than 0:',
        nextStep: 'register_family'
      };
    }

    return {
      response: `Registration complete! Your family size: ${familySize}. You will receive your beneficiary ID shortly. Save this number for future reference.`,
      nextStep: 'complete',
      completed: true
    };
  }

  private generateSessionId(phoneNumber: string): string {
    return createHash('sha256').update(`${phoneNumber}_${Date.now()}`).toString().substring(0, 16);
  }

  /**
   * Get beneficiary statistics
   */
  async getBeneficiaryStatistics(disasterId: string): Promise<{
    totalBeneficiaries: number;
    averageFamilySize: number;
    averageTrustScore: number;
    activeBeneficiaries: number;
    specialNeedsCount: number;
  }> {
    const beneficiaries = await this.listBeneficiariesByDisaster(disasterId);
    
    const totalBeneficiaries = beneficiaries.length;
    const activeBeneficiaries = beneficiaries.filter(b => b.isActive).length;
    const averageFamilySize = beneficiaries.length > 0 
      ? beneficiaries.reduce((sum, b) => sum + b.familySize, 0) / beneficiaries.length 
      : 0;
    const averageTrustScore = beneficiaries.length > 0
      ? beneficiaries.reduce((sum, b) => sum + b.trustScore, 0) / beneficiaries.length
      : 0;
    const specialNeedsCount = beneficiaries.filter(b => b.specialNeeds.length > 0).length;

    return {
      totalBeneficiaries,
      averageFamilySize,
      averageTrustScore,
      activeBeneficiaries,
      specialNeedsCount
    };
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

  // ─── Search / Filter ────────────────────────────────────────────────────────

  /**
   * Search and filter beneficiaries with cursor-based pagination.
   *
   * Validates all inputs before forwarding to the contract:
   * - `limit` must be 1–100 (default 20)
   * - `minTrustScore` must be 0–100
   * - `search` and `locationFilter` are trimmed; HTML-special chars are stripped
   *   to prevent injection via display layers.
   */
  async searchBeneficiaries(
    disasterId: string,
    options: BeneficiarySearchOptions = {}
  ): Promise<PaginatedResponse<BeneficiaryProfile>> {
    const {
      cursor = '',
      limit = 20,
      search = '',
      locationFilter = '',
      activeOnly = true,
      minTrustScore = 0,
    } = options;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    if (!Number.isInteger(minTrustScore) || minTrustScore < 0 || minTrustScore > 100) {
      throw new Error('minTrustScore must be an integer between 0 and 100');
    }

    const sanitize = (s: string) => s.trim().replace(/[<>"'&]/g, '');
    const cleanSearch = sanitize(search);
    const cleanLocation = sanitize(locationFilter);

    if (cleanSearch.length > 200) {
      throw new Error('search must be 200 characters or fewer');
    }

    // Decode opaque cursor "<ts>:<id>"
    let cursorTs = 0;
    let cursorId = '';
    if (cursor) {
      const sep = cursor.indexOf(':');
      if (sep !== -1) {
        cursorTs = parseInt(cursor.slice(0, sep), 10) || 0;
        cursorId = cursor.slice(sep + 1);
      }
    }

    try {
      const result = await this.contract.call(
        'search_beneficiaries_paginated',
        nativeToScVal(disasterId),
        nativeToScVal(cleanSearch),
        nativeToScVal(cleanLocation),
        nativeToScVal(activeOnly),
        nativeToScVal(minTrustScore),
        nativeToScVal(cursorTs),
        nativeToScVal(cursorId),
        nativeToScVal(limit),
      );

      const [beneficiaries, nextTs, nextId]: [BeneficiaryProfile[], number, string] =
        scValToNative(result.result.retval);

      const nextCursor = (nextTs === 0 && (!nextId || nextId === ''))
        ? null
        : `${nextTs}:${nextId}`;

      return { items: beneficiaries, nextCursor, hasMore: nextCursor !== null };
    } catch (error) {
      console.error('searchBeneficiaries failed:', error);
      return { items: [], nextCursor: null, hasMore: false };
    }
  }

  /**
   * Search and filter emergency funds.
   *
   * Validates all inputs:
   * - `search` and `disasterType` are trimmed and sanitized
   * - `createdAfter` / `createdBefore` must be non-negative; after ≤ before when both set
   */
  async searchFunds(options: FundSearchOptions = {}): Promise<EmergencyFund[]> {
    const {
      search = '',
      disasterType = '',
      activeOnly = false,
      createdAfter = 0,
      createdBefore = 0,
    } = options;

    const sanitize = (s: string) => s.trim().replace(/[<>"'&]/g, '');
    const cleanSearch = sanitize(search);
    const cleanType = sanitize(disasterType);

    if (cleanSearch.length > 200) {
      throw new Error('search must be 200 characters or fewer');
    }
    if (createdAfter < 0 || createdBefore < 0) {
      throw new Error('createdAfter and createdBefore must be non-negative');
    }
    if (createdAfter > 0 && createdBefore > 0 && createdAfter > createdBefore) {
      throw new Error('createdAfter must be less than or equal to createdBefore');
    }

    try {
      const result = await this.contract.call(
        'search_funds',
        nativeToScVal(cleanSearch),
        nativeToScVal(cleanType),
        nativeToScVal(activeOnly),
        nativeToScVal(createdAfter),
        nativeToScVal(createdBefore),
      );

      return scValToNative(result.result.retval) as EmergencyFund[];
    } catch (error) {
      console.error('searchFunds failed:', error);
      return [];
    }
  }
}
