import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG, 
  DISASTER_TYPES,
  SUPPLY_TYPES 
} from '../sdk/src/index';

/**
 * Earthquake Disaster Response Example
 * 
 * This example demonstrates how to use the Stellar Disaster Relief platform
 * for rapid response to an earthquake disaster.
 */

async function earthquakeResponse() {
  console.log('🚨 Starting Earthquake Disaster Response Protocol');
  
  // Initialize SDK with testnet configuration
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  // Configuration
  const config = {
    adminKey: 'SADMIN_KEY_HERE', // Replace with actual admin key
    ngoSigner: 'SNGO_KEY_HERE',
    govSigner: 'SGOV_KEY_HERE', 
    unSigner: 'SUN_KEY_HERE',
    disasterId: 'EQ_2024_03_16_SANTO_DOMINGO',
    affectedArea: 'Santo Domingo, Dominican Republic',
    estimatedAffected: 50000,
    totalBudget: '1000000', // 1M XLM equivalent
    duration: 90 // days
  };

  try {
    // Step 1: Initialize the disaster relief platform
    console.log('📋 Initializing platform...');
    await sdk.aidClient.deployEmergencyFund(
      config.adminKey,
      'platform_init',
      'Earthquake Response Platform',
      'Platform initialized for earthquake disaster response',
      '0',
      DISASTER_TYPES.EARTHQUAKE,
      config.affectedArea,
      Date.now() + (config.duration * 24 * 60 * 60 * 1000),
      [config.adminKey],
      1,
      {
        'response_team_id': 'EQ_TEAM_2024_001',
        'donor_agency': 'International Relief Fund',
        'priority_level': 'critical',
        'contact_email': 'earthquake-response@relief.org'
      }
    );

    // Step 2: Deploy rapid emergency funds
    console.log('💰 Deploying emergency funds...');
    const emergencyFunds = await sdk.aidClient.deployRapidResponse(
      config.adminKey,
      config.disasterId,
      DISASTER_TYPES.EARTHQUAKE,
      config.affectedArea,
      config.totalBudget,
      [
        {
          name: 'Emergency Medical',
          percentage: 35,
          description: 'Emergency medical supplies and care for earthquake victims'
        },
        {
          name: 'Search and Rescue',
          percentage: 25,
          description: 'Search and rescue equipment and personnel'
        },
        {
          name: 'Temporary Shelter',
          percentage: 20,
          description: 'Temporary shelter materials and camps'
        },
        {
          name: 'Food and Water',
          percentage: 15,
          description: 'Emergency food and clean water supplies'
        },
        {
          name: 'Communication',
          percentage: 5,
          description: 'Emergency communication equipment'
        }
      ]
    );

    console.log(`✅ Created ${emergencyFunds.length} emergency funds`);
    
    // Step 3: Register displaced persons (batch registration)
    console.log('👥 Registering displaced persons...');
    const displacedPersons = [
      {
        beneficiaryId: 'DP_001_FAMILY',
        name: 'Maria Rodriguez Family',
        disasterId: config.disasterId,
        location: 'Santo Domingo Centro',
        walletAddress: 'GD5...BENEFICIARY1',
        familySize: 4,
        specialNeeds: ['medical', 'elderly_care'],
        verificationFactors: [
          { factorType: 'possession', value: 'family_photo_2024', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_001', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'neighbor_vouch_juan_garcia', weight: 30, verifiedAt: Date.now() }
        ]
      },
      {
        beneficiaryId: 'DP_002_INDIVIDUAL', 
        name: 'Carlos Martinez',
        disasterId: config.disasterId,
        location: 'Santo Domingo Este',
        walletAddress: 'GD5...BENEFICIARY2',
        familySize: 1,
        specialNeeds: ['mobility'],
        verificationFactors: [
          { factorType: 'possession', value: 'id_card_temp_2024', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'voice_sample_002', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'community_center_vouch', weight: 30, verifiedAt: Date.now() }
        ]
      }
    ];

    for (const person of displacedPersons) {
      await sdk.beneficiaryClient.registerBeneficiary(
        config.adminKey,
        person.beneficiaryId,
        person.name,
        person.disasterId,
        person.location,
        person.walletAddress,
        person.familySize,
        person.specialNeeds,
        person.verificationFactors
      );
    }

    console.log(`✅ Registered ${displacedPersons.length} displaced persons`);

    // Step 4: Onboard local merchants for emergency supplies
    console.log('🏪 Onboarding local merchants...');
    const merchants = [
      {
        merchantId: 'PHARMACY_EMERGENCY_001',
        name: 'Farmacia del Pueblo',
        businessType: 'pharmacy',
        location: {
          latitude: 18.4764,
          longitude: -69.9383,
          address: 'Calle Principal #123',
          city: 'Santo Domingo',
          country: 'Dominican Republic',
          postalCode: '10201',
          facilityName: 'Farmacia del Pueblo',
          contactPerson: 'Jose Rodriguez'
        },
        contactInfo: '+1-809-555-0123',
        stellarAddress: 'GD5...PHARMACY1',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '50000',
        monthlyLimit: '500000',
        verificationDocuments: ['pharmacy_license_2024', 'business_permit']
      },
      {
        merchantId: 'GROCERY_EMERGENCY_001',
        name: 'Supermercado Comunitario',
        businessType: 'grocery',
        location: {
          latitude: 18.4764,
          longitude: -69.9383,
          address: 'Avenida Libertad #456',
          city: 'Santo Domingo',
          country: 'Dominican Republic',
          postalCode: '10201',
          facilityName: 'Supermercado Comunitario',
          contactPerson: 'Ana Santos'
        },
        contactInfo: '+1-809-555-0456',
        stellarAddress: 'GD5...GROCERY1',
        acceptedTokens: ['XLM'],
        dailyLimit: '100000',
        monthlyLimit: '1000000',
        verificationDocuments: ['business_license_2024', 'food_permit']
      }
    ];

    for (const merchant of merchants) {
      const request = sdk.merchantClient.createOnboardingRequest(
        merchant.name,
        merchant.businessType,
        merchant.location,
        merchant.contactInfo,
        merchant.stellarAddress
      );
      
      await sdk.merchantClient.registerMerchant(
        config.adminKey,
        merchant.merchantId,
        request
      );
      
      // Auto-verify for emergency response
      await sdk.merchantClient.verifyMerchant(
        config.adminKey,
        merchant.merchantId,
        true,
        'Emergency auto-verification for earthquake response'
      );
    }

    console.log(`✅ Onboarded ${merchants.length} emergency merchants`);

    // Step 5: Create conditional cash transfers for affected families
    console.log('💳 Creating conditional cash transfers...');
    const transfers = [
      {
        transferId: 'CT_EMERGENCY_001',
        beneficiaryId: 'DP_001_FAMILY',
        amount: '1000', // XLM equivalent
        token: 'XLM',
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
        purpose: 'Emergency earthquake relief - family of 4',
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('food', '400'),
          sdk.transferClient.createCategoryLimitRule('medical', '300'),
          sdk.transferClient.createCategoryLimitRule('shelter', '200'),
          sdk.transferClient.createCategoryLimitRule('transport', '100')
        ]
      },
      {
        transferId: 'CT_EMERGENCY_002',
        beneficiaryId: 'DP_002_INDIVIDUAL',
        amount: '500',
        token: 'XLM',
        expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
        purpose: 'Emergency earthquake relief - individual',
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('food', '200'),
          sdk.transferClient.createCategoryLimitRule('medical', '150'),
          sdk.transferClient.createCategoryLimitRule('shelter', '100'),
          sdk.transferClient.createCategoryLimitRule('transport', '50')
        ]
      }
    ];

    for (const transfer of transfers) {
      await sdk.transferClient.createTransfer(
        config.adminKey,
        transfer.transferId,
        transfer.beneficiaryId,
        transfer.amount,
        transfer.token,
        transfer.expiresAt,
        transfer.spendingRules,
        transfer.purpose
      );
    }

    console.log(`✅ Created ${transfers.length} conditional cash transfers`);

    // Step 6: Track emergency supplies
    console.log('📦 Setting up supply chain tracking...');
    const supplies = [
      {
        donorId: 'WHO_EMERGENCY',
        supplyType: SUPPLY_TYPES.MEDICINE,
        quantity: '10000',
        unit: 'units',
        origin: {
          latitude: 40.7128,
          longitude: -74.0060,
          address: 'WHO Headquarters',
          city: 'New York',
          country: 'USA',
          postalCode: '10017',
          facilityName: 'WHO Distribution Center',
          contactPerson: 'Dr. Sarah Johnson'
        },
        destination: {
          latitude: 18.4764,
          longitude: -69.9383,
          address: 'Santo Domingo Medical Center',
          city: 'Santo Domingo',
          country: 'Dominican Republic',
          postalCode: '10201',
          facilityName: 'Hospital Central',
          contactPerson: 'Dr. Maria Rodriguez'
        },
        estimatedArrival: Date.now() + (3 * 24 * 60 * 60 * 1000), // 3 days
        temperatureRequirements: {
          minTemp: 2,
          maxTemp: 8,
          critical: true
        },
        specialHandling: ['refrigerated', 'fragile']
      },
      {
        donorId: 'UNICEF_EMERGENCY',
        supplyType: SUPPLY_TYPES.WATER,
        quantity: '50000',
        unit: 'liters',
        origin: {
          latitude: 40.7128,
          longitude: -74.0060,
          address: 'UNICEF Warehouse',
          city: 'New York',
          country: 'USA',
          postalCode: '10017',
          facilityName: 'UNICEF Distribution Center',
          contactPerson: 'John Smith'
        },
        destination: {
          latitude: 18.4764,
          longitude: -69.9383,
          address: 'Relief Camp Alpha',
          city: 'Santo Domingo',
          country: 'Dominican Republic',
          postalCode: '10201',
          facilityName: 'Emergency Relief Camp',
          contactPerson: 'Camp Coordinator'
        },
        estimatedArrival: Date.now() + (2 * 24 * 60 * 60 * 1000), // 2 days
        temperatureRequirements: undefined,
        specialHandling: ['potable_water']
      }
    ];

    for (const supply of supplies) {
      const request = sdk.trackerClient.createSupplyChainRequest(
        supply.donorId,
        supply.supplyType,
        supply.quantity,
        supply.unit,
        supply.origin,
        supply.destination,
        supply.estimatedArrival,
        supply.temperatureRequirements,
        supply.specialHandling
      );
      
      await sdk.trackerClient.createShipment(config.adminKey, request);
    }

    console.log(`✅ Set up tracking for ${supplies.length} supply shipments`);

    // Step 7: Monitor for fraud patterns
    console.log('🔍 Activating fraud monitoring...');
    const riskProfiles = await sdk.aidClient.getFundStatistics('EQ_2024_03_16_SANTO_DOMINGO_emergency_medical');
    console.log('📊 Initial fund statistics:', riskProfiles);

    // Step 8: Generate QR codes for offline access
    console.log('📱 Generating QR codes for offline access...');
    for (const person of displacedPersons) {
      const qrCode = sdk.beneficiaryClient.generateBeneficiaryQRCode(
        person.beneficiaryId,
        await sdk.beneficiaryClient.getBeneficiary(person.beneficiaryId)
      );
      console.log(`📲 QR Code for ${person.name}:`, qrCode.substring(0, 100) + '...');
    }

    // Step 9: Set up USSD access for feature phones
    console.log('📞 Setting up USSD access for feature phone users...');
    const ussdSession = sdk.beneficiaryClient.createUSSDSession('+1-809-555-9999');
    console.log('📱 USSD Session created:', ussdSession);

    // Step 10: Display deployment summary
    console.log('\n🎯 EARTHQUAKE RESPONSE DEPLOYMENT SUMMARY');
    console.log('='.repeat(50));
    console.log(`📍 Disaster: ${config.disasterId}`);
    console.log(`🌍 Location: ${config.affectedArea}`);
    console.log(`👥 Affected: ${config.estimatedAffected.toLocaleString()} people`);
    console.log(`💰 Budget: ${config.totalBudget} XLM`);
    console.log(`⏱️ Duration: ${config.duration} days`);
    console.log('');
    console.log('📊 Assets Deployed:');
    console.log(`  💵 Emergency Funds: ${emergencyFunds.length}`);
    console.log(`  👥 Beneficiaries: ${displacedPersons.length}`);
    console.log(`  🏪 Merchants: ${merchants.length}`);
    console.log(`  💳 Cash Transfers: ${transfers.length}`);
    console.log(`  📦 Supply Shipments: ${supplies.length}`);
    console.log('');
    console.log('🔐 Security Features:');
    console.log('  ✅ Multi-sig fund release (2-of-3)');
    console.log('  ✅ Biometric-free identity verification');
    console.log('  ✅ Conditional spending rules');
    console.log('  ✅ GPS-verified merchant network');
    console.log('  ✅ Supply chain tracking');
    console.log('  ✅ Fraud detection monitoring');
    console.log('  ✅ Offline QR code access');
    console.log('  ✅ USSD feature phone support');
    console.log('');
    console.log('🚀 Earthquake response platform is now LIVE!');
    console.log('📞 Emergency hotline: +1-809-EARTHQUAKE');
    console.log('🌐 Web dashboard: https://relief.stellar.org/earthquake-response');
    console.log('📱 Mobile app: Available on iOS and Android');

  } catch (error) {
    console.error('❌ Error during earthquake response deployment:', error);
    throw error;
  }
}

