import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Operation,
  Keypair,
  BASE_FEE,
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

/**
 * Per-fund data returned by the provider. `undefined` means the fund does not
 * exist; the caller decides whether that is an error or a skip.
 */
export interface FundExpiryData {
  fundId: string;
  fundName: string;
  expiresAt: number; // unix seconds
  totalAmount: string;
  releasedAmount: string;
  availableAmount: string;
  adminAddress: string;
  /** True if the admin has already acknowledged / handled this expiry. */
  handled?: boolean;
  /** True for funds that never expire — these are always skipped. */
  neverExpires?: boolean;
}

/**
 * Pluggable data source for {@link FundExpiryNotificationsClient.checkExpiringFunds}.
 * In production this wraps a contract read; in tests it is injected directly.
 */
export interface FundExpiryDataProvider {
  getFund(fundId: string): Promise<FundExpiryData | undefined>;
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
  private dataProvider?: FundExpiryDataProvider;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig = {
      notificationThresholdDays: 7, // Notify 7 days before expiry
      enableAutoNotifications: true,
    },
    networkPassphrase: string = Networks.TESTNET,
    dataProvider?: FundExpiryDataProvider
  ) {
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.notificationConfig = notificationConfig;
    this.dataProvider = dataProvider;
  }

  /**
   * Override the data source used by {@link checkExpiringFunds}.
   */
  setDataProvider(provider: FundExpiryDataProvider): void {
    this.dataProvider = provider;
  }

  /**
   * Registers a notification threshold for a fund
   * Triggers notifications when fund expiry approaches
   */
  async registerFundExpiryNotification(
    adminAddress: string,
    fundId: string,
    fundName: string,
    expiresAt: number,
    notificationEmail: string
  ): Promise<{ success: boolean; transactionHash: string; notificationId: string }> {
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

      const notificationId = `${fundId}_expiry_${Date.now()}`;

      return {
        success: true,
        transactionHash: response.hash,
        notificationId,
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
    if (!this.dataProvider) {
      throw new Error(
        'checkExpiringFunds requires a data provider; pass one to the ' +
          'constructor or call setDataProvider() before calling this method.'
      );
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const thresholdSeconds =
      this.notificationConfig.notificationThresholdDays * 24 * 60 * 60;
    const expiringFunds: ExpiryNotification[] = [];

    for (const fundId of fundIds) {
      // Provider errors (RPC, decoding, etc.) surface to the caller rather
      // than being silently turned into an empty success — operators need
      // to know when the lookup failed, not treat it as "no expiries".
      const fund = await this.dataProvider.getFund(fundId);
      if (fund === undefined) {
        // Missing fund: skip rather than fabricate a notification.
        continue;
      }
      if (fund.neverExpires) {
        continue;
      }
      if (fund.handled) {
        continue;
      }

      const secondsUntilExpiry = fund.expiresAt - currentTime;
      // Already expired funds are past the window — they are handled by a
      // separate post-expiry path and must not re-enter the pre-expiry queue.
      if (secondsUntilExpiry <= 0) {
        continue;
      }
      if (secondsUntilExpiry > thresholdSeconds) {
        continue;
      }

      const daysUntilExpiry = Math.ceil(secondsUntilExpiry / (24 * 60 * 60));
      expiringFunds.push({
        id: `${fund.fundId}_expiry_${currentTime}`,
        fundId: fund.fundId,
        fundName: fund.fundName,
        expiresAt: fund.expiresAt,
        daysUntilExpiry,
        totalAmount: fund.totalAmount,
        releasedAmount: fund.releasedAmount,
        availableAmount: fund.availableAmount,
        adminAddress: fund.adminAddress,
        notificationSentAt: currentTime,
        notificationStatus: 'pending',
      });
    }

    return expiringFunds;
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
   * Acknowledges expiry notification
   */
  async acknowledgeNotification(
    adminAddress: string,
    notificationId: string
  ): Promise<{ success: boolean; acknowledgedAt: number }> {
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
        transactionHash: response.hash,
      };
    } catch (error: any) {
      throw new Error(`Failed to disable fund notifications: ${error.message}`);
    }
  }
}
