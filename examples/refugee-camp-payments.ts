import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG, 
  DISASTER_TYPES,
  SUPPLY_TYPES 
} from '../sdk/src/index';

/**
 * Refugee Camp Cash-for-Work Program Example
 * 
 * This example demonstrates how to implement a cash-for-work program
 * in a refugee camp setting using the Stellar Disaster Relief platform.
 */

async function refugeeCampPayments() {
  console.log('🏕️ Starting Refugee Camp Cash-for-Work Program');
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  // Configuration
  const config = {
    adminKey: 'SADMIN_KEY_HERE',
    ngoSigner: 'SNGO_KEY_HERE',
    govSigner: 'SGOV_KEY_HERE',
    unSigner: 'SUN_KEY_HERE',
    campId: 'CAMP_ZAATARI_2024',
    campName: 'Zaatari Refugee Camp',
    location: 'Mafraq, Jordan',
    totalPopulation: 80000,
    activeWorkers: 5000,
    monthlyBudget: '2000000', // 2M XLM equivalent
    programDuration: 12 // months
  };

  try {
    // Step 1: Initialize refugee camp program
    console.log('📋 Initializing refugee camp program...');
    await sdk.aidClient.deployEmergencyFund(
      config.adminKey,
      'camp_cash_for_work',
      'Refugee Camp Cash-for-Work Program',
      'Cash-for-work program for refugee camp residents',
      '0',
      'conflict',
      config.location,
      Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
      [config.adminKey, config.ngoSigner],
      2
    );

    // Step 2: Create specialized funds for different work categories
    console.log('💰 Creating work category funds...');
    const workFunds = [
      {
        fundId: 'CAMP_CONSTRUCTION',
        name: 'Construction & Maintenance',
        description: 'Camp construction, shelter maintenance, and infrastructure',
        percentage: 30
      },
      {
        fundId: 'CAMP_SANITATION',
        name: 'Sanitation & Waste Management',
        description: 'Sanitation facilities, waste collection, and environmental services',
        percentage: 25
      },
      {
        fundId: 'CAMP_EDUCATION',
        name: 'Education & Child Care',
        description: 'Teaching assistance, child care, and educational support',
        percentage: 20
      },
      {
        fundId: 'CAMP_HEALTHCARE',
        name: 'Healthcare Support',
        description: 'Medical assistance, health education, and clinic support',
        percentage: 15
      },
      {
        fundId: 'CAMP_FOOD_SERVICES',
        name: 'Food Services & Distribution',
        description: 'Food preparation, distribution, and kitchen assistance',
        percentage: 10
      }
    ];

    for (const fund of workFunds) {
      const amount = (BigInt(config.monthlyBudget) * BigInt(fund.percentage) / BigInt(100)).toString();
      await sdk.aidClient.deployEmergencyFund(
        config.adminKey,
        fund.fundId,
        fund.name,
        fund.description,
        amount,
        'conflict',
        config.location,
        Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
        [config.adminKey, config.ngoSigner],
        2
      );
    }

    console.log(`✅ Created ${workFunds.length} work category funds`);

    // Step 3: Register refugee workers with biometric-free identity
    console.log('👥 Registering refugee workers...');
    const refugeeWorkers = [
      {
        beneficiaryId: 'RW_001_CONSTRUCTION',
        name: 'Ahmad Hassan',
        disasterId: config.campId,
        location: 'Zone A, Block 12',
        walletAddress: 'GD5...REFUGEE1',
        familySize: 6,
        specialNeeds: ['large_family'],
        verificationFactors: [
          { factorType: 'possession', value: 'unhcr_card_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_001', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'camp_leader_vouch_mohammed', weight: 30, verifiedAt: Date.now() }
        ],
        workCategory: 'CAMP_CONSTRUCTION',
        skills: ['carpentry', 'construction', 'general_labor']
      },
      {
        beneficiaryId: 'RW_002_EDUCATION',
        name: 'Fatima Al-Rashid',
        disasterId: config.campId,
        location: 'Zone B, Block 8',
        walletAddress: 'GD5...REFUGEE2',
        familySize: 4,
        specialNeeds: ['single_parent'],
        verificationFactors: [
          { factorType: 'possession', value: 'unhcr_card_002', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'voice_sample_002', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'teacher_vouch_sarah', weight: 30, verifiedAt: Date.now() }
        ],
        workCategory: 'CAMP_EDUCATION',
        skills: ['teaching', 'child_care', 'arabic_language']
      },
      {
        beneficiaryId: 'RW_003_HEALTHCARE',
        name: 'Mohammed Khalid',
        disasterId: config.campId,
        location: 'Zone C, Block 15',
        walletAddress: 'GD5...REFUGEE3',
        familySize: 5,
        specialNeeds: ['medical_training'],
        verificationFactors: [
          { factorType: 'possession', value: 'unhcr_card_003', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_003', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'clinic_vouch_dr_ahmed', weight: 30, verifiedAt: Date.now() }
        ],
        workCategory: 'CAMP_HEALTHCARE',
        skills: ['first_aid', 'medical_assistance', 'translation']
      },
      {
        beneficiaryId: 'RW_004_SANITATION',
        name: 'Aisha Mahmoud',
        disasterId: config.campId,
        location: 'Zone A, Block 3',
        walletAddress: 'GD5...REFUGEE4',
        familySize: 3,
        specialNeeds: [],
        verificationFactors: [
          { factorType: 'possession', value: 'unhcr_card_004', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_004', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'block_leader_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        workCategory: 'CAMP_SANITATION',
        skills: ['sanitation', 'waste_management', 'cleaning']
      },
      {
        beneficiaryId: 'RW_005_FOOD_SERVICES',
        name: 'Omar Ibrahim',
        disasterId: config.campId,
        location: 'Zone B, Block 11',
        walletAddress: 'GD5...REFUGEE5',
        familySize: 7,
        specialNeeds: ['large_family', 'elderly_care'],
        verificationFactors: [
          { factorType: 'possession', value: 'unhcr_card_005', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_005', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'kitchen_supervisor_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        workCategory: 'CAMP_FOOD_SERVICES',
        skills: ['cooking', 'food_preparation', 'distribution']
      }
    ];

    for (const worker of refugeeWorkers) {
      await sdk.beneficiaryClient.registerBeneficiary(
        config.adminKey,
        worker.beneficiaryId,
        worker.name,
        worker.disasterId,
        worker.location,
        worker.walletAddress,
        worker.familySize,
        worker.specialNeeds,
        worker.verificationFactors
      );
    }

    console.log(`✅ Registered ${refugeeWorkers.length} refugee workers`);

    // Step 4: Onboard camp merchants and service providers
    console.log('🏪 Onboarding camp merchants...');
    const campMerchants = [
      {
        merchantId: 'CAMP_STORE_GENERAL',
        name: 'Camp General Store',
        businessType: 'grocery',
        location: {
          latitude: 32.3225,
          longitude: 36.2048,
          address: 'Main Market Area',
          city: 'Zaatari Camp',
          country: 'Jordan',
          postalCode: '77110',
          facilityName: 'Camp General Store',
          contactPerson: 'Camp Store Manager'
        },
        contactInfo: '+962-7-9000-0001',
        stellarAddress: 'GD5...CAMPSTORE1',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '20000',
        monthlyLimit: '200000',
        verificationDocuments: ['camp_permit_001', 'un_agreement']
      },
      {
        merchantId: 'CAMP_PHARMACY',
        name: 'Camp Pharmacy',
        businessType: 'pharmacy',
        location: {
          latitude: 32.3225,
          longitude: 36.2048,
          address: 'Health Center Building',
          city: 'Zaatari Camp',
          country: 'Jordan',
          postalCode: '77110',
          facilityName: 'Camp Pharmacy',
          contactPerson: 'Pharmacist Ahmed'
        },
        contactInfo: '+962-7-9000-0002',
        stellarAddress: 'GD5...CAMPPHARM1',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '15000',
        monthlyLimit: '150000',
        verificationDocuments: ['pharmacy_license_001', 'medical_permit']
      },
      {
        merchantId: 'CAMP_CLOTHING',
        name: 'Camp Clothing Store',
        businessType: 'clothing',
        location: {
          latitude: 32.3225,
          longitude: 36.2048,
          address: 'Distribution Center',
          city: 'Zaatari Camp',
          country: 'Jordan',
          postalCode: '77110',
          facilityName: 'Camp Clothing Store',
          contactPerson: 'Distribution Manager'
        },
        contactInfo: '+962-7-9000-0003',
        stellarAddress: 'GD5...CAMPCLOTH1',
        acceptedTokens: ['XLM'],
        dailyLimit: '10000',
        monthlyLimit: '100000',
        verificationDocuments: ['distribution_permit_001']
      }
    ];

    for (const merchant of campMerchants) {
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
      
      await sdk.merchantClient.verifyMerchant(
        config.adminKey,
        merchant.merchantId,
        true,
        'UNHCR approved camp merchant'
      );
    }

    console.log(`✅ Onboarded ${campMerchants.length} camp merchants`);

    // Step 5: Create monthly cash transfers for workers
    console.log('💳 Creating monthly cash transfers...');
    const monthlyTransfers = refugeeWorkers.map(worker => {
      const baseAmount = worker.familySize <= 4 ? '300' : '400'; // Base amount per family size
      const skillBonus = worker.skills.length > 2 ? '100' : '50'; // Skill-based bonus
      const totalAmount = (BigInt(baseAmount) + BigInt(skillBonus)).toString();
      
      return {
        transferId: `CT_MONTHLY_${worker.beneficiaryId}`,
        beneficiaryId: worker.beneficiaryId,
        amount: totalAmount,
        token: 'XLM',
        expiresAt: Date.now() + (35 * 24 * 60 * 60 * 1000), // 35 days with buffer
        purpose: `Monthly cash-for-work payment - ${worker.workCategory}`,
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('food', (BigInt(totalAmount) * BigInt(40) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('medical', (BigInt(totalAmount) * BigInt(20) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('clothing', (BigInt(totalAmount) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('education', (BigInt(totalAmount) * BigInt(10) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('other', (BigInt(totalAmount) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createLocationRule('Zaatari Camp')
        ]
      };
    });

    for (const transfer of monthlyTransfers) {
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

    console.log(`✅ Created ${monthlyTransfers.length} monthly cash transfers`);

    // Step 6: Track essential supplies for the camp
    console.log('📦 Setting up camp supply tracking...');
    const campSupplies = [
      {
        donorId: 'UNHCR_SUPPLIES',
        supplyType: SUPPLY_TYPES.FOOD,
        quantity: '100000',
        unit: 'kg',
        originLatLng: '31.9539,35.9106',
        originAddress: 'UNHCR Amman Warehouse',
        originFacility: 'UNHCR Distribution Center',
        originContact: 'Supply Chain Manager',
        destinationLatLng: '32.3225,36.2048',
        destinationAddress: 'Zaatari Camp Warehouse',
        destinationFacility: 'Camp Main Warehouse',
        destinationContact: 'Warehouse Manager',
        estimatedArrival: Date.now() + (7 * 24 * 60 * 60 * 1000), // 1 week
        temperatureRequirements: undefined,
        specialHandling: ['bulk_food', 'perishable']
      },
      {
        donorId: 'WHO_MEDICAL',
        supplyType: SUPPLY_TYPES.MEDICINE,
        quantity: '50000',
        unit: 'units',
        originLatLng: '31.9539,35.9106',
        originAddress: 'WHO Jordan Office',
        originFacility: 'WHO Medical Supplies',
        originContact: 'Medical Coordinator',
        destinationLatLng: '32.3225,36.2048',
        destinationAddress: 'Camp Health Center',
        destinationFacility: 'Camp Health Center',
        destinationContact: 'Head Doctor',
        estimatedArrival: Date.now() + (5 * 24 * 60 * 60 * 1000), // 5 days
        temperatureRequirements: {
          minTemp: 2,
          maxTemp: 25,
          critical: true
        },
        specialHandling: ['refrigerated', 'medical_supplies', 'controlled']
      },
      {
        donorId: 'UNICEF_EDUCATION',
        supplyType: SUPPLY_TYPES.TOOLS,
        quantity: '20000',
        unit: 'units',
        originLatLng: '31.9539,35.9106',
        originAddress: 'UNICEF Jordan Warehouse',
        originFacility: 'UNICEF Education Supplies',
        originContact: 'Education Coordinator',
        destinationLatLng: '32.3225,36.2048',
        destinationAddress: 'Camp School Complex',
        destinationFacility: 'Camp School',
        destinationContact: 'School Principal',
        estimatedArrival: Date.now() + (10 * 24 * 60 * 60 * 1000), // 10 days
        temperatureRequirements: undefined,
        specialHandling: ['educational_materials']
      }
    ];

    for (const supply of campSupplies) {
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

    console.log(`✅ Set up tracking for ${campSupplies.length} camp supply shipments`);

    // Step 7: Set up USSD access for feature phone users
    console.log('📞 Setting up USSD access for refugee community...');
    const ussdNumbers = [
      '+962-7-9000-1001', // Zone A
      '+962-7-9000-1002', // Zone B  
      '+962-7-9000-1003', // Zone C
      '+962-7-9000-1004', // Health Center
      '+962-7-9000-1005'  // Main Office
    ];

    for (const phoneNumber of ussdNumbers) {
      const session = sdk.beneficiaryClient.createUSSDSession(phoneNumber);
      console.log(`📱 USSD access for ${phoneNumber}: ${session.sessionId}`);
    }

    // Step 8: Generate QR codes for offline access
    console.log('📱 Generating QR codes for offline access...');
    for (const worker of refugeeWorkers) {
      const qrCode = sdk.beneficiaryClient.generateBeneficiaryQRCode(
        worker.beneficiaryId,
        await sdk.beneficiaryClient.getBeneficiary(worker.beneficiaryId)
      );
      console.log(`📲 QR Code for ${worker.name}:`, qrCode.substring(0, 100) + '...');
    }

    // Step 9: Display program summary
    console.log('\n🏕️ REFUGEE CAMP CASH-FOR-WORK PROGRAM SUMMARY');
    console.log('='.repeat(50));
    console.log(`🏕️ Camp: ${config.campName}`);
    console.log(`📍 Location: ${config.location}`);
    console.log(`👥 Population: ${config.totalPopulation.toLocaleString()}`);
    console.log(`💼 Workers: ${config.activeWorkers.toLocaleString()}`);
    console.log(`💰 Monthly Budget: ${config.monthlyBudget} XLM`);
    console.log(`⏱️ Duration: ${config.programDuration} months`);
    console.log('');
    console.log('📊 Program Components:');
    console.log(`  💵 Work Funds: ${workFunds.length}`);
    console.log(`  👥 Workers: ${refugeeWorkers.length}`);
    console.log(`  🏪 Merchants: ${campMerchants.length}`);
    console.log(`  💳 Transfers: ${monthlyTransfers.length}`);
    console.log(`  📦 Supplies: ${campSupplies.length}`);
    console.log('');
    console.log('🔐 Protection & Security:');
    console.log('  ✅ Multi-sig fund management');
    console.log('  ✅ Biometric-free identity verification');
    console.log('  ✅ Category-based spending restrictions');
    console.log('  ✅ Location-based access control');
    console.log('  ✅ Supply chain tracking');
    console.log('  ✅ Fraud detection monitoring');
    console.log('  ✅ Offline QR code access');
    console.log('  ✅ USSD feature phone support');
    console.log('');
    console.log('💼 Work Categories & Benefits:');
    workFunds.forEach(fund => {
      console.log(`  🏗️  ${fund.name}: ${fund.percentage}% of budget`);
    });
    console.log('');
    console.log('📞 USSD Access Numbers:');
    ussdNumbers.forEach(number => {
      console.log(`  📱 ${number}`);
    });
    console.log('');
    console.log('🚀 Refugee camp cash-for-work program is now ACTIVE!');
    console.log('📞 Camp hotline: +962-7-9000-0000');
    console.log('🌐 Management portal: https://relief.stellar.org/zaatari-camp');
    console.log('📱 Mobile app: Available for download');

  } catch (error) {
    console.error('❌ Error during refugee camp program setup:', error);
    throw error;
  }
}

// Additional utility functions for refugee camp management
async function processWorkerPayment(
  workerKey: string,
  transferId: string,
  merchantId: string,
  amount: string,
  category: string
) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const success = await sdk.transferClient.spend(
      workerKey,
      transferId,
      merchantId,
      amount,
      category,
      'Zaatari Camp'
    );
    
    if (success) {
      console.log(`✅ Worker payment processed: ${amount} XLM for ${category}`);
    } else {
      console.log(`❌ Payment rejected: spending rules violation`);
    }
  } catch (error) {
    console.error('❌ Worker payment error:', error);
  }
}

async function trackCampSupplies(shipmentId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const history = await sdk.trackerClient.getShipmentHistory(shipmentId);
    console.log(`📦 Camp supply tracking for ${shipmentId}:`);
    console.log(`  Status: ${history.shipment?.currentStatus}`);
    console.log(`  Checkpoints: ${history.shipment?.checkpoints.length}`);
    console.log(`  Delivered: ${history.confirmation ? 'Yes' : 'No'}`);
    
    // Check for temperature alerts
    const alerts = await sdk.trackerClient.getTemperatureAlerts();
    if (alerts.length > 0) {
      console.log('🌡️ Temperature Alerts:');
      alerts.forEach(([id, alert]) => {
        console.log(`  ⚠️ ${id}: ${alert}`);
      });
    }
  } catch (error) {
    console.error('❌ Supply tracking error:', error);
  }
}

async function generateWorkerReport(workerId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const worker = await sdk.beneficiaryClient.getBeneficiary(workerId);
    const transfers = await sdk.transferClient.listBeneficiaryTransfers(workerId);
    
    console.log(`👊 Worker Report for ${worker?.name}:`);
    console.log(`  ID: ${worker?.id}`);
    console.log(`  Family Size: ${worker?.familySize}`);
    console.log(`  Location: ${worker?.location}`);
    console.log(`  Trust Score: ${worker?.trustScore}/100`);
    console.log(`  Active Transfers: ${transfers.length}`);
    
    let totalSpent = BigInt(0);
    let totalRemaining = BigInt(0);
    
    transfers.forEach(transfer => {
      totalSpent += BigInt(transfer.spentAmount);
      totalRemaining += BigInt(transfer.remainingAmount);
    });
    
    console.log(`  Total Spent: ${totalSpent.toString()} XLM`);
    console.log(`  Total Remaining: ${totalRemaining.toString()} XLM`);
    
  } catch (error) {
    console.error('❌ Worker report error:', error);
  }
}

// Export for use in other modules
export {
  refugeeCampPayments,
  processWorkerPayment,
  trackCampSupplies,
  generateWorkerReport
};

// Run the refugee camp program if this file is executed directly
if (require.main === module) {
  refugeeCampPayments().catch(console.error);
}
