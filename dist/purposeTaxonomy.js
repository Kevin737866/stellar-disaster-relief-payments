"use strict";
/**
 * Disbursement purpose taxonomy helpers.
 *
 * The on-chain contract keeps the original free-text `purpose` for audit and
 * human review. This module provides a deterministic mapping from that text to
 * a small, stable set of reporting categories so that dashboards, duplicate
 * detection and policy guardrails do not depend on exact spelling.
 *
 * Unknown purposes are intentionally mapped to `other` rather than rejected;
 * this keeps the change backwards compatible while still giving operators a
 * structured view of the data. See `docs/purpose-taxonomy.md`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePurpose = normalizePurpose;
exports.isDisbursementPurposeCategory = isDisbursementPurposeCategory;
exports.categorizePurpose = categorizePurpose;
exports.classifyPurpose = classifyPurpose;
exports.validatePurpose = validatePurpose;
const types_1 = require("./types");
const CANONICAL_CATEGORIES = new Set(types_1.DISBURSEMENT_PURPOSE_CATEGORIES);
/**
 * Keyword map used by the classifier. Single-word keywords match a whole
 * normalised token; keywords containing `_` match the full phrase.
 */
const PURPOSE_KEYWORDS = [
    ['food', ['food', 'meal', 'meals', 'nutrition', 'groceries', 'ration', 'rations', 'feeding']],
    ['water', ['water', 'hydration', 'sanitation', 'wash', 'hygiene', 'latrine', 'latrines']],
    ['shelter', ['shelter', 'housing', 'tent', 'tents', 'blanket', 'blankets', 'bedding', 'accommodation']],
    ['medical', ['medical', 'health', 'healthcare', 'medicine', 'medicines', 'hospital', 'clinic', 'treatment', 'first_aid', 'vaccination']],
    ['education', ['education', 'school', 'schooling', 'books', 'tuition', 'learning', 'teacher', 'teachers']],
    ['livelihoods', ['livelihood', 'livelihoods', 'cash_for_work', 'employment', 'income', 'business', 'agriculture', 'seed', 'seeds', 'tools', 'training', 'grant']],
    ['protection', ['protection', 'safety', 'legal', 'psychosocial', 'pss', 'gbv', 'child_protection']],
    ['logistics', ['logistics', 'transport', 'transportation', 'fuel', 'delivery', 'warehouse', 'storage', 'fleet']],
    ['administration', ['administration', 'admin', 'staff', 'salaries', 'overhead', 'operations', 'coordination']],
];
/**
 * Normalise free text to lower-case underscore form.
 *
 * Examples: `"Food supplies"` → `"food_supplies"`,
 * `"cash-for-work"` → `"cash_for_work"`.
 */
function normalizePurpose(raw) {
    return (raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-/]+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}
/** True when the value is one of the canonical category names. */
function isDisbursementPurposeCategory(value) {
    return CANONICAL_CATEGORIES.has(normalizePurpose(value));
}
/**
 * Map a free-text purpose to a canonical reporting category.
 *
 * Matching order:
 * 1. the normalised value is already a canonical category;
 * 2. a known keyword appears as a whole token (or phrase) in the value;
 * 3. otherwise `other`.
 */
function categorizePurpose(raw) {
    const normalized = normalizePurpose(raw);
    if (!normalized)
        return 'other';
    if (CANONICAL_CATEGORIES.has(normalized)) {
        return normalized;
    }
    const tokens = new Set(normalized.split('_').filter(Boolean));
    for (const [category, keywords] of PURPOSE_KEYWORDS) {
        for (const keyword of keywords) {
            const matches = keyword.includes('_')
                ? normalized === keyword ||
                    normalized.startsWith(`${keyword}_`) ||
                    normalized.endsWith(`_${keyword}`) ||
                    normalized.includes(`_${keyword}_`)
                : tokens.has(keyword);
            if (matches)
                return category;
        }
    }
    return 'other';
}
/** Full classification result for a purpose value. */
function classifyPurpose(raw) {
    const normalized = normalizePurpose(raw);
    return {
        raw,
        normalized,
        category: categorizePurpose(raw),
        isCanonical: CANONICAL_CATEGORIES.has(normalized),
    };
}
/**
 * Validate a purpose before submitting it to the contract.
 *
 * Returns `null` when valid, otherwise an operator-readable error message.
 * The contract enforces the same non-empty / max-length rules.
 */
function validatePurpose(raw) {
    if (typeof raw !== 'string' || normalizePurpose(raw) === '') {
        return 'Purpose is required.';
    }
    if (raw.trim().length > types_1.PURPOSE_MAX_LENGTH) {
        return `Purpose must be ${types_1.PURPOSE_MAX_LENGTH} characters or fewer.`;
    }
    return null;
}
//# sourceMappingURL=purposeTaxonomy.js.map