import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG, 
  DISASTER_TYPES,
  SUPPLY_TYPES 
} from '../sdk/src/index';

/**
 * Drought Relief Water Distribution Program Example
 * 
 * This example demonstrates how to implement a water distribution program
 * for drought-affected communities using the Stellar Disaster Relief platform.
 */

async function droughtRelief() {
  console.log('🌵 Starting Drought Relief Water Distribution Program');
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  // Configuration
  const config = {
    adminKey: 'SADMIN_KEY_HERE',
    ngoSigner: 'SNGO_KEY_HERE',
    govSigner: 'SGOV_KEY_HERE',
    unSigner: 'SUN_KEY_HERE',
    disasterId: 'DROUGHT_HORN_OF_AFRICA_2024',
    affectedRegion: 'Horn of Africa - Ethiopia, Kenya, Somalia',
    affectedPopulation: 15000000,
    waterDistributionPoints: 250,
    monthlyWaterBudget: '5000000', // 5M XLM equivalent
    programDuration: 18 // months
  };

  try {
    // Step 1: Initialize drought relief program
    console.log('📋 Initializing drought relief program...');
    await sdk.aidClient.deployEmergencyFund(
      config.adminKey,
      'drought_water_relief',
      'Drought Relief Water Distribution',
      'Emergency water distribution for drought-affected communities',
      '0',
      'drought',
      config.affectedRegion,
      Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
      [config.adminKey, config.ngoSigner, config.govSigner],
      2
    );

    // Step 2: Create specialized water distribution funds
    console.log('💰 Creating water distribution funds...');
    const waterFunds = [
      {
        fundId: 'WATER_TRUCKING',
        name: 'Water Trucking Services',
        description: 'Mobile water trucking to remote villages',
        percentage: 40
      },
      {
        fundId: 'WATER_POINTS',
        name: 'Water Point Installation',
        description: 'Installation and maintenance of water distribution points',
        percentage: 25
      },
      {
        fundId: 'WATER_TREATMENT',
        name: 'Water Treatment & Purification',
        description: 'Water treatment chemicals and purification systems',
        percentage: 20
      },
      {
        fundId: 'WATER_STORAGE',
        name: 'Water Storage Solutions',
        description: 'Water tanks, containers, and storage infrastructure',
        percentage: 10
      },
      {
        fundId: 'WATER_MONITORING',
        name: 'Water Quality Monitoring',
        description: 'Water quality testing and monitoring equipment',
        percentage: 5
      }
    ];

    for (const fund of waterFunds) {
      const amount = (BigInt(config.monthlyWaterBudget) * BigInt(fund.percentage) / BigInt(100)).toString();
      await sdk.aidClient.deployEmergencyFund(
        config.adminKey,
        fund.fundId,
        fund.name,
        fund.description,
        amount,
        'drought',
        config.affectedRegion,
        Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
        [config.adminKey, config.ngoSigner],
        2
      );
    }

    console.log(`✅ Created ${waterFunds.length} water distribution funds`);

    // Step 3: Register water distribution beneficiaries
    console.log('👥 Registering drought-affected beneficiaries...');
    const droughtBeneficiaries = [
      {
        beneficiaryId: 'DB_001_ETHIOPIA',
        name: 'Abebe Kebede Family',
        disasterId: config.disasterId,
        location: 'Somali Region, Ethiopia',
        walletAddress: 'GD5...DROUGHT1',
        familySize: 8,
        specialNeeds: ['large_family', 'elderly_care', 'children'],
        verificationFactors: [
          { factorType: 'possession', value: 'village_id_card_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_001', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'elder_vouch_habiba', weight: 30, verifiedAt: Date.now() }
        ],
        waterNeeds: {
          dailyLiters: 40, // 5 liters per person minimum
          distanceToWater: 15, // km
          livestock: 5, // goats/sheep
          farming: true
        }
      },
      {
        beneficiaryId: 'DB_002_KENYA',
        name: 'Grace Wanjiru',
        disasterId: config.disasterId,
        location: 'Turkana County, Kenya',
        walletAddress: 'GD5...DROUGHT2',
        familySize: 5,
        specialNeeds: ['single_parent', 'children'],
        verificationFactors: [
          { factorType: 'possession', value: 'national_id_temp_002', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'voice_sample_002', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'chief_vouch_joseph', weight: 30, verifiedAt: Date.now() }
        ],
        waterNeeds: {
          dailyLiters: 25,
          distanceToWater: 20,
          livestock: 0,
          farming: false
        }
      },
      {
        beneficiaryId: 'DB_003_SOMALIA',
        name: 'Mohamed Hassan Clan',
        disasterId: config.disasterId,
        location: 'Puntland, Somalia',
        walletAddress: 'GD5...DROUGHT3',
        familySize: 12,
        specialNeeds: ['large_family', 'nomadic', 'livestock_dependent'],
        verificationFactors: [
          { factorType: 'possession', value: 'clan_registration_003', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'clan_mark_003', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'elder_vouch_ahmed', weight: 30, verifiedAt: Date.now() }
        ],
        waterNeeds: {
          dailyLiters: 60,
          distanceToWater: 25,
          livestock: 20, // camels, goats
          farming: false
        }
      }
    ];

    for (const beneficiary of droughtBeneficiaries) {
      await sdk.beneficiaryClient.registerBeneficiary(
        config.adminKey,
        beneficiary.beneficiaryId,
        beneficiary.name,
        beneficiary.disasterId,
        beneficiary.location,
        beneficiary.walletAddress,
        beneficiary.familySize,
        beneficiary.specialNeeds,
        beneficiary.verificationFactors
      );
    }

    console.log(`✅ Registered ${droughtBeneficiaries.length} drought beneficiaries`);

    // Step 4: Onboard water service providers and suppliers
    console.log('🏪 Onboarding water service providers...');
    const waterProviders = [
      {
        merchantId: 'WATER_TRUCK_ETH_001',
        name: 'Ethiopia Water Trucking Co.',
        businessType: 'water_trucking',
        location: {
          latitude: 9.1450,
          longitude: 40.4897,
          address: 'Jigjiga Water Depot',
          city: 'Jigjiga',
          country: 'Ethiopia',
          postalCode: '1010',
          facilityName: 'Water Trucking Base',
          contactPerson: 'Operations Manager'
        },
        contactInfo: '+251-9-1234-5678',
        stellarAddress: 'GD5...WATER1',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '50000',
        monthlyLimit: '500000',
        verificationDocuments: ['water_trucking_license', 'health_safety_cert'],
        serviceArea: 'Somali Region, Ethiopia'
      },
      {
        merchantId: 'WATER_POINT_KEN_001',
        name: 'Turkana Water Services',
        businessType: 'water_point',
        location: {
          latitude: 3.0864,
          longitude: 34.7531,
          address: 'Lodwar Water Point',
          city: 'Lodwar',
          country: 'Kenya',
          postalCode: '30500',
          facilityName: 'Main Water Distribution Point',
          contactPerson: 'Water Point Manager'
        },
        contactInfo: '+254-7-1234-5678',
        stellarAddress: 'GD5...WATER2',
        acceptedTokens: ['XLM'],
        dailyLimit: '30000',
        monthlyLimit: '300000',
        verificationDocuments: ['water_point_permit', 'quality_certification'],
        serviceArea: 'Turkana County, Kenya'
      },
      {
        merchantId: 'WATER_TREAT_SOM_001',
        name: 'Somalia Water Treatment Ltd.',
        businessType: 'water_treatment',
        location: {
          latitude: 10.4800,
          longitude: 47.0000,
          address: 'Garowe Treatment Plant',
          city: 'Garowe',
          country: 'Somalia',
          postalCode: '50100',
          facilityName: 'Water Treatment Facility',
          contactPerson: 'Plant Manager'
        },
        contactInfo: '+252-6-1234-5678',
        stellarAddress: 'GD5...WATER3',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '40000',
        monthlyLimit: '400000',
        verificationDocuments: ['treatment_license', 'environmental_cert'],
        serviceArea: 'Puntland, Somalia'
      }
    ];

    for (const provider of waterProviders) {
      const request = sdk.merchantClient.createOnboardingRequest(
        provider.name,
        provider.businessType,
        provider.location,
        provider.contactInfo,
        provider.stellarAddress
      );
      
      await sdk.merchantClient.registerMerchant(
        config.adminKey,
        provider.merchantId,
        request
      );
      
      await sdk.merchantClient.verifyMerchant(
        config.adminKey,
        provider.merchantId,
        true,
        'UN OCHA approved water service provider'
      );
    }

    console.log(`✅ Onboarded ${waterProviders.length} water service providers`);

    // Step 5: Create water allocation transfers for beneficiaries
    console.log('💳 Creating water allocation transfers...');
    const waterTransfers = droughtBeneficiaries.map(beneficiary => {
      // Calculate water allocation based on family size and needs
      const baseAllocation = beneficiary.familySize * 50; // 50 XLM per person
      const livestockBonus = beneficiary.waterNeeds.livestock * 10; // 10 XLM per livestock unit
      const farmingBonus = beneficiary.waterNeeds.farming ? 100 : 0; // Extra for farming
      const distanceBonus = beneficiary.waterNeeds.distanceToWater > 10 ? 50 : 0; // Extra for remote areas
      
      const totalAmount = (BigInt(baseAllocation) + BigInt(livestockBonus) + BigInt(farmingBonus) + BigInt(distanceBonus)).toString();
      
      return {
        transferId: `WT_MONTHLY_${beneficiary.beneficiaryId}`,
        beneficiaryId: beneficiary.beneficiaryId,
        amount: totalAmount,
        token: 'XLM',
        expiresAt: Date.now() + (35 * 24 * 60 * 60 * 1000), // 35 days
        purpose: `Monthly water allocation - ${beneficiary.familySize} people`,
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('water', (BigInt(totalAmount) * BigInt(70) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('water_treatment', (BigInt(totalAmount) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('water_storage', (BigInt(totalAmount) * BigInt(10) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('transport', (BigInt(totalAmount) * BigInt(5) / BigInt(100)).toString()),
          sdk.transferClient.createLocationRule(beneficiary.location)
        ]
      };
    });

    for (const transfer of waterTransfers) {
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

    console.log(`✅ Created ${waterTransfers.length} water allocation transfers`);

    // Step 6: Track water supply chain
    console.log('📦 Setting up water supply tracking...');
    const waterSupplies = [
      {
        donorId: 'UNICEF_WATER',
        supplyType: SUPPLY_TYPES.WATER,
        quantity: '1000000',
        unit: 'liters',
        originLatLng: '9.1450,40.4897',
        originAddress: 'UNICEF Ethiopia Warehouse',
        originFacility: 'UNICEF Water Distribution Center',
        originContact: 'Water Program Coordinator',
        destinationLatLng: '9.1450,40.4897',
        destinationAddress: 'Somali Region Distribution Points',
        destinationFacility: 'Regional Water Distribution',
        destinationContact: 'Regional Water Manager',
        estimatedArrival: Date.now() + (14 * 24 * 60 * 60 * 1000), // 2 weeks
        temperatureRequirements: undefined,
        specialHandling: ['potable_water', 'bulk_transport']
      },
      {
        donorId: 'WHO_TREATMENT',
        supplyType: SUPPLY_TYPES.TOOLS,
        quantity: '50000',
        unit: 'units',
        originLatLng: '-1.2921,36.8219',
        originAddress: 'WHO Kenya Office',
        originFacility: 'WHO Supply Chain',
        originContact: 'Supply Chain Manager',
        destinationLatLng: '3.0864,34.7531',
        destinationAddress: 'Turkana Treatment Centers',
        destinationFacility: 'Water Treatment Facilities',
        destinationContact: 'Treatment Center Manager',
        estimatedArrival: Date.now() + (10 * 24 * 60 * 60 * 1000), // 10 days
        temperatureRequirements: undefined,
        specialHandling: ['water_treatment_kits', 'medical_supplies']
      },
      {
        donorId: 'WFP_STORAGE',
        supplyType: SUPPLY_TYPES.OTHER,
        quantity: '10000',
        unit: 'units',
        originLatLng: '2.0469,45.3182',
        originAddress: 'WFP Somalia Warehouse',
        originFacility: 'WFP Storage Solutions',
        originContact: 'Logistics Coordinator',
        destinationLatLng: '10.4800,47.0000',
        destinationAddress: 'Puntland Storage Facilities',
        destinationFacility: 'Water Storage Facilities',
        destinationContact: 'Storage Manager',
        estimatedArrival: Date.now() + (21 * 24 * 60 * 60 * 1000), // 3 weeks
        temperatureRequirements: undefined,
        specialHandling: ['water_tanks', 'storage_containers']
      }
    ];

    for (const supply of waterSupplies) {
      const request = sdk.trackerClient.createSupplyChainRequest(
        supply.donorId,
        supply.supplyType,
        supply.quantity,
        supply.unit,
        supply.originLatLng,
        supply.originAddress,
        supply.originFacility,
        supply.originContact,
        supply.destinationLatLng,
        supply.destinationAddress,
        supply.destinationFacility,
        supply.destinationContact,
        supply.estimatedArrival,
        supply.temperatureRequirements,
        supply.specialHandling
      );
      
      await sdk.trackerClient.createShipment(config.adminKey, request);
    }

    console.log(`✅ Set up tracking for ${waterSupplies.length} water supply shipments`);

    // Step 7: Set up SMS-based water monitoring
    console.log('📱 Setting up SMS water monitoring system...');
    const smsNumbers = [
      '+251-9-1234-0001', // Ethiopia SMS gateway
      '+254-7-1234-0001', // Kenya SMS gateway
      '+252-6-1234-0001'  // Somalia SMS gateway
    ];

    for (const phoneNumber of smsNumbers) {
      const session = sdk.beneficiaryClient.createUSSDSession(phoneNumber);
      console.log(`📱 SMS monitoring for ${phoneNumber}: ${session.sessionId}`);
    }

    // Step 8: Generate QR codes for water collection points
    console.log('📱 Generating QR codes for water collection...');
    for (const beneficiary of droughtBeneficiaries) {
      const qrCode = sdk.beneficiaryClient.generateBeneficiaryQRCode(
        beneficiary.beneficiaryId,
        await sdk.beneficiaryClient.getBeneficiary(beneficiary.beneficiaryId)
      );
      console.log(`📲 Water QR Code for ${beneficiary.name}:`, qrCode.substring(0, 100) + '...');
    }

    // Step 9: Display program summary
    console.log('\n🌵 DROUGHT RELIEF WATER DISTRIBUTION PROGRAM SUMMARY');
    console.log('='.repeat(50));
    console.log(`🌍 Region: ${config.affectedRegion}`);
    console.log(`👥 Affected Population: ${config.affectedPopulation.toLocaleString()}`);
    console.log(`🚰 Water Points: ${config.waterDistributionPoints}`);
    console.log(`💰 Monthly Budget: ${config.monthlyWaterBudget} XLM`);
    console.log(`⏱️ Duration: ${config.programDuration} months`);
    console.log('');
    console.log('📊 Program Components:');
    console.log(`  💵 Water Funds: ${waterFunds.length}`);
    console.log(`  👥 Beneficiaries: ${droughtBeneficiaries.length}`);
    console.log(`  🏪 Water Providers: ${waterProviders.length}`);
    console.log(`  💳 Water Allocations: ${waterTransfers.length}`);
    console.log(`  📦 Water Supplies: ${waterSupplies.length}`);
    console.log('');
    console.log('💧 Water Distribution Strategy:');
    waterFunds.forEach(fund => {
      console.log(`  🚰 ${fund.name}: ${fund.percentage}% of budget`);
    });
    console.log('');
    console.log('👥 Beneficiary Water Needs:');
    droughtBeneficiaries.forEach(beneficiary => {
      console.log(`  👤 ${beneficiary.name}: ${beneficiary.waterNeeds.dailyLiters}L/day, ${beneficiary.waterNeeds.distanceToWater}km to water`);
    });
    console.log('');
    console.log('🔐 Protection & Security:');
    console.log('  ✅ Multi-sig fund management');
    console.log('  ✅ Biometric-free identity verification');
    console.log('  ✅ Category-based spending restrictions');
    console.log('  ✅ Location-based access control');
    console.log('  ✅ Water supply chain tracking');
    console.log('  ✅ SMS monitoring system');
    console.log('  ✅ QR code water collection');
    console.log('  ✅ Fraud detection monitoring');
    console.log('');
    console.log('📞 SMS Monitoring Numbers:');
    smsNumbers.forEach(number => {
      console.log(`  📱 ${number}`);
    });
    console.log('');
    console.log('🚀 Drought relief water distribution program is now ACTIVE!');
    console.log('📞 Emergency hotline: +1-555-DROUGHT-HELP');
    console.log('🌐 Management portal: https://relief.stellar.org/drought-relief');
    console.log('📱 Mobile app: Available for download');

  } catch (error) {
    console.error('❌ Error during drought relief program setup:', error);
    throw error;
  }
}

// Additional utility functions for drought relief management
async function processWaterPayment(
  beneficiaryKey: string,
  transferId: string,
  providerId: string,
  amount: string,
  waterService: string
) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const success = await sdk.transferClient.spend(
      beneficiaryKey,
      transferId,
      providerId,
      amount,
      waterService,
      'Water Collection Point'
    );
    
    if (success) {
      console.log(`✅ Water payment processed: ${amount} XLM for ${waterService}`);
    } else {
      console.log(`❌ Payment rejected: spending rules violation`);
    }
  } catch (error) {
    console.error('❌ Water payment error:', error);
  }
}

async function trackWaterSupply(shipmentId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const history = await sdk.trackerClient.getShipmentHistory(shipmentId);
    console.log(`📦 Water supply tracking for ${shipmentId}:`);
    console.log(`  Status: ${history.shipment?.currentStatus}`);
    console.log(`  Checkpoints: ${history.shipment?.checkpoints.length}`);
    console.log(`  Delivered: ${history.confirmation ? 'Yes' : 'No'}`);
    
    // Check for quality alerts
    const alerts = await sdk.trackerClient.getTemperatureAlerts();
    if (alerts.length > 0) {
      console.log('🧪 Water Quality Alerts:');
      alerts.forEach(([id, alert]) => {
        console.log(`  ⚠️ ${id}: ${alert}`);
      });
    }
  } catch (error) {
    console.error('❌ Water supply tracking error:', error);
  }
}

async function generateWaterReport(beneficiaryId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const beneficiary = await sdk.beneficiaryClient.getBeneficiary(beneficiaryId);
    const transfers = await sdk.transferClient.listBeneficiaryTransfers(beneficiaryId);
    
    console.log(`💧 Water Report for ${beneficiary?.name}:`);
    console.log(`  ID: ${beneficiary?.id}`);
    console.log(`  Family Size: ${beneficiary?.familySize}`);
    console.log(`  Location: ${beneficiary?.location}`);
    console.log(`  Trust Score: ${beneficiary?.trustScore}/100`);
    console.log(`  Active Allocations: ${transfers.length}`);
    
    let totalSpent = BigInt(0);
    let totalRemaining = BigInt(0);
    
    transfers.forEach((transfer: any) => {
      totalSpent += BigInt(transfer.spentAmount);
      totalRemaining += BigInt(transfer.remainingAmount);
    });
    
    console.log(`  Total Spent: ${totalSpent.toString()} XLM`);
    console.log(`  Total Remaining: ${totalRemaining.toString()} XLM`);
    
  } catch (error) {
    console.error('❌ Water report error:', error);
  }
}

// Export for use in other modules
export {
  droughtRelief,
  processWaterPayment,
  trackWaterSupply,
  generateWaterReport
};

// Run the drought relief program if this file is executed directly
if (require.main === module) {
  droughtRelief().catch(console.error);
}
