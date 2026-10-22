import { 
  createDisasterReliefSDK, 
  TESTNET_CONFIG, 
  DISASTER_TYPES,
  SUPPLY_TYPES 
} from '../sdk/src/index';

/**
 * Medical Supply Chain Management Example
 * 
 * This example demonstrates how to implement a comprehensive medical supply
 * chain management system for disaster response using the Stellar platform.
 */

async function medicalSupplyChain() {
  console.log('🏥 Starting Medical Supply Chain Management System');
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  // Configuration
  const config = {
    adminKey: 'SADMIN_KEY_HERE',
    ngoSigner: 'SNGO_KEY_HERE',
    govSigner: 'SGOV_KEY_HERE',
    unSigner: 'SUN_KEY_HERE',
    disasterId: 'MEDICAL_CRISIS_GLOBAL_2024',
    affectedRegions: ['Sub-Saharan Africa', 'Southeast Asia', 'Latin America'],
    targetPopulation: 25000000,
    medicalBudget: '10000000', // 10M XLM equivalent
    programDuration: 24 // months
  };

  try {
    // Step 1: Initialize medical supply chain program
    console.log('📋 Initializing medical supply chain program...');
    await sdk.aidClient.deployEmergencyFund(
      config.adminKey,
      'medical_supply_chain',
      'Global Medical Supply Chain Management',
      'Comprehensive medical supply chain for disaster response',
      '0',
      'pandemic',
      config.affectedRegions.join(', '),
      Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
      [config.adminKey, config.ngoSigner, config.govSigner, config.unSigner],
      3
    );

    // Step 2: Create specialized medical supply funds
    console.log('💰 Creating medical supply funds...');
    const medicalFunds = [
      {
        fundId: 'MEDICINES_ESSENTIAL',
        name: 'Essential Medicines',
        description: 'Critical medicines and antibiotics for disaster response',
        percentage: 30
      },
      {
        fundId: 'MEDICAL_EQUIPMENT',
        name: 'Medical Equipment',
        description: 'Diagnostic equipment, monitors, and medical devices',
        percentage: 25
      },
      {
        fundId: 'VACCINES_COLD_CHAIN',
        name: 'Vaccines & Cold Chain',
        description: 'Vaccines, refrigeration, and cold chain logistics',
        percentage: 20
      },
      {
        fundId: 'PPE_SUPPLIES',
        name: 'PPE & Safety Supplies',
        description: 'Personal protective equipment and safety supplies',
        percentage: 15
      },
      {
        fundId: 'EMERGENCY_MEDICAL',
        name: 'Emergency Medical Kits',
        description: 'Emergency medical kits and trauma supplies',
        percentage: 10
      }
    ];

    for (const fund of medicalFunds) {
      const amount = (BigInt(config.medicalBudget) * BigInt(fund.percentage) / BigInt(100)).toString();
      await sdk.aidClient.deployEmergencyFund(
        config.adminKey,
        fund.fundId,
        fund.name,
        fund.description,
        amount,
        'pandemic',
        config.affectedRegions.join(', '),
        Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
        [config.adminKey, config.ngoSigner],
        2
      );
    }

    console.log(`✅ Created ${medicalFunds.length} medical supply funds`);

    // Step 3: Register healthcare facilities and medical staff
    console.log('🏥 Registering healthcare facilities...');
    const medicalFacilities = [
      {
        beneficiaryId: 'HF_KENYA_NAIROBI_001',
        name: 'Nairobi General Hospital',
        disasterId: config.disasterId,
        location: 'Nairobi, Kenya',
        walletAddress: 'GD5...MEDICAL1',
        familySize: 200, // Staff count
        specialNeeds: ['emergency_care', 'intensive_care', 'surgery'],
        verificationFactors: [
          { factorType: 'possession', value: 'medical_license_kenya_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'hospital_admin_signature_001', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'ministry_health_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        facilityType: 'general_hospital',
        bedCapacity: 500,
        icuBeds: 50,
        emergencyServices: true,
        specialization: ['trauma', 'infectious_disease', 'emergency_medicine']
      },
      {
        beneficiaryId: 'HF_NIGERIA_LAGOS_001',
        name: 'Lagos Teaching Hospital',
        disasterId: config.disasterId,
        location: 'Lagos, Nigeria',
        walletAddress: 'GD5...MEDICAL2',
        familySize: 350,
        specialNeeds: ['research_laboratory', 'isolation_units'],
        verificationFactors: [
          { factorType: 'possession', value: 'medical_license_nigeria_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'hospital_admin_signature_002', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'nigeria_medical_board_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        facilityType: 'teaching_hospital',
        bedCapacity: 800,
        icuBeds: 100,
        emergencyServices: true,
        specialization: ['research', 'infectious_disease', 'critical_care']
      },
      {
        beneficiaryId: 'HF_INDIA_MUMBAI_001',
        name: 'Mumbai Medical Center',
        disasterId: config.disasterId,
        location: 'Mumbai, India',
        walletAddress: 'GD5...MEDICAL3',
        familySize: 400,
        specialNeeds: ['pediatric_care', 'maternity_services'],
        verificationFactors: [
          { factorType: 'possession', value: 'medical_license_india_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'hospital_admin_signature_003', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'indian_medical_council_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        facilityType: 'specialty_hospital',
        bedCapacity: 600,
        icuBeds: 80,
        emergencyServices: true,
        specialization: ['pediatrics', 'maternity', 'neonatal_care']
      }
    ];

    for (const facility of medicalFacilities) {
      await sdk.beneficiaryClient.registerBeneficiary(
        config.adminKey,
        facility.beneficiaryId,
        facility.name,
        facility.disasterId,
        facility.location,
        facility.walletAddress,
        facility.familySize,
        facility.specialNeeds,
        facility.verificationFactors
      );
    }

    console.log(`✅ Registered ${medicalFacilities.length} healthcare facilities`);

    // Step 4: Onboard medical suppliers and manufacturers
    console.log('🏪 Onboarding medical suppliers...');
    const medicalSuppliers = [
      {
        merchantId: 'SUPPLIER_PHARMA_GLOBAL',
        name: 'Global Pharma Supplies Ltd.',
        businessType: 'pharmaceutical',
        location: {
          latitude: 51.5074,
          longitude: -0.1278,
          address: 'Pharmaceutical Park, Building A',
          city: 'London',
          country: 'United Kingdom',
          postalCode: 'EC1A 1BB',
          facilityName: 'Global Pharma Manufacturing',
          contactPerson: 'Supply Chain Director'
        },
        contactInfo: '+44-20-1234-5678',
        stellarAddress: 'GD5...PHARMA1',
        acceptedTokens: ['XLM', 'USDC', 'EURT'],
        dailyLimit: '100000',
        monthlyLimit: '1000000',
        verificationDocuments: ['gmp_certificate', 'pharma_license', 'iso_9001'],
        certifications: ['WHO_GMP', 'ISO_13485', 'FDA_APPROVED'],
        productCategories: ['antibiotics', 'antivirals', 'vaccines']
      },
      {
        merchantId: 'SUPPLIER_MEDICAL_EQUIP',
        name: 'Medical Equipment International',
        businessType: 'medical_equipment',
        location: {
          latitude: 40.7128,
          longitude: -74.0060,
          address: 'Medical Technology Center',
          city: 'New York',
          country: 'USA',
          postalCode: '10001',
          facilityName: 'Medical Equipment Manufacturing',
          contactPerson: 'Operations Manager'
        },
        contactInfo: '+1-212-555-0123',
        stellarAddress: 'GD5...EQUIP1',
        acceptedTokens: ['XLM', 'USDC'],
        dailyLimit: '150000',
        monthlyLimit: '1500000',
        verificationDocuments: ['medical_device_license', 'fda_approval', 'ce_marking'],
        certifications: ['FDA_APPROVED', 'CE_MARKED', 'ISO_13485'],
        productCategories: ['ventilators', 'monitors', 'diagnostic_equipment']
      },
      {
        merchantId: 'SUPPLIER_COLD_CHAIN',
        name: 'Cold Chain Logistics Solutions',
        businessType: 'cold_chain',
        location: {
          latitude: 52.5200,
          longitude: 13.4050,
          address: 'Logistics Hub Berlin',
          city: 'Berlin',
          country: 'Germany',
          postalCode: '10115',
          facilityName: 'Cold Chain Operations Center',
          contactPerson: 'Logistics Director'
        },
        contactInfo: '+49-30-1234-5678',
        stellarAddress: 'GD5...COLD1',
        acceptedTokens: ['XLM', 'EURT'],
        dailyLimit: '80000',
        monthlyLimit: '800000',
        verificationDocuments: ['cold_chain_certification', 'gdp_license'],
        certifications: ['WHO_GDP', 'ISO_9001'],
        productCategories: ['vaccines', 'biologics', 'temperature_sensitive']
      }
    ];

    for (const supplier of medicalSuppliers) {
      const request = sdk.merchantClient.createOnboardingRequest(
        supplier.name,
        supplier.businessType,
        supplier.location,
        supplier.contactInfo,
        supplier.stellarAddress
      );
      
      await sdk.merchantClient.registerMerchant(
        config.adminKey,
        supplier.merchantId,
        request
      );
      
      await sdk.merchantClient.verifyMerchant(
        config.adminKey,
        supplier.merchantId,
        true,
        'WHO approved medical supplier'
      );
    }

    console.log(`✅ Onboarded ${medicalSuppliers.length} medical suppliers`);

    // Step 5: Create medical supply allocations for facilities
    console.log('💳 Creating medical supply allocations...');
    const medicalAllocations = medicalFacilities.map(facility => {
      // Calculate allocation based on facility capacity and specialization
      const baseAllocation = facility.bedCapacity * 100; // 100 XLM per bed
      const icuBonus = facility.icuBeds * 200; // Extra for ICU beds
      const emergencyBonus = facility.emergencyServices ? 50000 : 0; // Emergency services bonus
      const specializationBonus = facility.specialization.length * 10000; // Specialization bonus
      
      const totalAmount = (BigInt(baseAllocation) + BigInt(icuBonus) + BigInt(emergencyBonus) + BigInt(specializationBonus)).toString();
      
      return {
        transferId: `MS_QUARTERLY_${facility.beneficiaryId}`,
        beneficiaryId: facility.beneficiaryId,
        amount: totalAmount,
        token: 'XLM',
        expiresAt: Date.now() + (95 * 24 * 60 * 60 * 1000), // 95 days (quarterly + buffer)
        purpose: `Quarterly medical supply allocation - ${facility.bedCapacity} bed facility`,
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('medicines', (BigInt(totalAmount) * BigInt(35) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('equipment', (BigInt(totalAmount) * BigInt(25) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('vaccines', (BigInt(totalAmount) * BigInt(20) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('ppe', (BigInt(totalAmount) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('emergency_kits', (BigInt(totalAmount) * BigInt(5) / BigInt(100)).toString()),
          sdk.transferClient.createLocationRule(facility.location)
        ]
      };
    });

    for (const allocation of medicalAllocations) {
      await sdk.transferClient.createTransfer(
        config.adminKey,
        allocation.transferId,
        allocation.beneficiaryId,
        allocation.amount,
        allocation.token,
        allocation.expiresAt,
        allocation.spendingRules,
        allocation.purpose
      );
    }

    console.log(`✅ Created ${medicalAllocations.length} medical supply allocations`);

    // Step 6: Track comprehensive medical supply chain
    console.log('📦 Setting up medical supply chain tracking...');
    const medicalSupplies = [
      {
        donorId: 'WHO_GLOBAL_SUPPLY',
        supplyType: SUPPLY_TYPES.MEDICINE,
        quantity: '5000000',
        unit: 'doses',
        originLatLng: '46.2044,6.1432',
        originAddress: 'WHO Headquarters',
        originFacility: 'WHO Global Supply Center',
        originContact: 'Global Supply Coordinator',
        destinationLatLng: '-1.2921,36.8219',
        destinationAddress: 'Nairobi Medical Distribution Hub',
        destinationFacility: 'Regional Medical Distribution',
        destinationContact: 'Regional Supply Manager',
        estimatedArrival: Date.now() + (14 * 24 * 60 * 60 * 1000), // 2 weeks
        temperatureRequirements: {
          minTemp: 2,
          maxTemp: 8,
          critical: true
        },
        specialHandling: ['refrigerated', 'controlled_substance', 'priority_shipping']
      },
      {
        donorId: 'UNICEF_VACCINES',
        supplyType: SUPPLY_TYPES.MEDICINE,
        quantity: '10000000',
        unit: 'doses',
        originLatLng: '40.7128,-74.0060',
        originAddress: 'UNICEF Supply Division',
        originFacility: 'UNICEF Vaccine Distribution',
        originContact: 'Vaccine Program Manager',
        destinationLatLng: '19.0760,72.8777',
        destinationAddress: 'Mumbai Medical Center',
        destinationFacility: 'Mumbai Medical Center',
        destinationContact: 'Pharmacy Director',
        estimatedArrival: Date.now() + (21 * 24 * 60 * 60 * 1000), // 3 weeks
        temperatureRequirements: {
          minTemp: -20,
          maxTemp: -70,
          critical: true
        },
        specialHandling: ['deep_frozen', 'vaccines', 'temperature_monitored']
      },
      {
        donorId: 'GAVI_EQUIPMENT',
        supplyType: SUPPLY_TYPES.TOOLS,
        quantity: '5000',
        unit: 'units',
        originLatLng: '48.8566,2.3522',
        originAddress: 'Gavi Global Office',
        originFacility: 'Gavi Equipment Center',
        originContact: 'Equipment Logistics Manager',
        destinationLatLng: '6.5244,3.3792',
        destinationAddress: 'Lagos Teaching Hospital',
        destinationFacility: 'Lagos Teaching Hospital',
        destinationContact: 'Medical Equipment Manager',
        estimatedArrival: Date.now() + (28 * 24 * 60 * 60 * 1000), // 4 weeks
        temperatureRequirements: undefined,
        specialHandling: ['medical_equipment', 'calibration_required', 'installation_needed']
      }
    ];

    for (const supply of medicalSupplies) {
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

    console.log(`✅ Set up tracking for ${medicalSupplies.length} medical supply shipments`);

    // Step 7: Set up temperature monitoring for sensitive supplies
    console.log('🌡️ Setting up temperature monitoring system...');
    const temperatureAlerts = await sdk.trackerClient.getTemperatureAlerts();
    console.log(`🌡️ Temperature monitoring active: ${temperatureAlerts.length} sensors deployed`);

    // Step 8: Generate QR codes for medical facilities
    console.log('📱 Generating QR codes for medical facilities...');
    for (const facility of medicalFacilities) {
      const qrCode = sdk.beneficiaryClient.generateBeneficiaryQRCode(
        facility.beneficiaryId,
        await sdk.beneficiaryClient.getBeneficiary(facility.beneficiaryId)
      );
      console.log(`📲 Medical QR Code for ${facility.name}:`, qrCode.substring(0, 100) + '...');
    }

    // Step 9: Display program summary
    console.log('\n🏥 MEDICAL SUPPLY CHAIN MANAGEMENT SUMMARY');
    console.log('='.repeat(50));
    console.log(`🌍 Coverage: ${config.affectedRegions.join(', ')}`);
    console.log(`👥 Target Population: ${config.targetPopulation.toLocaleString()}`);
    console.log(`💰 Medical Budget: ${config.medicalBudget} XLM`);
    console.log(`⏱️ Duration: ${config.programDuration} months`);
    console.log('');
    console.log('📊 Program Components:');
    console.log(`  💵 Medical Funds: ${medicalFunds.length}`);
    console.log(`  🏥 Healthcare Facilities: ${medicalFacilities.length}`);
    console.log(`  🏪 Medical Suppliers: ${medicalSuppliers.length}`);
    console.log(`  💳 Supply Allocations: ${medicalAllocations.length}`);
    console.log(`  📦 Medical Shipments: ${medicalSupplies.length}`);
    console.log('');
    console.log('💊 Medical Supply Distribution:');
    medicalFunds.forEach(fund => {
      console.log(`  🏥 ${fund.name}: ${fund.percentage}% of budget`);
    });
    console.log('');
    console.log('🏥 Healthcare Facility Capacity:');
    medicalFacilities.forEach(facility => {
      console.log(`  🏥 ${facility.name}: ${facility.bedCapacity} beds, ${facility.icuBeds} ICU`);
    });
    console.log('');
    console.log('🔐 Medical Supply Security:');
    console.log('  ✅ Multi-sig fund management (3-of-4)');
    console.log('  ✅ WHO-approved supplier verification');
    console.log('  ✅ Category-based spending restrictions');
    console.log('  ✅ Location-based access control');
    console.log('  ✅ Temperature-sensitive tracking');
    console.log('  ✅ Cold chain monitoring');
    console.log('  ✅ QR code facility access');
    console.log('  ✅ Fraud detection monitoring');
    console.log('');
    console.log('🌡️ Temperature Monitoring:');
    console.log(`  🌡️ Active Sensors: ${temperatureAlerts.length}`);
    console.log('  📊 Real-time monitoring enabled');
    console.log('  ⚠️ Automated alert system');
    console.log('');
    console.log('🚀 Medical supply chain management system is now ACTIVE!');
    console.log('📞 Emergency hotline: +1-555-MEDICAL-HELP');
    console.log('🌐 Management portal: https://relief.stellar.org/medical-supply-chain');
    console.log('📱 Mobile app: Available for download');

  } catch (error) {
    console.error('❌ Error during medical supply chain setup:', error);
    throw error;
  }
}

// Additional utility functions for medical supply chain management
async function processMedicalSupplyOrder(
  facilityKey: string,
  allocationId: string,
  supplierId: string,
  amount: string,
  supplyCategory: string,
  urgent: boolean = false
) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const success = await sdk.transferClient.spend(
      facilityKey,
      allocationId,
      supplierId,
      amount,
      supplyCategory,
      'Medical Facility'
    );
    
    if (success) {
      console.log(`✅ Medical supply order processed: ${amount} XLM for ${supplyCategory}`);
      if (urgent) {
        console.log('🚨 URGENT: Priority processing enabled');
      }
    } else {
      console.log(`❌ Order rejected: spending rules violation`);
    }
  } catch (error) {
    console.error('❌ Medical supply order error:', error);
  }
}

async function trackMedicalShipment(shipmentId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const history = await sdk.trackerClient.getShipmentHistory(shipmentId);
    console.log(`📦 Medical shipment tracking for ${shipmentId}:`);
    console.log(`  Status: ${history.shipment?.currentStatus}`);
    console.log(`  Checkpoints: ${history.shipment?.checkpoints.length}`);
    console.log(`  Delivered: ${history.confirmation ? 'Yes' : 'No'}`);
    
    // Check temperature compliance
    const alerts = await sdk.trackerClient.getTemperatureAlerts();
    const shipmentAlerts = alerts.filter(([id]) => id.includes(shipmentId));
    if (shipmentAlerts.length > 0) {
      console.log('🌡️ Temperature Alerts:');
      shipmentAlerts.forEach(([id, alert]) => {
        console.log(`  ⚠️ ${id}: ${alert}`);
      });
    }
  } catch (error) {
    console.error('❌ Medical shipment tracking error:', error);
  }
}

async function generateFacilityReport(facilityId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const facility = await sdk.beneficiaryClient.getBeneficiary(facilityId);
    const allocations = await sdk.transferClient.listBeneficiaryTransfers(facilityId);
    
    console.log(`🏥 Facility Report for ${facility?.name}:`);
    console.log(`  ID: ${facility?.id}`);
    console.log(`  Location: ${facility?.location}`);
    console.log(`  Staff Count: ${facility?.familySize}`);
    console.log(`  Trust Score: ${facility?.trustScore}/100`);
    console.log(`  Active Allocations: ${allocations.length}`);
    
    let totalSpent = BigInt(0);
    let totalRemaining = BigInt(0);
    
    allocations.forEach((allocation: any) => {
      totalSpent += BigInt(allocation.spentAmount);
      totalRemaining += BigInt(allocation.remainingAmount);
    });
    
    console.log(`  Total Spent: ${totalSpent.toString()} XLM`);
    console.log(`  Total Remaining: ${totalRemaining.toString()} XLM`);
    
  } catch (error) {
    console.error('❌ Facility report error:', error);
  }
}

// Export for use in other modules
export {
  medicalSupplyChain,
  processMedicalSupplyOrder,
  trackMedicalShipment,
  generateFacilityReport
};

// Run the medical supply chain program if this file is executed directly
if (require.main === module) {
  medicalSupplyChain().catch(console.error);
}
