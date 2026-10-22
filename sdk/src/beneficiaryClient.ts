import {
  SorobanRpc,
  TransactionBuilder,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
const { Server } = SorobanRpc;
type Server = SorobanRpc.Server;

import { MultiSigManager } from './multiSig';
import { ReadCache } from './readCache';
import {
  BeneficiaryProfile,
  VerificationFactor,
  RecoveryCode,
  MerchantOnboardingRequest,
  PaginatedResponse,
  PaginationOptions,
  NetworkConfig,
  EmergencyFund,
  BeneficiarySearchOptions,
  FundSearchOptions,
} from './types';
import { OfflineEnvelope, OfflineSigner } from './offlineSigner';
import { createHash } from 'crypto';
import {
  BeneficiaryNotFoundError,
  ValidationError,
  NetworkError,
} from './errors';
import { withRetry } from './retry';
import { validateAddress } from './validation';

/**
 * Default page size for paginated beneficiary listings.
 *
 * Large disaster deployments must not rely on the unbounded
 * `listBeneficiariesByDisaster` scan; use `listBeneficiariesPaginated` (or the
 * paginated search helpers) instead.
 */
export const DEFAULT_BENEFICIARY_PAGE_SIZE = 20;

/** Maximum page size accepted by the beneficiary contract (inclusive). */
export const MAX_BENEFICIARY_PAGE_SIZE = 100;

export class BeneficiaryClient {
  private server: any;
  private contract: any;
  private config: NetworkConfig;
  readonly cache: ReadCache;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.beneficiaryManager);
    this.cache = new ReadCache(config);
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
    validateAddress(walletAddress, 'walletAddress');
    const registrarKeypair = Keypair.fromSecret(registrarKey);
    const registrarAccount = await withRetry<any>(() => this.server.getAccount(registrarKeypair.publicKey()));

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
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`beneficiary:${beneficiaryId}`);
      this.cache.invalidatePrefix(`beneficiary:disaster:${disasterId}`);
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
    const verifierAccount = await withRetry<any>(() => this.server.getAccount(verifierKeypair.publicKey()));

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
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`beneficiary:${beneficiaryId}`);
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
    validateAddress(newWalletAddress, 'newWalletAddress');
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
    return this.cache.get(`beneficiary:${beneficiaryId}`, async () => {
      try {
        const result = await this.contract.call("get_beneficiary", nativeToScVal(beneficiaryId));
        const profile = scValToNative(result.result.retval);
        return profile;
      } catch (error) {
        console.error('Failed to get beneficiary:', error);
        return null;
      }
    });
  }

  /**
   * List beneficiaries by disaster (unbounded scan).
   *
   * @deprecated Prefer {@link listBeneficiariesPaginated} or
   * {@link searchBeneficiaries}. This method loads every beneficiary for the
   * disaster into memory and is only safe for small datasets. A full disaster
   * deployment can contain thousands of records, so it must not be used as the
   * default listing path.
   */
  async listBeneficiariesByDisaster(disasterId: string): Promise<BeneficiaryProfile[]> {
    return this.cache.get(`beneficiary:disaster:${disasterId}`, async () => {
      try {
        const result = await this.contract.call("list_beneficiaries_by_disaster", nativeToScVal(disasterId));
        const beneficiaries = scValToNative(result.result.retval);
        return beneficiaries;
      } catch (error) {
        console.error('Failed to list beneficiaries:', error);
        return [];
      }
    });
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
    const { cursor = '', limit = DEFAULT_BENEFICIARY_PAGE_SIZE } = options;

    // Input validation
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_BENEFICIARY_PAGE_SIZE
    ) {
      throw new Error(`limit must be an integer between 1 and ${MAX_BENEFICIARY_PAGE_SIZE}`);
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
    const beneficiaryAccount = await withRetry<any>(() => this.server.getAccount(beneficiaryKeypair.publicKey()));

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
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`beneficiary:${beneficiaryId}`);
      return `Location updated for beneficiary ${beneficiaryId}`;
    } else {
      throw new NetworkError('update location', result.status, { beneficiaryId });
    }
  }

  /**
   * Generate recovery codes for offline access.
   *
   * **Demo-grade only.** The generated value is a deterministic SHA-256 of the
   * beneficiary ID, index, and timestamp. It does not match the contract's
   * recovery-code hash/argument format, and anyone who knows the beneficiary ID
   * can derive the contract-side value. See `docs/offline-flows.md` (known
   * gaps) before using this for account recovery.
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
   * Generate a minimised QR code for beneficiary identification.
   *
   * **Key privacy changes vs the naive implementation:**
   * - `name` is omitted — the beneficiary's display name should never be
   *   embedded in the QR image since anyone who photographs the QR can read it.
   *   The scanning party should look up the name on-chain after verifying
   *   `beneficiaryId` through proper authentication.
   * - `verificationFactors` (type + weight metadata) are also omitted — they
   *   reveal how the identity was constructed and are unnecessary for
   *   presentation-layer scanning.
   * - A `qrExpiresAt` field is added (default 30 min) so that screenshots or
   *   printed QR images cannot be replayed indefinitely.
   *
   * For offline contexts that require a cryptographically signed, expiry-scoped
   * QR, use `offlineAuth.generateQRCode()` instead — it uses a time-based
   * SHA-256 signature and is the reference implementation.
   *
   * @param beneficiaryId - Opaque beneficiary identifier.
   * @param profile       - Beneficiary profile record.
   * @param qrTtlMs       - Optional QR-specific TTL in ms (default 30 min).
   * @returns JSON string representing the minimised QR payload.
   *
   * @see docs/QR_PAYLOADS.md for full field documentation and scanner guidance.
   */
  generateBeneficiaryQRCode(
    beneficiaryId: string,
    profile: BeneficiaryProfile,
    qrTtlMs: number = 30 * 60 * 1000
  ): string {
    const qrData = {
      type: 'beneficiary_id',
      v: 1,           // payload version for future schema evolution
      beneficiaryId,
      disasterId: profile.disasterId,
      trustScore: profile.trustScore,
      // name intentionally omitted — prevents name exposure to QR scanners.
      // Resolve on-chain using beneficiaryId after scanning.
      // verificationFactors intentionally omitted — not needed for scanning.
      qrExpiresAt: Date.now() + qrTtlMs,  // prevents stale QR replay
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate a beneficiary QR code.
   *
   * Checks the QR-specific expiry (`qrExpiresAt`) and confirms the beneficiary
   * still exists on-chain.
   */
  async validateBeneficiaryQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);

      if (data.type !== 'beneficiary_id') {
        return false;
      }

      // Check QR-specific expiry (fast, no network call)
      if (data.qrExpiresAt && Date.now() > data.qrExpiresAt) {
        return false;
      }

      // Verify beneficiary exists on-chain
      const profile = await this.getBeneficiary(data.beneficiaryId);
      return profile !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create USSD session for feature phone users.
   *
   * This is a client-side simulator: the session ID is derived locally and
   * there is no server-side session, PIN/OTP, rate limit, or telco gateway.
   * Do not present it as a production USSD channel. See
   * `docs/offline-flows.md`.
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
   * Process USSD input.
   *
   * Advances the local demo state machine. No authentication, replay checks, or
   * rate limiting are performed. See `docs/offline-flows.md`.
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
      case 'check_balance':
        return this.processCheckBalance(input);
      case 'find_merchants':
        return this.processFindMerchants(input);
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

  private processCheckBalance(input: string): {
    response: string;
    nextStep: string;
    completed?: boolean;
  } {
    const beneficiaryId = input.trim();
    if (!beneficiaryId) {
      return {
        response: 'Invalid beneficiary ID. Please enter your beneficiary ID:',
        nextStep: 'check_balance'
      };
    }

    return {
      response: `Balance inquiry received for ${beneficiaryId}. Your relief balance and active entitlements have been dispatched via SMS.`,
      nextStep: 'complete',
      completed: true
    };
  }

  private processFindMerchants(input: string): {
    response: string;
    nextStep: string;
    completed?: boolean;
  } {
    const location = input.trim();
    if (!location) {
      return {
        response: 'Invalid location. Please enter your location (city/village):',
        nextStep: 'find_merchants'
      };
    }

    return {
      response: `Searching merchants near ${location}. You will receive an SMS with nearby authorized merchant locations.`,
      nextStep: 'complete',
      completed: true
    };
  }

  private generateSessionId(phoneNumber: string): string {
    return createHash('sha256').update(`${phoneNumber}_${Date.now()}`).toString().substring(0, 16);
  }

  /**
   * Get beneficiary statistics for a disaster deployment.
   *
   * Centralizes zero-division guards and handles empty inputs safely:
   * returns well-defined 0 values if no beneficiaries exist or if the list
   * is empty, and computes averages in a single pass.
   */
  async getBeneficiaryStatistics(disasterId: string): Promise<{
    totalBeneficiaries: number;
    averageFamilySize: number;
    averageTrustScore: number;
    activeBeneficiaries: number;
    specialNeedsCount: number;
  }> {
    const beneficiaries = await this.listBeneficiariesByDisaster(disasterId);

    if (!beneficiaries || beneficiaries.length === 0) {
      return {
        totalBeneficiaries: 0,
        averageFamilySize: 0,
        averageTrustScore: 0,
        activeBeneficiaries: 0,
        specialNeedsCount: 0,
      };
    }

    const totalBeneficiaries = beneficiaries.length;
    let totalFamilySize = 0;
    let totalTrustScore = 0;
    let activeBeneficiaries = 0;
    let specialNeedsCount = 0;

    for (const b of beneficiaries) {
      if (b.isActive) {
        activeBeneficiaries++;
      }
      if (b.specialNeeds && b.specialNeeds.length > 0) {
        specialNeedsCount++;
      }
      totalFamilySize += Number(b.familySize) || 0;
      totalTrustScore += Number(b.trustScore) || 0;
    }

    const averageFamilySize = totalBeneficiaries > 0 ? totalFamilySize / totalBeneficiaries : 0;
    const averageTrustScore = totalBeneficiaries > 0 ? totalTrustScore / totalBeneficiaries : 0;

    return {
      totalBeneficiaries,
      averageFamilySize,
      averageTrustScore,
      activeBeneficiaries,
      specialNeedsCount,
    };
  }


  /**
   * Build an unsigned transaction for registering a beneficiary.
   */
  async buildOfflineRegister(
    sourcePublicKey: string,
    beneficiaryId: string,
    name: string,
    disasterId: string,
    location: string,
    walletAddress: string,
    familySize: number,
    specialNeeds: string[],
    verificationFactors: any[]
  ): Promise<OfflineEnvelope> {
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'register_beneficiary',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(beneficiaryId), nativeToScVal(name), nativeToScVal(disasterId),
            nativeToScVal(location), new Address(walletAddress).toScVal(),
            nativeToScVal(familySize), nativeToScVal(specialNeeds),
            nativeToScVal(verificationFactors),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
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
   * - `search` and `locationFilter` are trimmed of extraneous whitespace.
   *
   * Note on sanitization boundaries: HTML entity escaping and sanitization
   * are the responsibility of the presentation/UI layer upon rendering data in
   * HTML/DOM. Raw search queries (such as names with apostrophes or organizations
   * with ampersands, e.g. "O'Connor", "Food & Shelter") are preserved here so
   * that matching at the contract/storage layer is not altered or corrupted.
   */
  async searchBeneficiaries(
    disasterId: string,
    options: BeneficiarySearchOptions = {}
  ): Promise<PaginatedResponse<BeneficiaryProfile>> {
    const {
      cursor = '',
      limit = DEFAULT_BENEFICIARY_PAGE_SIZE,
      search = '',
      locationFilter = '',
      activeOnly = true,
      minTrustScore = 0,
    } = options;

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BENEFICIARY_PAGE_SIZE) {
      throw new Error(`limit must be an integer between 1 and ${MAX_BENEFICIARY_PAGE_SIZE}`);
    }
    if (!Number.isInteger(minTrustScore) || minTrustScore < 0 || minTrustScore > 100) {
      throw new Error('minTrustScore must be an integer between 0 and 100');
    }

    const cleanSearch = search.trim();
    const cleanLocation = locationFilter.trim();

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
   * - `search` and `disasterType` are trimmed
   * - `createdAfter` / `createdBefore` must be non-negative; after ≤ before when both set
   *
   * Sanitization boundary: Presentation-layer escaping applies when displaying
   * search text in web interfaces. Unmodified string parameters are preserved for
   * exact querying at the contract boundary.
   */
  async searchFunds(options: FundSearchOptions = {}): Promise<EmergencyFund[]> {
    const {
      search = '',
      disasterType = '',
      activeOnly = false,
      createdAfter = 0,
      createdBefore = 0,
    } = options;

    const cleanSearch = search.trim();
    const cleanType = disasterType.trim();

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
