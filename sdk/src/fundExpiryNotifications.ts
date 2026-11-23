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

export interface NotificationLog {
  id: string;
  fundId: string;
  notificationType: 'email' | 'sms' | 'in-app' | 'webhook';
  recipient: string;
  sentAt: number;
  status: 'sent' | 'failed' | 'bounced' | 'acknowledged';
  message: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Notification store
// ---------------------------------------------------------------------------

/**
 * Pluggable persistence layer for notification log records.
 *
 * The default implementation (`InMemoryNotificationStore`) is suitable for
 * testing and single-process deployments. Production callers should provide
 * a database-backed implementation and pass it to the constructor.
 *
 * Both methods must be scoped to `fundId`:
 * - `append` persists one record; throws on write failure.
 * - `getByFund` returns all records for the given fund in ascending `sentAt`
 *   order; throws on read failure; returns `[]` only when the fund truly has
 *   no history.
 */
export interface NotificationStore {
  append(log: NotificationLog): Promise<void>;
  getByFund(fundId: string): Promise<NotificationLog[]>;
}

/**
 * In-memory notification store ordered by insertion time.
 * Records are stored in a `Map<fundId, NotificationLog[]>`.
 */
export class InMemoryNotificationStore implements NotificationStore {
  private readonly store = new Map<string, NotificationLog[]>();

  async append(log: NotificationLog): Promise<void> {
    const existing = this.store.get(log.fundId) ?? [];
    existing.push(log);
    this.store.set(log.fundId, existing);
  }

  /**
   * Returns records for `fundId` sorted ascending by `sentAt`.
   * Returns an empty array — not an error — when no records exist.
   */
  async getByFund(fundId: string): Promise<NotificationLog[]> {
    const records = this.store.get(fundId) ?? [];
    return records.slice().sort((a, b) => a.sentAt - b.sentAt);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Fund Expiry Notifications Client
 * Manages notifications to admins when funds are about to expire.
 *
 * @param contractId         Soroban contract address.
 * @param signingKey         Keypair used to sign transactions.
 * @param server             Horizon server instance.
 * @param notificationConfig Threshold and channel configuration.
 * @param networkPassphrase  Stellar network passphrase.
 * @param notificationStore  Persistence layer for notification logs.
 *                           Defaults to `InMemoryNotificationStore`.
 */
export class FundExpiryNotificationsClient {
  private contractId: string;
  private signingKey: Keypair;
  private server: any;
  private networkPassphrase: string;
  private notificationConfig: ExpiryNotificationConfig;
  private readonly store: NotificationStore;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig = {
      notificationThresholdDays: 7, // Notify 7 days before expiry
      enableAutoNotifications: true,
    },
    networkPassphrase: string = Networks.TESTNET,
    notificationStore: NotificationStore = new InMemoryNotificationStore()
  ) {
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.notificationConfig = notificationConfig;
    this.store = notificationStore;
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
   * Sends expiry notifications to fund administrators and persists each log
   * record to the notification store so it is visible via `getNotificationHistory`.
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
          let log: NotificationLog;
          try {
            log = await this.sendNotificationViaChannel(notification, channel);
            if (log.status === 'sent') {
              sentCount++;
            } else {
              failedCount++;
            }
          } catch (error: any) {
            failedCount++;
            log = {
              id: `${notification.fundId}_${channel}_${Date.now()}`,
              fundId: notification.fundId,
              notificationType: channel as 'email' | 'sms' | 'webhook',
              recipient: notification.adminAddress,
              sentAt: Math.floor(Date.now() / 1000),
              status: 'failed',
              message: error.message,
              retryCount: 0,
            };
          }

          // Persist the log before collecting it; a store write failure
          // surfaces as an error rather than a silent data loss.
          await this.store.append(log);
          logs.push(log);
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
   * Returns all notification log records for `fundId`, ordered by `sentAt`
   * ascending (oldest first).
   *
   * - Returns an empty array when the fund has no history (not an error).
   * - Throws when the underlying store fails to read.
   */
  async getNotificationHistory(fundId: string): Promise<NotificationLog[]> {
    try {
      return await this.store.getByFund(fundId);
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