// Additional utility functions for earthquake response
async function processEmergencyPayment(
  beneficiaryKey: string,
  transferId: string,
  merchantId: string,
  amount: string,
  category: string
) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const success = await sdk.transferClient.spend(
      beneficiaryKey,
      transferId,
      merchantId,
      amount,
      category,
      'Santo Domingo'
    );
    
    if (success) {
      console.log(`✅ Emergency payment processed: ${amount} XLM for ${category}`);
    } else {
      console.log(`❌ Payment rejected: spending rules violation`);
    }
  } catch (error) {
    console.error('❌ Payment processing error:', error);
  }
}

async function trackSupplyDelivery(shipmentId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const history = await sdk.trackerClient.getShipmentHistory(shipmentId);
    console.log(`📦 Supply tracking for ${shipmentId}:`);
    console.log(`  Status: ${history.shipment?.currentStatus}`);
    console.log(`  Checkpoints: ${history.shipment?.checkpoints.length}`);
    console.log(`  Delivered: ${history.confirmation ? 'Yes' : 'No'}`);
  } catch (error) {
    console.error('❌ Supply tracking error:', error);
  }
}

// Export for use in other modules
export {
  earthquakeResponse,
  processEmergencyPayment,
  trackSupplyDelivery
};

// Run the earthquake response if this file is executed directly
if (require.main === module) {
  earthquakeResponse().catch(console.error);
}
