"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAddress = validateAddress;
exports.validateAddressList = validateAddressList;
const stellar_sdk_1 = require("stellar-sdk");
function isValidStellarAddress(address) {
    // Accept standard public keys (G...), contract addresses (C...),
    // and muxed account IDs (M...) which are base32-encoded like other StrKey types.
    if (stellar_sdk_1.StrKey.isValidEd25519PublicKey(address) || stellar_sdk_1.StrKey.isValidContract(address)) {
        return true;
    }
    // Some versions of `stellar-sdk` expose a dedicated muxed validator (e.g. isValidMuxedAccountId).
    // Use it if available to perform accurate validation.
    const anyStrKey = stellar_sdk_1.StrKey;
    if (typeof anyStrKey.isValidMuxedAccountId === 'function') {
        try {
            if (anyStrKey.isValidMuxedAccountId(address))
                return true;
        }
        catch (_) {
            // fallthrough to regex check
        }
    }
    // Fallback: basic format check for muxed addresses (starts with 'M' and uses base32 chars).
    // This is intentionally permissive for older SDK versions that lack muxed validation.
    const trimmed = address.trim();
    const muxedRegex = /^[M][A-Z2-7]{55}$/;
    return muxedRegex.test(trimmed);
}
/**
 * Validates a single Stellar address string.
 * Throws a descriptive error if the address is empty, not a string, or malformed.
 */
function validateAddress(address, fieldName = 'address') {
    if (!address || typeof address !== 'string' || address.trim() === '') {
        throw new Error(`Invalid ${fieldName}: address must be a non-empty string`);
    }
    if (!isValidStellarAddress(address.trim())) {
        throw new Error(`Invalid ${fieldName}: "${address}" is not a valid Stellar address`);
    }
}
/**
 * Validates an array of Stellar address strings.
 * Throws if the array is empty or any element is invalid.
 */
function validateAddressList(addresses, fieldName = 'addresses') {
    if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new Error(`Invalid ${fieldName}: must be a non-empty array of Stellar addresses`);
    }
    addresses.forEach((addr, i) => validateAddress(addr, `${fieldName}[${i}]`));
}
//# sourceMappingURL=validation.js.map