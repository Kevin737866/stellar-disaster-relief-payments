import { ReadCache } from './readCache';
import { ConditionalTransfer, SpendingRule, TransferTransaction, PaymentRequest } from './types';
import { OfflineEnvelope } from './offlineSigner';
import { NetworkConfig } from './types';
/** Maximum 256-bit unsigned integer value: 2^256 - 1. */
export declare const MAX_U256: bigint;
/**
 * Validates and formats an amount string strictly as a U256-compatible decimal integer string.
 *
 * The contract expects a Soroban U256 integer. Amounts must be represented as non-negative
 * integer decimal strings (no decimal points, fractions, negative signs, or non-numeric characters)
 * and must not exceed 2^256 - 1.
 *
 * @param amount - The amount string to validate and normalize.
 * @param field - Field name for error reporting (defaults to 'amount').
 * @returns The normalized decimal integer string.
 * @throws {ValidationError} If the format is invalid or exceeds U256 bounds.
 */
export declare function validateU256Amount(amount: string, field?: string): string;
export declare class TransferClient {
    private server;
    private contract;
    private config;
    readonly cache: ReadCache;
    constructor(config: NetworkConfig);
    /**
     * Create conditional cash transfer
     *
     * @param creatorKey - Secret key of transfer creator
     * @param transferId - Unique transfer ID
     * @param beneficiaryId - Beneficiary identifier
     * @param amount - U256 decimal integer string representing transfer amount
     * @param token - Token symbol/address
     * @param expiresAt - Expiry timestamp
     * @param spendingRules - Spending rule restrictions
     * @param purpose - Purpose of transfer
     * @throws {ValidationError} If amount is not a valid U256 decimal string
     */
    createTransfer(creatorKey: string, transferId: string, beneficiaryId: string, amount: string, token: string, expiresAt: number, spendingRules: SpendingRule[], purpose: string): Promise<string>;
    /**
     * Attempt to spend from conditional transfer
     *
     * @param beneficiaryKey - Beneficiary secret key
     * @param transferId - Transfer identifier
     * @param merchantId - Merchant identifier
     * @param amount - U256 integer decimal string representing spend amount (0 to 2^256 - 1)
     * @param category - Spending category
     * @param location - Spend location
     * @throws {ValidationError} If amount is not a valid U256 decimal string
     */
    spend(beneficiaryKey: string, transferId: string, merchantId: string, amount: string, category: string, location: string): Promise<boolean>;
    /**
     * Get transfer details
     */
    getTransfer(transferId: string): Promise<ConditionalTransfer | null>;
    /**
     * Get transaction history for a transfer
     */
    getTransactions(transferId: string): Promise<TransferTransaction[]>;
    /**
     * Recall unspent funds after expiry
     */
    recallFunds(creatorKey: string, transferId: string): Promise<string>;
    /**
     * List active transfers for a beneficiary
     */
    listBeneficiaryTransfers(beneficiaryId: string): Promise<ConditionalTransfer[]>;
    /**
     * Extend transfer expiry
     */
    extendExpiry(creatorKey: string, transferId: string, newExpiry: number): Promise<string>;
    /**
     * Create spending rules for conditional transfers
     */
    createSpendingRules(rules: Array<{
        type: 'category_limit' | 'merchant_whitelist' | 'time_window' | 'location_based';
        parameters: Record<string, string>;
        limit: string;
    }>): SpendingRule[];
    /**
     * Create category limit rule
     */
    createCategoryLimitRule(category: string, limit: string): SpendingRule;
    /**
     * Create time window rule
     */
    createTimeWindowRule(startTime: number, endTime: number): SpendingRule;
    /**
     * Create location-based rule
     */
    createLocationRule(allowedLocation: string): SpendingRule;
    /**
     * Generate QR code for conditional transfer.
     *
     * @privacy WARNING — The returned JSON payload contains `beneficiaryId`,
     * `amount`, `remainingAmount`, `token`, `purpose`, and spending rule limits
     * in plaintext.  Anyone who scans this QR code can read the beneficiary's
     * current balance and transfer purpose.
     *
     * Recommended minimisation:
     * - Omit `remainingAmount` from the payload.  The merchant should query the
     *   contract after scanning to obtain the current balance, preventing
     *   real-time balance exposure via the QR image.
     * - Consider omitting `purpose` if it contains sensitive descriptions.
     * - The QR already includes `expiresAt` (transfer expiry) which limits
     *   the useful lifetime of a captured QR image.
     */
    generateTransferQRCode(transferId: string, transfer: ConditionalTransfer, qrTtlMs?: number): string;
    /**
     * Validate a transfer QR code.
     *
     * Checks the QR-specific expiry (`qrExpiresAt`) and confirms the transfer
     * is still active on-chain.
     */
    validateTransferQRCode(qrCodeData: string): Promise<boolean>;
    /**
     * Create emergency transfer template.
     *
     * Computes category limits using BigInt arithmetic:
     * - Medicine: 30% (`amount * 30 / 100`)
     * - Shelter: 10% (`amount * 10 / 100`)
     * - Food: receives the remaining balance (`amount - medicine - shelter`, ~60%)
     *
     * This guarantees that default category limit allocations sum exactly to the
     * total disbursement amount without losing units to integer division truncation.
     *
     * @param beneficiaryId - The recipient's beneficiary identifier.
     * @param amount - Total transfer amount as an integer string.
     * @param disasterType - Description of disaster for purpose labeling.
     */
    createEmergencyTransfer(beneficiaryId: string, amount: string, disasterType: string): {
        transferId: string;
        transfer: ConditionalTransfer;
    };
    /**
     * Process payment request with category and transfer selection logic.
     *
     * Selects an appropriate active transfer for the beneficiary based on:
     * 1. Active status and non-expired time window.
     * 2. Matching token (if specified).
     * 3. Sufficient remaining balance for the requested amount.
     * 4. Compatibility with spending rules:
     *    - Category limits: prioritizes transfers with matching category allowances.
     *    - Merchant whitelist: verifies merchant is allowed if whitelisting is configured.
     *    - Time windows: verifies current time falls within active window.
     *    - Location restrictions: verifies location matches if restricted.
     *
     * Category resolution:
     * - Uses explicit `request.category` if provided.
     * - Otherwise maps `request.purpose` via the disbursement purpose taxonomy (`categorizePurpose`).
     * - Falls back to `'general'` if purpose does not map to a recognized category.
     *
     * Limitations:
     * - Atomic single-transfer spend: does not split payment across multiple transfers if no single
     *   transfer has sufficient balance.
     * - Spending rule pre-checks are client-side heuristics to select the most suitable transfer;
     *   definitive rule verification and state transitions are enforced on-chain.
     *
     * @param request - Payment request details
     * @param beneficiaryKey - Secret key of the beneficiary
     * @returns Success status with transactionId and transferId or descriptive error
     */
    processPaymentRequest(request: PaymentRequest, beneficiaryKey: string): Promise<{
        success: boolean;
        transactionId?: string;
        transferId?: string;
        error?: string;
    }>;
    /**
     * Get transfer statistics
     */
    getTransferStatistics(transferId: string): Promise<{
        totalSpent: string;
        remainingAmount: string;
        utilizationRate: number;
        transactionCount: number;
        averageTransaction: string;
        isExpired: boolean;
    }>;
    /**
     * Batch create transfers for disaster response
     */
    batchCreateTransfers(creatorKey: string, beneficiaryIds: string[], amount: string, purpose: string, spendingRules: SpendingRule[]): Promise<string[]>;
    /**
     * Build an unsigned transaction for creating a conditional transfer.
     *
     * @param sourcePublicKey - Source account public key
     * @param transferId - Unique transfer identifier
     * @param beneficiaryId - Beneficiary identifier
     * @param amount - U256 integer decimal string representing transfer amount
     * @param token - Token symbol/address
     * @param expiresAt - Expiry timestamp
     * @param spendingRules - Typed spending rules configuring transfer restrictions
     * @param purpose - Purpose of transfer
     * @throws {ValidationError} If amount is not a valid U256 decimal string
     */
    buildOfflineCreateTransfer(sourcePublicKey: string, transferId: string, beneficiaryId: string, amount: string, token: string, expiresAt: number, spendingRules: SpendingRule[], purpose: string): Promise<OfflineEnvelope>;
    private getNetworkPassphrase;
}
//# sourceMappingURL=transferClient.d.ts.map