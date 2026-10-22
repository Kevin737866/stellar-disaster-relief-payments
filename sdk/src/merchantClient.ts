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

import {
  Merchant,
  Transaction,
  Location,
  MerchantOnboardingRequest,
  NetworkConfig,
  MerchantPaginationOptions,
  PaginatedMerchants,
} from './types';
import {
  MerchantNotFoundError,
  NetworkError,
  ValidationError,
} from './errors';
import {
  DEFAULT_OFFCHAIN_POLICY,
  OffchainPolicy,
  OffchainRequestBlockedError,
  normaliseHost,
  safeFetchText,
} from './offchainFetch';
import { ReadCache } from './readCache';
import { OfflineSigner, OfflineEnvelope } from './offlineSigner';
import { MultiSigManager } from './multiSig';
import { withRetry } from './retry';

// Payment methods matching contract enum
export const PAYMENT_QR = 0;
export const PAYMENT_USSD = 1;
export const PAYMENT_NFC = 2;
export const PAYMENT_OFFLINE = 3;
export const PAYMENT_ONLINE = 4;

/** Default page size for merchant listing endpoints. */
export const DEFAULT_MERCHANT_PAGE_SIZE = 20;

/** Maximum page size accepted by the merchant contract. */
export const MAX_MERCHANT_PAGE_SIZE = 100;

export class MerchantClient {
  private server: any;
  private contract: any;
  private config: NetworkConfig;
  readonly cache: ReadCache;
  /**
   * #238 — policy governing off-chain lookups. Empty by default, which means
   * *every* off-chain request is refused until a host is allowlisted. Failing
   * closed is deliberate: a silent default-allow would keep the SSRF surface
   * open for anyone who forgot to configure it.
   */
  private offchainPolicy: OffchainPolicy;

