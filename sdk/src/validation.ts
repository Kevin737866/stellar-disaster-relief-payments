import { StrKey } from 'stellar-sdk';

function isValidStellarAddress(address: string): boolean {
  return (
    StrKey.isValidEd25519PublicKey(address) ||
    StrKey.isValidContract(address)
  );
}

/**
 * Validates a single Stellar address string.
 * Throws a descriptive error if the address is empty, not a string, or malformed.
 */
export function validateAddress(address: string, fieldName = 'address'): void {
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
export function validateAddressList(addresses: string[], fieldName = 'addresses'): void {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty array of Stellar addresses`);
  }
  addresses.forEach((addr, i) => validateAddress(addr, `${fieldName}[${i}]`));
}
