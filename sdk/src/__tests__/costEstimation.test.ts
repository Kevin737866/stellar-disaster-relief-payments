import { BASE_FEE } from 'stellar-sdk';
import {
  estimateContractCost,
  estimateMultipleContractCosts,
  estimateTotalCost,
  CostEstimationClient,
  ContractInteractionType,
  CostEstimate,
} from '../costEstimation';

const BASE = parseInt(BASE_FEE, 10); // 100 stroops

describe('estimateContractCost', () => {
  const allTypes: ContractInteractionType[] = [
    'deployEmergencyFund',
    'triggerDisbursement',
    'registerMerchant',
    'processPayment',
    'createTransfer',
    'spend',
    'createShipment',
    'updateCheckpoint',
    'registerBeneficiary',
    'verifyBeneficiary',
  ];

  it('returns a valid CostEstimate for every supported interaction type', () => {
    for (const type of allTypes) {
      const estimate = estimateContractCost(type);
      expect(estimate).toMatchObject<Partial<CostEstimate>>({
        baseFeeStroops: expect.any(String),
        resourceFeeStroops: expect.any(String),
        totalFeeStroops: expect.any(String),
        totalFeeXLM: expect.any(String),
        requiresMultiSig: expect.any(Boolean),
        signerCount: expect.any(Number),
        description: expect.any(String),
      });
      expect(estimate.description.length).toBeGreaterThan(0);
    }
  });

  it('totalFeeStroops equals baseFeeStroops + resourceFeeStroops', () => {
    for (const type of allTypes) {
      const est = estimateContractCost(type);
      const expected = BigInt(est.baseFeeStroops) + BigInt(est.resourceFeeStroops);
      expect(BigInt(est.totalFeeStroops)).toBe(expected);
    }
  });

  it('totalFeeXLM is correctly derived from totalFeeStroops', () => {
    const est = estimateContractCost('deployEmergencyFund');
    const stroops = BigInt(est.totalFeeStroops);
    const whole = stroops / 10_000_000n;
    const remainder = stroops % 10_000_000n;
    const expected = `${whole}.${remainder.toString().padStart(7, '0')}`;
    expect(est.totalFeeXLM).toBe(expected);
  });

  describe('single-signer operations', () => {
    const singleSignerOps: ContractInteractionType[] = [
      'deployEmergencyFund',
      'registerMerchant',
      'createTransfer',
      'spend',
      'createShipment',
      'updateCheckpoint',
      'registerBeneficiary',
      'verifyBeneficiary',
    ];

    it.each(singleSignerOps)('%s defaults to signerCount=1 and requiresMultiSig=false', (type) => {
      const est = estimateContractCost(type);
      expect(est.signerCount).toBe(1);
      expect(est.requiresMultiSig).toBe(false);
    });
  });

  describe('multi-signer operations', () => {
    it('processPayment defaults to signerCount=2 and requiresMultiSig=true', () => {
      const est = estimateContractCost('processPayment');
      expect(est.signerCount).toBe(2);
      expect(est.requiresMultiSig).toBe(true);
    });

    it('triggerDisbursement defaults to signerCount=2 and requiresMultiSig=true', () => {
      const est = estimateContractCost('triggerDisbursement');
      expect(est.signerCount).toBe(2);
      expect(est.requiresMultiSig).toBe(true);
    });
  });

  describe('options.signerCount override', () => {
    it('overrides default signer count', () => {
      const est = estimateContractCost('deployEmergencyFund', { signerCount: 3 });
      expect(est.signerCount).toBe(3);
      expect(est.requiresMultiSig).toBe(true);
    });

    it('signerCount=1 sets requiresMultiSig=false', () => {
      const est = estimateContractCost('processPayment', { signerCount: 1 });
      expect(est.signerCount).toBe(1);
      expect(est.requiresMultiSig).toBe(false);
    });

    it('baseFeeStroops scales with signerCount', () => {
      const est1 = estimateContractCost('createTransfer', { signerCount: 1 });
      const est3 = estimateContractCost('createTransfer', { signerCount: 3 });
      expect(BigInt(est3.baseFeeStroops)).toBe(BigInt(est1.baseFeeStroops) * 3n);
    });
  });

  describe('options.baseFeeStroops override', () => {
    it('uses custom base fee', () => {
      const est = estimateContractCost('spend', { baseFeeStroops: '200' });
      // resource fee multiplier for 'spend' is 5, signerCount=1
      // baseFee = 200 * 1 = 200, resourceFee = 200 * 5 = 1000, total = 1200
      expect(BigInt(est.baseFeeStroops)).toBe(200n);
      expect(BigInt(est.resourceFeeStroops)).toBe(1000n);
      expect(BigInt(est.totalFeeStroops)).toBe(1200n);
    });
  });

  describe('resource fee multipliers', () => {
    it('deployEmergencyFund has higher resource fee than updateCheckpoint', () => {
      const deploy = estimateContractCost('deployEmergencyFund');
      const update = estimateContractCost('updateCheckpoint');
      expect(BigInt(deploy.resourceFeeStroops)).toBeGreaterThan(BigInt(update.resourceFeeStroops));
    });

    it('resource fee is a positive multiple of base fee', () => {
      for (const type of allTypes) {
        const est = estimateContractCost(type);
        expect(BigInt(est.resourceFeeStroops) % BigInt(BASE)).toBe(0n);
        expect(BigInt(est.resourceFeeStroops)).toBeGreaterThan(0n);
      }
    });
  });

  describe('error handling', () => {
    it('throws for unsupported interaction type', () => {
      expect(() => estimateContractCost('unknownOperation' as ContractInteractionType))
        .toThrow(/Unsupported contract interaction type/);
    });

    it('throws for invalid baseFeeStroops (NaN)', () => {
      expect(() => estimateContractCost('spend', { baseFeeStroops: 'abc' }))
        .toThrow(/Invalid baseFeeStroops/);
    });

    it('throws for negative baseFeeStroops', () => {
      expect(() => estimateContractCost('spend', { baseFeeStroops: '-1' }))
        .toThrow(/Invalid baseFeeStroops/);
    });

    it('throws for signerCount=0', () => {
      expect(() => estimateContractCost('spend', { signerCount: 0 }))
        .toThrow(/Invalid signerCount/);
    });

    it('throws for non-integer signerCount', () => {
      expect(() => estimateContractCost('spend', { signerCount: 1.5 }))
        .toThrow(/Invalid signerCount/);
    });
  });
});

