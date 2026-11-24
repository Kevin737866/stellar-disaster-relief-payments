import {
  CATEGORY_CLOTHING,
  CATEGORY_FOOD,
  CATEGORY_FUEL,
  CATEGORY_MEDICAL,
  CATEGORY_SHELTER,
  createDisasterReliefSDK,
  DISASTER_TYPES,
  TESTNET_CONFIG,
} from 'stellar-disaster-relief-sdk';

/**
 * Merchant Network Onboarding Example
 * 
 * This example demonstrates how to onboard and manage a network of local merchants
 * for disaster relief payments using the Stellar Disaster Relief platform.
 */

async function merchantOnboarding() {
  console.log('🏪 Starting Merchant Network Onboarding Program');
  
  // Initialize SDK
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  // Configuration
  const config = {
    adminKey: 'SADMIN_KEY_HERE',
    ngoSigner: 'SNGO_KEY_HERE',
    govSigner: 'SGOV_KEY_HERE',
    programId: 'MERCHANT_NETWORK_GLOBAL_2024',
    targetRegions: ['Southeast Asia', 'East Africa', 'Latin America'],
    targetMerchants: 10000,
    onboardingBudget: '2000000', // 2M XLM equivalent
    programDuration: 12 // months
  };

  try {
    // Step 1: Initialize merchant network program
    console.log('📋 Initializing merchant network program...');
    await sdk.aidClient.deployEmergencyFund(
      config.adminKey,
      'merchant_network_development',
      'Global Merchant Network Development',
      'Onboarding and development of local merchant networks for disaster relief',
      '0',
      'economic',
      config.targetRegions.join(', '),
      Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
      [config.adminKey, config.ngoSigner],
      2
    );

    // Step 2: Create merchant development funds
    console.log('💰 Creating merchant development funds...');
    const merchantFunds = [
      {
        fundId: 'MERCHANT_ONBOARDING',
        name: 'Merchant Onboarding Support',
        description: 'Support for merchant registration and verification',
        percentage: 40
      },
      {
        fundId: 'MERCHANT_TRAINING',
        name: 'Merchant Training & Education',
        description: 'Training programs for digital payments and Stellar integration',
        percentage: 25
      },
      {
        fundId: 'MERCHANT_INFRASTRUCTURE',
        name: 'Merchant Infrastructure Support',
        description: 'Equipment and infrastructure for digital payment acceptance',
        percentage: 20
      },
      {
        fundId: 'MERCHANT_VERIFICATION',
        name: 'Merchant Verification & Compliance',
        description: 'Background checks and compliance verification',
        percentage: 15
      }
    ];

    for (const fund of merchantFunds) {
      const amount = (BigInt(config.onboardingBudget) * BigInt(fund.percentage) / BigInt(100)).toString();
      await sdk.aidClient.deployEmergencyFund(
        config.adminKey,
        fund.fundId,
        fund.name,
        fund.description,
        amount,
        'economic',
        config.targetRegions.join(', '),
        Date.now() + (config.programDuration * 30 * 24 * 60 * 60 * 1000),
        [config.adminKey, config.ngoSigner],
        2
      );
    }

    console.log(`✅ Created ${merchantFunds.length} merchant development funds`);

    // Step 3: Register field agents and merchant coordinators
    console.log('👥 Registering field agents and coordinators...');
    const fieldAgents = [
      {
        beneficiaryId: 'FA_THAILAND_001',
        name: 'Somchai Chaiyaporn',
        disasterId: config.programId,
        location: 'Bangkok, Thailand',
        walletAddress: 'GD5...AGENT1',
        familySize: 1,
        specialNeeds: ['field_operations', 'local_language'],
        verificationFactors: [
          { factorType: 'possession', value: 'ngo_id_card_001', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_001', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'regional_manager_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        role: 'field_agent',
        region: 'Southeast Asia',
        targetMerchants: 500,
        languages: ['Thai', 'English', 'Burmese']
      },
      {
        beneficiaryId: 'FA_KENYA_001',
        name: 'Grace Wanjiru',
        disasterId: config.programId,
        location: 'Nairobi, Kenya',
        walletAddress: 'GD5...AGENT2',
        familySize: 1,
        specialNeeds: ['field_operations', 'local_language'],
        verificationFactors: [
          { factorType: 'possession', value: 'ngo_id_card_002', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_002', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'regional_manager_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        role: 'field_agent',
        region: 'East Africa',
        targetMerchants: 750,
        languages: ['Swahili', 'English', 'Somali']
      },
      {
        beneficiaryId: 'FA_COLOMBIA_001',
        name: 'Carlos Rodriguez',
        disasterId: config.programId,
        location: 'Bogotá, Colombia',
        walletAddress: 'GD5...AGENT3',
        familySize: 1,
        specialNeeds: ['field_operations', 'local_language'],
        verificationFactors: [
          { factorType: 'possession', value: 'ngo_id_card_003', weight: 30, verifiedAt: Date.now() },
          { factorType: 'behavioral', value: 'signature_pattern_003', weight: 40, verifiedAt: Date.now() },
          { factorType: 'social', value: 'regional_manager_vouch', weight: 30, verifiedAt: Date.now() }
        ],
        role: 'field_agent',
        region: 'Latin America',
        targetMerchants: 600,
        languages: ['Spanish', 'English', 'Portuguese']
      }
    ];

    for (const agent of fieldAgents) {
      await sdk.beneficiaryClient.registerBeneficiary(
        config.adminKey,
        agent.beneficiaryId,
        agent.name,
        agent.disasterId,
        agent.location,
        agent.walletAddress,
        agent.familySize,
        agent.specialNeeds,
        agent.verificationFactors
      );
    }

    console.log(`✅ Registered ${fieldAgents.length} field agents`);

    // Step 4: Create field agent operation budgets
    console.log('💳 Creating field agent operation budgets...');
    const agentBudgets = fieldAgents.map(agent => {
      const monthlyBudget = (BigInt(agent.targetMerchants) * BigInt(200)).toString(); // 200 XLM per merchant target
      
      return {
        transferId: `FA_BUDGET_MONTHLY_${agent.beneficiaryId}`,
        beneficiaryId: agent.beneficiaryId,
        amount: monthlyBudget,
        token: 'XLM',
        expiresAt: Date.now() + (35 * 24 * 60 * 60 * 1000), // 35 days
        purpose: `Monthly field operations budget - ${agent.targetMerchants} merchants target`,
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('transport', (BigInt(monthlyBudget) * BigInt(30) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('communication', (BigInt(monthlyBudget) * BigInt(20) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('training_materials', (BigInt(monthlyBudget) * BigInt(20) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('verification_costs', (BigInt(monthlyBudget) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('miscellaneous', (BigInt(monthlyBudget) * BigInt(15) / BigInt(100)).toString()),
          sdk.transferClient.createLocationRule(agent.region)
        ]
      };
    });

    for (const budget of agentBudgets) {
      await sdk.transferClient.createTransfer(
        config.adminKey,
        budget.transferId,
        budget.beneficiaryId,
        budget.amount,
        budget.token,
        budget.expiresAt,
        budget.spendingRules,
        budget.purpose
      );
    }

    console.log(`✅ Created ${agentBudgets.length} field agent budgets`);

    // Step 5: Onboard diverse merchant categories
    console.log('🏪 Onboarding diverse merchant categories...');
    const merchantCategories = [
      // Food and Agriculture
      {
        merchantId: 'MERCHANT_THAI_GROCERY_001',
        name: 'Thai Fresh Market',
        businessType: 'grocery',
        location: {
          latitude: 13.7563,
          longitude: 100.5018,
          address: '124 Sukhumvit Road',
          city: 'Bangkok',
          country: 'Thailand',
          postalCode: '10110',
          facilityName: 'Thai Fresh Market',
          contactPerson: 'Manager Somchai'
        },
        contactInfo: '+66-2-123-4567',
        stellarAddress: 'GD5...THAI1',
        acceptedTokens: ['XLM', 'USDC', 'THBT'],
        dailyLimit: '10000',
        monthlyLimit: '100000',
        verificationDocuments: ['business_license', 'food_permit', 'tax_id'],
        businessSize: 'small',
        employees: 8,
        yearsInBusiness: 5,
        agentId: 'FA_THAILAND_001'
      },
      {
        merchantId: 'MERCHANT_KENYA_FARM_001',
        name: 'Kenya Fresh Produce',
        businessType: 'agriculture',
        location: {
          latitude: -1.2921,
          longitude: 36.8219,
          address: '456 Ngong Road',
          city: 'Nairobi',
          country: 'Kenya',
          postalCode: '00100',
          facilityName: 'Kenya Fresh Produce Market',
          contactPerson: 'Manager Grace'
        },
        contactInfo: '+254-20-123-4567',
        stellarAddress: 'GD5...KENYA1',
        acceptedTokens: ['XLM', 'USDC', 'KES'],
        dailyLimit: '15000',
        monthlyLimit: '150000',
        verificationDocuments: ['farm_permit', 'business_license', 'cooperative_membership'],
        businessSize: 'medium',
        employees: 25,
        yearsInBusiness: 12,
        agentId: 'FA_KENYA_001'
      },
      // Healthcare
      {
        merchantId: 'MERCHANT_COLOMBIA_PHARMACY_001',
        name: 'Farmacia Salud Colombia',
        businessType: 'pharmacy',
        location: {
          latitude: 4.7110,
          longitude: -74.0721,
          address: '789 Carrera 7',
          city: 'Bogotá',
          country: 'Colombia',
          postalCode: '110111',
          facilityName: 'Farmacia Salud Colombia',
          contactPerson: 'Pharmacist Maria'
        },
        contactInfo: '+57-1-123-4567',
        stellarAddress: 'GD5...COLOMBIA1',
        acceptedTokens: ['XLM', 'USDC', 'COP'],
        dailyLimit: '20000',
        monthlyLimit: '200000',
        verificationDocuments: ['pharmacy_license', 'health_permit', 'business_license'],
        businessSize: 'small',
        employees: 6,
        yearsInBusiness: 8,
        agentId: 'FA_COLOMBIA_001'
      },
      // Services
      {
        merchantId: 'MERCHANT_THAI_TRANSPORT_001',
        name: 'Bangkok Transport Services',
        businessType: 'transport',
        location: {
          latitude: 13.7563,
          longitude: 100.5018,
          address: '321 Rama IV Road',
          city: 'Bangkok',
          country: 'Thailand',
          postalCode: '10500',
          facilityName: 'Bangkok Transport Services',
          contactPerson: 'Operations Manager'
        },
        contactInfo: '+66-2-234-5678',
        stellarAddress: 'GD5...TRANSPORT1',
        acceptedTokens: ['XLM', 'THBT'],
        dailyLimit: '25000',
        monthlyLimit: '250000',
        verificationDocuments: ['transport_license', 'vehicle_registration', 'insurance'],
        businessSize: 'medium',
        employees: 15,
        yearsInBusiness: 10,
        agentId: 'FA_THAILAND_001'
      },
      // Retail
      {
        merchantId: 'MERCHANT_KENYA_CLOTHING_001',
        name: 'Nairobi Fashion Boutique',
        businessType: 'clothing',
        location: {
          latitude: -1.2921,
          longitude: 36.8219,
          address: '888 Moi Avenue',
          city: 'Nairobi',
          country: 'Kenya',
          postalCode: '00100',
          facilityName: 'Nairobi Fashion Boutique',
          contactPerson: 'Store Manager'
        },
        contactInfo: '+254-20-345-6789',
        stellarAddress: 'GD5...CLOTHING1',
        acceptedTokens: ['XLM', 'USDC', 'KES'],
        dailyLimit: '12000',
        monthlyLimit: '120000',
        verificationDocuments: ['business_license', 'retail_permit', 'tax_certificate'],
        businessSize: 'small',
        employees: 4,
        yearsInBusiness: 3,
        agentId: 'FA_KENYA_001'
      },
      // Electronics
      {
        merchantId: 'MERCHANT_COLOMBIA_ELECTRONICS_001',
        name: 'Electro Colombia',
        businessType: 'electronics',
        location: {
          latitude: 4.7110,
          longitude: -74.0721,
          address: '654 Calle 26',
          city: 'Bogotá',
          country: 'Colombia',
          postalCode: '110231',
          facilityName: 'Electro Colombia',
          contactPerson: 'Technical Manager'
        },
        contactInfo: '+57-1-456-7890',
        stellarAddress: 'GD5...ELECTRONICS1',
        acceptedTokens: ['XLM', 'USDC', 'COP'],
        dailyLimit: '30000',
        monthlyLimit: '300000',
        verificationDocuments: ['electronics_license', 'technical_certification', 'business_license'],
        businessSize: 'medium',
        employees: 12,
        yearsInBusiness: 7,
        agentId: 'FA_COLOMBIA_001'
      }
    ];

    for (const merchant of merchantCategories) {
      const category =
        merchant.businessType === 'pharmacy'
          ? CATEGORY_MEDICAL
          : merchant.businessType === 'clothing'
            ? CATEGORY_CLOTHING
            : merchant.businessType === 'transport'
              ? CATEGORY_SHELTER
              : merchant.businessType === 'electronics'
                ? CATEGORY_FUEL
                : CATEGORY_FOOD;
      const request = sdk.merchantClient.createOnboardingRequest(
        merchant.name,
        merchant.businessType,
        category,
        `${merchant.location.latitude},${merchant.location.longitude}`,
        merchant.location.address,
        merchant.location.city,
        merchant.location.country,
        merchant.location.postalCode,
        merchant.contactInfo,
        merchant.verificationDocuments
      );
      
      await sdk.merchantClient.registerMerchant(
        config.adminKey,
        merchant.merchantId,
        request
      );
      
      // Auto-verify merchants with field agent recommendation
      await sdk.merchantClient.verifyMerchant(
        config.adminKey,
        merchant.merchantId,
        true,
        `Field agent ${merchant.agentId} verification approved`
      );
    }

    console.log(`✅ Onboarded ${merchantCategories.length} diverse merchants`);

    // Step 6: Create merchant onboarding incentives
    console.log('💳 Creating merchant onboarding incentives...');
    const merchantIncentives = merchantCategories.map(merchant => {
      const incentiveAmount = merchant.businessSize === 'small' ? '500' : '1000'; // Higher for medium businesses
      
      return {
        transferId: `MI_ONBOARDING_${merchant.merchantId}`,
        beneficiaryId: merchant.merchantId,
        amount: incentiveAmount,
        token: 'XLM',
        expiresAt: Date.now() + (60 * 24 * 60 * 60 * 1000), // 60 days
        purpose: `Merchant onboarding incentive - ${merchant.businessType}`,
        spendingRules: [
          sdk.transferClient.createCategoryLimitRule('equipment', (BigInt(incentiveAmount) * BigInt(40) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('training', (BigInt(incentiveAmount) * BigInt(30) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('marketing', (BigInt(incentiveAmount) * BigInt(20) / BigInt(100)).toString()),
          sdk.transferClient.createCategoryLimitRule('setup_costs', (BigInt(incentiveAmount) * BigInt(10) / BigInt(100)).toString()),
          sdk.transferClient.createLocationRule(merchant.location.city)
        ]
      };
    });

    for (const incentive of merchantIncentives) {
      await sdk.transferClient.createTransfer(
        config.adminKey,
        incentive.transferId,
        incentive.beneficiaryId,
        incentive.amount,
        incentive.token,
        incentive.expiresAt,
        incentive.spendingRules,
        incentive.purpose
      );
    }

    console.log(`✅ Created ${merchantIncentives.length} merchant onboarding incentives`);

    // Step 7: Generate QR codes for all merchants
    console.log('📱 Generating QR codes for merchants...');
    for (const merchant of merchantCategories) {
      const profile = await sdk.merchantClient.getMerchant(merchant.merchantId);
      if (!profile) {
        console.warn(`⚠️ Skipping QR for unknown merchant ${merchant.merchantId}`);
        continue;
      }
      const qrCode = sdk.merchantClient.generateMerchantQRCode(
        merchant.merchantId,
        profile
      );
      console.log(`📲 Merchant QR Code for ${merchant.name}:`, qrCode.substring(0, 100) + '...');
    }

    // Step 8: Display program summary
    console.log('\n🏪 MERCHANT NETWORK ONBOARDING PROGRAM SUMMARY');
    console.log('='.repeat(50));
    console.log(`🌍 Target Regions: ${config.targetRegions.join(', ')}`);
    console.log(`🎯 Target Merchants: ${config.targetMerchants.toLocaleString()}`);
    console.log(`💰 Onboarding Budget: ${config.onboardingBudget} XLM`);
    console.log(`⏱️ Duration: ${config.programDuration} months`);
    console.log('');
    console.log('📊 Program Components:');
    console.log(`  💵 Development Funds: ${merchantFunds.length}`);
    console.log(`  👥 Field Agents: ${fieldAgents.length}`);
    console.log(`  💳 Agent Budgets: ${agentBudgets.length}`);
    console.log(`  🏪 Merchants: ${merchantCategories.length}`);
    console.log(`  💰 Incentives: ${merchantIncentives.length}`);
    console.log('');
    console.log('💰 Merchant Development Strategy:');
    merchantFunds.forEach(fund => {
      console.log(`  🏪 ${fund.name}: ${fund.percentage}% of budget`);
    });
    console.log('');
    console.log('👥 Field Agent Coverage:');
    fieldAgents.forEach(agent => {
      console.log(`  👤 ${agent.name}: ${agent.region} - ${agent.targetMerchants} merchants target`);
    });
    console.log('');
    console.log('🏪 Merchant Categories:');
    const categories = [...new Set(merchantCategories.map(m => m.businessType))];
    categories.forEach(category => {
      const count = merchantCategories.filter(m => m.businessType === category).length;
      console.log(`  🏪 ${category}: ${count} merchants`);
    });
    console.log('');
    console.log('🔐 Merchant Network Security:');
    console.log('  ✅ Multi-sig fund management');
    console.log('  ✅ Field agent verification');
    console.log('  ✅ GPS-verified locations');
    console.log('  ✅ Document verification');
    console.log('  ✅ Category-based spending');
    console.log('  ✅ Location-based access');
    console.log('  ✅ QR code merchant access');
    console.log('  ✅ Fraud detection monitoring');
    console.log('');
    console.log('📱 Merchant Access Features:');
    console.log('  📲 QR code payments');
    console.log('  💳 Multi-token support');
    console.log('  🌐 Stellar TOML integration');
    console.log('  📊 Transaction analytics');
    console.log('  🔔 Real-time notifications');
    console.log('');
    console.log('🚀 Merchant network onboarding program is now ACTIVE!');
    console.log('📞 Merchant hotline: +1-555-MERCHANT-HELP');
    console.log('🌐 Management portal: https://relief.stellar.org/merchant-network');
    console.log('📱 Mobile app: Available for download');

  } catch (error) {
    console.error('❌ Error during merchant onboarding setup:', error);
    throw error;
  }
}

// Additional utility functions for merchant network management
async function processMerchantPayment(
  merchantKey: string,
  incentiveId: string,
  supplierId: string,
  amount: string,
  purchaseCategory: string
) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const success = await sdk.transferClient.spend(
      merchantKey,
      incentiveId,
      supplierId,
      amount,
      purchaseCategory,
      'Merchant Location'
    );
    
    if (success) {
      console.log(`✅ Merchant payment processed: ${amount} XLM for ${purchaseCategory}`);
    } else {
      console.log(`❌ Payment rejected: spending rules violation`);
    }
  } catch (error) {
    console.error('❌ Merchant payment error:', error);
  }
}

async function generateMerchantReport(merchantId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const merchant = await sdk.merchantClient.getMerchant(merchantId);
    const incentives = await sdk.transferClient.listBeneficiaryTransfers(merchantId);
    
    console.log(`🏪 Merchant Report for ${merchant?.name}:`);
    console.log(`  ID: ${merchant?.id}`);
    console.log(`  Type: ${merchant?.businessType}`);
    console.log(`  Location: ${merchant?.location.city}, ${merchant?.location.country}`);
    console.log(`  Status: ${merchant?.isVerified ? 'Verified' : 'Pending'}`);
    console.log(`  Reputation Score: ${merchant?.reputationScore}/100`);
    console.log(`  Active Incentives: ${incentives.length}`);
    
    let totalSpent = BigInt(0);
    let totalRemaining = BigInt(0);
    
    incentives.forEach((incentive: any) => {
      totalSpent += BigInt(incentive.spentAmount);
      totalRemaining += BigInt(incentive.remainingAmount);
    });
    
    console.log(`  Total Spent: ${totalSpent.toString()} XLM`);
    console.log(`  Total Remaining: ${totalRemaining.toString()} XLM`);
    
  } catch (error) {
    console.error('❌ Merchant report error:', error);
  }
}

async function trackFieldAgentPerformance(agentId: string) {
  const sdk = createDisasterReliefSDK(TESTNET_CONFIG);
  
  try {
    const agent = await sdk.beneficiaryClient.getBeneficiary(agentId);
    const budgets = await sdk.transferClient.listBeneficiaryTransfers(agentId);
    
    console.log(`👤 Field Agent Report for ${agent?.name}:`);
    console.log(`  ID: ${agent?.id}`);
    console.log(`  Region: ${agent?.location}`);
    console.log(`  Trust Score: ${agent?.trustScore}/100`);
    console.log(`  Active Budgets: ${budgets.length}`);
    
    let totalSpent = BigInt(0);
    let totalRemaining = BigInt(0);
    
    budgets.forEach((budget: any) => {
      totalSpent += BigInt(budget.spentAmount);
      totalRemaining += BigInt(budget.remainingAmount);
    });
    
    console.log(`  Total Spent: ${totalSpent.toString()} XLM`);
    console.log(`  Total Remaining: ${totalRemaining.toString()} XLM`);
    
    // Calculate merchant onboarding efficiency
    const efficiency = budgets.length > 0 ? (Number(totalSpent) / Number(totalSpent + totalRemaining)) * 100 : 0;
    console.log(`  Budget Utilization: ${efficiency.toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Field agent report error:', error);
  }
}

// Export for use in other modules
export {
  merchantOnboarding,
  processMerchantPayment,
  generateMerchantReport,
  trackFieldAgentPerformance
};

// Run the merchant onboarding program if this file is executed directly
if (require.main === module) {
  merchantOnboarding().catch(console.error);
}
