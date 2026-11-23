"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AidClient = exports.MIN_BATCH_SIZE = exports.MAX_BATCH_SIZE = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const { Server } = stellar_sdk_1.SorobanRpc;
const offlineSigner_1 = require("./offlineSigner");
const types_1 = require("./types");
const readCache_1 = require("./readCache");
const validation_1 = require("./validation");
const retry_1 = require("./retry");
/**
 * Maximum number of entries accepted by the on-chain batch disbursement
 * contract. Keep this in sync with `MAX_BATCH_SIZE` in `src/aid_registry.rs`.
 */
exports.MAX_BATCH_SIZE = types_1.BATCH_MAX_SIZE;
/** A batch must contain at least one entry. */
exports.MIN_BATCH_SIZE = 1;
class AidClient {
    constructor(config) {
        this.config = config;
        this.server = new Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.aidRegistry);
        this.cache = new readCache_1.ReadCache(config);
    }
    /**
     * Deploy emergency fund for disaster response
     */
    async deployEmergencyFund(adminKey, fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, releaseTriggers, requiredSignatures) {
        (0, validation_1.validateAddressList)(releaseTriggers, 'releaseTriggers');
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(adminKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("create_fund", ...[
            new stellar_sdk_1.Address(adminKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId),
            (0, stellar_sdk_1.nativeToScVal)(name),
            (0, stellar_sdk_1.nativeToScVal)(description),
            (0, stellar_sdk_1.nativeToScVal)(totalAmount),
            (0, stellar_sdk_1.nativeToScVal)(disasterType),
            (0, stellar_sdk_1.nativeToScVal)(geographicScope),
            (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(releaseTriggers),
            (0, stellar_sdk_1.nativeToScVal)(requiredSignatures)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate('aid:listActiveFunds');
            return fundId;
        }
        else {
            throw new Error(`Failed to deploy emergency fund: ${result.status}`);
        }
    }
    /**
     * Trigger disbursement with multi-sig approval
     */
    async triggerDisbursement(requesterKey, fundId, beneficiary, amount, purpose, approvers) {
        (0, validation_1.validateAddress)(beneficiary, 'beneficiary');
        (0, validation_1.validateAddressList)(approvers, 'approvers');
        const requesterKeypair = stellar_sdk_1.Keypair.fromSecret(requesterKey);
        const requesterAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(requesterKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(requesterAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("submit_disbursement", ...[
            new stellar_sdk_1.Address(requesterKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId),
            (0, stellar_sdk_1.nativeToScVal)(beneficiary),
            (0, stellar_sdk_1.nativeToScVal)(amount),
            (0, stellar_sdk_1.nativeToScVal)(purpose),
            (0, stellar_sdk_1.nativeToScVal)(approvers)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(requesterKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            this.cache.invalidate(`aid:fund:${fundId}`);
            this.cache.invalidate(`aid:disbursements:${fundId}`);
            return `Disbursement submitted for fund ${fundId}`;
        }
        else {
            throw new Error(`Failed to submit disbursement: ${result.status}`);
        }
    }
    /**
     * Submit multiple disbursements atomically in a single transaction.
     * All entries succeed or all fail — no partial state.
     *
     * Batches are limited to `MAX_BATCH_SIZE` (100) entries, matching the
     * on-chain limit. Split larger requests into multiple atomic batches.
     *
     * @param requesterKey  Secret key of the requester
     * @param fundId        Fund to draw from
     * @param entries       Array of { beneficiary, amount, purpose }
     * @param approvers     Secret keys of multi-sig approvers
     * @returns Array of disbursement IDs created on-chain
     */
    async triggerBatchDisbursement(requesterKey, fundId, entries, approvers) {
        if (entries.length < exports.MIN_BATCH_SIZE) {
            throw new Error('Batch must contain at least one entry');
        }
        if (entries.length > exports.MAX_BATCH_SIZE) {
            throw new Error(`Batch contains ${entries.length} entries; the maximum is ${exports.MAX_BATCH_SIZE}. ` +
                'Split the request into smaller batches.');
        }
        const requesterKeypair = stellar_sdk_1.Keypair.fromSecret(requesterKey);
        const requesterAccount = await this.server.getAccount(requesterKeypair.publicKey());
        // Build the entries as a Vec of tuples for the contract call
        const entriesScVal = (0, stellar_sdk_1.nativeToScVal)(entries.map(e => [e.beneficiary, e.amount, e.purpose]));
        const tx = new stellar_sdk_1.TransactionBuilder(requesterAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('submit_batch_disbursement', ...[
            new stellar_sdk_1.Address(requesterKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId),
            entriesScVal,
            (0, stellar_sdk_1.nativeToScVal)(approvers),
        ]))
            .setTimeout(30)
            .build();
        tx.sign(requesterKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            const ids = (0, stellar_sdk_1.scValToNative)(result.resultMetaXdr);
            return ids ?? [];
        }
        else {
            throw new Error(`Batch disbursement failed: ${result.status}`);
        }
    }
    /**
     * Get fund details
     */
    async getFund(fundId) {
        return this.cache.get(`aid:fund:${fundId}`, async () => {
            try {
                const result = await this.contract.call("get_fund", (0, stellar_sdk_1.nativeToScVal)(fundId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get fund:', error);
                return null;
            }
        });
    }
    /**
     * List all active emergency funds
     */
    async listActiveFunds() {
        return this.cache.get('aid:listActiveFunds', async () => {
            try {
                const result = await this.contract.call("list_active_funds");
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to list active funds:', error);
                return [];
            }
        });
    }
    /**
     * Get disbursement history for a fund
     */
    async getDisbursements(fundId) {
        return this.cache.get(`aid:disbursements:${fundId}`, async () => {
            try {
                const result = await this.contract.call("get_disbursements", (0, stellar_sdk_1.nativeToScVal)(fundId));
                return (0, stellar_sdk_1.scValToNative)(result.result.retval);
            }
            catch (error) {
                console.error('Failed to get disbursements:', error);
                return [];
            }
        });
    }
    /**
     * Monitor fund pool status
     */
    async monitorFundPool(fundId) {
        const fund = await this.getFund(fundId);
        if (!fund) {
            throw new Error(`Fund ${fundId} not found`);
        }
        const totalAmount = BigInt(fund.totalAmount);
        const releasedAmount = BigInt(fund.releasedAmount);
        const remainingAmount = totalAmount - releasedAmount;
        return {
            totalAmount: fund.totalAmount,
            releasedAmount: fund.releasedAmount,
            remainingAmount: remainingAmount.toString(),
            isActive: fund.isActive,
            expiresAt: fund.expiresAt
        };
    }
    /**
     * Cleanup expired funds
     */
    async cleanupExpiredFunds(adminKey) {
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        const adminAccount = await (0, retry_1.withRetry)(() => this.server.getAccount(adminKeypair.publicKey()));
        const tx = new stellar_sdk_1.TransactionBuilder(adminAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("cleanup_expired_funds"))
            .setTimeout(30)
            .build();
        tx.sign(adminKeypair);
        const result = await (0, retry_1.withRetry)(() => this.server.sendTransaction(tx));
        if (result.status === 'SUCCESS') {
            return 'Expired funds cleaned up successfully';
        }
        else {
            throw new Error(`Failed to cleanup expired funds: ${result.status}`);
        }
    }
    /**
     * Create multiple funds for large-scale disaster response
     */
    async deployRapidResponse(adminKey, disasterId, disasterType, affectedArea, totalBudget, fundCategories) {
        const fundIds = [];
        const adminKeypair = stellar_sdk_1.Keypair.fromSecret(adminKey);
        for (const category of fundCategories) {
            const fundId = `${disasterId}_${category.name.toLowerCase().replace(/\s+/g, '_')}`;
            const amount = (BigInt(totalBudget) * BigInt(category.percentage) / BigInt(100)).toString();
            try {
                await this.deployEmergencyFund(adminKey, fundId, `${category.name} - ${disasterId}`, category.description, amount, disasterType, affectedArea, Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now
                [adminKeypair.publicKey()], 1);
                fundIds.push(fundId);
            }
            catch (error) {
                console.error(`Failed to create fund ${fundId}:`, error);
            }
        }
        return fundIds;
    }
    /**
     * Generate a minimised QR code for fund information (offline access).
     *
     * Payload contains only the fields a scanner needs to look up and display
     * the fund.  Financial amounts and internal state are intentionally omitted
     * — the scanner should query the contract for live details after verifying
     * `fundId`.
     *
     * The QR carries its own `qrExpiresAt` expiry (default 24 h) that is
     * independent of the fund's own `expiresAt`, so a QR printed for a field
     * agent cannot be replayed indefinitely even if the fund is still active.
     *
     * @param fundId  - Opaque fund identifier.
     * @param fund    - Fund record to generate the QR for.
     * @param qrTtlMs - Optional QR-specific TTL in milliseconds (default 24 h).
     * @returns JSON string representing the minimised QR payload.
     *
     * @see docs/QR_PAYLOADS.md for full field documentation and scanner guidance.
     */
    generateFundQRCode(fundId, fund, qrTtlMs = 24 * 60 * 60 * 1000) {
        const qrData = {
            type: 'emergency_fund',
            v: 1, // payload version for future schema evolution
            fundId,
            disasterType: fund.disasterType,
            // NOTE: fund.name is included as a human-readable label only; no PII.
            // fund.totalAmount and fund.releasedAmount are intentionally omitted —
            // the scanner must query the contract for live financial state.
            name: fund.name,
            // fund.expiresAt: when the fund itself expires (do not use for QR validation)
            fundExpiresAt: fund.expiresAt,
            // qrExpiresAt: when this specific QR image expires (independent of fund)
            qrExpiresAt: Date.now() + qrTtlMs,
            timestamp: Date.now()
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate a fund QR code.
     *
     * Checks both the QR-specific expiry (`qrExpiresAt`) and confirms the fund
     * still exists on-chain.  Returns `false` for any expired or invalid QR.
     */
    async validateFundQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'emergency_fund') {
                return false;
            }
            // Check QR-specific expiry first (fast, no network call)
            if (data.qrExpiresAt && Date.now() > data.qrExpiresAt) {
                return false;
            }
            // Legacy: also respect fund-level expiry if qrExpiresAt is absent
            if (!data.qrExpiresAt && data.expiresAt && Date.now() > data.expiresAt) {
                return false;
            }
            // Verify fund exists on chain
            return (await this.getFund(data.fundId)) !== null;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Get fund statistics for reporting
     */
    async getFundStatistics(fundId) {
        const disbursements = await this.getDisbursements(fundId);
        const beneficiaries = new Set(disbursements.map(d => d.beneficiary));
        const totalAmount = disbursements.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
        const averageDisbursement = disbursements.length > 0
            ? (totalAmount / BigInt(disbursements.length)).toString()
            : '0';
        const lastDisbursement = disbursements.length > 0
            ? Math.max(...disbursements.map(d => d.timestamp))
            : null;
        return {
            totalDisbursements: disbursements.length,
            totalAmountDisbursed: totalAmount.toString(),
            averageDisbursement,
            lastDisbursement,
            beneficiariesReached: beneficiaries.size
        };
    }
    /**
     * Build an unsigned transaction for deploying an emergency fund.
     * Returns an OfflineEnvelope that can be signed offline and submitted later.
     */
    async buildOfflineDeployFund(sourcePublicKey, fundId, name, description, totalAmount, disasterType, geographicScope, expiresAt, releaseTriggers, requiredSignatures) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('create_fund', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId), (0, stellar_sdk_1.nativeToScVal)(name), (0, stellar_sdk_1.nativeToScVal)(description),
            (0, stellar_sdk_1.nativeToScVal)(totalAmount), (0, stellar_sdk_1.nativeToScVal)(disasterType),
            (0, stellar_sdk_1.nativeToScVal)(geographicScope), (0, stellar_sdk_1.nativeToScVal)(expiresAt),
            (0, stellar_sdk_1.nativeToScVal)(releaseTriggers), (0, stellar_sdk_1.nativeToScVal)(requiredSignatures),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
    }
    /**
     * Build an unsigned transaction for triggering a disbursement.
     */
    async buildOfflineDisbursement(sourcePublicKey, fundId, beneficiary, amount, purpose, approvers) {
        const sourceAccount = await this.server.getAccount(sourcePublicKey);
        const tx = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call('submit_disbursement', ...[
            new stellar_sdk_1.Address(sourcePublicKey).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(fundId), (0, stellar_sdk_1.nativeToScVal)(beneficiary),
            (0, stellar_sdk_1.nativeToScVal)(amount), (0, stellar_sdk_1.nativeToScVal)(purpose), (0, stellar_sdk_1.nativeToScVal)(approvers),
        ]))
            .setTimeout(0)
            .build();
        return offlineSigner_1.OfflineSigner.serialize(tx);
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return stellar_sdk_1.Networks.TESTNET;
            case 'mainnet':
                return stellar_sdk_1.Networks.PUBLIC;
            case 'standalone':
                return stellar_sdk_1.Networks.STANDALONE;
            default:
                throw new Error('Unsupported network');
        }
    }
}
exports.AidClient = AidClient;
//# sourceMappingURL=aidClient.js.map