describe('estimateMultipleContractCosts', () => {
  it('returns estimates for each interaction in order', () => {
    const results = estimateMultipleContractCosts([
      { interactionType: 'deployEmergencyFund' },
      { interactionType: 'registerBeneficiary' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].description).toContain('emergency fund');
    expect(results[1].description).toContain('beneficiary');
  });

  it('applies per-interaction options', () => {
    const results = estimateMultipleContractCosts([
      { interactionType: 'spend', options: { signerCount: 3 } },
      { interactionType: 'spend' },
    ]);
    expect(results[0].signerCount).toBe(3);
    expect(results[1].signerCount).toBe(1);
  });

  it('throws for empty array', () => {
    expect(() => estimateMultipleContractCosts([])).toThrow(/non-empty array/);
  });

  it('throws for non-array input', () => {
    expect(() => estimateMultipleContractCosts(null as any)).toThrow(/non-empty array/);
  });
});

describe('estimateTotalCost', () => {
  it('sums all interaction fees correctly', () => {
    const interactions = [
      { interactionType: 'deployEmergencyFund' as ContractInteractionType },
      { interactionType: 'registerBeneficiary' as ContractInteractionType },
      { interactionType: 'createTransfer' as ContractInteractionType },
    ];
    const result = estimateTotalCost(interactions);
    const expectedTotal = result.breakdown.reduce(
      (sum, est) => sum + BigInt(est.totalFeeStroops),
      0n
    );
    expect(BigInt(result.totalFeeStroops)).toBe(expectedTotal);
    expect(result.breakdown).toHaveLength(3);
  });

  it('totalFeeXLM is consistent with totalFeeStroops', () => {
    const result = estimateTotalCost([
      { interactionType: 'spend' as ContractInteractionType },
    ]);
    const stroops = BigInt(result.totalFeeStroops);
    const whole = stroops / 10_000_000n;
    const remainder = stroops % 10_000_000n;
    const expected = `${whole}.${remainder.toString().padStart(7, '0')}`;
    expect(result.totalFeeXLM).toBe(expected);
  });
});

describe('CostEstimationClient', () => {
  let client: CostEstimationClient;

  beforeEach(() => {
    client = new CostEstimationClient();
  });

  it('can be instantiated without config', () => {
    expect(client).toBeInstanceOf(CostEstimationClient);
  });

  it('can be instantiated with a config object', () => {
    const c = new CostEstimationClient({ rpcUrl: 'https://example.com', contractIds: {} });
    expect(c).toBeInstanceOf(CostEstimationClient);
  });

  it('estimateContractCost delegates to the standalone function', () => {
    const est = client.estimateContractCost('createShipment');
    const expected = estimateContractCost('createShipment');
    expect(est).toEqual(expected);
  });

  it('estimateMultipleContractCosts delegates to the standalone function', () => {
    const interactions = [
      { interactionType: 'spend' as ContractInteractionType },
      { interactionType: 'verifyBeneficiary' as ContractInteractionType },
    ];
    expect(client.estimateMultipleContractCosts(interactions))
      .toEqual(estimateMultipleContractCosts(interactions));
  });

  it('estimateTotalCost delegates to the standalone function', () => {
    const interactions = [
      { interactionType: 'processPayment' as ContractInteractionType },
    ];
    expect(client.estimateTotalCost(interactions))
      .toEqual(estimateTotalCost(interactions));
  });
});
