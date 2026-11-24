import { DonorTransparencyClient, TaxDeductionPolicy } from './donorTransparency';

const FUND_ID = 'fund-tax-receipt';
const DONOR = 'GDONORADDRESS';
const DONATION_DATE = Date.UTC(2024, 0, 15, 12, 0, 0);
const ISSUE_DATE = DONATION_DATE + 10 * 24 * 60 * 60 * 1000;
const FULL_DEDUCTION: TaxDeductionPolicy = { jurisdiction: 'US', deductiblePercentage: 100 };

class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

describe('donor tax receipts', () => {
  let now: jest.SpyInstance<number, []>;

  function resetStorage(): void {
    (global as any).localStorage = new MemoryStorage();
  }

  beforeEach(() => {
    resetStorage();
    now = jest.spyOn(Date, 'now').mockReturnValue(ISSUE_DATE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function recordFundCreation(
    client: DonorTransparencyClient,
    amount: string = '10000',
    timestamp: number = DONATION_DATE
  ): Promise<void> {
    now.mockReturnValue(timestamp);
    await client.createTransparencyEntry(FUND_ID, 'fund_created', amount, 'initial contribution');
    now.mockReturnValue(ISSUE_DATE);
  }

  async function generateReceipt(
    client: DonorTransparencyClient,
    policy?: TaxDeductionPolicy
  ) {
    return client.generateTaxReceipt(FUND_ID, DONOR, 'Test Donor', 'donor@example.org', policy);
  }

  it('uses the recorded contribution date when a receipt is generated later', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client, '10000');

    const receipt = await generateReceipt(client, FULL_DEDUCTION);

    expect(receipt.donationDate).toBe(DONATION_DATE);
    expect(receipt.receiptDate).toBe(ISSUE_DATE);
    expect(receipt.totalDonation).toBe('10000');
    expect(receipt.taxDeductibleAmount).toBe('10000');
    expect(receipt.taxPolicy).toEqual(FULL_DEDUCTION);

    const dashboard = await client.generateDonorDashboard(DONOR);
    expect(dashboard.taxReceipts).toEqual([receipt]);
  });

  it('rejects a receipt when no fund-creation record exists', async () => {
    const client = new DonorTransparencyClient();
    await client.createTransparencyEntry(FUND_ID, 'allocation', '10000', 'allocated');

    await expect(generateReceipt(client, FULL_DEDUCTION)).rejects.toThrow(
      /No fund-creation record/
    );
  });

  it('rejects a receipt when fund-creation records are duplicated', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client, '10000', DONATION_DATE);
    await recordFundCreation(client, '12000', DONATION_DATE + 60_000);

    await expect(generateReceipt(client, FULL_DEDUCTION)).rejects.toThrow(
      /Multiple fund-creation records/
    );
  });

  it('requires an explicit tax policy before claiming a deduction', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client);

    await expect(generateReceipt(client)).rejects.toThrow(/explicit tax policy/);
  });

  it('rejects a policy without a jurisdiction', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client);

    await expect(
      generateReceipt(client, { jurisdiction: '   ', deductiblePercentage: 100 })
    ).rejects.toThrow(/jurisdiction/);
  });

  it('emits a non-claiming receipt for a zero-percent policy', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client);

    const receipt = await generateReceipt(client, { jurisdiction: 'GB', deductiblePercentage: 0 });

    expect(receipt.taxDeductibleAmount).toBe('0');
    expect(receipt.totalDonation).toBe('10000');
    expect(receipt.taxPolicy).toEqual({ jurisdiction: 'GB', deductiblePercentage: 0 });
  });

  it('floors partial deductions without floating-point money errors', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client, '12345');

    const receipt = await generateReceipt(client, { jurisdiction: 'US', deductiblePercentage: 50 });

    expect(receipt.taxDeductibleAmount).toBe('6172');
  });

  it('applies the deductible cap only when it is lower than the calculated amount', async () => {
    const underCap = new DonorTransparencyClient();
    await recordFundCreation(underCap, '10000');
    const underCapReceipt = await generateReceipt(underCap, {
      jurisdiction: 'US',
      deductiblePercentage: 100,
      maximumDeductibleAmount: '15000',
    });
    expect(underCapReceipt.taxDeductibleAmount).toBe('10000');

    resetStorage();
    const overCap = new DonorTransparencyClient();
    await recordFundCreation(overCap, '10000');
    const overCapReceipt = await generateReceipt(overCap, {
      jurisdiction: 'US',
      deductiblePercentage: 100,
      maximumDeductibleAmount: '2500',
    });
    expect(overCapReceipt.taxDeductibleAmount).toBe('2500');
  });

  it.each([-1, 101, 12.5, NaN])(
    'rejects a deductiblePercentage of %s',
    async deductiblePercentage => {
      const client = new DonorTransparencyClient();
      await recordFundCreation(client);

      await expect(
        generateReceipt(client, { jurisdiction: 'US', deductiblePercentage })
      ).rejects.toThrow(/deductiblePercentage/);
    }
  );

  it('applies the policy to the donation date, not the receipt date', async () => {
    const applicable = new DonorTransparencyClient();
    await recordFundCreation(applicable);
    const applicableReceipt = await generateReceipt(applicable, {
      jurisdiction: 'CA-ON',
      deductiblePercentage: 100,
      validFrom: DONATION_DATE,
      validUntil: DONATION_DATE,
    });
    expect(applicableReceipt.taxDeductibleAmount).toBe('10000');

    resetStorage();
    const expired = new DonorTransparencyClient();
    await recordFundCreation(expired);
    await expect(
      generateReceipt(expired, {
        jurisdiction: 'CA-ON',
        deductiblePercentage: 100,
        validUntil: DONATION_DATE - 1,
      })
    ).rejects.toThrow(/does not apply to this donation date/);
  });

  it('rejects a policy with inconsistent effective dates', async () => {
    const client = new DonorTransparencyClient();
    await recordFundCreation(client);

    await expect(
      generateReceipt(client, {
        jurisdiction: 'US',
        deductiblePercentage: 100,
        validFrom: DONATION_DATE + 1,
        validUntil: DONATION_DATE,
      })
    ).rejects.toThrow(/validFrom must not be after validUntil/);
  });

  it('rejects invalid fund-creation amounts and caps', async () => {
    const invalidAmount = new DonorTransparencyClient();
    await recordFundCreation(invalidAmount, 'not-a-number');
    await expect(generateReceipt(invalidAmount, FULL_DEDUCTION)).rejects.toThrow(
      /Fund-creation record has an invalid/
    );

    resetStorage();
    const invalidCap = new DonorTransparencyClient();
    await recordFundCreation(invalidCap);
    await expect(
      generateReceipt(invalidCap, {
        jurisdiction: 'US',
        deductiblePercentage: 100,
        maximumDeductibleAmount: '-5',
      })
    ).rejects.toThrow(/maximumDeductibleAmount has an invalid/);
  });
});
