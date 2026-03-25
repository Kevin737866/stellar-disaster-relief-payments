import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG 
} from '../sdk/src/index';
import { 
  MerchantNetworkSDK, 
  CATEGORY_FOOD, 
  CATEGORY_WATER, 
  CATEGORY_MEDICAL,
  CATEGORY_CLOTHING,
  STATUS_TRIAL,
  STATUS_ACTIVE,
  STATUS_GRADUATED,
  PAYMENT_QR,
  PAYMENT_USSD,
  PAYMENT_OFFLINE
} from '../sdk/src/merchantNetwork';

/**
 * Kenyan Refugee Camp Marketplace Network
 * 
 * This example demonstrates a local merchant network in a Kenyan refugee camp
 * (e.g., Dadaab or Kakuma) for last-mile cash distribution.
 * 
 * Features:
 * - Rapid merchant onboarding (< 15 minutes)
 * - 500+ merchants per disaster zone within 48 hours
 * - Sub-3 second payment processing (online), < 1 hour (offline sync)
 * - Community vouching system (3 beneficiaries or 1 NGO worker)
 * - Trial period: $100/day for 7 days, then review
 * - Fraud detection with < 0.5% fraud rate
 */

interface CampLocation {
  name: string;
  latitude: number;
  longitude: number;
  population: number;
}

interface VendorProfile {
  name: string;
  category: number;
  description: string;
  inventory: string[];
}

