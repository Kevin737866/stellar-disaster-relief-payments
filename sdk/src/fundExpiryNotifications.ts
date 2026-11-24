import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
  SorobanRpc,
  scValToNative,
} from 'stellar-sdk';

export interface ExpiryNotification {
  id: string;
  fundId: string;
  fundName: string;
  expiresAt: number;
  daysUntilExpiry: number;
  totalAmount: string;
  releasedAmount: string;
  availableAmount: string;
  adminAddress: string;
  notificationSentAt: number;
  notificationStatus: 'pending' | 'sent' | 'acknowledged';
}

export interface ExpiryNotificationConfig {
  notificationThresholdDays: number; // Days before expiry to send notification
  enableAutoNotifications: boolean;
  emailTemplate?: string;
  smsTemplate?: string;
}

export type FundExpiryNotificationIdSource = 'contract' | 'correlation';

export interface RegisterFundExpiryNotificationResult {
  success: boolean;
  transactionHash: string;
  /**
   * Identifier for the registered notification.
   * - `contract`: decoded from a confirmed contract transaction result.
   * - `correlation`: client-generated correlation ID derived from the transaction
   *   hash returned by the submission when the contract does not expose an ID.
   *   This is traceable to the submitted transaction, not a contract-returned ID.
   */
  notificationId: string;
  /** How `notificationId` was derived. */
  notificationIdSource: FundExpiryNotificationIdSource;
}

export interface NotificationLog {
  id: string;
  fundId: string;
  notificationType: 'email' | 'sms' | 'in-app' | 'webhook';
  recipient: string;
  sentAt: number;
  status: 'sent' | 'failed' | 'bounced';
  message: string;
  retryCount: number;
}

/**
 * Fund Expiry Notifications Client
 * Manages notifications to admins when funds are about to expire
 */
