import { Account, Keypair, StrKey, Transaction, nativeToScVal } from 'stellar-sdk';
import {
  AidClient,
  DEFAULT_BASE_FEE,
  OFFLINE_INFINITE_TIMEOUT,
} from '../aidClient';
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

describe('AidClient reliability and fee configuration (#162-#165)', () => {
  const source = Keypair.random();
  const beneficiary = Keypair.random();

  describe('#162 triggerBatchDisbursement result parsing', () => {
    it('extracts disbursement IDs from contract returnValue ScVal', async () => {
      const client = new AidClient(TEST_CONFIG);
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
        sendTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          returnValue: nativeToScVal(['disb_1', 'disb_2']),
        })),
      };

      const ids = await client.triggerBatchDisbursement(
        source.secret(),
        'fund_1',
        [{ beneficiary: beneficiary.publicKey(), amount: '25', purpose: 'food' }],
        [source.publicKey()]
      );

      expect(ids).toEqual(['disb_1', 'disb_2']);
    });

    it('rejects malformed or non-string-array return values cleanly', async () => {
      const client = new AidClient(TEST_CONFIG);
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
        sendTransaction: jest.fn(async () => ({
          status: 'SUCCESS',
          resultMetaXdr: 'not-valid-xdr',
        })),
      };

      await expect(
        client.triggerBatchDisbursement(
          source.secret(),
          'fund_1',
          [{ beneficiary: beneficiary.publicKey(), amount: '25', purpose: 'food' }],
          [source.publicKey()]
        )
      ).rejects.toThrow('Failed to parse batch disbursement IDs');
    });

    it('rejects missing transaction return payload instead of silently misinterpreting', async () => {
      const client = new AidClient(TEST_CONFIG);
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
        sendTransaction: jest.fn(async () => ({ status: 'SUCCESS' })),
      };

      await expect(
        client.triggerBatchDisbursement(
          source.secret(),
          'fund_1',
          [{ beneficiary: beneficiary.publicKey(), amount: '25', purpose: 'food' }],
          [source.publicKey()]
        )
      ).rejects.toThrow('without a parseable return value');
    });
  });

  describe('#163 configurable and adaptive fees', () => {
    it('uses DEFAULT_BASE_FEE by default and supports estimator + per-call override', async () => {
      const feeEstimator = jest.fn(async () => '750');
      const client = new AidClient(TEST_CONFIG, { feeEstimator });
      const sendTransaction = jest.fn(async (_tx: any) => ({ status: 'SUCCESS' }));
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
        sendTransaction,
      };

      expect(DEFAULT_BASE_FEE).toBe('100');

      await client.triggerDisbursement(
        source.secret(),
        'fund_1',
        beneficiary.publicKey(),
        '100',
        'water',
        [source.publicKey()]
      );
      expect(feeEstimator).toHaveBeenCalledWith('submit_disbursement');
      const txEstimated = sendTransaction.mock.calls[0][0] as Transaction;
      expect(txEstimated.fee).toBe('750');

      await client.triggerDisbursement(
        source.secret(),
        'fund_1',
        beneficiary.publicKey(),
        '100',
        'water',
        [source.publicKey()],
        { fee: '2500' }
      );
      const txOverride = sendTransaction.mock.calls[1][0] as Transaction;
      expect(txOverride.fee).toBe('2500');
    });

    it('uses server.getFeeStats() when available and falls back safely', async () => {
      const client = new AidClient(TEST_CONFIG, { baseFee: '200' });
      const sendTransaction = jest.fn(async (_tx: any) => ({ status: 'SUCCESS' }));
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
        getFeeStats: jest.fn(async () => ({ sorobanInclusionFee: { p50: '1250' } })),
        sendTransaction,
      };

      await client.deployEmergencyFund(
        source.secret(),
        'fund_fee',
        'Relief',
        'Desc',
        '5000',
        'flood',
        'coast',
        Date.now() + 60_000,
        [source.publicKey()],
        1
      );
      const tx = sendTransaction.mock.calls[0][0] as Transaction;
      expect(tx.fee).toBe('1250');
    });
  });

  describe('#164 monitorFundPool monetary normalization', () => {
    it('normalizes string, number, and bigint monetary values', async () => {
      const client = new AidClient(TEST_CONFIG);
      (client as any).contract = {
        call: jest.fn(async () => ({ result: { retval: null } })),
      };

      jest.spyOn(client, 'getFund').mockResolvedValueOnce({
        id: 'f1',
        name: 'F1',
        description: 'D',
        totalAmount: 5000 as any,
        releasedAmount: BigInt(1250) as any,
        disasterType: 'flood',
        geographicScope: 'zone',
        createdAt: 1,
        expiresAt: 9999999999,
        isActive: true,
        releaseTriggers: [],
        requiredSignatures: 1,
      });

      const pool = await client.monitorFundPool('f1');
      expect(pool).toEqual({
        totalAmount: '5000',
        releasedAmount: '1250',
        remainingAmount: '3750',
        isActive: true,
        expiresAt: 9999999999,
      });
    });

    it('rejects non-numeric, empty, or negative monetary fields', async () => {
      const client = new AidClient(TEST_CONFIG);
      for (const bad of ['', '12.5', '-10', null]) {
        jest.spyOn(client, 'getFund').mockResolvedValueOnce({
          id: 'f_bad',
          name: 'F',
          description: 'D',
          totalAmount: bad as any,
          releasedAmount: '0',
          disasterType: 'flood',
          geographicScope: 'zone',
          createdAt: 1,
          expiresAt: 9999999999,
          isActive: true,
          releaseTriggers: [],
          requiredSignatures: 1,
        });
        await expect(client.monitorFundPool('f_bad')).rejects.toThrow('Invalid monetary field totalAmount');
      }
    });
  });

  describe('#165 offline builder timeout documentation and override', () => {
    it('uses OFFLINE_INFINITE_TIMEOUT (0) by default and supports bounded overrides', async () => {
      const client = new AidClient(TEST_CONFIG);
      (client as any).server = {
        getAccount: jest.fn(async () => new Account(source.publicKey(), '0')),
      };

      expect(OFFLINE_INFINITE_TIMEOUT).toBe(0);

      const defaultEnv = await client.buildOfflineDisbursement(
        source.publicKey(),
        'fund_1',
        beneficiary.publicKey(),
        '50',
        'medical',
        [source.publicKey()]
      );
      const defaultTx = OfflineSigner.deserialize(defaultEnv);
      expect(defaultTx.timeBounds?.maxTime ?? '0').toBe('0');

      const boundedEnv = await client.buildOfflineDeployFund(
        source.publicKey(),
        'fund_2',
        'Relief',
        'Desc',
        '1000',
        'storm',
        'island',
        9999999999,
        [source.publicKey()],
        1,
        { timeoutSeconds: 600, fee: '500' }
      );
      const boundedTx = OfflineSigner.deserialize(boundedEnv);
      expect(boundedTx.fee).toBe('500');
      expect(Number(boundedTx.timeBounds?.maxTime)).toBeGreaterThan(0);

      await expect(
        client.buildOfflineDisbursement(
          source.publicKey(),
          'fund_1',
          beneficiary.publicKey(),
          '50',
          'medical',
          [source.publicKey()],
          { timeoutSeconds: -5 }
        )
      ).rejects.toThrow('Invalid timeoutSeconds');
    });
  });
});
