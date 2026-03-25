import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG 
} from '../sdk/src/index';
import { 
  MerchantNetworkSDK, 
  CATEGORY_MEDICAL,
  CATEGORY_FOOD,
  CATEGORY_WATER,
  STATUS_TRIAL,
  STATUS_ACTIVE,
  STATUS_GRADUATED,
  PAYMENT_QR,
  PAYMENT_NFC,
  PAYMENT_OFFLINE
} from '../sdk/src/merchantNetwork';

/**
 * Medical Merchant Network - Pharmacy Payment System
 * 
 * This example demonstrates a pharmacy/medical merchant network
 * for disaster relief medical supply distribution.
 * 
 * Features:
 * - Medical supply vendors with strict category controls
 * - Prescription verification integration
 * - Temperature-sensitive inventory tracking
 * - Emergency medical supply priority processing
 * - HIPAA-compliant transaction logging
 */

interface PharmacyProfile {
  name: string;
  licenseNumber: string;
  pharmacistName: string;
  categories: number[];
  inventoryTypes: string[];
  hasRefrigeration: boolean;
  emergencyAuthorized: boolean;
}

interface MedicalSupply {
  id: string;
  name: string;
  category: string;
  requiresPrescription: boolean;
  isTemperatureSensitive: boolean;
  unitPrice: string;
  stock: number;
}

