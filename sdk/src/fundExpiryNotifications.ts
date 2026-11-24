import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Operation,
  Keypair,
  StrKey,
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

/** Smallest accepted value for `notificationThresholdDays` (1 day before expiry). */
export const MIN_NOTIFICATION_THRESHOLD_DAYS = 1;

/** Largest accepted value for `notificationThresholdDays` (365 days before expiry). */
export const MAX_NOTIFICATION_THRESHOLD_DAYS = 365;

/** Maximum accepted length of an email or SMS template. */
export const MAX_NOTIFICATION_TEMPLATE_LENGTH = 10000;

export type NotificationConfigErrorCode =
  | 'INVALID_ADMIN_ADDRESS'
  | 'INVALID_CONFIG'
  | 'UNAUTHORIZED'
  | 'PERSISTENCE_FAILED';

/**
 * Error raised by notification-configuration operations.
 *
 * `code` tells callers why the update failed without parsing the message:
 * - `INVALID_ADMIN_ADDRESS`: `adminAddress` is not a Stellar public key.
 * - `INVALID_CONFIG`: the supplied threshold/template/channel settings are invalid.
 * - `UNAUTHORIZED`: the persistence provider rejected the writer.
 * - `PERSISTENCE_FAILED`: the provider failed for a non-authorization reason.
 */
export class NotificationConfigError extends Error {
  readonly code: NotificationConfigErrorCode;

  constructor(code: NotificationConfigErrorCode, message: string) {
    super(message);
    this.name = 'NotificationConfigError';
    this.code = code;
  }
}

/**
 * A persisted notification configuration snapshot.
 *
 * `requestedBy` records which admin address requested the change. It is a
 * caller-supplied attribution, not proof of on-chain authorization.
 */
export interface NotificationConfigRecord {
  contractId: string;
  config: ExpiryNotificationConfig;
  updatedAt: number; // unix seconds
  requestedBy: string;
}

/**
 * Persistence boundary for notification configuration.
 *
 * A store is responsible for durability and for authorizing writes. When no
 * store is supplied the client only keeps configuration in memory, and every
 * update result reports `persistence: 'local'`.
 */
export interface NotificationConfigStore {
  /** Persist a configuration snapshot. Throwing rejects the update. */
  save(record: NotificationConfigRecord): Promise<void>;
  /** Load the stored snapshot for a contract, or `null` when none exists. */
  load(contractId: string): Promise<NotificationConfigRecord | null>;
}

export interface FundExpiryNotificationsClientOptions {
  /**
   * Optional durable configuration provider. Without it, configuration
   * updates are in-memory only and are lost when the client is recreated.
   */
  configStore?: NotificationConfigStore;
}

export interface NotificationConfigUpdateResult {
  success: boolean;
  updatedAt: number;
  /**
   * `persistent` when the update was accepted by a configured store,
   * `local` when it only changed this client instance's memory.
   */
  persistence: 'persistent' | 'local';
  /**
   * Always `unverified`: this method does not check on-chain admin rights.
   * A configured store may enforce its own authorization and reject with
   * `UNAUTHORIZED`.
   */
  authorization: 'unverified';
  /** The configuration now in effect for this client. */
  config: ExpiryNotificationConfig;
}

export interface NotificationConfigLoadResult {
  /** `true` when a stored snapshot was applied to this client. */
  loaded: boolean;
  persistence: 'persistent' | 'local';
  config: ExpiryNotificationConfig;
  updatedAt?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates notification threshold and channel settings.
 * Throws {@link NotificationConfigError} with code `INVALID_CONFIG`.
 */
export function validateExpiryNotificationConfig(
  config: ExpiryNotificationConfig
): void {
  if (!isPlainObject(config)) {
    throw new NotificationConfigError(
      'INVALID_CONFIG',
      'Notification configuration must be an object'
    );
  }

  const allowedKeys = [
    'notificationThresholdDays',
    'enableAutoNotifications',
    'emailTemplate',
    'smsTemplate',
  ];
  const unknownKeys = Object.keys(config).filter(
    (key) => !allowedKeys.includes(key)
  );
  if (unknownKeys.length > 0) {
    throw new NotificationConfigError(
      'INVALID_CONFIG',
      `Unknown notification configuration field(s): ${unknownKeys.join(', ')}`
    );
  }

  const threshold = config.notificationThresholdDays;
  if (typeof threshold !== 'number' || !Number.isInteger(threshold)) {
    throw new NotificationConfigError(
      'INVALID_CONFIG',
      'notificationThresholdDays must be an integer number of days'
    );
  }
  if (
    threshold < MIN_NOTIFICATION_THRESHOLD_DAYS ||
    threshold > MAX_NOTIFICATION_THRESHOLD_DAYS
  ) {
    throw new NotificationConfigError(
      'INVALID_CONFIG',
      `notificationThresholdDays must be between ${MIN_NOTIFICATION_THRESHOLD_DAYS} and ${MAX_NOTIFICATION_THRESHOLD_DAYS} days (received ${threshold})`
    );
  }

  if (typeof config.enableAutoNotifications !== 'boolean') {
    throw new NotificationConfigError(
      'INVALID_CONFIG',
      'enableAutoNotifications must be a boolean'
    );
  }

  for (const key of ['emailTemplate', 'smsTemplate'] as const) {
    const template = config[key];
    if (template === undefined) {
      continue;
    }
    if (typeof template !== 'string' || template.trim() === '') {
      throw new NotificationConfigError(
        'INVALID_CONFIG',
        `${key} must be a non-empty string when provided`
      );
    }
    if (template.length > MAX_NOTIFICATION_TEMPLATE_LENGTH) {
      throw new NotificationConfigError(
        'INVALID_CONFIG',
        `${key} must be at most ${MAX_NOTIFICATION_TEMPLATE_LENGTH} characters`
      );
    }
  }
}

/** True when a provider error represents an authorization rejection. */
function isProviderAuthorizationError(error: any): boolean {
  return (
    error?.code === 'UNAUTHORIZED' ||
    error?.name === 'UnauthorizedError' ||
    error?.status === 401 ||
    error?.status === 403
  );
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
  private configStore?: NotificationConfigStore;

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig = {
      notificationThresholdDays: 7, // Notify 7 days before expiry
      enableAutoNotifications: true,
    },
    networkPassphrase: string = Networks.TESTNET,
    options: FundExpiryNotificationsClientOptions = {}
  ) {
    validateExpiryNotificationConfig(notificationConfig);

    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.notificationConfig = { ...notificationConfig };
    this.configStore = options.configStore;
  }

