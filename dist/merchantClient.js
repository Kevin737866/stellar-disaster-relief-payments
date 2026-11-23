"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantClient = exports.MAX_MERCHANT_PAGE_SIZE = exports.DEFAULT_MERCHANT_PAGE_SIZE = exports.PAYMENT_ONLINE = exports.PAYMENT_OFFLINE = exports.PAYMENT_NFC = exports.PAYMENT_USSD = exports.PAYMENT_QR = void 0;
exports.parseTomlTables = parseTomlTables;
const stellar_sdk_1 = require("stellar-sdk");
const { Server } = stellar_sdk_1.SorobanRpc;
const errors_1 = require("./errors");
const offchainFetch_1 = require("./offchainFetch");
const readCache_1 = require("./readCache");
const offlineSigner_1 = require("./offlineSigner");
const multiSig_1 = require("./multiSig");
const retry_1 = require("./retry");
// Payment methods matching contract enum
exports.PAYMENT_QR = 0;
exports.PAYMENT_USSD = 1;
exports.PAYMENT_NFC = 2;
exports.PAYMENT_OFFLINE = 3;
exports.PAYMENT_ONLINE = 4;
/** Default page size for merchant listing endpoints. */
exports.DEFAULT_MERCHANT_PAGE_SIZE = 20;
/** Maximum page size accepted by the merchant contract. */
exports.MAX_MERCHANT_PAGE_SIZE = 100;
class MerchantClient {
    constructor(config, offchainPolicy = {}) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.merchantNetwork);
        this.cache = new readCache_1.ReadCache(config);
        this.offchainPolicy = offchainPolicy;
    }
    /**
     * Replace the off-chain fetch policy.
     *
     * @example
     * client.setOffchainPolicy({ allowedHostSuffixes: ['.relief.example'] });
     */
    setOffchainPolicy(policy) {
        this.offchainPolicy = policy;
    }
    /**
     * Register local merchant for relief network.
     *
     * Parameter order matches the Rust `register_merchant` contract function:
     * owner, merchant_id, name, business_type, category, location_lat_lng,
     * location_address, location_city, location_country, location_postal_code,
     * contact_info, accepted_tokens, vouchers, emergency_fast_track.
     */
    async registerMerchant(ownerKey, merchantId, request) {
        const ownerKeypair = stellar_sdk_1.Keypair.fromSecret(ownerKey);
        const ownerAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(ownerKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(ownerAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("register_merchant", ...[
            new stellar_sdk_1.Address(ownerKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(request.name),
            (0, stellar_sdk_1.nativeToScVal)(request.businessType),
            (0, stellar_sdk_1.nativeToScVal)(request.category),
            (0, stellar_sdk_1.nativeToScVal)(request.locationLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.locationAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.locationCity),
            (0, stellar_sdk_1.nativeToScVal)(request.locationCountry),
            (0, stellar_sdk_1.nativeToScVal)(request.locationPostalCode),
            (0, stellar_sdk_1.nativeToScVal)(request.contactInfo),
            (0, stellar_sdk_1.nativeToScVal)(request.acceptedTokens),
            (0, stellar_sdk_1.nativeToScVal)(request.vouchers),
            (0, stellar_sdk_1.nativeToScVal)(request.emergencyFastTrack),
        ]))
            .setTimeout(30)
            .build();
        tx.sign(ownerKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            return `Merchant ${merchantId} registered successfully. Awaiting verification.`;
        }
        else {
            throw new errors_1.NetworkError('register merchant', result.status, { merchantId });
        }
    }
    /**
     * Verify merchant (by authorized verifier).
     *
     * The contract does not expose a `verify_merchant` endpoint. Merchant
     * verification is handled via `review_trial_merchant`, which an admin calls
     * to approve or reject a trial-period merchant. The `notes` parameter is
     * accepted for API compatibility and logged client-side but is not sent
     * to the contract.
     */
    async verifyMerchant(verifierKey, merchantId, approved, notes) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(verifierKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(verifierAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("review_trial_merchant", ...[
            new stellar_sdk_1.Address(verifierKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(approved),
        ]))
            .setTimeout(30)
            .build();
        tx.sign(verifierKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`merchant:${merchantId}`);
            return approved
                ? `Merchant ${merchantId} verified and activated`
                : `Merchant ${merchantId} verification rejected`;
        }
        else {
            throw new errors_1.NetworkError('verify merchant', result.status, { merchantId });
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
    async processPayment(merchantKey, beneficiaryKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod = exports.PAYMENT_ONLINE) {
        const merchantKeypair = stellar_sdk_1.Keypair.fromSecret(merchantKey);
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const merchantAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(merchantKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(merchantAccount, {
            fee: '200', // Higher fee for multi-sig
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.buildProcessPaymentOperation(merchantKeypair.publicKey(), beneficiaryKeypair.publicKey(), merchantId, beneficiaryId, amount, token, purpose, paymentMethod))
            .setTimeout(30)
            .build();
        tx.sign(merchantKeypair);
        tx.sign(beneficiaryKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`merchant:${merchantId}`);
            this.cache.invalidate(`merchant:txns:${merchantId}`);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new errors_1.NetworkError('process payment', result.status, { merchantId, beneficiaryKey });
        }
    }
    /**
     * Build the `process_payment` contract invocation shared by the online and
     * offline payment flows.
     *
     * #179 — keeping the argument list in one place stops `processPayment`,
     * `buildOfflinePayment` and `buildMultiSigPayment` from drifting apart
     * (for example, dropping the trailing `paymentMethod` discriminator) after
     * a merge. Every payment builder must go through this method.
     */
    buildProcessPaymentOperation(merchantPublicKey, beneficiaryPublicKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod) {
        return this.contract.call('process_payment', new stellar_sdk_1.Address(merchantPublicKey).toScVal(), new stellar_sdk_1.Address(beneficiaryPublicKey).toScVal(), (0, stellar_sdk_1.nativeToScVal)(merchantId), (0, stellar_sdk_1.nativeToScVal)(beneficiaryId), (0, stellar_sdk_1.nativeToScVal)(amount), (0, stellar_sdk_1.nativeToScVal)(token), (0, stellar_sdk_1.nativeToScVal)(purpose), (0, stellar_sdk_1.nativeToScVal)(paymentMethod));
    }
    /**
     * Get merchant details
     */
    async getMerchant(merchantId) {
        return this.cache.get(`merchant:${merchantId}`, async () => {
            try {
                const result = await this.contract.call("get_merchant", (0, stellar_sdk_1.nativeToScVal)(merchantId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
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
    async findMerchantsByLocation(latitude, longitude, radiusKm) {
        try {
            const result = await this.contract.call("find_merchants_by_location", (0, stellar_sdk_1.nativeToScVal)(latitude), (0, stellar_sdk_1.nativeToScVal)(longitude), (0, stellar_sdk_1.nativeToScVal)(radiusKm));
            const merchants = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return merchants;
        }
        catch (error) {
            console.error('Failed to find merchants by location:', error);
            return [];
        }
    }
    /**
     * Normalise and validate `offset` / `limit` for merchant listing calls.
     */
    normalizeMerchantPageOptions(options = {}) {
        const { offset = 0, limit = exports.DEFAULT_MERCHANT_PAGE_SIZE } = options;
        if (!Number.isInteger(offset) || offset < 0) {
            throw new Error('offset must be a non-negative integer');
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > exports.MAX_MERCHANT_PAGE_SIZE) {
            throw new Error(`limit must be an integer between 1 and ${exports.MAX_MERCHANT_PAGE_SIZE}`);
        }
        return { offset, limit };
    }
    /** Convert the contract tuple into a typed page. */
    toMerchantPage(value) {
        const [merchants, totalCount, hasMore] = (value ?? [[], 0, false]);
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
    async findMerchantsPaginated(options = {}) {
        const { offset, limit } = this.normalizeMerchantPageOptions(options);
        try {
            const result = await this.contract.call('find_merchants_paginated', (0, stellar_sdk_1.nativeToScVal)(offset), (0, stellar_sdk_1.nativeToScVal)(limit));
            return this.toMerchantPage((0, stellar_sdk_1.scValToNative)(result.result.retval));
        }
        catch (error) {
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
    async findMerchantsByLocationPaginated(latitude, longitude, radiusKm, options = {}) {
        const { offset, limit } = this.normalizeMerchantPageOptions(options);
        try {
            const result = await this.contract.call('find_merchants_by_location_paginated', (0, stellar_sdk_1.nativeToScVal)(latitude), (0, stellar_sdk_1.nativeToScVal)(longitude), (0, stellar_sdk_1.nativeToScVal)(radiusKm), (0, stellar_sdk_1.nativeToScVal)(offset), (0, stellar_sdk_1.nativeToScVal)(limit));
            return this.toMerchantPage((0, stellar_sdk_1.scValToNative)(result.result.retval));
        }
        catch (error) {
            console.error('Failed to find merchants by location (paginated):', error);
            return { merchants: [], totalCount: 0, hasMore: false };
        }
    }
    /**
     * Find active merchants by category with offset/limit pagination.
     */
    async findMerchantsByCategoryPaginated(category, options = {}) {
        const { offset, limit } = this.normalizeMerchantPageOptions(options);
        try {
            const result = await this.contract.call('find_merchants_by_category_paginated', (0, stellar_sdk_1.nativeToScVal)(category), (0, stellar_sdk_1.nativeToScVal)(offset), (0, stellar_sdk_1.nativeToScVal)(limit));
            return this.toMerchantPage((0, stellar_sdk_1.scValToNative)(result.result.retval));
        }
        catch (error) {
            console.error('Failed to find merchants by category (paginated):', error);
            return { merchants: [], totalCount: 0, hasMore: false };
        }
    }
    /**
     * Get merchant transaction history
     */
    async getMerchantTransactions(merchantId) {
        return this.cache.get(`merchant:txns:${merchantId}`, async () => {
            try {
                const result = await this.contract.call("get_merchant_transactions", (0, stellar_sdk_1.nativeToScVal)(merchantId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get merchant transactions:', error);
                return [];
            }
        });
    }
    /**
     * Update merchant reputation based on feedback
     */
    async updateReputation(adminKey, merchantId, feedbackScore // -10 to +10
    ) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(adminKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("update_reputation", ...[
            new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(feedbackScore)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`merchant:${merchantId}`);
            return `Reputation updated for merchant ${merchantId}`;
        }
        else {
            throw new errors_1.NetworkError('update reputation', result.status, { merchantId });
        }
    }
    /**
     * Get verification queue
     */
    async getVerificationQueue() {
        try {
            const result = await (0, retry_1.withRetry)(() => this.contract.call("get_verification_queue"));
            const queue = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return queue;
        }
        catch (error) {
            console.error('Failed to get verification queue:', error);
            return [];
        }
    }
    /**
     * Generate QR code for merchant identification
     */
    generateMerchantQRCode(merchantId, merchant) {
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
    async validateMerchantQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'merchant') {
                return false;
            }
            // Verify merchant exists and is active
            const merchant = await this.getMerchant(data.merchantId);
            return merchant !== null && merchant.isActive;
        }
        catch (error) {
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
    async discoverMerchantsFromStellarToml(domain) {
        const host = (0, offchainFetch_1.normaliseHost)(domain);
        const tomlUrl = `https://${host}/.well-known/stellar.toml`;
        let tomlData;
        try {
            const result = await (0, offchainFetch_1.safeFetchText)(tomlUrl, this.offchainPolicy);
            tomlData = result.body;
        }
        catch (error) {
            if (error instanceof offchainFetch_1.OffchainRequestBlockedError) {
                console.error(`Refused Stellar TOML discovery for "${host}": ${error.message}`);
                return [];
            }
            throw error;
        }
        try {
            const tables = parseTomlTables(tomlData);
            const merchants = [];
            for (const [sectionName, fields] of tables) {
                if (sectionName !== 'MERCHANTS')
                    continue;
                // A merchant record must have at least a name to be useful.
                const name = fields['name'];
                if (typeof name !== 'string' || name.trim() === '') {
                    continue;
                }
                const acceptedTokens = Array.isArray(fields['accepted_tokens'])
                    ? fields['accepted_tokens'].filter((t) => typeof t === 'string' && t.length > 0)
                    : ['XLM'];
                // Validate location fields if present
                const lat = typeof fields['latitude'] === 'number'
                    ? fields['latitude']
                    : 0;
                const lng = typeof fields['longitude'] === 'number'
                    ? fields['longitude']
                    : 0;
                merchants.push({
                    id: `toml_${host}_${merchants.length}`,
                    name: name.trim(),
                    owner: typeof fields['owner'] === 'string' ? fields['owner'] : '',
                    businessType: typeof fields['business_type'] === 'string'
                        ? fields['business_type']
                        : 'general',
                    location: {
                        latitude: lat,
                        longitude: lng,
                        address: typeof fields['address'] === 'string' ? fields['address'] : '',
                        city: typeof fields['city'] === 'string' ? fields['city'] : '',
                        country: typeof fields['country'] === 'string' ? fields['country'] : '',
                        postalCode: typeof fields['postal_code'] === 'string' ? fields['postal_code'] : ''
                    },
                    contactInfo: typeof fields['contact_info'] === 'string' ? fields['contact_info'] : '',
                    registrationDate: Date.now(),
                    isVerified: false,
                    verificationDocuments: [],
                    stellarTomlUrl: tomlUrl,
                    acceptedTokens: acceptedTokens.length > 0 ? acceptedTokens : ['XLM'],
                    dailyLimit: typeof fields['daily_limit'] === 'string' ? fields['daily_limit'] : '1000',
                    monthlyLimit: typeof fields['monthly_limit'] === 'string' ? fields['monthly_limit'] : '10000',
                    currentMonthVolume: '0',
                    reputationScore: 50,
                    isActive: false
                });
            }
            return merchants;
        }
        catch (error) {
            console.error('Failed to parse merchants from TOML:', error);
            return [];
        }
    }
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
    createOnboardingRequest(name, businessType, category, locationLatLng, locationAddress, locationCity, locationCountry, locationPostalCode, contactInfo, vouchers = [], emergencyFastTrack = false) {
        return {
            name,
            businessType,
            category,
            locationLatLng,
            locationAddress,
            locationCity,
            locationCountry,
            locationPostalCode,
            contactInfo,
            acceptedTokens: ['XLM'],
            vouchers,
            emergencyFastTrack,
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
    toNonNegativeBigInt(value) {
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
    async getMerchantStatistics(merchantId) {
        const transactions = await this.getMerchantTransactions(merchantId);
        const merchant = await this.getMerchant(merchantId);
        if (!merchant) {
            throw new errors_1.MerchantNotFoundError(merchantId);
        }
        const totalTransactions = transactions.length;
        const totalVolume = transactions.reduce((sum, tx) => sum + BigInt(tx.amount), BigInt(0));
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
    async batchVerifyMerchants(verifierKey, merchantIds, approved, notes) {
        const results = [];
        for (const merchantId of merchantIds) {
            try {
                const result = await this.verifyMerchant(verifierKey, merchantId, approved, notes);
                results.push(result);
            }
            catch (error) {
                results.push(`Failed to verify ${merchantId}: ${error}`);
            }
        }
        return results;
    }
    /**
     * Build an unsigned transaction for registering a merchant.
     */
    async buildOfflineRegisterMerchant(sourcePublicKey, merchantId, request) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('register_merchant', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(request.name),
            (0, stellar_sdk_1.nativeToScVal)(request.businessType),
            (0, stellar_sdk_1.nativeToScVal)(request.category),
            (0, stellar_sdk_1.nativeToScVal)(request.locationLatLng),
            (0, stellar_sdk_1.nativeToScVal)(request.locationAddress),
            (0, stellar_sdk_1.nativeToScVal)(request.locationCity),
            (0, stellar_sdk_1.nativeToScVal)(request.locationCountry),
            (0, stellar_sdk_1.nativeToScVal)(request.locationPostalCode),
            (0, stellar_sdk_1.nativeToScVal)(request.contactInfo),
            (0, stellar_sdk_1.nativeToScVal)(request.acceptedTokens),
            (0, stellar_sdk_1.nativeToScVal)(request.vouchers),
            (0, stellar_sdk_1.nativeToScVal)(request.emergencyFastTrack),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
    }
    /**
     * Build an unsigned transaction for approving a merchant.
     *
     * Calls `review_trial_merchant` (the contract's merchant-verification
     * endpoint) rather than the nonexistent `verify_merchant`. The `notes`
     * parameter is accepted for API compatibility but not sent to the contract.
     */
    async buildOfflineApproveMerchant(sourcePublicKey, merchantId, approved, notes) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('review_trial_merchant', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(merchantId), (0, stellar_sdk_1.nativeToScVal)(approved),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
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
    async buildOfflinePayment(merchantPublicKey, beneficiaryPublicKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod = exports.PAYMENT_ONLINE) {
        const sourceAccount = await this.server.getAccount(merchantPublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '200',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.buildProcessPaymentOperation(merchantPublicKey, beneficiaryPublicKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
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
    async buildMultiSigPayment(merchantPublicKey, beneficiaryPublicKey, merchantId, beneficiaryId, amount, token, purpose, authorizedSigners, threshold, paymentMethod = exports.PAYMENT_ONLINE) {
        const sourceAccount = await this.server.getAccount(merchantPublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '200',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.buildProcessPaymentOperation(merchantPublicKey, beneficiaryPublicKey, merchantId, beneficiaryId, amount, token, purpose, paymentMethod))
            .setTimeout(0)
            .build();
        return multiSig_1.MultiSigManager.create(tx, this.getNetworkPassphrase(), authorizedSigners, threshold);
    }
    getNetworkPassphrase() {
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
exports.MerchantClient = MerchantClient;
/**
 * Parse a TOML string into a list of (section-name, fields) pairs.
 *
 * Array-of-tables headers like `[[MERCHANTS]]` produce one entry per
 * occurrence, so multiple `[[MERCHANTS]]` blocks yield multiple rows.
 */
function parseTomlTables(toml) {
    const tables = [];
    const lines = toml.split(/\r?\n/);
    // Top-level fields go into a synthetic "" section so they are not lost.
    let currentSection = '';
    let currentFields = {};
    let hasFields = false;
    function flush() {
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
        if (line === '')
            continue;
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
        if (eqIdx === -1)
            continue;
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
function stripComment(line) {
    let result = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble)
            inSingle = !inSingle;
        else if (ch === '"' && !inSingle)
            inDouble = !inDouble;
        else if (ch === '#' && !inSingle && !inDouble)
            break;
        result += ch;
    }
    return result;
}
/**
 * Find the index of `=` that is not inside a quoted string.
 */
function indexOfUnquoted(line, target) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble)
            inSingle = !inSingle;
        else if (ch === '"' && !inSingle)
            inDouble = !inDouble;
        else if (ch === target && !inSingle && !inDouble)
            return i;
    }
    return -1;
}
/**
 * Parse a TOML scalar or array value.
 */
function parseTomlValue(raw) {
    const trimmed = raw.trim();
    // Array: ["a", "b"]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1).trim();
        if (inner === '')
            return [];
        const items = splitArrayItems(inner);
        return items
            .map((item) => parseTomlValue(item))
            .filter((v) => v !== undefined);
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
    if (trimmed === 'true')
        return true;
    if (trimmed === 'false')
        return false;
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
function splitArrayItems(inner) {
    const items = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "'" && !inDouble)
            inSingle = !inSingle;
        else if (ch === '"' && !inSingle)
            inDouble = !inDouble;
        if (ch === ',' && !inSingle && !inDouble) {
            items.push(current.trim());
            current = '';
        }
        else {
            current += ch;
        }
    }
    if (current.trim())
        items.push(current.trim());
    return items;
}
/**
 * Unescape common TOML string escape sequences.
 */
function unescapeString(s) {
    return s
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}
//# sourceMappingURL=merchantClient.js.map