async function setupRefugeeCampNetwork() {
  console.log('🏪 Setting up Kenyan Refugee Camp Merchant Network');
  console.log('='.repeat(60));
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  const merchantSDK = new MerchantNetworkSDK(TESTNET_CONFIG);
  
  // Camp configuration
  const camp: CampLocation = {
    name: 'Kakuma Refugee Camp',
    latitude: 3.7256,
    longitude: 34.8694,
    population: 200000
  };
  
  console.log(`📍 Location: ${camp.name}`);
  console.log(`   Population: ${camp.population.toLocaleString()}`);
  console.log(`   Coordinates: ${camp.latitude}, ${camp.longitude}`);
  
  // Admin keys (in production, use secure key management)
  const adminKey = 'SADMIN_KEY_HERE';
  const ngoFieldWorkerKey = 'SNGO_KEY_HERE';
  
  // Target: 500+ merchants within 48 hours
  const targetMerchants = 500;
  const onboardingBudget = '5000000'; // 5M USDC equivalent
  
  console.log(`\n📊 Target: ${targetMerchants}+ merchants within 48 hours`);
  console.log(`💰 Budget: ${onboardingBudget} USDC`);
  
  // Define vendor categories for the camp
  const vendorCategories: VendorProfile[] = [
    { name: 'Food Stalls', category: CATEGORY_FOOD, description: 'Fresh produce, grains, cooked food', inventory: ['vegetables', 'fruits', 'grains', 'spices'] },
    { name: 'Water Vendors', category: CATEGORY_WATER, description: 'Clean water supply', inventory: ['water_bottles', 'water_jerrycans', 'purification_tabs'] },
    { name: 'Medical Shops', category: CATEGORY_MEDICAL, description: 'Pharmacy and medical supplies', inventory: ['medicine', 'first_aid', 'sanitary_supplies'] },
    { name: 'Clothing Vendors', category: CATEGORY_CLOTHING, description: 'Clothing and textiles', inventory: ['clothes', 'blankets', 'shoes'] },
    { name: 'Household Goods', category: CATEGORY_FOOD, description: 'Kitchenware, cleaning supplies', inventory: ['pots', 'soap', 'detergent'] },
  ];
  
  console.log(`\n📦 Vendor Categories:`);
  vendorCategories.forEach((cat, i) => {
    console.log(`   ${i + 1}. ${cat.name} (${merchantSDK.getCategoryName(cat.category)})`);
  });
  
  // Register merchants in batches
  console.log(`\n🚀 Starting merchant registration...`);
  
  const registeredMerchants: string[] = [];
  const startTime = Date.now();
  
  // Simulate batch registration (in production, use parallel processing)
  const batchSize = 50;
  const totalBatches = Math.ceil(targetMerchants / batchSize);
  
  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = Date.now();
    console.log(`\n📋 Batch ${batch + 1}/${totalBatches} (${batchSize} merchants)`);
    
    for (let i = 0; i < batchSize; i++) {
      const merchantIndex = batch * batchSize + i;
      if (merchantIndex >= targetMerchants) break;
      
      // Generate merchant ID
      const merchantId = `KAKUMA_${String(merchantIndex).padStart(4, '0')}`;
      
      // Select random category
      const category = vendorCategories[merchantIndex % vendorCategories.length];
      
      // Generate location within camp (randomized for demo)
      const latOffset = (Math.random() - 0.5) * 0.05;
      const lngOffset = (Math.random() - 0.5) * 0.05;
      
      // Create merchant profile
      const profile = merchantSDK.createOnboardingRequest(
        `${category.name} #${merchantIndex + 1}`,
        category.description,
        category.category,
        {
          latitude: camp.latitude + latOffset,
          longitude: camp.longitude + lngOffset,
          address: `Zone ${Math.floor(Math.random() * 10) + 1}`,
          city: 'Kakuma',
          country: 'Kenya',
          postalCode: ''
        },
        `+254${Math.floor(Math.random() * 900000000 + 100000000)}`,
        false // Not emergency fast-track
      );
      
      // Generate references (simulated)
      const references = [
        `beneficiary_${Math.floor(Math.random() * 10000)}`,
        `beneficiary_${Math.floor(Math.random() * 10000)}`,
        `beneficiary_${Math.floor(Math.random() * 10000)}`
      ];
      
      try {
        // In production, actually call the contract
        // await merchantSDK.registerMerchant(adminKey, merchantId, profile, references);
        registeredMerchants.push(merchantId);
      } catch (error) {
        console.error(`   ❌ Failed to register ${merchantId}:`, error);
      }
    }
    
    const batchTime = Date.now() - batchStart;
    console.log(`   ✅ Batch completed in ${batchTime}ms`);
    console.log(`   📊 Progress: ${registeredMerchants.length}/${targetMerchants}`);
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`\n✅ Registration complete!`);
  console.log(`   Total time: ${(totalTime / 1000 / 60).toFixed(2)} minutes`);
  console.log(`   Merchants registered: ${registeredMerchants.length}`);
  console.log(`   Rate: ${(registeredMerchants.length / (totalTime / 1000 / 60)).toFixed(1)}/min`);
  
  // Simulate community vouching
  console.log(`\n🔗 Processing community vouches...`);
  
  // Each merchant needs 3 vouches from beneficiaries
  const vouchBatchSize = 100;
  for (let i = 0; i < registeredMerchants.length; i += vouchBatchSize) {
    const batch = registeredMerchants.slice(i, i + vouchBatchSize);
    
    for (const merchantId of batch) {
      // Simulate 3 beneficiary vouches
      for (let v = 0; v < 3; v++) {
        try {
          // In production, actually call the contract
          // await merchantSDK.addVouch(ngoFieldWorkerKey, merchantId, 0); // beneficiary vouch
        } catch (error) {
          // Vouch already added or failed
        }
      }
    }
  }
  
  console.log(`   ✅ Vouches processed for ${registeredMerchants.length} merchants`);
  
  // Simulate trial period review and graduation
  console.log(`\n🎓 Reviewing trial merchants for graduation...`);
  
  const graduatedMerchants: string[] = [];
  const trialMerchants = registeredMerchants.slice(0, Math.min(100, registeredMerchants.length));
  
  for (const merchantId of trialMerchants) {
    // Simulate good transaction history
    const stats = {
      reputationScore: 50 + Math.floor(Math.random() * 30),
      currentDayVolume: String(Math.floor(Math.random() * 80)),
      currentMonthVolume: String(Math.floor(Math.random() * 2000)),
      currentVouches: 3
    };
    
    // Graduate if good performance
    if (parseInt(stats.currentMonthVolume) > 500 && stats.reputationScore > 60) {
      try {
        // In production, actually call the contract
        // await merchantSDK.reviewTrialMerchant(adminKey, merchantId, true);
        graduatedMerchants.push(merchantId);
      } catch (error) {
        // Review failed
      }
    }
  }
  
  console.log(`   ✅ Graduated ${graduatedMerchants.length} merchants to higher limits`);
  
  // Demonstrate payment processing
  console.log(`\n💳 Demonstrating payment processing...`);
  
  // Test online payment
  const onlinePaymentStart = Date.now();
  console.log(`   🌐 Processing online payment...`);
  // Simulate online payment
  const onlinePaymentTime = Date.now() - onlinePaymentStart;
  console.log(`   ✅ Online payment: ${onlinePaymentTime}ms (target: <3000ms)`);
  
  // Test offline payment
  const offlinePaymentStart = Date.now();
  console.log(`   📴 Processing offline payment...`);
  // Simulate offline payment (queued)
  const offlinePaymentId = `offline_${Date.now()}`;
  console.log(`   ✅ Offline payment queued: ${offlinePaymentId}`);
  console.log(`   ⏱️ Will sync within 1 hour when connectivity returns`);
  
  // Test QR code payment
  console.log(`\n📱 Testing payment methods...`);
  
  // Generate shop QR
  const shopQR = await merchantSDK.generateQRCode(registeredMerchants[0]);
  console.log(`   📋 Shop QR generated: ${JSON.stringify(shopQR).substring(0, 50)}...`);
  
  // Generate transaction QR
  const txQR = await merchantSDK.generateTransactionQR(
    registeredMerchants[0],
    '50',
    'BENEFICIARY_001'
  );
  console.log(`   📋 Transaction QR generated: ${JSON.stringify(txQR).substring(0, 50)}...`);
  
  // Test USSD code
  const ussdCode = '*123456*50#';
  const parsed = merchantSDK.parseUSSDCode(ussdCode);
  console.log(`   📞 USSD code parsed: merchant=${parsed.merchantCode}, amount=${parsed.amount}`);
  
  // Test nearby merchant search
  console.log(`\n🔍 Testing beneficiary discovery...`);
  
  const nearbyMerchants = await merchantSDK.findNearbyMerchants(
    { latitude: camp.latitude, longitude: camp.longitude },
    5 // 5km radius
  );
  console.log(`   📍 Found ${nearbyMerchants.length} merchants within 5km`);
  
  // Test category search
  const foodMerchants = await merchantSDK.findMerchantsByCategory(CATEGORY_FOOD);
  console.log(`   🍎 Found ${foodMerchants.length} food vendors`);
  
  // Test fraud detection
  console.log(`\n🛡️ Testing fraud detection...`);
  
  const fraudAlerts = await merchantSDK.getFraudAlerts(registeredMerchants[0]);
  console.log(`   ⚠️ Fraud alerts: ${fraudAlerts.length}`);
  
  // Test settlement
  console.log(`\n💰 Testing daily settlement...`);
  
  const settlementHistory = await merchantSDK.getSettlementHistory(registeredMerchants[0]);
  console.log(`   📊 Settlement records: ${settlementHistory.length}`);
  
  // Summary
  console.log(`\n` + '='.repeat(60));
  console.log(`📈 NETWORK SUMMARY`);
  console.log(`='.repeat(60)`);
  console.log(`   Camp: ${camp.name}`);
  console.log(`   Total Merchants: ${registeredMerchants.length}`);
  console.log(`   Graduated: ${graduatedMerchants.length}`);
  console.log(`   Target Met: ${registeredMerchants.length >= targetMerchants ? '✅ Yes' : '❌ No'}`);
  console.log(`   Onboarding Time: ${(totalTime / 1000 / 60).toFixed(2)} minutes`);
  console.log(`   Payment Methods: QR, USSD, NFC, Offline`);
  console.log(`   Fraud Detection: Active (target: <0.5%)`);
  console.log(`   Daily Settlement: Enabled`);
  console.log(`='.repeat(60)`);
  
  return {
    camp,
    registeredMerchants,
    graduatedMerchants,
    totalTime
  };
}

// Run the example
if (require.main === module) {
  setupRefugeeCampNetwork()
    .then(result => {
      console.log(`\n✅ Example completed successfully!`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Example failed:', error);
      process.exit(1);
    });
}

export default setupRefugeeCampNetwork;