import { Merchant, Transaction, MerchantOnboardingRequest, NetworkConfig, MerchantPaginationOptions, PaginatedMerchants } from './types';
import { OffchainPolicy } from './offchainFetch';
import { ReadCache } from './readCache';
import { OfflineEnvelope } from './offlineSigner';
import { MultiSigManager } from './multiSig';
export declare const PAYMENT_QR = 0;
export declare const PAYMENT_USSD = 1;
export declare const PAYMENT_NFC = 2;
export declare const PAYMENT_OFFLINE = 3;
export declare const PAYMENT_ONLINE = 4;
/** Default page size for merchant listing endpoints. */
export declare const DEFAULT_MERCHANT_PAGE_SIZE = 20;
/** Maximum page size accepted by the merchant contract. */
export declare const MAX_MERCHANT_PAGE_SIZE = 100;
export declare class MerchantClient {
    private server;
    private contract;
    private config;
    readonly cache: ReadCache;
    /**
     * #238 — policy governing off-chain lookups. Empty by default, which means
     * *every* off-chain request is refused until a host is allowlisted. Failing
     * closed is deliberate: a silent default-allow would keep the SSRF surface
     * open for anyone who forgot to configure it.
     */
    private offchainPolicy;
    constructor(config: NetworkConfig, offchainPolicy?: OffchainPolicy);
    /**
     * Replace the off-chain fetch policy.
     *
     * @example
     * client.setOffchainPolicy({ allowedHostSuffixes: ['.relief.example'] });
     */
    setOffchainPolicy(policy: OffchainPolicy): void;
    /**
     * Register local merchant for relief network.
     *
     * Parameter order matches the Rust `register_merchant` contract function:
     * owner, merchant_id, name, business_type, category, location_lat_lng,
     * location_address, location_city, location_country, location_postal_code,
     * contact_info, accepted_tokens, vouchers, emergency_fast_track.
     */
    registerMerchant(ownerKey: string, merchantId: string, request: MerchantOnboardingRequest): Promise<string>;
    /**
     * Verify merchant (by authorized verifier).
     *
     * The contract does not expose a `verify_merchant` endpoint. Merchant
     * verification is handled via `review_trial_merchant`, which an admin calls
     * to approve or reject a trial-period merchant. The `notes` parameter is
     * accepted for API compatibility and logged client-side but is not sent
     * to the contract.
     */
    verifyMerchant(verifierKey: string, merchantId: string, approved: boolean, notes: string): Promise<string>;
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
    processPayment(merchantKey: string, beneficiaryKey: string, merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string, paymentMethod?: number): Promise<string>;
    /**
     * Build the `process_payment` contract invocation shared by the online and
     * offline payment flows.
     *
     * #179 — keeping the argument list in one place stops `processPayment`,
     * `buildOfflinePayment` and `buildMultiSigPayment` from drifting apart
     * (for example, dropping the trailing `paymentMethod` discriminator) after
     * a merge. Every payment builder must go through this method.
     */
    private buildProcessPaymentOperation;
    /**
     * Get merchant details
     */
    getMerchant(merchantId: string): Promise<Merchant | null>;
    /**
     * Find merchants by location (geographic search, unbounded).
     *
     * @deprecated Prefer {@link findMerchantsByLocationPaginated} for production
     * clients; this helper loads every matching merchant.
     */
    findMerchantsByLocation(latitude: number, longitude: number, radiusKm: number): Promise<Merchant[]>;
    /**
     * Normalise and validate `offset` / `limit` for merchant listing calls.
     */
    private normalizeMerchantPageOptions;
    /** Convert the contract tuple into a typed page. */
    private toMerchantPage;
    /**
     * List active merchants with offset/limit pagination.
     *
     * This is the preferred listing path for dashboards: the contract returns a
     * bounded page plus `totalCount` / `hasMore`, so the UI never loads an
     * unbounded merchant set.
     */
    findMerchantsPaginated(options?: MerchantPaginationOptions): Promise<PaginatedMerchants>;
    /**
     * Find active merchants by location with offset/limit pagination.
     *
     * @param latitude  Centre latitude in decimal degrees.
     * @param longitude Centre longitude in decimal degrees.
     * @param radiusKm  Search radius in kilometres.
     */
    findMerchantsByLocationPaginated(latitude: number, longitude: number, radiusKm: number, options?: MerchantPaginationOptions): Promise<PaginatedMerchants>;
    /**
     * Find active merchants by category with offset/limit pagination.
     */
    findMerchantsByCategoryPaginated(category: number, options?: MerchantPaginationOptions): Promise<PaginatedMerchants>;
    /**
     * Get merchant transaction history
     */
    getMerchantTransactions(merchantId: string): Promise<Transaction[]>;
    /**
     * Update merchant reputation based on feedback
     */
    updateReputation(adminKey: string, merchantId: string, feedbackScore: number): Promise<string>;
    /**
     * Get verification queue
     */
    getVerificationQueue(): Promise<string[]>;
    /**
     * Generate QR code for merchant identification
     */
    generateMerchantQRCode(merchantId: string, merchant: Merchant): string;
    /**
     * Validate merchant QR code
     */
    validateMerchantQRCode(qrCodeData: string): Promise<boolean>;
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
    discoverMerchantsFromStellarToml(domain: string): Promise<Merchant[]>;
    /**
     * Create merchant onboarding request template.
     *
     * @param name              Human-readable merchant name.
     * @param businessType      Free-text business type description.
     * @param category          Numeric category code (0=food,1=water,2=shelter,3=medical,4=clothing,5=fuel).
     * @param locationLatLng    Coordinates as "lat,lng" string, e.g. "18.4861,-69.9312".
     * @param locationAddress   Street address.
     * @param locationCity      City name.
     * @param locationCountry   Country name.
     * @param locationPostalCode Postal / ZIP code.
     * @param contactInfo       Contact details (phone, email, etc.).
     * @param vouchers          Community vouching references (3 beneficiary IDs or 1 NGO worker ID).
     * @param emergencyFastTrack Pre-approved from existing network (skips trial period).
     */
    createOnboardingRequest(name: string, businessType: string, category: number, locationLatLng: string, locationAddress: string, locationCity: string, locationCountry: string, locationPostalCode: string, contactInfo: string, vouchers?: string[], emergencyFastTrack?: boolean): MerchantOnboardingRequest;
    /**
     * Parse a contract-supplied amount into a non-negative BigInt.
     *
     * Contract storage can hand back strings, numbers or BigInts, and a
     * malformed limit must not make the whole statistics call throw (#180).
     * Invalid, negative or non-integer values are treated as zero so callers
     * always receive well-defined statistics.
     */
    private toNonNegativeBigInt;
    /**
     * Get merchant statistics
     */
    getMerchantStatistics(merchantId: string): Promise<{
        totalTransactions: number;
        totalVolume: string;
        averageTransaction: string;
        reputationScore: number;
        monthlyUtilization: number;
    }>;
    /**
     * Batch verify merchants
     */
    batchVerifyMerchants(verifierKey: string, merchantIds: string[], approved: boolean, notes: string): Promise<string[]>;
    /**
     * Build an unsigned transaction for registering a merchant.
     */
    buildOfflineRegisterMerchant(sourcePublicKey: string, merchantId: string, request: MerchantOnboardingRequest): Promise<OfflineEnvelope>;
    /**
     * Build an unsigned transaction for approving a merchant.
     *
     * Calls `review_trial_merchant` (the contract's merchant-verification
     * endpoint) rather than the nonexistent `verify_merchant`. The `notes`
     * parameter is accepted for API compatibility but not sent to the contract.
     */
    buildOfflineApproveMerchant(sourcePublicKey: string, merchantId: string, approved: boolean, notes: string): Promise<OfflineEnvelope>;
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
    buildOfflinePayment(merchantPublicKey: string, beneficiaryPublicKey: string, merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string, paymentMethod?: number): Promise<OfflineEnvelope>;
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
    buildMultiSigPayment(merchantPublicKey: string, beneficiaryPublicKey: string, merchantId: string, beneficiaryId: string, amount: string, token: string, purpose: string, authorizedSigners: string[], threshold: number, paymentMethod?: number): Promise<MultiSigManager>;
    private getNetworkPassphrase;
}
export type TomlValue = string | number | boolean | string[] | number[];
/** A [sectionName, fields] pair for each table/array-of-tables entry. */
export type TomlTable = [string, Record<string, TomlValue>];
/**
 * Parse a TOML string into a list of (section-name, fields) pairs.
 *
 * Array-of-tables headers like `[[MERCHANTS]]` produce one entry per
 * occurrence, so multiple `[[MERCHANTS]]` blocks yield multiple rows.
 */
export declare function parseTomlTables(toml: string): TomlTable[];
//# sourceMappingURL=merchantClient.d.ts.map