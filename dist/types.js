"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BATCH_MAX_SIZE = exports.PURPOSE_MAX_LENGTH = exports.DISBURSEMENT_PURPOSE_CATEGORIES = void 0;
// ─── Disbursement purpose taxonomy ───────────────────────────────────────────
/**
 * Canonical reporting categories for disbursement purposes.
 *
 * The contract continues to store the operator-entered `purpose` string for
 * auditability, but every purpose is mapped to one of these categories so that
 * reporting, duplicate-intent detection and guardrails do not depend on
 * free-text spelling.
 */
exports.DISBURSEMENT_PURPOSE_CATEGORIES = [
    'food',
    'water',
    'shelter',
    'medical',
    'education',
    'livelihoods',
    'protection',
    'logistics',
    'administration',
    'other',
];
/** Maximum accepted length of the free-text purpose field. */
exports.PURPOSE_MAX_LENGTH = 120;
/**
 * Maximum number of operations in one batch transaction and entries in one
 * batch disbursement. Matches Stellar's 100-operation limit and the on-chain
 * `MAX_BATCH_SIZE` in `src/aid_registry.rs`.
 */
exports.BATCH_MAX_SIZE = 100;
//# sourceMappingURL=types.js.map