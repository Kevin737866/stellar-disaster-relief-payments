import {
  Server,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  scValToNative
} from 'stellar-sdk';
import {
  Merchant,
  Transaction,
  Location,
  MerchantOnboardingRequest
} from './types';
import {
  MerchantNotFoundError,
  NetworkError,
  ValidationError,
} from './errors';

export class MerchantClient {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.merchantNetwork);
  }

  /**
   * Register local merchant for relief network
   */
  async registerMerchant(
    ownerKey: string,
    merchantId: string,
    request: MerchantOnboardingRequest
  ): Promise<string> {
    const ownerKeypair = Keypair.fromSecret(ownerKey);
    const ownerAccount = await this.server.getAccount(ownerKeypair.publicKey());

    const tx = new TransactionBuilder(ownerAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "register_merchant",
          ...[
            new Address(ownerKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(request.name),
            nativeToScVal(request.businessType),
            nativeToScVal(request.location),
            nativeToScVal(request.contactInfo),
            nativeToScVal(request.stellarTomlUrl),
            nativeToScVal(request.acceptedTokens),
            nativeToScVal(request.dailyLimit),
            nativeToScVal(request.monthlyLimit),
            nativeToScVal(request.verificationDocuments)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(ownerKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Merchant ${merchantId} registered successfully. Awaiting verification.`;
    } else {
      throw new NetworkError('register merchant', result.status, { merchantId });
    }
  }

  /**
   * Verify merchant (by authorized verifier)
   */
  async verifyMerchant(
    verifierKey: string,
    merchantId: string,
    approved: boolean,
    notes: string
  ): Promise<string> {
    const verifierKeypair = Keypair.fromSecret(verifierKey);
    const verifierAccount = await this.server.getAccount(verifierKeypair.publicKey());

    const tx = new TransactionBuilder(verifierAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "verify_merchant",
          ...[
            new Address(verifierKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(approved),
            nativeToScVal(notes)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(verifierKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return approved 
        ? `Merchant ${merchantId} verified and activated`
        : `Merchant ${merchantId} verification rejected`;
    } else {
      throw new NetworkError('verify merchant', result.status, { merchantId });
    }
  }

  /**
   * Process payment from beneficiary to merchant
   */
  async processPayment(
    merchantKey: string,
    beneficiaryKey: string,
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string
  ): Promise<string> {
    const merchantKeypair = Keypair.fromSecret(merchantKey);
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    
    const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());

    const tx = new TransactionBuilder(merchantAccount, {
      fee: '200', // Higher fee for multi-sig
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "process_payment",
          ...[
            new Address(merchantKeypair.publicKey()).toScVal(),
            new Address(beneficiaryKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(beneficiaryId),
            nativeToScVal(amount),
            nativeToScVal(token),
            nativeToScVal(purpose)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(merchantKeypair);
    tx.sign(beneficiaryKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new NetworkError('process payment', result.status, { merchantId, beneficiaryKey });
    }
  }

  /**
   * Get merchant details
   */
  async getMerchant(merchantId: string): Promise<Merchant | null> {
    try {
      const result = await this.contract.call("get_merchant", nativeToScVal(merchantId));
      const merchant = scValToNative(result.result.retval);
      return merchant;
    } catch (error) {
      console.error('Failed to get merchant:', error);
      return null;
    }
  }

  /**
   * Find merchants by location (geographic search)
   */
  async findMerchantsByLocation(
    latitude: number,
    longitude: number,
    radiusKm: number
  ): Promise<Merchant[]> {
    try {
      const result = await this.contract.call(
        "find_merchants_by_location",
        nativeToScVal(latitude),
        nativeToScVal(longitude),
        nativeToScVal(radiusKm)
      );
      const merchants = scValToNative(result.result.retval);
      return merchants;
    } catch (error) {
      console.error('Failed to find merchants by location:', error);
      return [];
    }
  }

  /**
   * Get merchant transaction history
   */
  async getMerchantTransactions(merchantId: string): Promise<Transaction[]> {
    try {
      const result = await this.contract.call("get_merchant_transactions", nativeToScVal(merchantId));
      const transactions = scValToNative(result.result.retval);
      return transactions;
    } catch (error) {
      console.error('Failed to get merchant transactions:', error);
      return [];
    }
  }

  /**
   * Update merchant reputation based on feedback
   */
  async updateReputation(
    adminKey: string,
    merchantId: string,
    feedbackScore: number // -10 to +10
  ): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "update_reputation",
          ...[
            new Address(adminKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(feedbackScore)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Reputation updated for merchant ${merchantId}`;
    } else {
      throw new NetworkError('update reputation', result.status, { merchantId });
    }
  }

  /**
   * Get verification queue
   */
  async getVerificationQueue(): Promise<string[]> {
    try {
      const result = await this.contract.call("get_verification_queue");
      const queue = scValToNative(result.result.retval);
      return queue;
    } catch (error) {
      console.error('Failed to get verification queue:', error);
      return [];
    }
  }

  /**
   * Generate QR code for merchant identification
   */
  generateMerchantQRCode(merchantId: string, merchant: Merchant): string {
    const qrData = {
      type: 'merchant',
      merchantId,
      name: merchant.name,
      businessType: merchant.businessType,
      location: merchant.location,
      acceptedTokens: merchant.acceptedTokens,
      reputationScore: merchant.reputationScore,
      stellarTomlUrl: merchant.stellarTomlUrl,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate merchant QR code
   */
  async validateMerchantQRCode(qrCodeData: string): Promise<boolean> {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'merchant') {
        return false;
      }

      // Verify merchant exists and is active
      const merchant = await this.getMerchant(data.merchantId);
      return merchant !== null && merchant.isActive;
    } catch (error) {
      return false;
    }
  }

  /**
   * Discover merchants using Stellar TOML
   */
  async discoverMerchantsFromStellarToml(domain: string): Promise<Merchant[]> {
    try {
      // Fetch Stellar TOML file
      const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
      const response = await fetch(tomlUrl);
      const tomlData = await response.text();

      // Parse TOML and extract merchant information
      // This is a simplified implementation
      const merchants: Merchant[] = [];
      
      // In production, use a proper TOML parser
      const lines = tomlData.split('\n');
      let currentSection = '';
      
      for (const line of lines) {
        if (line.startsWith('[')) {
          currentSection = line.slice(1, -1);
        } else if (currentSection === 'MERCHANTS' && line.includes('=')) {
          const [key, value] = line.split('=').map(s => s.trim());
          if (key === 'name') {
            // Create merchant from TOML data
            merchants.push({
              id: `toml_${Date.now()}`,
              name: value.replace(/"/g, ''),
              owner: '',
              businessType: 'general',
              location: {
                latitude: 0,
                longitude: 0,
                address: '',
                city: '',
                country: '',
                postalCode: ''
              },
              contactInfo: '',
              registrationDate: Date.now(),
              isVerified: false,
              verificationDocuments: [],
              stellarTomlUrl: tomlUrl,
              acceptedTokens: ['XLM'],
              dailyLimit: '1000',
              monthlyLimit: '10000',
              currentMonthVolume: '0',
              reputationScore: 50,
              isActive: false
            });
          }
        }
      }

      return merchants;
    } catch (error) {
      console.error('Failed to discover merchants from TOML:', error);
      return [];
    }
  }

  /**
   * Create merchant onboarding request template
   */
  createOnboardingRequest(
    name: string,
    businessType: string,
    location: Location,
    contactInfo: string,
    stellarAddress: string
  ): MerchantOnboardingRequest {
    return {
      name,
      businessType,
      location,
      contactInfo,
      stellarTomlUrl: `https://stellar.expert/explorer/testnet/account/${stellarAddress}`,
      acceptedTokens: ['XLM'], // Default to XLM
      dailyLimit: '1000', // Default limits
      monthlyLimit: '10000',
      verificationDocuments: [] // Will be uploaded separately
    };
  }

  /**
   * Get merchant statistics
   */
  async getMerchantStatistics(merchantId: string): Promise<{
    totalTransactions: number;
    totalVolume: string;
    averageTransaction: string;
    reputationScore: number;
    monthlyUtilization: number;
  }> {
    const transactions = await this.getMerchantTransactions(merchantId);
    const merchant = await this.getMerchant(merchantId);
    
    if (!merchant) {
      throw new MerchantNotFoundError(merchantId);
    }

    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce((sum, tx) => 
      sum + BigInt(tx.amount), BigInt(0)
    );

    const averageTransaction = totalTransactions > 0 
      ? (totalVolume / BigInt(totalTransactions)).toString()
      : '0';

    const monthlyLimit = BigInt(merchant.monthlyLimit);
    const currentVolume = BigInt(merchant.currentMonthVolume);
    const monthlyUtilization = monthlyLimit > 0 
      ? Number((currentVolume * BigInt(100)) / monthlyLimit)
      : 0;

    return {
      totalTransactions,
      totalVolume: totalVolume.toString(),
      averageTransaction,
      reputationScore: merchant.reputationScore,
      monthlyUtilization
    };
  }

  /**
   * Batch verify merchants
   */
  async batchVerifyMerchants(
    verifierKey: string,
    merchantIds: string[],
    approved: boolean,
    notes: string
  ): Promise<string[]> {
    const results: string[] = [];

    for (const merchantId of merchantIds) {
      try {
        const result = await this.verifyMerchant(verifierKey, merchantId, approved, notes);
        results.push(result);
      } catch (error) {
        results.push(`Failed to verify ${merchantId}: ${error}`);
      }
    }

    return results;
  }

  private getNetworkPassphrase(): string {
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
