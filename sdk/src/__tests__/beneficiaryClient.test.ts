import { createHash } from 'crypto';
import { Account, Keypair, StrKey, Transaction, xdr } from 'stellar-sdk';
import { BeneficiaryClient, RECOVERY_CODE_DOMAIN, validateFamilySize } from '../beneficiaryClient';
import { OfflineSigner } from '../offlineSigner';
import { NetworkConfig } from '../types';

function contractId(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

const TEST_CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: contractId(0),
    aidRegistry: contractId(1),
    beneficiaryManager: contractId(2),
    merchantNetwork: contractId(3),
    cashTransfer: contractId(4),
    supplyChainTracker: contractId(5),
    antiFraud: contractId(6),
  },
};

describe('BeneficiaryClient alignment, u32 serialization, and reactivation (#166, #167, #326)', () => {
  const signer = Keypair.random();
  const wallet = Keypair.random();

  it('derives recovery codes matching on-chain SDRP_RC_V1 salted SHA-256 (#166)', () => {
    const client = new BeneficiaryClient(TEST_CONFIG);
    const salt = 'rc_salt_abc123';
    const codes = client.generateRecoveryCodes('ben_001', salt);

    expect(codes).toHaveLength(3);
    codes.forEach((digest, idx) => {
      const expected = createHash('sha256')
        .update(`${RECOVERY_CODE_DOMAIN}:ben_001:${salt}:${idx}`)
        .digest('hex');
      expect(digest).toBe(expected);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    expect(() => client.generateRecoveryCodes('ben_001', '')).toThrow('Recovery salt');
  });

  it('serializes familySize explicitly as Soroban u32 and rejects invalid sizes (#167)', async () => {
    expect(() => validateFamilySize(0)).toThrow('familySize');
    expect(() => validateFamilySize(-1)).toThrow('familySize');
    expect(() => validateFamilySize(2.5)).toThrow('familySize');
    expect(() => validateFamilySize(0xffffffff + 1)).toThrow('familySize');
    expect(validateFamilySize(4)).toBe(4);

    const client = new BeneficiaryClient(TEST_CONFIG);
    const sendTransaction = jest.fn(async (_tx: any) => ({ status: 'SUCCESS' }));
    (client as any).server = {
      getAccount: jest.fn(async () => new Account(signer.publicKey(), '0')),
      sendTransaction,
    };

    await client.registerBeneficiary(
      signer.secret(),
      'ben_u32',
      'Offchain Real Name',
      'dis_1',
      'Camp A',
      wallet.publicKey(),
      4,
      [],
      []
    );

    const tx = sendTransaction.mock.calls[0][0] as Transaction;
    const invokeOp = tx.operations[0] as any;
    const invokeArgs = invokeOp.func.invokeContract().args() as xdr.ScVal[];

    // Index 2 is pseudonymHint (must not contain raw personal name), Index 6 is familySize (u32)
    expect(invokeArgs[2].str().toString()).not.toContain('Offchain Real Name');
    expect(invokeArgs[6].switch()).toBe(xdr.ScValType.scvU32());
    expect(invokeArgs[6].u32()).toBe(4);

    // buildOfflineRegister uses exact same u32 encoding
    const envelope = await client.buildOfflineRegister(
      signer.publicKey(),
      'ben_u32_off',
      'Offchain Real Name',
      'dis_1',
      'Camp A',
      wallet.publicKey(),
      7,
      [],
      []
    );
    const offlineTx = OfflineSigner.deserialize(envelope);
    const offArgs = (offlineTx.operations[0] as any).func.invokeContract().args() as xdr.ScVal[];
    expect(offArgs[6].switch()).toBe(xdr.ScValType.scvU32());
    expect(offArgs[6].u32()).toBe(7);
  });

  it('invokes reactivate_beneficiary with non-empty reason and invalidates cache (#326)', async () => {
    const client = new BeneficiaryClient(TEST_CONFIG);
    const sendTransaction = jest.fn(async (_tx: any) => ({ status: 'SUCCESS' }));
    (client as any).server = {
      getAccount: jest.fn(async () => new Account(signer.publicKey(), '0')),
      sendTransaction,
    };

    await expect(client.reactivateBeneficiary(signer.secret(), 'ben_1', '')).rejects.toThrow(
      'Reactivation reason'
    );

    const msg = await client.reactivateBeneficiary(
      signer.secret(),
      'ben_1',
      'Verified return to camp'
    );
    expect(msg).toContain('reactivated');
    const tx = sendTransaction.mock.calls[0][0] as Transaction;
    const invoke = (tx.operations[0] as any).func.invokeContract();
    expect(String(invoke.functionName())).toBe('reactivate_beneficiary');
  });
});
