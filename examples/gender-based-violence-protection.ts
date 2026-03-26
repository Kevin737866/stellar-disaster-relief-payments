/**
 * Gender-Based Violence Protection - Hidden Identity System
 * 
 * Scenario: Women's Shelter and Safe House Network
 * - Survivors of domestic violence and trafficking
 * - Need complete anonymity for safety
 * - Hidden identity to prevent tracking by abusers
 * - Emergency duress features
 * - Secure access to aid without revealing location
 * 
 * This example demonstrates:
 * 1. Fully pseudonymous identity (no real names)
 * 2. Duress mode with decoy information
 * 3. Geofencing alerts for safety zones
 * 4. Hidden transaction history
 * 5. Emergency contact system
 * 6. Location privacy protection
 */

import { BeneficiaryIdentityClient } from '../sdk/src/beneficiaryIdentity';
import { OfflineAuthClient } from '../sdk/src/offlineAuth';
import { Keypair } from 'stellar-sdk';

// Configuration
const config = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'CPLATFORM_CONTRACT_ID',
    aidRegistry: 'CAID_REGISTRY_ID',
    beneficiaryManager: 'CBENEFICIARY_MANAGER_ID',
    merchantNetwork: 'CMERCHANT_NETWORK_ID',
    cashTransfer: 'CCASH_TRANSFER_ID',
    supplyChainTracker: 'CSUPPLY_CHAIN_ID',
    antiFraud: 'CANTI_FRAUD_ID'
  }
};

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Gender-Based Violence Protection System');
  console.log('  Hidden Identity for At-Risk Women');
  console.log('═══════════════════════════════════════════════════════════\n');

  const identityClient = new BeneficiaryIdentityClient(config);
  const offlineClient = new OfflineAuthClient(config);

  // Scenario 1: Survivor Intake at Women's Shelter
  console.log('🏠 SCENARIO 1: Confidential Intake at Women\'s Shelter');
  console.log('─────────────────────────────────────────────────────────\n');

  console.log('Context: Survivor arrives at safe house');
  console.log('  - Fleeing domestic violence');
  console.log('  - No documents (left everything behind)');
  console.log('  - Abuser has resources to track her');
  console.log('  - Needs immediate access to aid');
  console.log('  - Complete anonymity required\n');

  // Generate keypairs
  const shelterWorkerKeypair = Keypair.random();
  const survivorKeypair = Keypair.random();
  
  console.log('Shelter Worker: ' + shelterWorkerKeypair.publicKey());
  console.log('Survivor\'s Wallet: ' + survivorKeypair.publicKey());
  console.log('  ⚠️  Real name NEVER stored on blockchain\n');

  // Step 1: Create pseudonymous identity
  console.log('Step 1: Creating Pseudonymous Identity');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Using code name: "Phoenix" (chosen by survivor)\n');

  const identityFactors = identityClient.generateFactors({
    // Knowledge factors (only survivor knows)
    pin: '7890',
    mothersMaidenName: 'SecureAnswer1', // Fake answer for privacy
    birthCity: 'SafeCity', // Fake location
    
    // Possession factors
    phoneNumber: '+1-555-SHELTER', // Shelter-provided phone
    aidRationCard: 'SHELTER-AID-2024-ANON-001',
    
    // Social factors (shelter staff and support group)
    communityVouchers: [
      shelterWorkerKeypair.publicKey(), // Shelter counselor
      Keypair.random().publicKey(), // Support group facilitator
      Keypair.random().publicKey()  // Legal advocate
    ],
    
    // Behavioral factors (device from shelter)
    deviceFingerprint: 'SHELTER-DEVICE-SECURE-001',
    
    // Institutional factors
    ngoAttestation: 'WOMENS-SHELTER-ATTESTATION-2024',
    campRegistrationId: 'ANONYMOUS-INTAKE-2024-001'
  });

  console.log(`✓ Generated ${identityFactors.length} identity factors`);
  console.log('  ⚠️  All factors pseudonymous');
  console.log('  ⚠️  No real personal information stored');
  console.log('  ⚠️  Cannot be traced back to real identity\n');

  // Step 2: Set up emergency recovery contacts
  console.log('Step 2: Emergency Recovery Network');
  console.log('─────────────────────────────────────────────────────────');

  const recoveryContacts = [
    shelterWorkerKeypair.publicKey(), // Primary counselor
    Keypair.random().publicKey(), // Backup counselor
    Keypair.random().publicKey(), // Legal advocate
    Keypair.random().publicKey(), // Support group leader
    Keypair.random().publicKey()  // Emergency hotline
  ];

  console.log('✓ 5 emergency contacts configured');
  console.log('  - All contacts are shelter staff/advocates');
  console.log('  - No family members (for safety)');
  console.log('  - 3-of-5 threshold for recovery\n');

  // Step 3: Create identity with enhanced security
  console.log('Step 3: Creating Secure Hidden Identity');
  console.log('─────────────────────────────────────────────────────────');

  try {
    const idHash = await identityClient.createIdentity(
      shelterWorkerKeypair.secret(),
      identityFactors,
      recoveryContacts,
      'Safe Location - Coordinates Hidden', // Vague location
      survivorKeypair.publicKey(),
      '0000' // Duress PIN - shows decoy information
    );

    console.log('✓ Hidden identity created successfully!');
    console.log(`  ID Hash: ${idHash}`);
    console.log('  Code Name: Phoenix');
    console.log('  ⚠️  Real name: NEVER stored');
    console.log('  ⚠️  Location: Obfuscated');
    console.log('  ⚠️  Duress PIN: Active (0000)\n');

    // Step 4: Configure safety geofences
    console.log('Step 4: Configuring Safety Geofences');
    console.log('─────────────────────────────────────────────────────────');

    const safeZones = [
      {
        zoneName: 'Women\'s Shelter',
        latitude: 40.7128 * 1e6, // Fake coordinates
        longitude: -74.0060 * 1e6,
        radiusMeters: 500,
        isSafe: true
      },
      {
        zoneName: 'Legal Aid Office',
        latitude: 40.7589 * 1e6,
        longitude: -73.9851 * 1e6,
        radiusMeters: 200,
        isSafe: true
      },
      {
        zoneName: 'Support Group Location',
        latitude: 40.7489 * 1e6,
        longitude: -73.9680 * 1e6,
        radiusMeters: 300,
        isSafe: true
      }
    ];

    console.log('✓ 3 safe zones configured:');
    safeZones.forEach(zone => {
      console.log(`  - ${zone.zoneName} (${zone.radiusMeters}m radius)`);
    });
    console.log('\n  ⚠️  Alert triggered if identity used outside safe zones');
    console.log('  ⚠️  Automatic notification to emergency contacts\n');

    // Scenario 2: Duress Mode Activation
    console.log('\n⚠️  SCENARIO 2: Duress Mode - Coercion Protection');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Abuser finds survivor and demands access');
    console.log('Survivor enters duress PIN (0000) instead of real PIN\n');

    const duressCheck = await identityClient.verifyWithDuressCheck(idHash, '0000');
    
    if (duressCheck.isDuress) {
      console.log('🚨 DURESS MODE ACTIVATED');
      console.log('─────────────────────────────────────────────────────────');
      console.log('Visible to Abuser:');
      console.log('  ✓ Authentication "successful"');
      console.log('  ✓ Decoy balance: $50 (fake)');
      console.log('  ✓ Fake transaction history');
      console.log('  ✓ Wrong location shown');
      console.log('  ✓ No real information revealed\n');

      console.log('Hidden Actions (Survivor Protected):');
      console.log('  ✓ Real funds: Hidden and safe');
      console.log('  ✓ Silent alert sent to shelter');
      console.log('  ✓ Emergency contacts notified');
      console.log('  ✓ Location tracking activated');
      console.log('  ✓ Law enforcement can be alerted');
      console.log('  ✓ Survivor appears compliant (safety first)\n');
    }

    // Scenario 3: Anonymous Aid Access
    console.log('\n🛒 SCENARIO 3: Anonymous Aid Access');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Survivor needs groceries at partner store');
    console.log('Must maintain complete anonymity\n');

    const identity = await identityClient.getIdentity(idHash);
    if (!identity) {
      throw new Error('Failed to retrieve identity');
    }

    // Generate anonymous QR code
    const anonymousQR = identityClient.generateQRAccess(idHash, identity, 15);
    
    console.log('✓ Anonymous QR code generated');
    console.log('  - Valid for 15 minutes');
    console.log('  - No personal information in QR');
    console.log('  - Merchant sees only: "Authorized Beneficiary"');
    console.log('  - Transaction recorded without revealing identity');
    console.log('  - Location not logged\n');

    console.log('At the store:');
    console.log('  1. Survivor shows QR code');
    console.log('  2. Merchant scans (offline capable)');
    console.log('  3. System verifies authorization');
    console.log('  4. Transaction approved');
    console.log('  5. No personal data exchanged\n');

    const qrValidation = identityClient.validateQRAccess(anonymousQR);
    if (qrValidation) {
      console.log('✓ Transaction Authorized');
      console.log('  Merchant confirmation: "Payment approved"');
      console.log('  Survivor\'s privacy: Fully protected\n');
    }

    // Scenario 4: Geofence Alert
    console.log('\n📍 SCENARIO 4: Geofence Safety Alert');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Identity used outside designated safe zones\n');

    // Simulate location check outside safe zone
    const unsafeLocation = {
      latitude: 40.6782, // Different location
      longitude: -73.9442
    };

    const isInSafeZone = await identityClient.checkGeofence(
      idHash,
      unsafeLocation.latitude,
      unsafeLocation.longitude
    );

    if (!isInSafeZone) {
      console.log('🚨 GEOFENCE ALERT TRIGGERED');
      console.log('─────────────────────────────────────────────────────────');
      console.log('Alert Details:');
      console.log('  ⚠️  Identity used outside safe zones');
      console.log('  ⚠️  Location: Outside designated areas');
      console.log('  ⚠️  Time: ' + new Date().toISOString());
      console.log('\nAutomatic Actions:');
      console.log('  ✓ Emergency contacts notified');
      console.log('  ✓ Shelter staff alerted');
      console.log('  ✓ Optional: Law enforcement notification');
      console.log('  ✓ Survivor safety check initiated\n');
    }

    // Scenario 5: Secure Communication
    console.log('\n💬 SCENARIO 5: Secure Emergency Communication');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Survivor needs to contact shelter discreetly\n');

    // Generate TOTP for secure communication
    const totp = offlineClient.generateTOTP(idHash, 30);
    
    console.log('Emergency Communication Protocol:');
    console.log('  1. Survivor texts code to emergency number');
    console.log(`  2. Current TOTP: ${totp}`);
    console.log('  3. Code changes every 30 seconds');
    console.log('  4. No personal information in message');
    console.log('  5. Shelter verifies and responds\n');

    console.log('Example message:');
    console.log(`  "Code: ${totp}"`);
    console.log('\nShelter receives:');
    console.log('  ✓ Code verified');
    console.log('  ✓ Identity: Phoenix');
    console.log('  ✓ Status: Emergency contact');
    console.log('  ✓ Action: Immediate response initiated\n');

    // Scenario 6: Transitioning to Independence
    console.log('\n🌟 SCENARIO 6: Transitioning to Independence');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: After 6 months, survivor is ready to live independently');
    console.log('Identity needs to transfer to new safe location\n');

    const newSafeLocation = {
      zoneName: 'Independent Living - New City',
      latitude: 42.3601 * 1e6,
      longitude: -71.0589 * 1e6,
      radiusMeters: 1000,
      isSafe: true
    };

    console.log('Transferring identity to new location...');
    await identityClient.transferIdentity(
      idHash,
      survivorKeypair.secret(),
      'New Safe Location - Coordinates Protected',
      newSafeLocation
    );

    console.log('✓ Identity transferred successfully!');
    console.log('  - New safe zone configured');
    console.log('  - Old location data removed');
    console.log('  - Privacy maintained');
    console.log('  - All protections remain active');
    console.log('  - Trust score preserved\n');

    // Scenario 7: Paper Backup for Emergency
    console.log('\n📄 SCENARIO 7: Emergency Paper Backup');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Survivor needs offline backup in case of emergency\n');

    const paperCodes = offlineClient.generatePaperBackupCodes(idHash, 5);
    
    console.log('✓ Emergency backup codes generated:');
    console.log('  - 5 single-use codes');
    console.log('  - Stored in sealed envelope');
    console.log('  - Kept in shelter safe');
    console.log('  - Only survivor can access\n');

    console.log('Sample codes (sealed):');
    paperCodes.slice(0, 2).forEach((code, index) => {
      console.log(`  ${index + 1}. ${code.code} [${code.checksum}]`);
    });
    console.log('  ...\n');

    const printableBackup = offlineClient.generatePrintableBackup(
      idHash,
      identity,
      paperCodes
    );

    console.log('✓ Printable backup sheet created');
    console.log('  - Sealed in envelope');
    console.log('  - Marked "CONFIDENTIAL"');
    console.log('  - Stored securely');
    console.log('  - Survivor has only copy\n');

    // Scenario 8: Trust Score and Reputation
    console.log('\n⭐ SCENARIO 8: Building Trust Without Revealing Identity');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Context: Survivor participates in programs and builds reputation');
    console.log('Trust score increases without revealing identity\n');

    // Simulate positive activities
    const activities = [
      { type: 'counseling_attendance', positive: true },
      { type: 'job_training_completion', positive: true },
      { type: 'support_group_participation', positive: true },
      { type: 'financial_literacy_course', positive: true }
    ];

    console.log('Activities completed:');
    for (const activity of activities) {
      await identityClient.updateTrustScore(idHash, activity.type, activity.positive);
      console.log(`  ✓ ${activity.type.replace(/_/g, ' ')}`);
    }

    const updatedIdentity = await identityClient.getIdentity(idHash);
    console.log(`\n✓ Trust score increased: ${identity.trustScore} → ${updatedIdentity?.trustScore}`);
    console.log('  - Higher trust = more aid access');
    console.log('  - Reputation built anonymously');
    console.log('  - No personal information revealed');
    console.log('  - Privacy fully maintained\n');

    // Summary and Statistics
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  PROTECTION SYSTEM SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Privacy Protection:');
    console.log('  ✓ Real name: NEVER stored');
    console.log('  ✓ Location: Obfuscated');
    console.log('  ✓ Identity: Fully pseudonymous');
    console.log('  ✓ Transactions: Anonymous');
    console.log('  ✓ No biometric data\n');

    console.log('Safety Features:');
    console.log('  ✓ Duress mode: Active');
    console.log('  ✓ Decoy information: Configured');
    console.log('  ✓ Geofencing: 3 safe zones');
    console.log('  ✓ Emergency alerts: Enabled');
    console.log('  ✓ Silent notifications: Active\n');

    console.log('Access Control:');
    console.log('  ✓ Multi-factor authentication');
    console.log('  ✓ Offline capability');
    console.log('  ✓ Anonymous transactions');
    console.log('  ✓ Secure communication');
    console.log('  ✓ Emergency recovery: 3-of-5\n');

    console.log('Empowerment:');
    console.log('  ✓ Financial independence');
    console.log('  ✓ Anonymous aid access');
    console.log('  ✓ Trust building');
    console.log('  ✓ Identity portability');
    console.log('  ✓ Self-sovereign control\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✓ SURVIVOR SAFETY PRIORITIZED');
    console.log('  ✓ COMPLETE ANONYMITY MAINTAINED');
    console.log('  ✓ EMPOWERMENT WITHOUT EXPOSURE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Impact Statement:');
    console.log('─────────────────────────────────────────────────────────');
    console.log('This system enables survivors of gender-based violence to:');
    console.log('  • Access aid without revealing their identity');
    console.log('  • Maintain safety through duress features');
    console.log('  • Build financial independence anonymously');
    console.log('  • Transition to new locations securely');
    console.log('  • Communicate emergencies discreetly');
    console.log('  • Recover access through trusted advocates');
    console.log('  • Live with dignity and without fear\n');

    console.log('No survivor should have to choose between safety and survival.');
    console.log('This system ensures they can have both.\n');

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main().catch(console.error);
