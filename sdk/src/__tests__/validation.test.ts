import { validateAddress, validateAddressList } from '../validation';

// Valid Stellar public keys (G... addresses)
const VALID_ADDRESS = 'GC2H33LY56GNCN5TYBSX5WHCXXVY67QL7WLYOSZQ222WP7ZYO57GPNBR';
const VALID_ADDRESS_2 = 'GB76YDFBKFMASHFYWJWK3C33M6IF76DOLFCFN5V6VJT3XLOJQTBQMEJV';
// Valid Stellar contract address (C... address)
const VALID_CONTRACT_ADDRESS = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
// A muxed-style address: take a valid G... public key and replace leading 'G' with 'M'
const VALID_MUXED_ADDRESS = 'MC2H33LY56GNCN5TYBSX5WHCXXVY67QL7WLYOSZQ222WP7ZYO57GPNBR';

describe('validateAddress', () => {
  it('accepts a valid Stellar address', () => {
    expect(() => validateAddress(VALID_ADDRESS)).not.toThrow();
  });

  it('accepts a valid contract address', () => {
    expect(() => validateAddress(VALID_CONTRACT_ADDRESS, 'contractAddress')).not.toThrow();
  });

  it('accepts a valid address with custom field name', () => {
    expect(() => validateAddress(VALID_ADDRESS, 'walletAddress')).not.toThrow();
  });

  it('accepts a muxed (M...) address', () => {
    expect(() => validateAddress(VALID_MUXED_ADDRESS, 'muxed')).not.toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => validateAddress('')).toThrow('must be a non-empty string');
  });

  it('rejects a whitespace-only string', () => {
    expect(() => validateAddress('   ')).toThrow('must be a non-empty string');
  });

  it('rejects a malformed address (too short)', () => {
    expect(() => validateAddress('GABC123')).toThrow('is not a valid Stellar address');
  });

  it('rejects a random string', () => {
    expect(() => validateAddress('not-an-address')).toThrow('is not a valid Stellar address');
  });

  it('rejects an address starting with wrong prefix', () => {
    // Stellar public keys start with G; S... are secret keys
    expect(() => validateAddress('SAEZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN')).toThrow(
      'is not a valid Stellar address'
    );
  });

  it('includes the field name in the error message', () => {
    expect(() => validateAddress('', 'beneficiary')).toThrow('beneficiary');
  });
});

describe('validateAddressList', () => {
  it('accepts a list with one valid address', () => {
    expect(() => validateAddressList([VALID_ADDRESS])).not.toThrow();
  });

  it('accepts a list with multiple valid addresses', () => {
    expect(() => validateAddressList([VALID_ADDRESS, VALID_ADDRESS_2])).not.toThrow();
  });

  it('rejects an empty array', () => {
    expect(() => validateAddressList([])).toThrow('must be a non-empty array');
  });

  it('rejects a list containing an invalid address', () => {
    expect(() => validateAddressList([VALID_ADDRESS, 'bad-address'])).toThrow(
      'is not a valid Stellar address'
    );
  });

  it('rejects a list containing an empty string', () => {
    expect(() => validateAddressList([VALID_ADDRESS, ''])).toThrow('must be a non-empty string');
  });

  it('includes the field name in the error message', () => {
    expect(() => validateAddressList([], 'releaseTriggers')).toThrow('releaseTriggers');
  });

  it('includes the index in the error for invalid element', () => {
    expect(() => validateAddressList([VALID_ADDRESS, 'bad'], 'approvers')).toThrow('approvers[1]');
  });
});
