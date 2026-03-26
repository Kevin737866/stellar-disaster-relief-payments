import { DonorPortal, SupplyChainClient } from '../sdk/src';

async function vaccineColdChainExample(): Promise<void> {
  const tracker = new SupplyChainClient();
  const portal = new DonorPortal(tracker);

  const shipment = await tracker.createShipment(
    {
      category: 'medicine',
      description: 'COVID-19 vaccine vials (2-8C)',
      quantity: 120000,
      unit: 'doses',
      requiresColdChain: true,
      estimatedValueUsd: 250000,
    },
    [
      { checkpointId: 'cp1', name: 'Lagos Central Store', latitude: 6.5244, longitude: 3.3792, expectedArrival: Date.now() },
      { checkpointId: 'cp2', name: 'Abuja Distribution Hub', latitude: 9.0765, longitude: 7.3986, expectedArrival: Date.now() + 6 * 60 * 60 * 1000 },
      { checkpointId: 'cp3', name: 'Kano Vaccination Center', latitude: 12.0022, longitude: 8.5920, expectedArrival: Date.now() + 12 * 60 * 60 * 1000 },
    ],
    ['gps_tracker', 'temperature_logger', 'seal_tamper', 'photo_attestation', 'community_witness']
  );

  await tracker.recordCustodyEvent(shipment.id, 'Lagos Central Store (6.5244, 3.3792)', {
    sensor: { temperature: 4.2, humidity: 61, shock: 130, light: 40 },
    proofHash: 'proof_start_lagos',
    gpsAnchorHash: 'gps_anchor_001',
    sealIntact: true,
    photoHash: 'QmVaccinePhoto01',
  }, 'warehouse_operator_lagos');

  await tracker.recordCustodyEvent(shipment.id, 'Abuja Distribution Hub (9.0765, 7.3986)', {
    sensor: { temperature: 5.6, humidity: 58, shock: 180, light: 36 },
    proofHash: 'proof_abuja_handoff',
    gpsAnchorHash: 'gps_anchor_002',
    sealIntact: true,
    photoHash: 'QmVaccinePhoto02',
  }, 'transporter_abuja');

  await tracker.recordCustodyEvent(shipment.id, 'Kano Vaccination Center (12.0022, 8.5920)', {
    sensor: { temperature: 6.1, humidity: 55, shock: 120, light: 22 },
    proofHash: 'proof_kano_arrival',
    gpsAnchorHash: 'gps_anchor_003',
    sealIntact: true,
    photoHash: 'QmVaccinePhoto03',
  }, 'distribution_officer_kano');

  await tracker.verifyFinalDelivery(shipment.id, {
    beneficiarySignature: 'beneficiary_sig_kano_001',
    qrCode: 'QR:VAX:KANO:001',
    pinHash: 'pin_hash_kano_001',
    witnessSignatures: ['witness_a', 'witness_b', 'witness_c'],
    photoHash: 'QmDeliveryProofKano',
  });

  const report = tracker.generateChainOfCustody(shipment.id);
  const dashboards = portal.getConditionDashboards();

  console.log('Vaccine cold-chain shipment:', shipment.id);
  console.log('Anomalies detected:', report.anomalies.length);
  console.log('Anchor data loss rate:', report.anchorCoverage.dataLossRate);
  console.log('Cold-chain dashboard rows:', dashboards.length);
}

if (require.main === module) {
  vaccineColdChainExample().catch((error) => {
    console.error('vaccine-cold-chain example failed', error);
    process.exit(1);
  });
}

export { vaccineColdChainExample };