  constructor(config: NetworkConfig, offchainPolicy: OffchainPolicy = {}) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.merchantNetwork);
    this.cache = new ReadCache(config);
    this.offchainPolicy = offchainPolicy;
  }

  /**
   * Replace the off-chain fetch policy.
   *
   * @example
   * client.setOffchainPolicy({ allowedHostSuffixes: ['.relief.example'] });
   */
  setOffchainPolicy(policy: OffchainPolicy): void {
    this.offchainPolicy = policy;
  }

  /**
   * Register local merchant for relief network
   */
  async registerMerchant(
    ownerKey: string,
    merchantId: string,
    request: MerchantOnboardingRequest
  ): Promise<string> {
    const ownerKeypair = Keypair.fromSecret(ownerKey);
    const ownerAccount = await withRetry<any>(() => this.server.getAccount(ownerKeypair.publicKey()));

    const tx = new TransactionBuilder(ownerAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "register_merchant",
          ...[
            new Address(ownerKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(request.name),
            nativeToScVal(request.businessType),
            nativeToScVal(request.location),
            nativeToScVal(request.contactInfo),
            nativeToScVal(request.stellarTomlUrl),
            nativeToScVal(request.acceptedTokens),
            nativeToScVal(request.dailyLimit),
            nativeToScVal(request.monthlyLimit),
            nativeToScVal(request.verificationDocuments)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(ownerKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      return `Merchant ${merchantId} registered successfully. Awaiting verification.`;
    } else {
      throw new NetworkError('register merchant', result.status, { merchantId });
    }
  }

  /**
   * Verify merchant (by authorized verifier)
   */
  async verifyMerchant(
    verifierKey: string,
    merchantId: string,
    approved: boolean,
    notes: string
  ): Promise<string> {
    const verifierKeypair = Keypair.fromSecret(verifierKey);
    const verifierAccount = await withRetry<any>(() => this.server.getAccount(verifierKeypair.publicKey()));

    const tx = new TransactionBuilder(verifierAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "verify_merchant",
          ...[
            new Address(verifierKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(approved),
            nativeToScVal(notes)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(verifierKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`merchant:${merchantId}`);
      return approved 
        ? `Merchant ${merchantId} verified and activated`
        : `Merchant ${merchantId} verification rejected`;
    } else {
      throw new NetworkError('verify merchant', result.status, { merchantId });
    }
  }

  /**
   * Process payment from beneficiary to merchant
   *
   * @param merchantKey - Merchant secret key
   * @param beneficiaryKey - Beneficiary secret key
   * @param merchantId - Merchant identifier
   * @param beneficiaryId - Beneficiary identifier
   * @param amount - Payment amount
   * @param token - Token symbol/address
   * @param purpose - Purpose of payment
   * @param paymentMethod - Payment method discriminator (defaults to PAYMENT_ONLINE = 4)
   */
  async processPayment(
    merchantKey: string,
    beneficiaryKey: string,
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    paymentMethod: number = PAYMENT_ONLINE
  ): Promise<string> {
    const merchantKeypair = Keypair.fromSecret(merchantKey);
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    
    const merchantAccount = await withRetry<any>(() => this.server.getAccount(merchantKeypair.publicKey()));

    const tx = new TransactionBuilder(merchantAccount, {
      fee: '200', // Higher fee for multi-sig
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "process_payment",
          ...[
            new Address(merchantKeypair.publicKey()).toScVal(),
            new Address(beneficiaryKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(beneficiaryId),
            nativeToScVal(amount),
            nativeToScVal(token),
            nativeToScVal(purpose),
            nativeToScVal(paymentMethod),
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(merchantKeypair);
    tx.sign(beneficiaryKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`merchant:${merchantId}`);
      this.cache.invalidate(`merchant:txns:${merchantId}`);
      return scValToNative(result.result.retval);
    } else {
      throw new NetworkError('process payment', result.status, { merchantId, beneficiaryKey });
    }
  }

  /**
   * Get merchant details
   */
  async getMerchant(merchantId: string): Promise<Merchant | null> {
    return this.cache.get(`merchant:${merchantId}`, async () => {
      try {
        const result = await this.contract.call("get_merchant", nativeToScVal(merchantId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get merchant:', error);
        return null;
      }
    });
  }

  /**
   * Find merchants by location (geographic search, unbounded).
   *
   * @deprecated Prefer {@link findMerchantsByLocationPaginated} for production
   * clients; this helper loads every matching merchant.
   */
  async findMerchantsByLocation(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<Merchant[]> {
    try {
      const result = await this.contract.call(
        "find_merchants_by_location",
        nativeToScVal(latitude),
        nativeToScVal(longitude),
        nativeToScVal(radiusKm)
      );
      const merchants = scValToNative(result.result.retval);
      return merchants;
    } catch (error) {
      console.error('Failed to find merchants by location:', error);
      return [];
    }
  }

  /**
   * Normalise and validate `offset` / `limit` for merchant listing calls.
   */
  private normalizeMerchantPageOptions(
    options: MerchantPaginationOptions = {}
  ): { offset: number; limit: number } {
    const { offset = 0, limit = DEFAULT_MERCHANT_PAGE_SIZE } = options;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative integer');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MERCHANT_PAGE_SIZE) {
      throw new Error(`limit must be an integer between 1 and ${MAX_MERCHANT_PAGE_SIZE}`);
    }
    return { offset, limit };
  }

  /** Convert the contract tuple into a typed page. */
  private toMerchantPage(value: unknown): PaginatedMerchants {
    const [merchants, totalCount, hasMore] = (value ?? [[], 0, false]) as [
      Merchant[],
      number | bigint,
      boolean,
    ];
    return {
      merchants: merchants ?? [],
      totalCount: Number(totalCount) || 0,
      hasMore: Boolean(hasMore),
    };
  }

  /**
   * List active merchants with offset/limit pagination.
   *
   * This is the preferred listing path for dashboards: the contract returns a
   * bounded page plus `totalCount` / `hasMore`, so the UI never loads an
   * unbounded merchant set.
   */
  async findMerchantsPaginated(
    options: MerchantPaginationOptions = {}
  ): Promise<PaginatedMerchants> {
    const { offset, limit } = this.normalizeMerchantPageOptions(options);
    try {
      const result = await this.contract.call(
        'find_merchants_paginated',
        nativeToScVal(offset),
        nativeToScVal(limit)
      );
      return this.toMerchantPage(scValToNative(result.result.retval));
    } catch (error) {
      console.error('Failed to list merchants (paginated):', error);
      return { merchants: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Find active merchants by location with offset/limit pagination.
   *
   * @param latitude  Centre latitude in decimal degrees.
   * @param longitude Centre longitude in decimal degrees.
   * @param radiusKm  Search radius in kilometres.
   */
  async findMerchantsByLocationPaginated(
    latitude: number,
    longitude: number,
    radiusKm: number,
    options: MerchantPaginationOptions = {}
  ): Promise<PaginatedMerchants> {
    const { offset, limit } = this.normalizeMerchantPageOptions(options);
    try {
      const result = await this.contract.call(
        'find_merchants_by_location_paginated',
        nativeToScVal(latitude),
        nativeToScVal(longitude),
        nativeToScVal(radiusKm),
        nativeToScVal(offset),
        nativeToScVal(limit)
      );
      return this.toMerchantPage(scValToNative(result.result.retval));
    } catch (error) {
      console.error('Failed to find merchants by location (paginated):', error);
      return { merchants: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Find active merchants by category with offset/limit pagination.
   */
  async findMerchantsByCategoryPaginated(
    category: number,
    options: MerchantPaginationOptions = {}
  ): Promise<PaginatedMerchants> {
    const { offset, limit } = this.normalizeMerchantPageOptions(options);
    try {
      const result = await this.contract.call(
        'find_merchants_by_category_paginated',
        nativeToScVal(category),
        nativeToScVal(offset),
        nativeToScVal(limit)
      );
      return this.toMerchantPage(scValToNative(result.result.retval));
    } catch (error) {
      console.error('Failed to find merchants by category (paginated):', error);
      return { merchants: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Get merchant transaction history
   */
  async getMerchantTransactions(merchantId: string): Promise<Transaction[]> {
    return this.cache.get(`merchant:txns:${merchantId}`, async () => {
      try {
        const result = await this.contract.call("get_merchant_transactions", nativeToScVal(merchantId));
        return scValToNative(result.result.retval);
      } catch (error) {
        console.error('Failed to get merchant transactions:', error);
        return [];
      }
    });
  }

  /**
   * Update merchant reputation based on feedback
   */
  async updateReputation(
    adminKey: string,
    merchantId: string,
    feedbackScore: number // -10 to +10
  ): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await withRetry<any>(() => this.server.getAccount(adminKeypair.publicKey()));

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "update_reputation",
          ...[
            new Address(adminKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(feedbackScore)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await withRetry<any>(() => this.server.sendTransaction(tx));
    
    if (result.status === 'SUCCESS') {
      this.cache.invalidate(`merchant:${merchantId}`);
      return `Reputation updated for merchant ${merchantId}`;
    } else {
      throw new NetworkError('update reputation', result.status, { merchantId });
    }
  }

  /**
   * Get verification queue
   */
  async getVerificationQueue(): Promise<string[]> {
    try {
      const result = await withRetry<any>(() => this.contract.call("get_verification_queue"));
      const queue = scValToNative(result.result.retval);
      return queue;
    } catch (error) {
      console.error('Failed to get verification queue:', error);
      return [];
    }
  }

  /**
   * Generate QR code for merchant identification
   */
  generateMerchantQRCode(merchantId: string, merchant: Merchant): string {
    const qrData = {
      type: 'merchant',
      merchantId,
      name: merchant.name,
      businessType: merchant.businessType,
      location: merchant.location,
      acceptedTokens: merchant.acceptedTokens,
      reputationScore: merchant.reputationScore,
      stellarTomlUrl: merchant.stellarTomlUrl,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate merchant QR code
   */
  async validateMerchantQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'merchant') {
        return false;
      }

      // Verify merchant exists and is active
      const merchant = await this.getMerchant(data.merchantId);
      return merchant !== null && merchant.isActive;
    } catch (error) {
      return false;
    }
  }

  /**
   * Discover merchants using Stellar TOML.
   *
   * #238 — this previously did `fetch('https://' + domain + '/.well-known/stellar.toml')`
   * with a caller-supplied, entirely unvalidated `domain`. Because the value
   * was interpolated into a URL, a caller could supply `user@evil.com` (which
   * makes the request go to `evil.com`), `localhost:8000` or
   * `169.254.169.254` (which reach internal services and cloud metadata), and
   * the response was then parsed and handed back as merchant data.
   *
   * Now the host is normalised and checked against the allowlist, the request
   * is HTTPS-only with no credential headers, redirects are followed manually
   * with the allowlist re-applied at every hop, and the response is
   * size-capped. A blocked request returns an empty list and logs the reason
   * rather than silently returning nothing.
   *
   * Parsing now uses a proper TOML parser that handles comments, quoted
   * strings, arrays, and `[[MERCHANTS]]` array-of-tables syntax (the standard
   * way to represent multiple merchants in TOML). Discovered merchant records
   * are validated — entries without a `name` are skipped to avoid bogus
   * records from malformed or irrelevant sections.
   *
   * Limitations: this parser supports the TOML subset needed for
   * `stellar.toml` (key-value pairs, single/double-quoted strings, arrays of
   * strings, comments, and array-of-tables sections). It does not support
   * inline tables, multiline strings, or nested tables beyond one level.
   *
   * @throws {ValidationError} if `domain` is not a bare hostname.
   */
  async discoverMerchantsFromStellarToml(domain: string): Promise<Merchant[]> {
    const host = normaliseHost(domain);
    const tomlUrl = `https://${host}/.well-known/stellar.toml`;

    let tomlData: string;
    try {
      const result = await safeFetchText(tomlUrl, this.offchainPolicy);
      tomlData = result.body;
    } catch (error) {
      if (error instanceof OffchainRequestBlockedError) {
        console.error(`Refused Stellar TOML discovery for "${host}": ${error.message}`);
        return [];
      }
      throw error;
    }

    try {
      const tables = parseTomlTables(tomlData);
      const merchants: Merchant[] = [];

      for (const [sectionName, fields] of tables) {
        if (sectionName !== 'MERCHANTS') continue;

        // A merchant record must have at least a name to be useful.
        const name = fields['name'];
        if (typeof name !== 'string' || name.trim() === '') {
          continue;
        }

        const acceptedTokens = Array.isArray(fields['accepted_tokens'])
          ? (fields['accepted_tokens'] as unknown[]).filter(
              (t): t is string => typeof t === 'string' && t.length > 0
            )
          : ['XLM'];

        // Validate location fields if present
        const lat = typeof fields['latitude'] === 'number'
          ? (fields['latitude'] as number)
          : 0;
        const lng = typeof fields['longitude'] === 'number'
          ? (fields['longitude'] as number)
          : 0;

        merchants.push({
          id: `toml_${host}_${merchants.length}`,
          name: name.trim(),
          owner: typeof fields['owner'] === 'string' ? (fields['owner'] as string) : '',
          businessType: typeof fields['business_type'] === 'string'
            ? (fields['business_type'] as string)
            : 'general',
          location: {
            latitude: lat,
            longitude: lng,
            address: typeof fields['address'] === 'string' ? (fields['address'] as string) : '',
            city: typeof fields['city'] === 'string' ? (fields['city'] as string) : '',
            country: typeof fields['country'] === 'string' ? (fields['country'] as string) : '',
            postalCode: typeof fields['postal_code'] === 'string' ? (fields['postal_code'] as string) : ''
          },
          contactInfo: typeof fields['contact_info'] === 'string' ? (fields['contact_info'] as string) : '',
          registrationDate: Date.now(),
          isVerified: false,
          verificationDocuments: [],
          stellarTomlUrl: tomlUrl,
          acceptedTokens: acceptedTokens.length > 0 ? acceptedTokens : ['XLM'],
          dailyLimit: typeof fields['daily_limit'] === 'string' ? (fields['daily_limit'] as string) : '1000',
          monthlyLimit: typeof fields['monthly_limit'] === 'string' ? (fields['monthly_limit'] as string) : '10000',
          currentMonthVolume: '0',
          reputationScore: 50,
          isActive: false
        });
      }

      return merchants;
    } catch (error) {
      console.error('Failed to parse merchants from TOML:', error);
      return [];
    }
  }

  /**
   * Create merchant onboarding request template
   */
  createOnboardingRequest(
    name: string,
    businessType: string,
    location: Location,
    contactInfo: string,
    stellarAddress: string
  ): MerchantOnboardingRequest {
    return {
      name,
      businessType,
      location,
      contactInfo,
      stellarTomlUrl: `https://stellar.expert/explorer/testnet/account/${stellarAddress}`,
      acceptedTokens: ['XLM'], // Default to XLM
      dailyLimit: '1000', // Default limits
      monthlyLimit: '10000',
      verificationDocuments: [] // Will be uploaded separately
    };
  }

  /**
   * Parse a contract-supplied amount into a non-negative BigInt.
   *
   * Contract storage can hand back strings, numbers or BigInts, and a
   * malformed limit must not make the whole statistics call throw (#180).
   * Invalid, negative or non-integer values are treated as zero so callers
   * always receive well-defined statistics.
   */
  private toNonNegativeBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value >= BigInt(0) ? value : BigInt(0);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0
        ? BigInt(Math.trunc(value))
        : BigInt(0);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
      }
    }
    return BigInt(0);
  }

  /**
   * Get merchant statistics
   */
  async getMerchantStatistics(merchantId: string): Promise<{
    totalTransactions: number;
    totalVolume: string;
    averageTransaction: string;
    reputationScore: number;
    monthlyUtilization: number;
  }> {
    const transactions = await this.getMerchantTransactions(merchantId);
    const merchant = await this.getMerchant(merchantId);
    
    if (!merchant) {
      throw new MerchantNotFoundError(merchantId);
    }

    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce((sum, tx) => 
      sum + BigInt(tx.amount), BigInt(0)
    );

    const averageTransaction = totalTransactions > 0 
      ? (totalVolume / BigInt(totalTransactions)).toString()
      : '0';

    const monthlyLimit = this.toNonNegativeBigInt(merchant.monthlyLimit);
    const currentVolume = this.toNonNegativeBigInt(merchant.currentMonthVolume);
    const monthlyUtilization = monthlyLimit > BigInt(0)
      ? Number((currentVolume * BigInt(100)) / monthlyLimit)
      : 0;

    return {
      totalTransactions,
      totalVolume: totalVolume.toString(),
      averageTransaction,
      reputationScore: merchant.reputationScore,
      monthlyUtilization
    };
  }

  /**
   * Batch verify merchants
   */
  async batchVerifyMerchants(
    verifierKey: string,
    merchantIds: string[],
    approved: boolean,
    notes: string
  ): Promise<string[]> {
    const results: string[] = [];

    for (const merchantId of merchantIds) {
      try {
        const result = await this.verifyMerchant(verifierKey, merchantId, approved, notes);
        results.push(result);
      } catch (error) {
        results.push(`Failed to verify ${merchantId}: ${error}`);
      }
    }

    return results;
  }


  /**
   * Build an unsigned transaction for registering a merchant.
   */
  async buildOfflineRegisterMerchant(
    sourcePublicKey: string,
    merchantId: string,
    request: any
  ): Promise<OfflineEnvelope> {
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'register_merchant',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(merchantId), nativeToScVal(request.name),
            nativeToScVal(request.businessType), nativeToScVal(request.location),
            nativeToScVal(request.contactInfo), nativeToScVal(request.stellarTomlUrl),
            nativeToScVal(request.acceptedTokens), nativeToScVal(request.dailyLimit),
            nativeToScVal(request.monthlyLimit), nativeToScVal(request.verificationDocuments),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
  }

  /**
   * Build an unsigned transaction for approving a merchant.
   */
  async buildOfflineApproveMerchant(
    sourcePublicKey: string,
    merchantId: string,
    approved: boolean,
    notes: string
  ): Promise<OfflineEnvelope> {
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'verify_merchant',
          ...[
            new Address(sourcePublicKey).toScVal(),
            nativeToScVal(merchantId), nativeToScVal(approved), nativeToScVal(notes),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
  }

  /**
   * Build an unsigned transaction for processing a payment.
   *
   * @param merchantPublicKey - Merchant account public key
   * @param beneficiaryPublicKey - Beneficiary account public key
   * @param merchantId - Merchant identifier
   * @param beneficiaryId - Beneficiary identifier
   * @param amount - Payment amount
   * @param token - Token symbol/address
   * @param purpose - Purpose of payment
   * @param paymentMethod - Payment method discriminator (defaults to PAYMENT_ONLINE = 4)
   */
  async buildOfflinePayment(
    merchantPublicKey: string,
    beneficiaryPublicKey: string,
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    paymentMethod: number = PAYMENT_ONLINE
  ): Promise<OfflineEnvelope> {
    const sourceAccount = await this.server.getAccount(merchantPublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '200',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'process_payment',
          ...[
            new Address(merchantPublicKey).toScVal(),
            new Address(beneficiaryPublicKey).toScVal(),
            nativeToScVal(merchantId), nativeToScVal(beneficiaryId),
            nativeToScVal(amount), nativeToScVal(token), nativeToScVal(purpose),
            nativeToScVal(paymentMethod),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return OfflineSigner.serialize(tx);
  }

  /**
   * Build a multi-sig payment transaction for offline collection of signatures.
   *
   * @param merchantPublicKey - Merchant account public key
   * @param beneficiaryPublicKey - Beneficiary account public key
   * @param merchantId - Merchant identifier
   * @param beneficiaryId - Beneficiary identifier
   * @param amount - Payment amount
   * @param token - Token symbol/address
   * @param purpose - Purpose of payment
   * @param authorizedSigners - Public keys of signers authorized to sign
   * @param threshold - Number of required signatures
   * @param paymentMethod - Payment method discriminator (defaults to PAYMENT_ONLINE = 4)
   */
  async buildMultiSigPayment(
    merchantPublicKey: string,
    beneficiaryPublicKey: string,
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    authorizedSigners: string[],
    threshold: number,
    paymentMethod: number = PAYMENT_ONLINE
  ): Promise<MultiSigManager> {
    const sourceAccount = await this.server.getAccount(merchantPublicKey);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '200',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'process_payment',
          ...[
            new Address(merchantPublicKey).toScVal(),
            new Address(beneficiaryPublicKey).toScVal(),
            nativeToScVal(merchantId), nativeToScVal(beneficiaryId),
            nativeToScVal(amount), nativeToScVal(token), nativeToScVal(purpose),
            nativeToScVal(paymentMethod),
          ]
        )
      )
      .setTimeout(0)
      .build();
    return MultiSigManager.create(tx, this.getNetworkPassphrase(), authorizedSigners, threshold);
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

// ─── TOML parsing helpers ─────────────────────────────────────────────────────
//
// A minimal TOML parser sufficient for `stellar.toml` files. Supports:
// - Array-of-tables sections: `[[MERCHANTS]]`
// - Single/double-quoted string values
// - Arrays of strings
// - Integer and float values
// - Boolean values
// - Comments (`#` to end of line)
// - Blank lines
//
// Does NOT support: inline tables, multiline strings, nested tables, or
// dotted keys. These are rare in stellar.toml merchant sections.

export type TomlValue = string | number | boolean | string[] | number[];

/** A [sectionName, fields] pair for each table/array-of-tables entry. */
export type TomlTable = [string, Record<string, TomlValue>];

/**
 * Parse a TOML string into a list of (section-name, fields) pairs.
 *
 * Array-of-tables headers like `[[MERCHANTS]]` produce one entry per
 * occurrence, so multiple `[[MERCHANTS]]` blocks yield multiple rows.
 */
export function parseTomlTables(toml: string): TomlTable[] {
  const tables: TomlTable[] = [];
  const lines = toml.split(/\r?\n/);

  // Top-level fields go into a synthetic "" section so they are not lost.
  let currentSection = '';
  let currentFields: Record<string, TomlValue> = {};
  let hasFields = false;

  function flush(): void {
    if (hasFields) {
      tables.push([currentSection, currentFields]);
      currentFields = {};
      hasFields = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip comments (respect quoted strings)
    const line = stripComment(raw).trim();

    if (line === '') continue;

    // Array-of-tables header: [[SECTION]]
    if (line.startsWith('[[') && line.endsWith(']]')) {
      flush();
      currentSection = line.slice(2, -2).trim();
      hasFields = true; // start a new entry even if empty
      continue;
    }

    // Table header: [SECTION]
    if (line.startsWith('[') && line.endsWith(']')) {
      flush();
      currentSection = line.slice(1, -1).trim();
      hasFields = true;
      continue;
    }

    // Key-value pair
    const eqIdx = indexOfUnquoted(line, '=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    const valueRaw = line.slice(eqIdx + 1).trim();
    const value = parseTomlValue(valueRaw);

    if (value !== undefined) {
      currentFields[key] = value;
      hasFields = true;
    }
  }

  flush();
  return tables;
}

/**
 * Strip a `#` comment from a line, respecting quoted strings.
 */
function stripComment(line: string): string {
  let result = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) break;
    result += ch;
  }
  return result;
}

/**
 * Find the index of `=` that is not inside a quoted string.
 */
function indexOfUnquoted(line: string, target: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === target && !inSingle && !inDouble) return i;
  }
  return -1;
}

/**
 * Parse a TOML scalar or array value.
 */
function parseTomlValue(raw: string): TomlValue | undefined {
  const trimmed = raw.trim();

  // Array: ["a", "b"]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    const items = splitArrayItems(inner);
    return items
      .map((item) => parseTomlValue(item))
      .filter((v): v is string | number => v !== undefined) as string[];
  }

  // Double-quoted string
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeString(trimmed.slice(1, -1));
  }

  // Single-quoted string (literal, no escapes)
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number (integer or float)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
  }

  // Unquoted bare string (best-effort, not valid TOML but tolerate it)
  return trimmed;
}

/**
 * Split an array body into individual items, respecting quoted strings.
 */
function splitArrayItems(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (ch === ',' && !inSingle && !inDouble) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/**
 * Unescape common TOML string escape sequences.
 */
function unescapeString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
