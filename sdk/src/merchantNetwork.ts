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

// Merchant categories
export const CATEGORY_FOOD = 0;
export const CATEGORY_WATER = 1;
export const CATEGORY_SHELTER = 2;
export const CATEGORY_MEDICAL = 3;
export const CATEGORY_CLOTHING = 4;
export const CATEGORY_FUEL = 5;

// Merchant status
export const STATUS_PENDING = 0;
export const STATUS_TRIAL = 1;
export const STATUS_ACTIVE = 2;
export const STATUS_SUSPENDED = 3;
export const STATUS_GRADUATED = 4;

// Payment methods
export const PAYMENT_QR = 0;
export const PAYMENT_USSD = 1;
export const PAYMENT_NFC = 2;
export const PAYMENT_OFFLINE = 3;
export const PAYMENT_ONLINE = 4;

export interface MerchantProfile {
  name: string;
  businessType: string;
  category: number;
  location: Location;
  contactInfo: string;
  acceptedTokens: string[];
  emergencyFastTrack: boolean;
}

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  country: string;
  postalCode: string;
}

export interface Merchant {
  id: string;
  name: string;
  owner: string;
  businessType: string;
  category: number;
  location: Location;
  contactInfo: string;
  registrationDate: number;
  status: number;
  isVerified: boolean;
  verificationDocuments: string[];
  vouchers: string[];
  vouchingThreshold: number;
  currentVouches: number;
  trialStartDate: number;
  trialEndDate: number;
  trialDailyLimit: string;
  dailyVolumeLimit: string;
  monthlyLimit: string;
  currentMonthVolume: string;
  currentDayVolume: string;
  lastResetDate: number;
  reputationScore: number;
  isActive: boolean;
  emergencyFastTrack: boolean;
  acceptsQr: boolean;
  acceptsUssd: boolean;
  acceptsNfc: boolean;
  acceptsOffline: boolean;
  pendingSettlement: string;
  lastSettlementDate: number;
}

export interface Transaction {
  id: string;
  merchantId: string;
  beneficiaryId: string;
  amount: string;
  token: string;
  timestamp: number;
  purpose: string;
  merchantSignature: string;
  beneficiarySignature: string;
  isSettled: boolean;
  paymentMethod: number;
}

export interface OfflineTransaction {
  id: string;
  merchantId: string;
  beneficiaryId: string;
  amount: string;
  token: string;
  timestamp: number;
  purpose: string;
  signature: string;
  isSynced: boolean;
}

export interface FraudAlert {
  id: string;
  merchantId: string;
  alertType: string;
  severity: number;
  description: string;
  timestamp: number;
  isResolved: boolean;
}

export interface Settlement {
  id: string;
  merchantId: string;
  amount: string;
  token: string;
  timestamp: number;
  transactionCount: number;
}

export interface MerchantStats {
  reputationScore: number;
  currentDayVolume: string;
  currentMonthVolume: string;
  currentVouches: number;
}

export interface QRCodeData {
  merchantId: string;
  category: number;
  latitude: number;
  longitude: number;
  name: string;
}

export interface TransactionQRData {
  merchantId: string;
  amount: string;
  transferCode: string;
  timestamp: number;
}

export class MerchantNetworkSDK {
  private server: Server;
  private contract: Contract;
  private config: any;

