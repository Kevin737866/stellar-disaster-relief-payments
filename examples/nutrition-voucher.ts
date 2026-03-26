import { BeneficiaryApp, ConditionalTransfersClient } from '../sdk/src';

async function nutritionVoucherExample(): Promise<void> {
  const transfers = new ConditionalTransfersClient();
  const app = new BeneficiaryApp(transfers);

  const voucher = transfers.createTransfer(
    'beneficiary_mother_001',
    180,
    [
      { type: 'category_lock', params: { categories: ['grocer'] } },
      { type: 'expiry', params: { expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 } },
      { type: 'geofence', params: { campLat: 6.5244, campLon: 3.3792, radiusKm: 50 } },
      { type: 'velocity', params: { maxTransactionsPerDay: 3, maxAmountPerTransaction: 100 } },
      { type: 'cospending', params: { threshold: 75 } },
      { type: 'condition', params: { conditions: ['Nutrition'] } },
    ],
    'USD'
  );

  transfers.executeSpend(voucher.id, 'merchant_grocer_22', 'grocer', 45, 6.55, 3.38, false);
  transfers.executeSpend(voucher.id, 'merchant_grocer_11', 'grocer', 30, 6.53, 3.36, false);

  console.log('Nutrition voucher ID:', voucher.id);
  console.log('BAL response:', app.smsBalanceCheck('BAL', voucher.id));
  console.log('Category history:', app.getSpendingHistoryByCategory(voucher.id));
  console.log('Supported rule combinations:', transfers.supportsRuleCombinations());
  console.log('Reliability at valid merchants:', transfers.reliabilityStatsForValidMerchants().successRate);
  console.log('Hotline:', app.supportHotline());
}

if (require.main === module) {
  nutritionVoucherExample().catch((error) => {
    console.error('nutrition-voucher example failed', error);
    process.exit(1);
  });
}

export { nutritionVoucherExample };
