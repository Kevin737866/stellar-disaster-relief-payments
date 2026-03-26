import { BeneficiaryApp, ConditionalTransfersClient } from '../sdk/src';

async function shelterReconstructionExample(): Promise<void> {
  const transfers = new ConditionalTransfersClient();
  const app = new BeneficiaryApp(transfers);

  const grant = transfers.createTransfer(
    'beneficiary_family_778',
    600,
    [
      { type: 'category_lock', params: { categories: ['hardware'] } },
      { type: 'expiry', params: { expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 } },
      { type: 'geofence', params: { campLat: 9.0765, campLon: 7.3986, radiusKm: 50 } },
      { type: 'velocity', params: { maxTransactionsPerDay: 3, maxAmountPerTransaction: 100 } },
      { type: 'cospending', params: { threshold: 75 } },
      { type: 'condition', params: { conditions: ['Shelter'] } },
    ],
    'USD'
  );

  transfers.executeSpend(grant.id, 'merchant_hardware_1', 'hardware', 70, 9.1, 7.4, true);
  transfers.executeSpend(grant.id, 'merchant_hardware_2', 'hardware', 60, 9.08, 7.38, false);

  const contract = transfers.createWorkContract(
    'beneficiary_family_778',
    'Roof frame reconstruction',
    'oracle_supervisor_001',
    200
  );

  const completionPayment = transfers.verifyWorkMilestone(contract.id, {
    supervisorAttestation: true,
    photoProofHash: 'QmShelterProof001',
    gpsCheckIn: true,
  });

  console.log('Shelter grant ID:', grant.id);
  console.log('Remaining balance:', transfers.getTransferBalance(grant.id));
  console.log('Completion milestone payout:', completionPayment);
  console.log('Cash-for-work verification accuracy:', transfers.cashForWorkVerificationAccuracy());
  console.log('Spending history by category:', app.getSpendingHistoryByCategory(grant.id));
}

if (require.main === module) {
  shelterReconstructionExample().catch((error) => {
    console.error('shelter-reconstruction example failed', error);
    process.exit(1);
  });
}

export { shelterReconstructionExample };