  /**
   * Returns the configuration currently in effect for this client.
   */
  getNotificationConfig(): ExpiryNotificationConfig {
    return { ...this.notificationConfig };
  }

  /**
   * Loads configuration from the configured store and applies it.
   *
   * Clients are constructed synchronously, so persistence is restored with
   * this explicit async call. Use it after construction when a store was
   * supplied:
   *
   * ```ts
   * const client = new FundExpiryNotificationsClient(..., {
   *   configStore: myStore,
   * });
   * await client.loadNotificationConfig();
   * ```
   *
   * Without a store this is a no-op reporting `persistence: 'local'`.
   * A stale or malformed stored snapshot is rejected with `INVALID_CONFIG`
   * instead of silently corrupting in-memory state.
   */
  async loadNotificationConfig(): Promise<NotificationConfigLoadResult> {
    if (!this.configStore) {
      return {
        loaded: false,
        persistence: 'local',
        config: this.getNotificationConfig(),
      };
    }

    let record: NotificationConfigRecord | null;
    try {
      record = await this.configStore.load(this.contractId);
    } catch (error: any) {
      throw new NotificationConfigError(
        'PERSISTENCE_FAILED',
        `Failed to load notification config: ${error?.message ?? error}`
      );
    }

    if (!record) {
      return {
        loaded: false,
        persistence: 'persistent',
        config: this.getNotificationConfig(),
      };
    }

    validateExpiryNotificationConfig(record.config);
    this.notificationConfig = { ...record.config };

    return {
      loaded: true,
      persistence: 'persistent',
      config: this.getNotificationConfig(),
      updatedAt: record.updatedAt,
    };
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
   * Updates notification configuration.
   *
   * Scope and authorization:
   * - `adminAddress` is only format-validated (Stellar public key) and recorded
   *   as `requestedBy`; this method performs **no** on-chain admin check.
   * - With a `configStore`, the merged configuration is saved through it and
   *   the result reports `persistence: 'persistent'`. The store owns
   *   authorization; a rejected write leaves in-memory configuration unchanged.
   * - Without a store, only in-memory configuration changes, the result reports
   *   `persistence: 'local'` and the update does **not** survive client
   *   reconstruction.
   *
   * @throws NotificationConfigError `INVALID_ADMIN_ADDRESS`, `INVALID_CONFIG`,
   * `UNAUTHORIZED` or `PERSISTENCE_FAILED`.
   */
  async updateNotificationConfig(
    adminAddress: string,
    newConfig: Partial<ExpiryNotificationConfig>
  ): Promise<NotificationConfigUpdateResult> {
    if (typeof adminAddress !== 'string' || !StrKey.isValidEd25519PublicKey(adminAddress)) {
      throw new NotificationConfigError(
        'INVALID_ADMIN_ADDRESS',
        'adminAddress must be a valid Stellar public key'
      );
    }

    if (!isPlainObject(newConfig)) {
      throw new NotificationConfigError(
        'INVALID_CONFIG',
        'Notification configuration must be an object'
      );
    }

    const merged: ExpiryNotificationConfig = {
      ...this.notificationConfig,
      ...newConfig,
    };
    validateExpiryNotificationConfig(merged);

    const updatedAt = Math.floor(Date.now() / 1000);

    if (this.configStore) {
      try {
        await this.configStore.save({
          contractId: this.contractId,
          config: { ...merged },
          updatedAt,
          requestedBy: adminAddress,
        });
      } catch (error: any) {
        if (isProviderAuthorizationError(error)) {
          throw new NotificationConfigError(
            'UNAUTHORIZED',
            `Notification config store rejected ${adminAddress}: ${error?.message ?? error}`
          );
        }
        throw new NotificationConfigError(
          'PERSISTENCE_FAILED',
          `Failed to persist notification config: ${error?.message ?? error}`
        );
      }

      this.notificationConfig = merged;
      return {
        success: true,
        updatedAt,
        persistence: 'persistent',
        authorization: 'unverified',
        config: this.getNotificationConfig(),
      };
    }

    this.notificationConfig = merged;
    return {
      success: true,
      updatedAt,
      persistence: 'local',
      authorization: 'unverified',
      config: this.getNotificationConfig(),
    };
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