export class FundExpiryNotificationsClient {
  private contractId: string;
  private signingKey: Keypair;
  private server: any;
  private networkPassphrase: string;
  private notificationConfig: ExpiryNotificationConfig;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig = {
      notificationThresholdDays: 7, // Notify 7 days before expiry
      enableAutoNotifications: true,
    },
    networkPassphrase: string = Networks.TESTNET
  ) {
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.notificationConfig = notificationConfig;
  }

  /**
   * Registers a notification threshold for a fund.
   * Triggers notifications when fund expiry approaches.
   *
   * The returned `notificationId` is traceable to a confirmed contract result
   * when the contract exposes an ID. If the contract does not expose a
   * notification ID, a clearly named transaction-hash correlation ID is
   * returned instead (`notificationIdSource: 'correlation'`).
   */
  async registerFundExpiryNotification(
    adminAddress: string,
    fundId: string,
    fundName: string,
    expiresAt: number,
    notificationEmail: string
  ): Promise<RegisterFundExpiryNotificationResult> {
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'register_expiry_notification',
            new Address(adminAddress),
            fundId,
            fundName,
            expiresAt,
            notificationEmail
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await this.server.submitTransaction(transaction);
      const transactionHash = this.getTransactionHash(response);
      const resolved = await this.resolveRegisterNotificationId(response, transactionHash, fundId);

      return {
        success: true,
        transactionHash,
        notificationId: resolved.notificationId,
        notificationIdSource: resolved.source,
      };
    } catch (error: any) {
      throw new Error(`Failed to register expiry notification: ${error.message}`);
    }
  }

  /**
   * Checks for funds expiring within the notification threshold
   * Returns list of funds requiring notifications
   */
  async checkExpiringFunds(fundIds: string[]): Promise<ExpiryNotification[]> {
    try {
      const expiringFunds: ExpiryNotification[] = [];
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      const thresholdSeconds = this.notificationConfig.notificationThresholdDays * 24 * 60 * 60;

      // This would typically query the contract or a backend service
      // For now, returning empty array as placeholder
      return expiringFunds;
    } catch (error: any) {
      throw new Error(`Failed to check expiring funds: ${error.message}`);
    }
  }

  /**
   * Sends expiry notifications to fund administrators
   * Supports multiple notification channels
   */
  async sendExpiryNotifications(
    notifications: ExpiryNotification[],
    channels: ('email' | 'sms' | 'webhook')[] = ['email']
  ): Promise<{ success: boolean; sentCount: number; failedCount: number; logs: NotificationLog[] }> {
    try {
      let sentCount = 0;
      let failedCount = 0;
      const logs: NotificationLog[] = [];

      for (const notification of notifications) {
        for (const channel of channels) {
          try {
            const log = await this.sendNotificationViaChannel(notification, channel);
            logs.push(log);
            if (log.status === 'sent') {
              sentCount++;
            } else {
              failedCount++;
            }
          } catch (error: any) {
            failedCount++;
            logs.push({
              id: `${notification.fundId}_${channel}_${Date.now()}`,
              fundId: notification.fundId,
              notificationType: channel as 'email' | 'sms' | 'webhook',
              recipient: notification.adminAddress,
              sentAt: Math.floor(Date.now() / 1000),
              status: 'failed',
              message: error.message,
              retryCount: 0,
            });
          }
        }
      }

      return {
        success: failedCount === 0,
        sentCount,
        failedCount,
        logs,
      };
    } catch (error: any) {
      throw new Error(`Failed to send expiry notifications: ${error.message}`);
    }
  }

  /**
   * Sends notification via specific channel
   */
  private async sendNotificationViaChannel(
    notification: ExpiryNotification,
    channel: 'email' | 'sms' | 'webhook'
  ): Promise<NotificationLog> {
    const message = this.generateNotificationMessage(notification, channel);
    const timestamp = Math.floor(Date.now() / 1000);
    const logId = `${notification.fundId}_${channel}_${timestamp}`;

    // Simulate sending notification
    // In production, integrate with actual notification services
    let status: 'sent' | 'failed' | 'bounced' = 'sent';

    try {
      if (channel === 'email') {
        // Call email service
        // await sendEmail(notification.adminAddress, 'Fund Expiry Notification', message);
      } else if (channel === 'sms') {
        // Call SMS service
        // await sendSMS(notification.adminAddress, message);
      } else if (channel === 'webhook') {
        // Call webhook
        // await notifyWebhook(notification.adminAddress, message);
      }
    } catch (error) {
      status = 'failed';
    }

    return {
      id: logId,
      fundId: notification.fundId,
      notificationType: channel,
      recipient: notification.adminAddress,
      sentAt: timestamp,
      status,
      message,
      retryCount: 0,
    };
  }

  /**
   * Generates notification message with fund details
   */
  private generateNotificationMessage(
    notification: ExpiryNotification,
    channel: 'email' | 'sms' | 'webhook'
  ): string {
    const daysRemaining = notification.daysUntilExpiry;
    const fundName = notification.fundName;
    const availableAmount = notification.availableAmount;

    if (channel === 'email') {
      return `
        <h2>Fund Expiry Alert</h2>
        <p>The ${fundName} fund is expiring in ${daysRemaining} days.</p>
        <p><strong>Available Amount:</strong> ${availableAmount}</p>
        <p>Please take action to allocate remaining funds or request an extension.</p>
      `;
    } else if (channel === 'sms') {
      return `ALERT: ${fundName} expires in ${daysRemaining} days. Available: ${availableAmount}. Action required.`;
    } else {
      return JSON.stringify({
        fundId: notification.fundId,
        fundName,
        daysUntilExpiry: daysRemaining,
        availableAmount,
        message: `Fund expiry alert for ${fundName}`,
      });
    }
  }

  /**
   * Acknowledges expiry notification.
   *
   * @param notificationId - Contract-returned notification ID, or a correlation
   *   ID returned by `registerFundExpiryNotification` when the contract did not
   *   expose an ID.
   */
  async acknowledgeNotification(
    adminAddress: string,
    notificationId: string
  ): Promise<{ success: boolean; acknowledgedAt: number }> {
    this.assertNotificationId(notificationId, 'acknowledge notification');
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'acknowledge_notification',
            new Address(adminAddress),
            notificationId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      await this.server.submitTransaction(transaction);

      return {
        success: true,
        acknowledgedAt: Math.floor(Date.now() / 1000),
      };
    } catch (error: any) {
      throw new Error(`Failed to acknowledge notification: ${error.message}`);
    }
  }

  /**
   * Gets notification history for a fund
   */
  async getNotificationHistory(fundId: string): Promise<NotificationLog[]> {
    try {
      // Query notification history from contract or backend
      // This would typically retrieve from storage
      return [];
    } catch (error: any) {
      throw new Error(`Failed to retrieve notification history: ${error.message}`);
    }
  }

  /**
   * Updates notification configuration
   */
  async updateNotificationConfig(
    adminAddress: string,
    newConfig: ExpiryNotificationConfig
  ): Promise<{ success: boolean; updatedAt: number }> {
    try {
      this.notificationConfig = { ...this.notificationConfig, ...newConfig };
      return {
        success: true,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    } catch (error: any) {
      throw new Error(`Failed to update notification config: ${error.message}`);
    }
  }

  /**
   * Disables notifications for a specific fund
   */
  async disableFundNotifications(
    adminAddress: string,
    fundId: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const sourceAccount = await this.server.loadAccount(adminAddress);
      const contract = new Contract(this.contractId) as any;

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'disable_fund_notifications',
            new Address(adminAddress),
            fundId
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      const response = await this.server.submitTransaction(transaction);

      return {
        success: true,
        transactionHash: this.getTransactionHash(response),
      };
    } catch (error: any) {
      throw new Error(`Failed to disable fund notifications: ${error.message}`);
    }
  }

  private assertNotificationId(notificationId: string, operation: string): void {
    if (typeof notificationId !== 'string' || notificationId.trim().length === 0) {
      throw new Error(`Failed to ${operation}: notificationId is required`);
    }
  }

  private getTransactionHash(response: any): string {
    const hash = response?.hash ?? response?.id ?? response?.txHash;
    if (typeof hash !== 'string' || hash.trim().length === 0) {
      throw new Error('Transaction response did not include a transaction hash');
    }
    return hash;
  }

  private buildCorrelationNotificationId(transactionHash: string, fundId: string): string {
    return `tx:${transactionHash}:fund:${fundId}:notification-registration`;
  }

  private async resolveRegisterNotificationId(
    submitResponse: any,
    transactionHash: string,
    fundId: string
  ): Promise<{ notificationId: string; source: FundExpiryNotificationIdSource }> {
    const submitResult = this.readContractNotificationId(submitResponse);
    if (submitResult === undefined) {
      throw this.malformedContractResultError();
    }
    if (submitResult !== null) {
      return { notificationId: submitResult, source: 'contract' };
    }

    const confirmedResponse = await this.getConfirmedTransactionResponse(submitResponse, transactionHash);
    if (confirmedResponse) {
      const confirmedId = this.readContractNotificationId(confirmedResponse);
      if (confirmedId === undefined) {
        throw this.malformedContractResultError();
      }
      if (confirmedId !== null) {
        return { notificationId: confirmedId, source: 'contract' };
      }
    }

    // No contract-exposed ID found in confirmed/available result. Use a clearly named
    // correlation ID traceable to the submitted transaction hash.
    return {
      notificationId: this.buildCorrelationNotificationId(transactionHash, fundId),
      source: 'correlation',
    };
  }

  /**
   * Returns the decoded ID, `null` when the result contains no ID, and `undefined`
   * when a result was present but could not be parsed into an ID.
   */
  private readContractNotificationId(response: any): string | null | undefined {
    try {
      return this.extractContractNotificationId(response) ?? null;
    } catch {
      return undefined;
    }
  }

  private malformedContractResultError(): Error {
    return new Error('malformed contract result; notificationId could not be parsed');
  }

  private async getConfirmedTransactionResponse(
    submitResponse: any,
    transactionHash: string
  ): Promise<any | null> {
    if (this.hasResultPayload(submitResponse)) {
      return submitResponse;
    }

    const getTransaction = this.server?.getTransaction;
    if (typeof getTransaction !== 'function') {
      return null;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      let txResponse: any;
      try {
        txResponse = await getTransaction.call(this.server, transactionHash);
      } catch {
        return null;
      }

      const status = txResponse?.status;
      if (status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return txResponse;
      }
      if (status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`transaction ${transactionHash} failed on-chain`);
      }
      if (status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        return txResponse;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return null;
  }

  private hasResultPayload(response: any): boolean {
    return Boolean(
      response?.resultMetaXdr ??
        response?.result_meta_xdr ??
        response?.returnValue ??
        response?.result?.retval ??
        response?.resultXdr ??
        response?.result_xdr
    );
  }

  private extractContractNotificationId(response: any): string | undefined {
    const raw = this.extractRawContractReturnValue(response);
    if (raw === undefined) return undefined;
    return this.normalizeContractNotificationId(raw);
  }

  private extractRawContractReturnValue(response: any): unknown | undefined {
    if (!response) return undefined;

    if (response.returnValue !== undefined) return response.returnValue;

    const retval = response?.result?.retval;
    if (retval !== undefined) return retval;

    const meta = response?.resultMetaXdr ?? response?.result_meta_xdr;
    if (meta) {
      const extracted = this.extractReturnValueFromMeta(meta);
      if (extracted !== undefined) return extracted;
    }

    const resultXdr = response?.resultXdr ?? response?.result_xdr;
    if (resultXdr && typeof resultXdr?.result === 'function') {
      try {
        // Horizon/Soroban transaction result shape: result().value() may contain retval.
        const txResult = resultXdr.result();
        const value = txResult?.value?.();
        if (Array.isArray(value) && value.length > 0) {
          const first = value[0];
          const opRet = typeof first?.tr === 'function' ? first.tr() : undefined;
          const invokeRet = typeof opRet?.value === 'function' ? opRet.value() : undefined;
          const maybeRetval = typeof invokeRet?.value === 'function' ? invokeRet.value() : undefined;
          if (maybeRetval !== undefined) return maybeRetval;
        }
      } catch {
        throw new Error('MALFORMED_NOTIFICATION_ID');
      }
    }

    return undefined;
  }

  private extractReturnValueFromMeta(meta: any): unknown | undefined {
    let decodeAttempted = false;
    let decodeFailed = false;
    try {
      const sorobanMeta =
        typeof meta?.v3 === 'function' ? meta.v3()?.sorobanMeta?.() : meta?.v3?.sorobanMeta;
      const returnValue =
        typeof sorobanMeta?.returnValue === 'function'
          ? sorobanMeta.returnValue()
          : sorobanMeta?.returnValue;
      if (returnValue !== undefined && returnValue !== null) {
        decodeAttempted = true;
        return scValToNative(returnValue);
      }
    } catch {
      decodeFailed = true;
    }

    // Some server mocks/providers expose already-decoded return_value.
    const decoded = meta?.returnValue ?? meta?.return_value ?? meta?.v3?.soroban_meta?.return_value;
    if (decoded !== undefined) return decoded;
    if (decodeAttempted && decodeFailed) {
      throw new Error('MALFORMED_NOTIFICATION_ID');
    }
    return undefined;
  }

  private normalizeContractNotificationId(raw: unknown): string | undefined {
    let value: unknown = raw;
    if (value && typeof value === 'object' && typeof (value as any)._switch === 'function') {
      try {
        value = scValToNative(value as any);
      } catch {
        throw new Error('MALFORMED_NOTIFICATION_ID');
      }
    }

    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) throw new Error('MALFORMED_NOTIFICATION_ID');
      return trimmed;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      const text = String(value);
      if (!text || text === 'NaN') throw new Error('MALFORMED_NOTIFICATION_ID');
      return text;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return undefined;
      if (value.length === 1) return this.normalizeContractNotificationId(value[0]);
      throw new Error('MALFORMED_NOTIFICATION_ID');
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const candidate =
        obj.notificationId ??
        obj.notification_id ??
        obj.id ??
        obj.value;
      if (candidate !== undefined) {
        return this.normalizeContractNotificationId(candidate);
      }
      throw new Error('MALFORMED_NOTIFICATION_ID');
    }

    throw new Error('MALFORMED_NOTIFICATION_ID');
  }
}
