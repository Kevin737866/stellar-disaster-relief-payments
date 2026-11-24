"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferClient = exports.MAX_U256 = void 0;
exports.validateU256Amount = validateU256Amount;
const stellar_sdk_1 = require("stellar-sdk");
const readCache_1 = require("./readCache");
const errors_1 = require("./errors");
const offlineSigner_1 = require("./offlineSigner");
const retry_1 = require("./retry");
const purposeTaxonomy_1 = require("./purposeTaxonomy");
/** Maximum 256-bit unsigned integer value: 2^256 - 1. */
exports.MAX_U256 = (1n << 256n) - 1n;
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
function validateU256Amount(amount, field = 'amount') {
    if (typeof amount !== 'string') {
        throw new errors_1.ValidationError(field, 'Amount must be a string');
    }
    const trimmed = amount.trim();
    if (!trimmed) {
        throw new errors_1.ValidationError(field, 'Amount string must not be empty');
    }
    if (!/^\d+$/.test(trimmed)) {
        throw new errors_1.ValidationError(field, 'Amount must be a non-negative decimal integer string without decimals, fractions, or signs');
    }
    try {
        const val = BigInt(trimmed);
        if (val < 0n || val > exports.MAX_U256) {
            throw new errors_1.ValidationError(field, 'Amount must fit within a 256-bit unsigned integer (0 <= amount <= 2^256 - 1)');
        }
        return val.toString();
    }
    catch (err) {
        if (err instanceof errors_1.ValidationError)
            throw err;
        throw new errors_1.ValidationError(field, `Failed to parse amount as U256: ${err?.message || err}`);
    }
}
class TransferClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.cashTransfer);
        this.cache = new readCache_1.ReadCache(config);
    }
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
    async createTransfer(creatorKey, transferId, beneficiaryId, amount, token, expiresAt, spendingRules, purpose) {
        const validAmount = validateU256Amount(amount, 'amount');
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(creatorKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_transfer", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(validAmount),
            (0, stellar_sdk_1.nativeToScVal)(token),
            (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(spendingRules),
            (0, stellar_sdk_1.nativeToScVal)(purpose)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidatePrefix(`transfer:beneficiary:${beneficiaryId}`);
            return `Conditional transfer ${transferId} created successfully`;
        }
        else {
            throw new errors_1.TransactionError(transferId, result.status, { operation: 'create transfer' });
        }
    }
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
    async spend(beneficiaryKey, transferId, merchantId, amount, category, location) {
        const validAmount = validateU256Amount(amount, 'amount');
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const beneficiaryAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(beneficiaryKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(beneficiaryAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("spend", ...[
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(merchantId),
            (0, stellar_sdk_1.nativeToScVal)(validAmount),
            (0, stellar_sdk_1.nativeToScVal)(category),
            (0, stellar_sdk_1.nativeToScVal)(location)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(beneficiaryKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`transfer:${transferId}`);
            this.cache.invalidate(`transfer:transactions:${transferId}`);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new errors_1.TransactionError(transferId, result.status, { operation: 'spend', merchantId });
        }
    }
    /**
     * Get transfer details
     */
    async getTransfer(transferId) {
        return this.cache.get(`transfer:${transferId}`, async () => {
            try {
                const result = await this.contract.call("get_transfer", (0, stellar_sdk_1.nativeToScVal)(transferId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get transfer:', error);
                return null;
            }
        });
    }
    /**
     * Get transaction history for a transfer
     */
    async getTransactions(transferId) {
        return this.cache.get(`transfer:transactions:${transferId}`, async () => {
            try {
                const result = await this.contract.call("get_transactions", (0, stellar_sdk_1.nativeToScVal)(transferId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get transactions:', error);
                return [];
            }
        });
    }
    /**
     * Recall unspent funds after expiry
     */
    async recallFunds(creatorKey, transferId) {
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(creatorKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("recall_funds", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`transfer:${transferId}`);
            this.cache.invalidate(`transfer:transactions:${transferId}`);
            const recalledAmount = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return `Recalled ${recalledAmount} units from transfer ${transferId}`;
        }
        else {
            throw new errors_1.TransactionError(transferId, result.status, { operation: 'recall funds' });
        }
    }
    /**
     * List active transfers for a beneficiary
     */
    async listBeneficiaryTransfers(beneficiaryId) {
        return this.cache.get(`transfer:beneficiary:${beneficiaryId}`, async () => {
            try {
                const result = await this.contract.call("list_beneficiary_transfers", (0, stellar_sdk_1.nativeToScVal)(beneficiaryId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to list beneficiary transfers:', error);
                return [];
            }
        });
    }
    /**
     * Extend transfer expiry
     */
    async extendExpiry(creatorKey, transferId, newExpiry) {
        const creatorKeypair = stellar_sdk_1.Keypair.fromSecret(creatorKey);
        const creatorAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(creatorKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(creatorAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("extend_expiry", ...[
            new stellar_sdk_1.Address(creatorKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId),
            (0, stellar_sdk_1.nativeToScVal)(newExpiry)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(creatorKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`transfer:${transferId}`);
            return `Transfer ${transferId} expiry extended to ${new Date(newExpiry).toISOString()}`;
        }
        else {
            throw new errors_1.TransactionError(transferId, result.status, { operation: 'extend expiry' });
        }
    }
    /**
     * Create spending rules for conditional transfers
     */
    createSpendingRules(rules) {
        return rules.map(rule => ({
            ruleType: rule.type,
            parameters: rule.parameters,
            limit: rule.limit,
            currentUsage: '0'
        }));
    }
    /**
     * Create category limit rule
     */
    createCategoryLimitRule(category, limit) {
        return {
            ruleType: 'category_limit',
            parameters: {
                category
            },
            limit,
            currentUsage: '0'
        };
    }
    /**
     * Create time window rule
     */
    createTimeWindowRule(startTime, endTime) {
        return {
            ruleType: 'time_window',
            parameters: {
                start_time: startTime.toString(),
                end_time: endTime.toString()
            },
            limit: '0', // No limit, just time restriction
            currentUsage: '0'
        };
    }
    /**
     * Create location-based rule
     */
    createLocationRule(allowedLocation) {
        return {
            ruleType: 'location_based',
            parameters: {
                location: allowedLocation
            },
            limit: '0', // No limit, just location restriction
            currentUsage: '0'
        };
    }
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
    generateTransferQRCode(transferId, transfer, qrTtlMs = 30 * 60 * 1000) {
        const qrData = {
            type: 'transfer',
            v: 1, // payload version for future schema evolution
            transferId,
            beneficiaryId: transfer.beneficiaryId,
            amount: transfer.amount,
            // NOTE: `remainingAmount` exposes the current balance to anyone scanning
            // the QR.  Consider omitting in production; merchants should query the
            // contract for the live balance after scanning the transfer ID.
            remainingAmount: transfer.remainingAmount,
            token: transfer.token,
            purpose: transfer.purpose,
            spendingRules: transfer.spendingRules.map(rule => ({
                type: rule.ruleType,
                limit: rule.limit
            })),
            expiresAt: transfer.expiresAt, // QR is scoped to transfer expiry
            timestamp: Date.now()
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate a transfer QR code.
     *
     * Checks the QR-specific expiry (`qrExpiresAt`) and confirms the transfer
     * is still active on-chain.
     */
    async validateTransferQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'transfer') {
                return false;
            }
            // Check QR-specific expiry first (fast, no network call)
            if (data.qrExpiresAt && Date.now() > data.qrExpiresAt) {
                return false;
            }
            // Verify transfer exists and is active
            const transfer = await this.getTransfer(data.transferId);
            return transfer !== null && transfer.isActive;
        }
        catch (error) {
            return false;
        }
    }
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
    createEmergencyTransfer(beneficiaryId, amount, disasterType) {
        const total = BigInt(amount);
        if (total < 0n) {
            throw new Error('Transfer amount must be non-negative');
        }
        const transferId = `emergency_${beneficiaryId}_${Date.now()}`;
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        // Default emergency spending rules
        // Medicine (30%) and Shelter (10%) computed via integer division;
        // Food gets the remaining balance so total category limits sum exactly to 100%.
        const medicineLimit = (total * 30n) / 100n;
        const shelterLimit = (total * 10n) / 100n;
        const foodLimit = total - medicineLimit - shelterLimit;
        const spendingRules = [
            this.createCategoryLimitRule('food', foodLimit.toString()),
            this.createCategoryLimitRule('medicine', medicineLimit.toString()),
            this.createCategoryLimitRule('shelter', shelterLimit.toString()),
            this.createTimeWindowRule(Date.now(), Date.now() + (7 * 24 * 60 * 60 * 1000))
        ];
        const transfer = {
            id: transferId,
            beneficiaryId,
            amount,
            token: 'XLM',
            createdAt: Date.now(),
            expiresAt,
            spendingRules,
            isActive: true,
            spentAmount: '0',
            remainingAmount: amount,
            creator: 'emergency_system',
            purpose: `Emergency assistance for ${disasterType}`
        };
        return { transferId, transfer };
    }
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
    async processPaymentRequest(request, beneficiaryKey) {
        try {
            const validAmount = validateU256Amount(request.amount, 'amount');
            const requestAmountBigInt = BigInt(validAmount);
            // 1. Resolve category
            let category = (request.category || '').trim().toLowerCase();
            if (!category && request.purpose) {
                const classified = (0, purposeTaxonomy_1.categorizePurpose)(request.purpose);
                if (classified && classified !== 'other') {
                    category = classified;
                }
            }
            if (!category) {
                category = 'general';
            }
            // 2. Fetch transfers for beneficiary
            const transfers = await this.listBeneficiaryTransfers(request.beneficiaryId);
            if (!transfers || transfers.length === 0) {
                return {
                    success: false,
                    error: 'No active transfers found for beneficiary',
                };
            }
            const now = Date.now();
            // 3. Filter for active and non-expired transfers
            const activeTransfers = transfers.filter(t => t.isActive && now <= t.expiresAt);
            if (activeTransfers.length === 0) {
                return {
                    success: false,
                    error: 'All transfers for beneficiary are inactive or expired',
                };
            }
            // 4. Filter for token match and sufficient remaining amount
            const fundedTransfers = activeTransfers.filter(t => {
                if (request.token && t.token && t.token !== request.token) {
                    return false;
                }
                try {
                    return BigInt(t.remainingAmount) >= requestAmountBigInt;
                }
                catch {
                    return false;
                }
            });
            if (fundedTransfers.length === 0) {
                return {
                    success: false,
                    error: `No active transfers found with sufficient remaining balance (required: ${request.amount} ${request.token || ''})`.trim(),
                };
            }
            const scoredCandidates = fundedTransfers.map(transfer => {
                let score = 0;
                let eligible = true;
                let reason = '';
                for (const rule of transfer.spendingRules || []) {
                    const ruleType = rule.ruleType;
                    const params = rule.parameters || {};
                    if (ruleType === 'merchant_whitelist') {
                        const allowed = params.merchant_id || params.merchantId || params.merchants || '';
                        const allowedList = allowed.split(',').map(s => s.trim());
                        if (allowed && !allowedList.includes(request.merchantId)) {
                            eligible = false;
                            reason = `Merchant ${request.merchantId} not in whitelist`;
                            break;
                        }
                        score += 10;
                    }
                    else if (ruleType === 'time_window') {
                        const start = params.start_time ? Number(params.start_time) : 0;
                        const end = params.end_time ? Number(params.end_time) : Infinity;
                        if (now < start || now > end) {
                            eligible = false;
                            reason = 'Current time outside transfer spending window';
                            break;
                        }
                        score += 5;
                    }
                    else if (ruleType === 'location_based') {
                        if (request.location && params.location) {
                            if (params.location !== request.location) {
                                eligible = false;
                                reason = `Location ${request.location} does not match required location ${params.location}`;
                                break;
                            }
                            score += 10;
                        }
                    }
                    else if (ruleType === 'category_limit') {
                        const ruleCategory = (params.category || '').toLowerCase();
                        if (ruleCategory === category) {
                            try {
                                const limit = BigInt(rule.limit);
                                const usage = BigInt(rule.currentUsage || '0');
                                const remainingAllowance = limit - usage;
                                if (remainingAllowance < requestAmountBigInt) {
                                    eligible = false;
                                    reason = `Category limit exceeded for category '${category}'`;
                                    break;
                                }
                                score += 50; // High preference for matching category rule with available limit
                            }
                            catch {
                                // Ignore parse errors in heuristic
                            }
                        }
                    }
                }
                // Favor transfers expiring sooner so funds are utilized before expiry
                score += Math.max(0, 100 - Math.floor((transfer.expiresAt - now) / (1000 * 60 * 60 * 24)));
                return { transfer, score, eligible, reason };
            });
            const eligibleCandidates = scoredCandidates
                .filter(c => c.eligible)
                .sort((a, b) => b.score - a.score);
            if (eligibleCandidates.length === 0) {
                const rejectionReason = scoredCandidates[0]?.reason || 'Spending rule restrictions';
                return {
                    success: false,
                    error: `No eligible transfer found matching category '${category}' and merchant '${request.merchantId}': ${rejectionReason}`,
                };
            }
            // 6. Attempt spend on best matching transfer
            const selectedTransfer = eligibleCandidates[0].transfer;
            const success = await this.spend(beneficiaryKey, selectedTransfer.id, request.merchantId, validAmount, category, request.location || 'unknown');
            if (success) {
                return {
                    success: true,
                    transactionId: `txn_${selectedTransfer.id}_${Date.now()}`,
                    transferId: selectedTransfer.id,
                };
            }
            else {
                return {
                    success: false,
                    error: 'Payment rejected by spending rules',
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: `Payment processing failed: ${error}`,
            };
        }
    }
    /**
     * Get transfer statistics
     */
    async getTransferStatistics(transferId) {
        const transfer = await this.getTransfer(transferId);
        const transactions = await this.getTransactions(transferId);
        if (!transfer) {
            throw new errors_1.TransactionError(transferId, 'Transfer not found', { operation: 'get transfer stats' });
        }
        const totalSpent = transfer.spentAmount;
        const remainingAmount = transfer.remainingAmount;
        const totalAmount = transfer.amount;
        const utilizationRate = Number((BigInt(totalSpent) * BigInt(100)) / BigInt(totalAmount));
        const transactionCount = transactions.length;
        const averageTransaction = transactionCount > 0
            ? (BigInt(totalSpent) / BigInt(transactionCount)).toString()
            : '0';
        const isExpired = Date.now() > transfer.expiresAt;
        return {
            totalSpent,
            remainingAmount,
            utilizationRate,
            transactionCount,
            averageTransaction,
            isExpired
        };
    }
    /**
     * Batch create transfers for disaster response
     */
    async batchCreateTransfers(creatorKey, beneficiaryIds, amount, purpose, spendingRules) {
        const results = [];
        for (const beneficiaryId of beneficiaryIds) {
            const transferId = `batch_${beneficiaryId}_${Date.now()}`;
            const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
            try {
                const result = await this.createTransfer(creatorKey, transferId, beneficiaryId, amount, 'XLM', expiresAt, spendingRules, purpose);
                results.push(result);
            }
            catch (error) {
                results.push(`Failed to create transfer for ${beneficiaryId}: ${error}`);
            }
        }
        return results;
    }
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
    async buildOfflineCreateTransfer(sourcePublicKey, transferId, beneficiaryId, amount, token, expiresAt, spendingRules, purpose) {
        const validAmount = validateU256Amount(amount, 'amount');
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('create_transfer', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(transferId), (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(validAmount), (0, stellar_sdk_1.nativeToScVal)(token), (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(spendingRules), (0, stellar_sdk_1.nativeToScVal)(purpose),
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
}
exports.TransferClient = TransferClient;
//# sourceMappingURL=transferClient.js.map