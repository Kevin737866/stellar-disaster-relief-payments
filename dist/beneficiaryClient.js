"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeneficiaryClient = exports.MAX_BENEFICIARY_PAGE_SIZE = exports.DEFAULT_BENEFICIARY_PAGE_SIZE = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const { Server } = stellar_sdk_1.SorobanRpc;
const readCache_1 = require("./readCache");
const offlineSigner_1 = require("./offlineSigner");
const errors_1 = require("./errors");
const retry_1 = require("./retry");
const validation_1 = require("./validation");
/**
 * Default page size for paginated beneficiary listings.
 *
 * Large disaster deployments must not rely on the unbounded
 * `listBeneficiariesByDisaster` scan; use `listBeneficiariesPaginated` (or the
 * paginated search helpers) instead.
 */
exports.DEFAULT_BENEFICIARY_PAGE_SIZE = 20;
/** Maximum page size accepted by the beneficiary contract (inclusive). */
exports.MAX_BENEFICIARY_PAGE_SIZE = 100;
class BeneficiaryClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.beneficiaryManager);
        this.cache = new readCache_1.ReadCache(config);
    }
    /**
     * Register displaced person without traditional ID
     */
    async registerBeneficiary(registrarKey, beneficiaryId, name, disasterId, location, walletAddress, familySize, specialNeeds, verificationFactors) {
        (0, validation_1.validateAddress)(walletAddress, 'walletAddress');
        const registrarKeypair = stellar_sdk_1.Keypair.fromSecret(registrarKey);
        const registrarAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(registrarKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(registrarAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("register_beneficiary", ...[
            new stellar_sdk_1.Address(registrarKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(name),
            (0, stellar_sdk_1.nativeToScVal)(disasterId),
            (0, stellar_sdk_1.nativeToScVal)(location),
            new stellar_sdk_1.Address(walletAddress).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(familySize),
            (0, stellar_sdk_1.nativeToScVal)(specialNeeds),
            (0, stellar_sdk_1.nativeToScVal)(verificationFactors)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(registrarKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`beneficiary:${beneficiaryId}`);
            this.cache.invalidatePrefix(`beneficiary:disaster:${disasterId}`);
            return `Beneficiary ${beneficiaryId} registered successfully`;
        }
        else {
            throw new errors_1.NetworkError('register beneficiary', result.status, { beneficiaryId });
        }
    }
    /**
     * Verify beneficiary using behavioral/possession factors
     */
    async verifyBeneficiary(verifierKey, beneficiaryId, providedFactors) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(verifierKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(verifierAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("verify_beneficiary", ...[
            new stellar_sdk_1.Address(verifierKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(providedFactors)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(verifierKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`beneficiary:${beneficiaryId}`);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new errors_1.NetworkError('verify beneficiary', result.status, { beneficiaryId });
        }
    }
    /**
     * Restore access using recovery code
     */
    async restoreAccess(beneficiaryId, recoveryCode, newWalletAddress) {
        (0, validation_1.validateAddress)(newWalletAddress, 'newWalletAddress');
        try {
            const result = await this.contract.call("restore_access", ...[
                (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
                (0, stellar_sdk_1.nativeToScVal)(recoveryCode),
                new stellar_sdk_1.Address(newWalletAddress).toScVal()
            ]);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to restore access:', error);
            return false;
        }
    }
    /**
     * Get beneficiary profile
     */
    async getBeneficiary(beneficiaryId) {
        return this.cache.get(`beneficiary:${beneficiaryId}`, async () => {
            try {
                const result = await this.contract.call("get_beneficiary", (0, stellar_sdk_1.nativeToScVal)(beneficiaryId));
                const profile = (0, stellar_sdk_1.scValToNative)(result.result.retval);
                return profile;
            }
            catch (error) {
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
    async listBeneficiariesByDisaster(disasterId) {
        return this.cache.get(`beneficiary:disaster:${disasterId}`, async () => {
            try {
                const result = await this.contract.call("list_beneficiaries_by_disaster", (0, stellar_sdk_1.nativeToScVal)(disasterId));
                const beneficiaries = (0, stellar_sdk_1.scValToNative)(result.result.retval);
                return beneficiaries;
            }
            catch (error) {
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
    async listBeneficiariesPaginated(disasterId, options = {}) {
        const { cursor = '', limit = exports.DEFAULT_BENEFICIARY_PAGE_SIZE } = options;
        // Input validation
        if (typeof limit !== 'number' ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > exports.MAX_BENEFICIARY_PAGE_SIZE) {
            throw new Error(`limit must be an integer between 1 and ${exports.MAX_BENEFICIARY_PAGE_SIZE}`);
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
            const result = await this.contract.call('list_beneficiaries_paginated', (0, stellar_sdk_1.nativeToScVal)(disasterId), (0, stellar_sdk_1.nativeToScVal)(cursorTs), (0, stellar_sdk_1.nativeToScVal)(cursorId), (0, stellar_sdk_1.nativeToScVal)(limit));
            // Contract returns a tuple (Vec<BeneficiaryProfile>, u64, String)
            const [beneficiaries, nextTs, nextId] = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            // Encode next cursor; empty when no more data (nextTs === 0 && nextId === '')
            const nextCursor = (nextTs === 0 && (!nextId || nextId === ''))
                ? null
                : `${nextTs}:${nextId}`;
            return {
                items: beneficiaries,
                nextCursor,
                hasMore: nextCursor !== null,
            };
        }
        catch (error) {
            console.error('Failed to list beneficiaries (paginated):', error);
            return { items: [], nextCursor: null, hasMore: false };
        }
    }
    /**
     * Update beneficiary location
     */
    async updateLocation(beneficiaryKey, beneficiaryId, newLocation) {
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const beneficiaryAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(beneficiaryKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(beneficiaryAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("update_location", ...[
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(newLocation)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(beneficiaryKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`beneficiary:${beneficiaryId}`);
            return `Location updated for beneficiary ${beneficiaryId}`;
        }
        else {
            throw new errors_1.NetworkError('update location', result.status, { beneficiaryId });
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
    generateRecoveryCodes(beneficiaryId) {
        const codes = [];
        for (let i = 0; i < 3; i++) {
            const code = this.generateRecoveryCode(beneficiaryId, i);
            codes.push(code);
        }
        return codes;
    }
    generateRecoveryCode(beneficiaryId, index) {
        const data = `${beneficiaryId}_${index}_${Date.now()}`;
        // SHA-256 via crypto-js — aligns with Rust sha2::Sha256 used on-chain for
        // RecoveryCode.code_hash.  Both produce lowercase hex for identical input.
        return SHA256(data).toString();
    }
    /**
     * Create biometric-free identity factors
     */
    createVerificationFactors(possessionFactors, behavioralFactors, socialFactors) {
        const factors = [];
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
     * Generate QR code for beneficiary identification.
     *
     * @privacy WARNING — The returned JSON payload contains `name`, `disasterId`,
     * `trustScore`, and verification factor metadata in plaintext.  Anyone who
     * scans this QR code can read these fields.
     *
     * Recommended minimisation:
     * - Omit `name` from the payload.  The scanning party should look up the
     *   display name on-chain after verifying `beneficiaryId`.
     * - Add an `expiresAt` field (e.g. `Date.now() + 30 * 60 * 1000` for 30 min)
     *   to prevent stale QR reuse.
     * - Use the `offlineAuth.generateQRCode()` method instead for contexts where
     *   expiry-scoped, signed offline QR codes are required.
     */
    generateBeneficiaryQRCode(beneficiaryId, profile, qrTtlMs = 30 * 60 * 1000) {
        const qrData = {
            type: 'beneficiary_id',
            v: 1, // payload version for future schema evolution
            beneficiaryId,
            // NOTE: `name` is included here for operator convenience but exposes the
            // beneficiary's display name to anyone scanning the QR.  Consider omitting
            // in production and resolving the name on-chain after verifying the ID.
            name: profile.name,
            disasterId: profile.disasterId,
            trustScore: profile.trustScore,
            timestamp: Date.now(),
            // NOTE: No `expiresAt` field — this QR does not expire.  Add one for
            // production deployments where stale QR reuse is a concern.
            verificationFactors: profile.verificationFactors.map(f => ({
                type: f.factorType,
                weight: f.weight
                // Raw factor values are intentionally omitted — never include them here.
            }))
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate a beneficiary QR code.
     *
     * Checks the QR-specific expiry (`qrExpiresAt`) and confirms the beneficiary
     * still exists on-chain.
     */
    async validateBeneficiaryQRCode(qrCodeData) {
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
        }
        catch (error) {
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
    createUSSDSession(phoneNumber) {
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
    processUSSDInput(sessionId, input, currentStep) {
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
    processMainMenu(input) {
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
    processRegistrationName(input) {
        return {
            response: `Thank you ${input}. Please enter your current location (city/village):`,
            nextStep: 'register_location'
        };
    }
    processRegistrationLocation(input) {
        return {
            response: 'Please enter your family size (number of people):',
            nextStep: 'register_family'
        };
    }
    processRegistrationFamily(input) {
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
    processCheckBalance(input) {
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
    processFindMerchants(input) {
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
    generateSessionId(phoneNumber) {
        // SHA-256 via crypto-js — truncated to 16 hex chars for session ID length.
        // Not sent to the contract; for local session tracking only.
        return SHA256(`${phoneNumber}_${Date.now()}`).toString().substring(0, 16);
    }
    /**
     * Get beneficiary statistics for a disaster deployment.
     *
     * Centralizes zero-division guards and handles empty inputs safely:
     * returns well-defined 0 values if no beneficiaries exist or if the list
     * is empty, and computes averages in a single pass.
     */
    async getBeneficiaryStatistics(disasterId) {
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
    async buildOfflineRegister(sourcePublicKey, beneficiaryId, name, disasterId, location, walletAddress, familySize, specialNeeds, verificationFactors) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('register_beneficiary', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId), (0, stellar_sdk_1.nativeToScVal)(name), (0, stellar_sdk_1.nativeToScVal)(disasterId),
            (0, stellar_sdk_1.nativeToScVal)(location), new stellar_sdk_1.Address(walletAddress).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(familySize), (0, stellar_sdk_1.nativeToScVal)(specialNeeds),
            (0, stellar_sdk_1.nativeToScVal)(verificationFactors),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
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
    async searchBeneficiaries(disasterId, options = {}) {
        const { cursor = '', limit = exports.DEFAULT_BENEFICIARY_PAGE_SIZE, search = '', locationFilter = '', activeOnly = true, minTrustScore = 0, } = options;
        if (!Number.isInteger(limit) || limit < 1 || limit > exports.MAX_BENEFICIARY_PAGE_SIZE) {
            throw new Error(`limit must be an integer between 1 and ${exports.MAX_BENEFICIARY_PAGE_SIZE}`);
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
            const result = await this.contract.call('search_beneficiaries_paginated', (0, stellar_sdk_1.nativeToScVal)(disasterId), (0, stellar_sdk_1.nativeToScVal)(cleanSearch), (0, stellar_sdk_1.nativeToScVal)(cleanLocation), (0, stellar_sdk_1.nativeToScVal)(activeOnly), (0, stellar_sdk_1.nativeToScVal)(minTrustScore), (0, stellar_sdk_1.nativeToScVal)(cursorTs), (0, stellar_sdk_1.nativeToScVal)(cursorId), (0, stellar_sdk_1.nativeToScVal)(limit));
            const [beneficiaries, nextTs, nextId] = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            const nextCursor = (nextTs === 0 && (!nextId || nextId === ''))
                ? null
                : `${nextTs}:${nextId}`;
            return { items: beneficiaries, nextCursor, hasMore: nextCursor !== null };
        }
        catch (error) {
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
    async searchFunds(options = {}) {
        const { search = '', disasterType = '', activeOnly = false, createdAfter = 0, createdBefore = 0, } = options;
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
            const result = await this.contract.call('search_funds', (0, stellar_sdk_1.nativeToScVal)(cleanSearch), (0, stellar_sdk_1.nativeToScVal)(cleanType), (0, stellar_sdk_1.nativeToScVal)(activeOnly), (0, stellar_sdk_1.nativeToScVal)(createdAfter), (0, stellar_sdk_1.nativeToScVal)(createdBefore));
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('searchFunds failed:', error);
            return [];
        }
    }
}
exports.BeneficiaryClient = BeneficiaryClient;
//# sourceMappingURL=beneficiaryClient.js.map