"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeneficiaryClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
const crypto_js_1 = require("crypto-js");
class BeneficiaryClient {
    constructor(config) {
        this.config = config;
        this.server = new stellar_sdk_1.Server(config.rpcUrl);
        this.contract = new stellar_sdk_1.Contract(config.contractIds.beneficiaryManager);
    }
    /**
     * Register displaced person without traditional ID
     */
    async registerBeneficiary(registrarKey, beneficiaryId, name, disasterId, location, walletAddress, familySize, specialNeeds, verificationFactors) {
        const registrarKeypair = stellar_sdk_1.Keypair.fromSecret(registrarKey);
        const registrarAccount = await this.server.getAccount(registrarKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(registrarAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("register_beneficiary", ...[
            new stellar_sdk_1.Address(registrarKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(name),
            (0, stellar_sdk_1.nativeToScVal)(disasterId),
            (0, stellar_sdk_1.nativeToScVal)(location),
            new stellar_sdk_1.Address(walletAddress).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(familySize),
            (0, stellar_sdk_1.nativeToScVal)(specialNeeds),
            (0, stellar_sdk_1.nativeToScVal)(verificationFactors)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(registrarKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Beneficiary ${beneficiaryId} registered successfully`;
        }
        else {
            throw new Error(`Failed to register beneficiary: ${result.status}`);
        }
    }
    /**
     * Verify beneficiary using behavioral/possession factors
     */
    async verifyBeneficiary(verifierKey, beneficiaryId, providedFactors) {
        const verifierKeypair = stellar_sdk_1.Keypair.fromSecret(verifierKey);
        const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(verifierAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("verify_beneficiary", ...[
            new stellar_sdk_1.Address(verifierKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(providedFactors)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(verifierKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        else {
            throw new Error(`Failed to verify beneficiary: ${result.status}`);
        }
    }
    /**
     * Restore access using recovery code
     */
    async restoreAccess(beneficiaryId, recoveryCode, newWalletAddress) {
        try {
            const result = await this.contract.call("restore_access", ...[
                (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
                (0, stellar_sdk_1.nativeToScVal)(recoveryCode),
                new stellar_sdk_1.Address(newWalletAddress).toScVal()
            ]);
            return (0, stellar_sdk_1.scValToNative)(result.result.retval);
        }
        catch (error) {
            console.error('Failed to restore access:', error);
            return false;
        }
    }
    /**
     * Get beneficiary profile
     */
    async getBeneficiary(beneficiaryId) {
        try {
            const result = await this.contract.call("get_beneficiary", (0, stellar_sdk_1.nativeToScVal)(beneficiaryId));
            const profile = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return profile;
        }
        catch (error) {
            console.error('Failed to get beneficiary:', error);
            return null;
        }
    }
    /**
     * List beneficiaries by disaster
     */
    async listBeneficiariesByDisaster(disasterId) {
        try {
            const result = await this.contract.call("list_beneficiaries_by_disaster", (0, stellar_sdk_1.nativeToScVal)(disasterId));
            const beneficiaries = (0, stellar_sdk_1.scValToNative)(result.result.retval);
            return beneficiaries;
        }
        catch (error) {
            console.error('Failed to list beneficiaries:', error);
            return [];
        }
    }
    /**
     * Update beneficiary location
     */
    async updateLocation(beneficiaryKey, beneficiaryId, newLocation) {
        const beneficiaryKeypair = stellar_sdk_1.Keypair.fromSecret(beneficiaryKey);
        const beneficiaryAccount = await this.server.getAccount(beneficiaryKeypair.publicKey());
        const tx = new stellar_sdk_1.TransactionBuilder(beneficiaryAccount, {
            fee: '100',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(this.contract.call("update_location", ...[
            new stellar_sdk_1.Address(beneficiaryKeypair.publicKey()).toScVal(),
            (0, stellar_sdk_1.nativeToScVal)(beneficiaryId),
            (0, stellar_sdk_1.nativeToScVal)(newLocation)
        ]))
            .setTimeout(30)
            .build();
        tx.sign(beneficiaryKeypair);
        const result = await this.server.sendTransaction(tx);
        if (result.status === 'SUCCESS') {
            return `Location updated for beneficiary ${beneficiaryId}`;
        }
        else {
            throw new Error(`Failed to update location: ${result.status}`);
        }
    }
    /**
     * Generate recovery codes for offline access
     */
    generateRecoveryCodes(beneficiaryId) {
        const codes = [];
        for (let i = 0; i < 3; i++) {
            const code = this.generateRecoveryCode(beneficiaryId, i);
            codes.push(code);
        }
        return codes;
    }
    generateRecoveryCode(beneficiaryId, index) {
        const data = `${beneficiaryId}_${index}_${Date.now()}`;
        return (0, crypto_js_1.createHash)('sha256').update(data).toString();
    }
    /**
     * Create biometric-free identity factors
     */
    createVerificationFactors(possessionFactors, behavioralFactors, socialFactors) {
        const factors = [];
        const currentTime = Date.now();
        // Possession factors (items they have)
        possessionFactors.forEach((value, index) => {
            factors.push({
                factorType: 'possession',
                value,
                weight: 30,
                verifiedAt: currentTime
            });
        });
        // Behavioral factors (patterns of behavior)
        behavioralFactors.forEach((value, index) => {
            factors.push({
                factorType: 'behavioral',
                value,
                weight: 40,
                verifiedAt: currentTime
            });
        });
        // Social factors (community verification)
        socialFactors.forEach((value, index) => {
            factors.push({
                factorType: 'social',
                value,
                weight: 30,
                verifiedAt: currentTime
            });
        });
        return factors;
    }
    /**
     * Generate QR code for beneficiary identification
     */
    generateBeneficiaryQRCode(beneficiaryId, profile) {
        const qrData = {
            type: 'beneficiary_id',
            beneficiaryId,
            name: profile.name,
            disasterId: profile.disasterId,
            trustScore: profile.trustScore,
            timestamp: Date.now(),
            verificationFactors: profile.verificationFactors.map(f => ({
                type: f.factorType,
                weight: f.weight
            }))
        };
        return JSON.stringify(qrData);
    }
    /**
     * Validate beneficiary QR code
     */
    async validateBeneficiaryQRCode(qrCodeData) {
        try {
            const data = JSON.parse(qrCodeData);
            if (data.type !== 'beneficiary_id') {
                return false;
            }
            // Verify beneficiary exists
            const profile = await this.getBeneficiary(data.beneficiaryId);
            return profile !== null;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Create USSD session for feature phone users
     */
    createUSSDSession(phoneNumber) {
        const sessionId = this.generateSessionId(phoneNumber);
        return {
            sessionId,
            welcomeMessage: `Welcome to Disaster Relief Aid. Please enter:\n1. Register\n2. Check Balance\n3. Find Merchants\n4. Help`
        };
    }
    /**
     * Process USSD input
     */
    processUSSDInput(sessionId, input, currentStep) {
        switch (currentStep) {
            case 'welcome':
                return this.processMainMenu(input);
            case 'register_name':
                return this.processRegistrationName(input);
            case 'register_location':
                return this.processRegistrationLocation(input);
            case 'register_family':
                return this.processRegistrationFamily(input);
            default:
                return {
                    response: 'Invalid input. Please try again.',
                    nextStep: 'welcome'
                };
        }
    }
    processMainMenu(input) {
        switch (input) {
            case '1':
                return {
                    response: 'Please enter your full name:',
                    nextStep: 'register_name'
                };
            case '2':
                return {
                    response: 'Please enter your beneficiary ID:',
                    nextStep: 'check_balance'
                };
            case '3':
                return {
                    response: 'Please enter your location (city/village):',
                    nextStep: 'find_merchants'
                };
            case '4':
                return {
                    response: 'For help, contact: +1234567890 or visit nearest relief center.',
                    nextStep: 'welcome'
                };
            default:
                return {
                    response: 'Invalid option. Please enter 1, 2, 3, or 4:',
                    nextStep: 'welcome'
                };
        }
    }
    processRegistrationName(input) {
        return {
            response: `Thank you ${input}. Please enter your current location (city/village):`,
            nextStep: 'register_location'
        };
    }
    processRegistrationLocation(input) {
        return {
            response: 'Please enter your family size (number of people):',
            nextStep: 'register_family'
        };
    }
    processRegistrationFamily(input) {
        const familySize = parseInt(input);
        if (isNaN(familySize) || familySize < 1) {
            return {
                response: 'Invalid family size. Please enter a number greater than 0:',
                nextStep: 'register_family'
            };
        }
        return {
            response: `Registration complete! Your family size: ${familySize}. You will receive your beneficiary ID shortly. Save this number for future reference.`,
            nextStep: 'complete',
            completed: true
        };
    }
    generateSessionId(phoneNumber) {
        return (0, crypto_js_1.createHash)('sha256').update(`${phoneNumber}_${Date.now()}`).toString().substring(0, 16);
    }
    /**
     * Get beneficiary statistics
     */
    async getBeneficiaryStatistics(disasterId) {
        const beneficiaries = await this.listBeneficiariesByDisaster(disasterId);
        const totalBeneficiaries = beneficiaries.length;
        const activeBeneficiaries = beneficiaries.filter(b => b.isActive).length;
        const averageFamilySize = beneficiaries.length > 0
            ? beneficiaries.reduce((sum, b) => sum + b.familySize, 0) / beneficiaries.length
            : 0;
        const averageTrustScore = beneficiaries.length > 0
            ? beneficiaries.reduce((sum, b) => sum + b.trustScore, 0) / beneficiaries.length
            : 0;
        const specialNeedsCount = beneficiaries.filter(b => b.specialNeeds.length > 0).length;
        return {
            totalBeneficiaries,
            averageFamilySize,
            averageTrustScore,
            activeBeneficiaries,
            specialNeedsCount
        };
    }
    getNetworkPassphrase() {
        switch (this.config.network) {
            case 'testnet':
                return 'Test SDF Network ; September 2015';
            case 'mainnet':
                return 'Public Global Stellar Network ; September 2015';
            case 'standalone':
                return 'Standalone Network ; February 2017';
            default:
                throw new Error('Unsupported network');
        }
    }
}
exports.BeneficiaryClient = BeneficiaryClient;
//# sourceMappingURL=beneficiaryClient.js.map