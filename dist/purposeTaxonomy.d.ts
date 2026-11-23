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
import { DisbursementPurposeCategory, PurposeClassification } from './types';
/**
 * Normalise free text to lower-case underscore form.
 *
 * Examples: `"Food supplies"` → `"food_supplies"`,
 * `"cash-for-work"` → `"cash_for_work"`.
 */
export declare function normalizePurpose(raw: string): string;
/** True when the value is one of the canonical category names. */
export declare function isDisbursementPurposeCategory(value: string): value is DisbursementPurposeCategory;
/**
 * Map a free-text purpose to a canonical reporting category.
 *
 * Matching order:
 * 1. the normalised value is already a canonical category;
 * 2. a known keyword appears as a whole token (or phrase) in the value;
 * 3. otherwise `other`.
 */
export declare function categorizePurpose(raw: string): DisbursementPurposeCategory;
/** Full classification result for a purpose value. */
export declare function classifyPurpose(raw: string): PurposeClassification;
/**
 * Validate a purpose before submitting it to the contract.
 *
 * Returns `null` when valid, otherwise an operator-readable error message.
 * The contract enforces the same non-empty / max-length rules.
 */
export declare function validatePurpose(raw: string): string | null;
//# sourceMappingURL=purposeTaxonomy.d.ts.map