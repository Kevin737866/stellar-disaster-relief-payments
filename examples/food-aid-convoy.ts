import { DonorPortal, SupplyChainClient } from '../sdk/src';

async function foodAidConvoyExample(): Promise<void> {
  const tracker = new SupplyChainClient();
  const portal = new DonorPortal(tracker);

  const convoy = await tracker.createShipment(
    {
      category: 'food',
      description: 'Cross-border nutrition convoy kits',
      quantity: 45000,
      unit: 'family_kits',
      estimatedValueUsd: 900000,
    },
    [
      { checkpointId: 'cb1', name: 'Cotonou Port', latitude: 6.3703, longitude: 2.3912, expectedArrival: Date.now() },
      { checkpointId: 'cb2', name: 'Lagos Inland Depot', latitude: 6.5244, longitude: 3.3792, expectedArrival: Date.now() + 7 * 60 * 60 * 1000 },
      { checkpointId: 'cb3', name: 'Ibadan Relief Warehouse', latitude: 7.3775, longitude: 3.9470, expectedArrival: Date.now() + 11 * 60 * 60 * 1000 },
      { checkpointId: 'cb4', name: 'Ilorin Community Distribution Point', latitude: 8.4799, longitude: 4.5418, expectedArrival: Date.now() + 16 * 60 * 60 * 1000 },
    ],
    ['gps_tracker', 'shock_sensor', 'seal_tamper', 'photo_attestation']
  );

  await tracker.recordCustodyEvent(convoy.id, 'Cotonou Port (6.3703, 2.3912)', {
    sensor: { temperature: 29, humidity: 70, shock: 210, light: 300 },
    proofHash: 'food_proof_001',
    gpsAnchorHash: 'food_anchor_001',
    sealIntact: true,
    photoHash: 'QmFoodPhoto01',
  }, 'warehouse_benin');

  await tracker.recordCustodyEvent(convoy.id, 'Lagos Inland Depot (6.5244, 3.3792)', {
    sensor: { temperature: 31, humidity: 73, shock: 280, light: 270 },
    proofHash: 'food_proof_002',
    gpsAnchorHash: 'food_anchor_002',
    sealIntact: true,
    photoHash: 'QmFoodPhoto02',
  }, 'border_transport_team');

  await tracker.recordCustodyEvent(convoy.id, 'Ibadan Relief Warehouse (7.3775, 3.9470)', {
    sensor: { temperature: 30, humidity: 69, shock: 220, light: 210 },
    proofHash: 'food_proof_003',
    gpsAnchorHash: 'food_anchor_003',
    sealIntact: true,
    photoHash: 'QmFoodPhoto03',
  }, 'regional_logistics_oyo');

  await tracker.recordCustodyEvent(convoy.id, 'Ilorin Community Distribution Point (8.4799, 4.5418)', {
    sensor: { temperature: 28, humidity: 66, shock: 160, light: 180 },
    proofHash: 'food_proof_004',
    gpsAnchorHash: 'food_anchor_004',
    sealIntact: true,
    photoHash: 'QmFoodPhoto04',
  }, 'kwara_distribution_team');

  await tracker.verifyFinalDelivery(convoy.id, {
    beneficiarySignature: 'community_rep_signature_001',
    qrCode: 'QR:FOOD:ILORIN:CONVOY-01',
    pinHash: 'food_pin_hash_001',
    witnessSignatures: ['community_witness_1', 'community_witness_2', 'community_witness_3'],
    photoHash: 'QmFoodDeliveryProof',
  });

  const report = tracker.generateChainOfCustody(convoy.id);
  const mapMarkers = portal.getActiveShipmentMap();
  const impact = portal.getImpactMetrics(900000);

  console.log('Food convoy shipment:', convoy.id);
  console.log('Events captured:', report.custodyEvents.length);
  console.log('Route anomalies:', report.anomalies.length);
  console.log('Active map markers:', mapMarkers.length);
  console.log('Impact metrics:', impact);
}

if (require.main === module) {
  foodAidConvoyExample().catch((error) => {
    console.error('food-aid-convoy example failed', error);
    process.exit(1);
  });
}

export { foodAidConvoyExample };