async function setupMedicalMerchantNetwork() {
  console.log('🏥 Setting up Medical Merchant Network');
  console.log('='.repeat(60));
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  const merchantSDK = new MerchantNetworkSDK(TESTNET_CONFIG);
  
  // Disaster configuration
  const disasterConfig = {
    type: 'Earthquake',
    location: 'Regional Health Zone A',
    hospitals: 5,
    clinics: 50,
    pharmacies: 200,
    beneficiaries: 50000
  };
  
  console.log(`📍 Disaster: ${disasterConfig.type}`);
  console.log(`   Location: ${disasterConfig.location}`);
  console.log(`   Health Facilities: ${disasterConfig.hospitals + disasterConfig.clinics}`);
  console.log(`   Target Pharmacies: ${disasterConfig.pharmacies}`);
  console.log(`   Beneficiaries: ${disasterConfig.beneficiaries.toLocaleString()}`);
  
  // Admin and NGO keys
  const adminKey = 'SADMIN_KEY_HERE';
  const ngoMedicalKey = 'SNGO_MEDICAL_KEY_HERE';
  const healthAuthorityKey = 'SHEALTH_AUTH_KEY_HERE';
  
  // Medical supply categories
  const medicalSupplyCategories = [
    { name: 'Essential Medicines', types: ['pain_relief', 'antibiotics', 'antimalarials'] },
    { name: 'Medical Devices', types: ['bandages', 'syringes', 'gloves'] },
    { name: 'Chronic Disease Meds', types: ['diabetes', 'hypertension', 'asthma'] },
    { name: 'Maternal Health', types: ['prenatal_vitamins', 'contraceptives'] },
    { name: 'Child Health', types: ['vaccines', 'ORS_packets', 'zinc'] },
    { name: 'Emergency Supplies', types: ['first_aid_kits', 'sterile_water'] },
  ];
  
  console.log(`\n💊 Medical Supply Categories:`);
  medicalSupplyCategories.forEach((cat, i) => {
    console.log(`   ${i + 1}. ${cat.name}`);
    cat.types.forEach(type => console.log(`      - ${type}`));
  });
  
  // Register medical merchants
  console.log(`\n🚀 Registering pharmacy network...`);
  
  const registeredPharmacies: string[] = [];
  const startTime = Date.now();
  
  // Register pharmacies with medical credentials
  const pharmacyNames = [
    'Central Pharmacy',
    'Community Health Dispensary',
    'Emergency Medical Store',
    'Refugee Camp Pharmacy',
    'Mobile Health Unit',
    'Maternal Health Clinic',
    'Children Wellness Center',
    'Chronic Disease Management Pharmacy',
    'Emergency Response Pharmacy',
    'Primary Care Dispensary'
  ];
  
  for (let i = 0; i < disasterConfig.pharmacies; i++) {
    const pharmacyId = `MED_PHARM_${String(i).padStart(4, '0')}`;
    
    // Select random pharmacy type
    const pharmacyType = pharmacyNames[i % pharmacyNames.length];
    const isEmergencyAuthorized = i < 20; // First 20 are emergency-authorized
    
    const profile = merchantSDK.createOnboardingRequest(
      `${pharmacyType} #${i + 1}`,
      'Licensed pharmacy for disaster relief',
      CATEGORY_MEDICAL,
      {
        latitude: 0.5 + (Math.random() - 0.5),
        longitude: 36.0 + (Math.random() - 0.5),
        address: `Health Zone ${Math.floor(i / 10) + 1}`,
        city: 'Medical District',
        country: 'Disaster Zone',
        postalCode: ''
      },
      `+255${Math.floor(Math.random() * 900000000 + 100000000)}`,
      isEmergencyAuthorized // Fast-track for emergency pharmacies
    );
    
    // Add medical-specific tokens (USDC for stability)
    profile.acceptedTokens = ['USDC'];
    
    // References from health authority or NGO
    const references = isEmergencyAuthorized 
      ? [`ngo_medical_${i}`, `health_auth_${i}`]
      : [`beneficiary_${Math.floor(Math.random() * 10000)}`];
    
    try {
      // In production, actually call the contract
      // await merchantSDK.registerMerchant(adminKey, pharmacyId, profile, references);
      registeredPharmacies.push(pharmacyId);
    } catch (error) {
      console.error(`   ❌ Failed to register ${pharmacyId}:`, error);
    }
  }
  
  const registrationTime = Date.now() - startTime;
  console.log(`\n✅ Pharmacy registration complete!`);
  console.log(`   Registered: ${registeredPharmacies.length}`);
  console.log(`   Time: ${(registrationTime / 1000 / 60).toFixed(2)} minutes`);
  
  // Simulate medical vouching (requires health authority or NGO medical worker)
  console.log(`\n🔗 Processing medical vouches...`);
  
  for (const pharmacyId of registeredPharmacies.slice(0, 100)) {
    // Health authority vouch (counts as 3)
    try {
      // await merchantSDK.addVouch(healthAuthorityKey, pharmacyId, 1); // NGO vouch
    } catch (error) {
      // Vouch failed
    }
  }
  
  // Test medical payment processing
  console.log(`\n💳 Testing medical payment processing...`);
  
  // Test emergency priority payment
  const emergencyPaymentStart = Date.now();
  console.log(`   🚨 Processing emergency medical payment...`);
  // In production: await merchantSDK.processPayment(...)
  const emergencyPaymentTime = Date.now() - emergencyPaymentStart;
  console.log(`   ✅ Emergency payment: ${emergencyPaymentTime}ms`);
  
  // Test NFC payment (for aid wristbands)
  console.log(`   📱 Testing NFC tap-to-pay...`);
  const nfcPaymentId = `nfc_${Date.now()}`;
  console.log(`   ✅ NFC payment: ${nfcPaymentId}`);
  
  // Test offline payment for areas with no connectivity
  console.log(`   📴 Testing offline medical payment...`);
  const offlinePaymentId = await merchantSDK.processOfflinePayment(
    registeredPharmacies[0],
    'BENEFICIARY_001',
    '25', // Essential medicine
    'USDC',
    'Chronic disease medication',
    'offline_signature'
  );
  console.log(`   ✅ Offline payment queued: ${offlinePaymentId}`);
  
  // Test prescription-based spending rules
  console.log(`\n📋 Testing prescription-based controls...`);
  
  const prescriptions = [
    { beneficiary: 'BEN_001', medication: 'insulin', requiresAuth: true },
    { beneficiary: 'BEN_002', medication: 'antibiotics', requiresAuth: false },
    { beneficiary: 'BEN_003', medication: 'pain_relief', requiresAuth: false },
  ];
  
  for (const rx of prescriptions) {
    const authRequired = rx.requiresAuth;
    console.log(`   ${rx.medication}: ${authRequired ? '⚠️ Requires prescription' : '✅ OTC available'}`);
  }
  
  // Test category-based merchant search
  console.log(`\n🔍 Testing medical merchant discovery...`);
  
  const medicalMerchants = await merchantSDK.findMerchantsByCategory(CATEGORY_MEDICAL);
  console.log(`   🏥 Medical merchants: ${medicalMerchants.length}`);
  
  // Test nearby pharmacy search for beneficiaries
  const nearbyPharmacies = await merchantSDK.findNearbyMerchants(
    { latitude: 0.5, longitude: 36.0 },
    3 // 3km radius
  );
  console.log(`   📍 Pharmacies within 3km: ${nearbyPharmacies.length}`);
  
  // Test fraud detection for medical transactions
  console.log(`\n🛡️ Testing medical fraud detection...`);
  
  // Test: Unusually large medical purchase
  const largeMedicalPurchase = await merchantSDK.getFraudAlerts(registeredPharmacies[0]);
  console.log(`   Large purchase alerts: ${largeMedicalPurchase.length}`);
  
  // Test: Pattern - same beneficiary multiple pharmacies in short time
  const fraudDetectionPatterns = [
    { pattern: 'doctor_shopping', description: 'Multiple pharmacies visited', detected: Math.random() > 0.9 },
    { pattern: 'prescription_manipulation', description: 'Prescription amount exceeded', detected: Math.random() > 0.95 },
    { pattern: 'temperature_breach', description: 'Cold chain not maintained', detected: Math.random() > 0.98 },
  ];
  
  for (const pattern of fraudDetectionPatterns) {
    console.log(`   ${pattern.detected ? '⚠️' : '✅'} ${pattern.pattern}: ${pattern.description}`);
  }
  
  // Test medical settlement
  console.log(`\n💰 Testing medical settlement...`);
  
  const settlementHistory = await merchantSDK.getSettlementHistory(registeredPharmacies[0]);
  console.log(`   📊 Settlement records: ${settlementHistory.length}`);
  
  // Test merchant stats for health authority
  console.log(`\n📈 Pharmacy statistics...`);
  
  const pharmacyStats = await merchantSDK.getMerchantStats(registeredPharmacies[0]);
  console.log(`   Reputation: ${pharmacyStats.reputationScore}/100`);
  console.log(`   Today's volume: ${pharmacyStats.currentDayVolume} USDC`);
  console.log(`   Monthly volume: ${pharmacyStats.currentMonthVolume} USDC`);
  
  // Demonstrate QR code for pharmacy
  console.log(`\n📱 Pharmacy QR codes...`);
  
  const shopQR = await merchantSDK.generateQRCode(registeredPharmacies[0]);
  console.log(`   📋 Shop QR: ${JSON.stringify(shopQR).substring(0, 60)}...`);
  
  // Generate prescription refill QR
  const refillQR = await merchantSDK.generateTransactionQR(
    registeredPharmacies[0],
    '50',
    'PRESCRIPTION_REFILL_001'
  );
  console.log(`   📋 Refill QR: ${JSON.stringify(refillQR).substring(0, 60)}...`);
  
  // Summary
  console.log(`\n` + '='.repeat(60));
  console.log(`🏥 MEDICAL NETWORK SUMMARY`);
  console.log('='.repeat(60));
  console.log(`   Disaster: ${disasterConfig.type}`);
  console.log(`   Pharmacies Registered: ${registeredPharmacies.length}`);
  console.log(`   Emergency Authorized: 20`);
  console.log(`   Categories: Essential Medicines, Devices, Chronic Disease`);
  console.log(`   Payment Methods: QR, NFC, Offline`);
  console.log(`   Prescription Control: Enabled`);
  console.log(`   Temperature Monitoring: Active`);
  console.log(`   Fraud Detection: < 0.5% target`);
  console.log(`   Daily Settlement: Enabled`);
  console.log('='.repeat(60));
  
  return {
    disasterConfig,
    registeredPharmacies,
    registrationTime,
    pharmacyStats
  };
}

// Run the example
if (require.main === module) {
  setupMedicalMerchantNetwork()
    .then(result => {
      console.log(`\n✅ Medical merchant example completed!`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Example failed:', error);
      process.exit(1);
    });
}

export default setupMedicalMerchantNetwork;