  constructor(config: any) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.merchantNetwork);
  }

  /**
   * Register a merchant with simplified onboarding (community vouching)
   * Target: < 15 minutes onboarding time
   */
  async registerMerchant(
    ownerKey: string,
    merchantId: string,
    profile: MerchantProfile,
    references: string[] // 3 beneficiary references or 1 NGO field worker
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
            nativeToScVal(profile.name),
            nativeToScVal(profile.businessType),
            nativeToScVal(profile.category),
            nativeToScVal(profile.location),
            nativeToScVal(profile.contactInfo),
            nativeToScVal(profile.acceptedTokens),
            nativeToScVal(references),
            nativeToScVal(profile.emergencyFastTrack)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(ownerKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Merchant ${merchantId} registered successfully.`;
    } else {
      throw new Error(`Failed to register merchant: ${result.status}`);
    }
  }

  /**
   * Add community vouches for merchant (3 beneficiaries or 1 NGO worker)
   */
  async addVouch(
    voucherKey: string,
    merchantId: string,
    voucherType: number // 0 = beneficiary, 1 = ngo
  ): Promise<string> {
    const voucherKeypair = Keypair.fromSecret(voucherKey);
    const voucherAccount = await this.server.getAccount(voucherKeypair.publicKey());

    const tx = new TransactionBuilder(voucherAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "add_vouch",
          ...[
            new Address(voucherKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(voucherType)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(voucherKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Vouch added for merchant ${merchantId}`;
    } else {
      throw new Error(`Failed to add vouch: ${result.status}`);
    }
  }

  /**
   * Process payment from beneficiary to merchant
   * Sub-3 second processing for online, < 1 hour for offline sync
   */
  async processPayment(
    merchantKey: string,
    beneficiaryKey: string,
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    paymentMethod: number = PAYMENT_ONLINE
  ): Promise<string> {
    const merchantKeypair = Keypair.fromSecret(merchantKey);
    const beneficiaryKeypair = Keypair.fromSecret(beneficiaryKey);
    
    const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());

    const tx = new TransactionBuilder(merchantAccount, {
      fee: '200',
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
            nativeToScVal(purpose),
            nativeToScVal(paymentMethod)
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
      throw new Error(`Failed to process payment: ${result.status}`);
    }
  }

  /**
   * Process offline payment (batched and synced when connectivity returns)
   */
  async processOfflinePayment(
    merchantId: string,
    beneficiaryId: string,
    amount: string,
    token: string,
    purpose: string,
    signature: string
  ): Promise<string> {
    try {
      const result = await this.contract.call(
        "process_offline_payment",
        nativeToScVal(merchantId),
        nativeToScVal(beneficiaryId),
        nativeToScVal(amount),
        nativeToScVal(token),
        nativeToScVal(purpose),
        nativeToScVal(signature)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      throw new Error(`Failed to process offline payment: ${error}`);
    }
  }

  /**
   * Sync offline transactions (when connectivity returns)
   */
  async syncOfflineTransactions(
    merchantKey: string,
    merchantId: string,
    offlineTransactionIds: string[]
  ): Promise<number> {
    const merchantKeypair = Keypair.fromSecret(merchantKey);
    const merchantAccount = await this.server.getAccount(merchantKeypair.publicKey());

    const tx = new TransactionBuilder(merchantAccount, {
      fee: '200',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "sync_offline_transactions",
          ...[
            nativeToScVal(merchantId),
            nativeToScVal(offlineTransactionIds)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(merchantKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new Error(`Failed to sync offline transactions: ${result.status}`);
    }
  }

  /**
   * Get fraud alerts for a merchant
   */
  async getFraudAlerts(merchantId: string): Promise<FraudAlert[]> {
    try {
      const result = await this.contract.call(
        "get_fraud_alerts",
        nativeToScVal(merchantId)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get fraud alerts:', error);
      return [];
    }
  }

  /**
   * Daily automatic settlement to merchant wallets
   */
  async settleBalances(adminKey: string): Promise<number> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '200',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "settle_balances",
          new Address(adminKeypair.publicKey()).toScVal()
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return scValToNative(result.result.retval);
    } else {
      throw new Error(`Failed to settle balances: ${result.status}`);
    }
  }

  /**
   * Review trial merchant for graduation
   */
  async reviewTrialMerchant(
    adminKey: string,
    merchantId: string,
    approve: boolean
  ): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "review_trial_merchant",
          ...[
            new Address(adminKeypair.publicKey()).toScVal(),
            nativeToScVal(merchantId),
            nativeToScVal(approve)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return approve 
        ? `Merchant ${merchantId} graduated successfully`
        : `Merchant ${merchantId} trial extended or suspended`;
    } else {
      throw new Error(`Failed to review trial merchant: ${result.status}`);
    }
  }

  /**
   * Generate static QR code for shop
   */
  async generateQRCode(merchantId: string): Promise<QRCodeData> {
    try {
      const result = await this.contract.call(
        "generate_shop_qr",
        nativeToScVal(merchantId)
      );
      const qrData = scValToNative(result.result.retval);
      
      // Parse QR data: merchant_id|category|lat|lng|name
      const parts = qrData.split('|');
      return {
        merchantId: parts[0],
        category: parseInt(parts[1]),
        latitude: parseFloat(parts[2]),
        longitude: parseFloat(parts[3]),
        name: parts[4]
      };
    } catch (error) {
      throw new Error(`Failed to generate QR code: ${error}`);
    }
  }

  /**
   * Generate dynamic QR code for transaction
   */
  async generateTransactionQR(
    merchantId: string,
    amount: string,
    transferCode: string
  ): Promise<TransactionQRData> {
    try {
      const result = await this.contract.call(
        "generate_transaction_qr",
        ...[
          nativeToScVal(merchantId),
          nativeToScVal(amount),
          nativeToScVal(transferCode)
        ]
      );
      const qrData = scValToNative(result.result.retval);
      
      // Parse QR data: merchant_id|amount|transfer_code|timestamp
      const parts = qrData.split('|');
      return {
        merchantId: parts[0],
        amount: parts[1],
        transferCode: parts[2],
        timestamp: parseInt(parts[3])
      };
    } catch (error) {
      throw new Error(`Failed to generate transaction QR: ${error}`);
    }
  }

  /**
   * Parse USSD code: *merchant_code*amount#
   */
  parseUSSDCode(code: string): { merchantCode: string; amount: string } {
    const parts = code.split('*');
    if (parts.length >= 3) {
      const merchantCode = parts[1];
      const amount = parts[2].replace('#', '');
      return { merchantCode, amount };
    }
    return { merchantCode: '', amount: '0' };
  }

  /**
   * Get merchant details
   */
  async getMerchant(merchantId: string): Promise<Merchant | null> {
    try {
      const result = await this.contract.call(
        "get_merchant",
        nativeToScVal(merchantId)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get merchant:', error);
      return null;
    }
  }

  /**
   * Find merchants by location (geographic search)
   * Beneficiary discovery
   */
  async findNearbyMerchants(
    gpsCoords: { latitude: number; longitude: number },
    radiusKm: number
  ): Promise<Merchant[]> {
    try {
      const result = await this.contract.call(
        "find_merchants_by_location",
        ...[
          nativeToScVal(gpsCoords.latitude),
          nativeToScVal(gpsCoords.longitude),
          nativeToScVal(radiusKm)
        ]
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to find nearby merchants:', error);
      return [];
    }
  }

  /**
   * Find merchants by category
   */
  async findMerchantsByCategory(category: number): Promise<Merchant[]> {
    try {
      const result = await this.contract.call(
        "find_merchants_by_category",
        nativeToScVal(category)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to find merchants by category:', error);
      return [];
    }
  }

  /**
   * Get merchant transaction history
   */
  async getMerchantTransactions(merchantId: string): Promise<Transaction[]> {
    try {
      const result = await this.contract.call(
        "get_merchant_transactions",
        nativeToScVal(merchantId)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get merchant transactions:', error);
      return [];
    }
  }

  /**
   * Get settlement history for a merchant
   * Daily payout tracking
   */
  async getSettlementHistory(merchantId: string): Promise<Settlement[]> {
    try {
      const result = await this.contract.call(
        "get_settlement_history",
        nativeToScVal(merchantId)
      );
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get settlement history:', error);
      return [];
    }
  }

  /**
   * Get merchant statistics
   */
  async getMerchantStats(merchantId: string): Promise<MerchantStats> {
    try {
      const result = await this.contract.call(
        "get_merchant_stats",
        nativeToScVal(merchantId)
      );
      const stats = scValToNative(result.result.retval);
      return {
        reputationScore: stats[0],
        currentDayVolume: stats[1],
        currentMonthVolume: stats[2],
        currentVouches: stats[3]
      };
    } catch (error) {
      console.error('Failed to get merchant stats:', error);
      return {
        reputationScore: 0,
        currentDayVolume: '0',
        currentMonthVolume: '0',
        currentVouches: 0
      };
    }
  }

  /**
   * Get onboarding queue
   */
  async getOnboardingQueue(): Promise<string[]> {
    try {
      const result = await this.contract.call("get_onboarding_queue");
      return scValToNative(result.result.retval);
    } catch (error) {
      console.error('Failed to get onboarding queue:', error);
      return [];
    }
  }

  /**
   * Reset daily volumes
   */
  async resetDailyVolumes(adminKey: string): Promise<void> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call("reset_daily_volumes")
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status !== 'SUCCESS') {
      throw new Error(`Failed to reset daily volumes: ${result.status}`);
    }
  }

  /**
   * Create merchant onboarding request
   */
  createOnboardingRequest(
    name: string,
    businessType: string,
    category: number,
    location: Location,
    contactInfo: string,
    emergencyFastTrack: boolean = false
  ): MerchantProfile {
    return {
      name,
      businessType,
      category,
      location,
      contactInfo,
      acceptedTokens: ['USDC', 'XLM'],
      emergencyFastTrack
    };
  }

  /**
   * Get category name
   */
  getCategoryName(category: number): string {
    const categories: { [key: number]: string } = {
      [CATEGORY_FOOD]: 'Food',
      [CATEGORY_WATER]: 'Water',
      [CATEGORY_SHELTER]: 'Shelter',
      [CATEGORY_MEDICAL]: 'Medical',
      [CATEGORY_CLOTHING]: 'Clothing',
      [CATEGORY_FUEL]: 'Fuel'
    };
    return categories[category] || 'Unknown';
  }

  /**
   * Get status name
   */
  getStatusName(status: number): string {
    const statuses: { [key: number]: string } = {
      [STATUS_PENDING]: 'Pending',
      [STATUS_TRIAL]: 'Trial',
      [STATUS_ACTIVE]: 'Active',
      [STATUS_SUSPENDED]: 'Suspended',
      [STATUS_GRADUATED]: 'Graduated'
    };
    return statuses[status] || 'Unknown';
  }

  /**
   * Get payment method name
   */
  getPaymentMethodName(method: number): string {
    const methods: { [key: number]: string } = {
      [PAYMENT_QR]: 'QR Code',
      [PAYMENT_USSD]: 'USSD',
      [PAYMENT_NFC]: 'NFC',
      [PAYMENT_OFFLINE]: 'Offline',
      [PAYMENT_ONLINE]: 'Online'
    };
    return methods[method] || 'Unknown';
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

export default MerchantNetworkSDK;
