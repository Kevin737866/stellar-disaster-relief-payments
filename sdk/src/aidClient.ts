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
  EmergencyFund, 
  DisbursementRecord, 
  DeploymentOptions,
  NetworkConfig 
} from './types';

export class AidClient {
  private server: Server;
  private contract: Contract;
  private config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new Server(config.rpcUrl);
    this.contract = new Contract(config.contractIds.aidRegistry);
  }

  /**
   * Deploy emergency fund for disaster response
   */
  async deployEmergencyFund(
    adminKey: string,
    fundId: string,
    name: string,
    description: string,
    totalAmount: string,
    disasterType: string,
    geographicScope: string,
    expiresAt: number,
    releaseTriggers: string[],
    requiredSignatures: number
  ): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "create_fund",
          ...[
            new Address(adminKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            nativeToScVal(name),
            nativeToScVal(description),
            nativeToScVal(totalAmount),
            nativeToScVal(disasterType),
            nativeToScVal(geographicScope),
            nativeToScVal(expiresAt),
            nativeToScVal(releaseTriggers),
            nativeToScVal(requiredSignatures)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return fundId;
    } else {
      throw new Error(`Failed to deploy emergency fund: ${result.status}`);
    }
  }

  /**
   * Trigger disbursement with multi-sig approval
   */
  async triggerDisbursement(
    requesterKey: string,
    fundId: string,
    beneficiary: string,
    amount: string,
    purpose: string,
    approvers: string[]
  ): Promise<string> {
    const requesterKeypair = Keypair.fromSecret(requesterKey);
    const requesterAccount = await this.server.getAccount(requesterKeypair.publicKey());

    const tx = new TransactionBuilder(requesterAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          "submit_disbursement",
          ...[
            new Address(requesterKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            nativeToScVal(beneficiary),
            nativeToScVal(amount),
            nativeToScVal(purpose),
            nativeToScVal(approvers)
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(requesterKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return `Disbursement submitted for fund ${fundId}`;
    } else {
      throw new Error(`Failed to submit disbursement: ${result.status}`);
    }
  }

  /**
   * Submit multiple disbursements atomically in a single transaction.
   * All entries succeed or all fail — no partial state.
   *
   * @param requesterKey  Secret key of the requester
   * @param fundId        Fund to draw from
   * @param entries       Array of { beneficiary, amount, purpose }
   * @param approvers     Secret keys of multi-sig approvers
   * @returns Array of disbursement IDs created on-chain
   */
  async triggerBatchDisbursement(
    requesterKey: string,
    fundId: string,
    entries: Array<{ beneficiary: string; amount: string; purpose: string }>,
    approvers: string[]
  ): Promise<string[]> {
    if (entries.length === 0) {
      throw new Error('Batch must contain at least one entry');
    }

    const requesterKeypair = Keypair.fromSecret(requesterKey);
    const requesterAccount = await this.server.getAccount(requesterKeypair.publicKey());

    // Build the entries as a Vec of tuples for the contract call
    const entriesScVal = nativeToScVal(
      entries.map(e => [e.beneficiary, e.amount, e.purpose])
    );

    const tx = new TransactionBuilder(requesterAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(
        this.contract.call(
          'submit_batch_disbursement',
          ...[
            new Address(requesterKeypair.publicKey()).toScVal(),
            nativeToScVal(fundId),
            entriesScVal,
            nativeToScVal(approvers),
          ]
        )
      )
      .setTimeout(30)
      .build();

    tx.sign(requesterKeypair);
    const result = await this.server.sendTransaction(tx);

    if (result.status === 'SUCCESS') {
      const ids = scValToNative(result.resultMetaXdr) as string[];
      return ids ?? [];
    } else {
      throw new Error(`Batch disbursement failed: ${result.status}`);
    }
  }

  /**
   * Get fund details
   */
  async getFund(fundId: string): Promise<EmergencyFund | null> {
    try {
      const result = await this.contract.call("get_fund", nativeToScVal(fundId));
      const fundData = scValToNative(result.result.retval);
      return fundData;
    } catch (error) {
      console.error('Failed to get fund:', error);
      return null;
    }
  }

  /**
   * List all active emergency funds
   */
  async listActiveFunds(): Promise<EmergencyFund[]> {
    try {
      const result = await this.contract.call("list_active_funds");
      const funds = scValToNative(result.result.retval);
      return funds;
    } catch (error) {
      console.error('Failed to list active funds:', error);
      return [];
    }
  }

  /**
   * Get disbursement history for a fund
   */
  async getDisbursements(fundId: string): Promise<DisbursementRecord[]> {
    try {
      const result = await this.contract.call("get_disbursements", nativeToScVal(fundId));
      const disbursements = scValToNative(result.result.retval);
      return disbursements;
    } catch (error) {
      console.error('Failed to get disbursements:', error);
      return [];
    }
  }

  /**
   * Monitor fund pool status
   */
  async monitorFundPool(fundId: string): Promise<{
    totalAmount: string;
    releasedAmount: string;
    remainingAmount: string;
    isActive: boolean;
    expiresAt: number;
  }> {
    const fund = await this.getFund(fundId);
    if (!fund) {
      throw new Error(`Fund ${fundId} not found`);
    }

    const totalAmount = BigInt(fund.totalAmount);
    const releasedAmount = BigInt(fund.releasedAmount);
    const remainingAmount = totalAmount - releasedAmount;

    return {
      totalAmount: fund.totalAmount,
      releasedAmount: fund.releasedAmount,
      remainingAmount: remainingAmount.toString(),
      isActive: fund.isActive,
      expiresAt: fund.expiresAt
    };
  }

  /**
   * Cleanup expired funds
   */
  async cleanupExpiredFunds(adminKey: string): Promise<string> {
    const adminKeypair = Keypair.fromSecret(adminKey);
    const adminAccount = await this.server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(adminAccount, {
      fee: '100',
      networkPassphrase: this.getNetworkPassphrase(),
    })
      .addOperation(this.contract.call("cleanup_expired_funds"))
      .setTimeout(30)
      .build();

    tx.sign(adminKeypair);
    const result = await this.server.sendTransaction(tx);
    
    if (result.status === 'SUCCESS') {
      return 'Expired funds cleaned up successfully';
    } else {
      throw new Error(`Failed to cleanup expired funds: ${result.status}`);
    }
  }

  /**
   * Create multiple funds for large-scale disaster response
   */
  async deployRapidResponse(
    adminKey: string,
    disasterId: string,
    disasterType: string,
    affectedArea: string,
    totalBudget: string,
    fundCategories: Array<{
      name: string;
      percentage: number;
      description: string;
    }>
  ): Promise<string[]> {
    const fundIds: string[] = [];
    const adminKeypair = Keypair.fromSecret(adminKey);

    for (const category of fundCategories) {
      const fundId = `${disasterId}_${category.name.toLowerCase().replace(/\s+/g, '_')}`;
      const amount = (BigInt(totalBudget) * BigInt(category.percentage) / BigInt(100)).toString();
      
      try {
        await this.deployEmergencyFund(
          adminKey,
          fundId,
          `${category.name} - ${disasterId}`,
          category.description,
          amount,
          disasterType,
          affectedArea,
          Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now
          [adminKeypair.publicKey()],
          1
        );
        fundIds.push(fundId);
      } catch (error) {
        console.error(`Failed to create fund ${fundId}:`, error);
      }
    }

    return fundIds;
  }

  /**
   * Generate QR code for fund information (offline access)
   */
  generateFundQRCode(fundId: string, fund: EmergencyFund): string {
    const qrData = {
      type: 'emergency_fund',
      fundId,
      name: fund.name,
      totalAmount: fund.totalAmount,
      disasterType: fund.disasterType,
      expiresAt: fund.expiresAt,
      timestamp: Date.now()
    };

    return JSON.stringify(qrData);
  }

  /**
   * Validate fund QR code
   */
  validateFundQRCode(qrCodeData: string): boolean {
    try {
      const data = JSON.parse(qrCodeData);
      
      if (data.type !== 'emergency_fund') {
        return false;
      }

      // Check if QR code is expired
      if (data.expiresAt && Date.now() > data.expiresAt) {
        return false;
      }

      // Verify fund exists on chain
      return this.getFund(data.fundId).then(fund => fund !== null);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get fund statistics for reporting
   */
  async getFundStatistics(fundId: string): Promise<{
    totalDisbursements: number;
    totalAmountDisbursed: string;
    averageDisbursement: string;
    lastDisbursement: number | null;
    beneficiariesReached: number;
  }> {
    const disbursements = await this.getDisbursements(fundId);
    const beneficiaries = new Set(disbursements.map(d => d.beneficiary));
    
    const totalAmount = disbursements.reduce((sum, d) => 
      sum + BigInt(d.amount), BigInt(0)
    );

    const averageDisbursement = disbursements.length > 0 
      ? (totalAmount / BigInt(disbursements.length)).toString()
      : '0';

    const lastDisbursement = disbursements.length > 0
      ? Math.max(...disbursements.map(d => d.timestamp))
      : null;

    return {
      totalDisbursements: disbursements.length,
      totalAmountDisbursed: totalAmount.toString(),
      averageDisbursement,
      lastDisbursement,
      beneficiariesReached: beneficiaries.size
    };
  }

  private getNetworkPassphrase(): string {
    switch (this.config.network) {
      case 'testnet':
        return Networks.TESTNET;
      case 'mainnet':
        return Networks.PUBLIC;
      case 'standalone':
        return Networks.STANDALONE;
      default:
        throw new Error('Unsupported network');
    }
  }
}
