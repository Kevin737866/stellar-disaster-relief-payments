import { ReadCache } from './readCache';
import { BeneficiaryProfile, VerificationFactor, PaginatedResponse, PaginationOptions, NetworkConfig, EmergencyFund, BeneficiarySearchOptions, FundSearchOptions } from './types';
import { OfflineEnvelope } from './offlineSigner';
/**
 * Default page size for paginated beneficiary listings.
 *
 * Large disaster deployments must not rely on the unbounded
 * `listBeneficiariesByDisaster` scan; use `listBeneficiariesPaginated` (or the
 * paginated search helpers) instead.
 */
export declare const DEFAULT_BENEFICIARY_PAGE_SIZE = 20;
/** Maximum page size accepted by the beneficiary contract (inclusive). */
export declare const MAX_BENEFICIARY_PAGE_SIZE = 100;
export declare class BeneficiaryClient {
    private server;
    private contract;
    private config;
    readonly cache: ReadCache;
    constructor(config: NetworkConfig);
    /**
     * Register displaced person without traditional ID
     */
    registerBeneficiary(registrarKey: string, beneficiaryId: string, name: string, disasterId: string, location: string, walletAddress: string, familySize: number, specialNeeds: string[], verificationFactors: VerificationFactor[]): Promise<string>;
    /**
     * Verify beneficiary using behavioral/possession factors
     */
    verifyBeneficiary(verifierKey: string, beneficiaryId: string, providedFactors: VerificationFactor[]): Promise<boolean>;
    /**
     * Restore access using recovery code
     */
    restoreAccess(beneficiaryId: string, recoveryCode: string, newWalletAddress: string): Promise<boolean>;
    /**
     * Get beneficiary profile
     */
    getBeneficiary(beneficiaryId: string): Promise<BeneficiaryProfile | null>;
    /**
     * List beneficiaries by disaster (unbounded scan).
     *
     * @deprecated Prefer {@link listBeneficiariesPaginated} or
     * {@link searchBeneficiaries}. This method loads every beneficiary for the
     * disaster into memory and is only safe for small datasets. A full disaster
     * deployment can contain thousands of records, so it must not be used as the
     * default listing path.
     */
    listBeneficiariesByDisaster(disasterId: string): Promise<BeneficiaryProfile[]>;
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
    listBeneficiariesPaginated(disasterId: string, options?: PaginationOptions): Promise<PaginatedResponse<BeneficiaryProfile>>;
    /**
     * Update beneficiary location
     */
    updateLocation(beneficiaryKey: string, beneficiaryId: string, newLocation: string): Promise<string>;
    /**
     * Generate recovery codes for offline access.
     *
     * **Demo-grade only.** The generated value is a deterministic SHA-256 of the
     * beneficiary ID, index, and timestamp. It does not match the contract's
     * recovery-code hash/argument format, and anyone who knows the beneficiary ID
     * can derive the contract-side value. See `docs/offline-flows.md` (known
     * gaps) before using this for account recovery.
     */
    generateRecoveryCodes(beneficiaryId: string): string[];
    private generateRecoveryCode;
    /**
     * Create biometric-free identity factors
     */
    createVerificationFactors(possessionFactors: string[], behavioralFactors: string[], socialFactors: string[]): VerificationFactor[];
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
    generateBeneficiaryQRCode(beneficiaryId: string, profile: BeneficiaryProfile, qrTtlMs?: number): string;
    /**
     * Validate a beneficiary QR code.
     *
     * Checks the QR-specific expiry (`qrExpiresAt`) and confirms the beneficiary
     * still exists on-chain.
     */
    validateBeneficiaryQRCode(qrCodeData: string): Promise<boolean>;
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
    };
    /**
     * Process USSD input.
     *
     * Advances the local demo state machine. No authentication, replay checks, or
     * rate limiting are performed. See `docs/offline-flows.md`.
     */
    processUSSDInput(sessionId: string, input: string, currentStep: string): {
        response: string;
        nextStep: string;
        completed?: boolean;
    };
    private processMainMenu;
    private processRegistrationName;
    private processRegistrationLocation;
    private processRegistrationFamily;
    private processCheckBalance;
    private processFindMerchants;
    private generateSessionId;
    /**
     * Get beneficiary statistics for a disaster deployment.
     *
     * Centralizes zero-division guards and handles empty inputs safely:
     * returns well-defined 0 values if no beneficiaries exist or if the list
     * is empty, and computes averages in a single pass.
     */
    getBeneficiaryStatistics(disasterId: string): Promise<{
        totalBeneficiaries: number;
        averageFamilySize: number;
        averageTrustScore: number;
        activeBeneficiaries: number;
        specialNeedsCount: number;
    }>;
    /**
     * Build an unsigned transaction for registering a beneficiary.
     */
    buildOfflineRegister(sourcePublicKey: string, beneficiaryId: string, name: string, disasterId: string, location: string, walletAddress: string, familySize: number, specialNeeds: string[], verificationFactors: any[]): Promise<OfflineEnvelope>;
    private getNetworkPassphrase;
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
    searchBeneficiaries(disasterId: string, options?: BeneficiarySearchOptions): Promise<PaginatedResponse<BeneficiaryProfile>>;
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
    searchFunds(options?: FundSearchOptions): Promise<EmergencyFund[]>;
}
//# sourceMappingURL=beneficiaryClient.d.ts.map