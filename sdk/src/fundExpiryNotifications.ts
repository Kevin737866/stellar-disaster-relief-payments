import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Operation,
  Keypair,
  BASE_FEE,
} from 'stellar-sdk';
import { logger } from './logger';

export type NotificationChannel = 'email' | 'sms' | 'webhook';

const DELIVERY_CHANNELS: NotificationChannel[] = ['email', 'sms', 'webhook'];

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
  notificationStatus: 'pending' | 'sent' | 'acknowledged' | 'failed';
}

/** Everything a delivery provider needs in order to send one channel message. */
export interface NotificationDeliveryRequest {
  channel: NotificationChannel;
  notification: ExpiryNotification;
  fundId: string;
  fundName: string;
  recipient: string;
  /** Alias of `recipient` for SMTP-style providers. */
  to: string;
  adminAddress: string;
  subject: string;
  message: string;
  /** Alias of `message` for providers that expect a body. */
  body: string;
  /** Structured payload, primarily for webhook providers. */
  payload: Record<string, unknown>;
  expiresAt: number;
  daysUntilExpiry: number;
  availableAmount: string;
}

/** Confirmation returned by a provider after it attempts delivery. */
export interface DeliveryReceipt {
  accepted: boolean;
  reason?: string;
  messageId?: string;
}

/** Alias retained for callers that prefer the shorter result name. */
export type DeliveryResult = DeliveryReceipt;

/**
 * Contract implemented by every channel provider. `send` must only resolve
 * when the provider has accepted the message; rejection or `accepted: false`
 * is surfaced as a failed notification log.
 */
export interface NotificationDeliveryProvider {
  send(request: NotificationDeliveryRequest): Promise<DeliveryReceipt | void>;
}

export type EmailDeliveryProvider = NotificationDeliveryProvider;
export type SmsDeliveryProvider = NotificationDeliveryProvider;
export type SMSDeliveryProvider = NotificationDeliveryProvider;
export type WebhookDeliveryProvider = NotificationDeliveryProvider;

/** Providers keyed by the channels they deliver. */
export interface NotificationDeliveryProviders {
  email?: EmailDeliveryProvider;
  sms?: SmsDeliveryProvider;
  webhook?: WebhookDeliveryProvider;
}

/** Aliases for callers that use alternate naming. */
export type DeliveryProviders = NotificationDeliveryProviders;
export type NotificationProviders = NotificationDeliveryProviders;

export interface ExpiryNotificationConfig {
  notificationThresholdDays: number; // Days before expiry to send notification
  enableAutoNotifications: boolean;
  emailTemplate?: string;
  smsTemplate?: string;
  /** Delivery providers for the channels passed to `sendExpiryNotifications`. */
  deliveryProviders?: NotificationDeliveryProviders;
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
  /** Actionable explanation when `status` is `failed`. */
  reason?: string;
  /** Provider-issued identifier when the provider accepted the message. */
  providerMessageId?: string;
}

function defaultNotificationConfig(): ExpiryNotificationConfig {
  return {
    notificationThresholdDays: 7,
    enableAutoNotifications: true,
  };
}

function isDeliveryProviderBag(value: unknown): value is NotificationDeliveryProviders {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return DELIVERY_CHANNELS.some((channel) => record[channel] !== undefined);
}

function extractDeliveryProviders(
  config: ExpiryNotificationConfig | NotificationDeliveryProviders | undefined
): NotificationDeliveryProviders {
  if (!config || typeof config !== 'object') return {};
  const record = config as Record<string, any>;
  const nested = record.deliveryProviders ?? record.providers ?? record.notificationProviders;
  return {
    ...(isDeliveryProviderBag(record) ? (record as NotificationDeliveryProviders) : {}),
    ...(nested && typeof nested === 'object' ? (nested as NotificationDeliveryProviders) : {}),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** A resolved provider call is acceptance unless it explicitly reports rejection. */
function normalizeDeliveryReceipt(result: unknown, channel: NotificationChannel): DeliveryReceipt {
  if (result === undefined || result === null) {
    return { accepted: true };
  }
  if (typeof result === 'boolean') {
    return result
      ? { accepted: true }
      : { accepted: false, reason: `${channel} delivery provider rejected the notification` };
  }
  if (typeof result === 'string') {
    const rejected = new Set(['failed', 'failure', 'rejected', 'reject', 'bounced', 'error', 'false']);
    return rejected.has(result.trim().toLowerCase())
      ? { accepted: false, reason: `${channel} delivery provider rejected the notification: ${result}` }
      : { accepted: true };
  }
  if (typeof result === 'object') {
    const receipt = result as Record<string, any>;
    const status = typeof receipt.status === 'string' ? receipt.status.toLowerCase() : undefined;
    const rejectedStatuses = ['failed', 'failure', 'rejected', 'reject', 'bounced', 'error'];
    const explicitlyRejected =
      receipt.accepted === false ||
      receipt.success === false ||
      receipt.delivered === false ||
      receipt.ok === false ||
      (status !== undefined && rejectedStatuses.includes(status));

    const messageId = receipt.messageId ?? receipt.providerMessageId ?? receipt.id;
    if (explicitlyRejected) {
      const reason = receipt.reason ?? receipt.error ?? receipt.message
        ?? `${channel} delivery provider rejected the notification`;
      return { accepted: false, reason: String(reason), messageId };
    }
    return { accepted: true, messageId };
  }
  return { accepted: true };
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
  private deliveryProviders: NotificationDeliveryProviders;

  /**
   * `deliveryProviders` (or `notificationConfig.deliveryProviders`) must
   * include a provider for every requested channel; otherwise that channel's
   * delivery is reported as failed with an actionable reason.
   */
  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig | NotificationDeliveryProviders = defaultNotificationConfig(),
    networkPassphrase: string | NotificationDeliveryProviders = Networks.TESTNET,
    deliveryProviders: NotificationDeliveryProviders = {}
  ) {
    // Providers may be supplied as a dedicated argument or on the config, so
    // both wiring styles are accepted without changing the existing signature.
    const configIsProviderBag = isDeliveryProviderBag(notificationConfig);
    const passphraseIsProviderBag = isDeliveryProviderBag(networkPassphrase);
    const resolvedConfig = configIsProviderBag
      ? defaultNotificationConfig()
      : (notificationConfig as ExpiryNotificationConfig);

    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = passphraseIsProviderBag
      ? Networks.TESTNET
      : (networkPassphrase as string);
    this.notificationConfig = resolvedConfig;
    this.deliveryProviders = {
      ...(configIsProviderBag
        ? (notificationConfig as NotificationDeliveryProviders)
        : extractDeliveryProviders(resolvedConfig)),
      ...(passphraseIsProviderBag ? (networkPassphrase as NotificationDeliveryProviders) : {}),
      ...deliveryProviders,
    };
  }

  /** Alias for the configured delivery providers. */
  get providers(): NotificationDeliveryProviders {
    return this.deliveryProviders;
  }

  set providers(providers: NotificationDeliveryProviders) {
    this.deliveryProviders = providers;
  }

  /** Registers or replaces providers for individual channels. */
  setDeliveryProviders(providers: NotificationDeliveryProviders): void {
    this.deliveryProviders = { ...this.deliveryProviders, ...providers };
  }

  /** Alias of `setDeliveryProviders`. */
  configureDeliveryProviders(providers: NotificationDeliveryProviders): void {
    this.setDeliveryProviders(providers);
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
    channels: NotificationChannel[] = ['email']
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
            const reason = `Unexpected error delivering ${channel} notification: ${toErrorMessage(error)}`;
            logger.error(
              `[expiry-notifications] fundId=${notification.fundId} channel=${channel} ${reason}`
            );
            logs.push({
              id: `${notification.fundId}_${channel}_${Date.now()}`,
              fundId: notification.fundId,
              notificationType: channel,
              recipient: notification.adminAddress,
              sentAt: Math.floor(Date.now() / 1000),
              status: 'failed',
              message: `Delivery failed: ${reason}`,
              reason,
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
   * Sends notification via a specific channel. A `sent` log is only produced
   * after the configured provider accepts the delivery.
   */
  private async sendNotificationViaChannel(
    notification: ExpiryNotification,
    channel: NotificationChannel
  ): Promise<NotificationLog> {
    const message = this.generateNotificationMessage(notification, channel);
    const timestamp = Math.floor(Date.now() / 1000);
    const log: NotificationLog = {
      id: `${notification.fundId}_${channel}_${timestamp}`,
      fundId: notification.fundId,
      notificationType: channel,
      recipient: notification.adminAddress,
      sentAt: timestamp,
      status: 'failed',
      message,
      retryCount: 0,
    };

    const provider = this.deliveryProviders[channel];
    if (!provider) {
      const reason =
        `No ${channel} delivery provider is configured. Pass deliveryProviders.${channel} ` +
        `to the FundExpiryNotificationsClient constructor (or set ` +
        `notificationConfig.deliveryProviders.${channel}) so delivery can be confirmed.`;
      logger.warn(
        `[expiry-notifications] fundId=${notification.fundId} channel=${channel} ${reason}`
      );
      return { ...log, message: `Delivery failed: ${reason}`, reason };
    }

    try {
      const request = this.buildDeliveryRequest(notification, channel, message);
      const receipt = await this.invokeDeliveryProvider(provider, channel, request);
      const providerMessageId = receipt.messageId ? { providerMessageId: receipt.messageId } : {};
      if (!receipt.accepted) {
        const reason = receipt.reason ?? `${channel} delivery provider did not accept the notification`;
        logger.error(
          `[expiry-notifications] fundId=${notification.fundId} channel=${channel} ${reason}`
        );
        return {
          ...log,
          message: `Delivery failed: ${reason}`,
          reason,
          ...providerMessageId,
        };
      }
      return { ...log, status: 'sent', ...providerMessageId };
    } catch (error: unknown) {
      const reason = `Failed to deliver ${channel} notification: ${toErrorMessage(error)}`;
      logger.error(
        `[expiry-notifications] fundId=${notification.fundId} channel=${channel} ${reason}`
      );
      return { ...log, message: `Delivery failed: ${reason}`, reason };
    }
  }

  /** Builds the payload passed to a channel provider. */
  private buildDeliveryRequest(
    notification: ExpiryNotification,
    channel: NotificationChannel,
    message: string
  ): NotificationDeliveryRequest {
    const subject = `Fund Expiry Notification: ${notification.fundName}`;
    return {
      channel,
      notification,
      fundId: notification.fundId,
      fundName: notification.fundName,
      recipient: notification.adminAddress,
      to: notification.adminAddress,
      adminAddress: notification.adminAddress,
      subject,
      message,
      body: message,
      payload: {
        notificationId: notification.id,
        fundId: notification.fundId,
        fundName: notification.fundName,
        daysUntilExpiry: notification.daysUntilExpiry,
        availableAmount: notification.availableAmount,
        message,
      },
      expiresAt: notification.expiresAt,
      daysUntilExpiry: notification.daysUntilExpiry,
      availableAmount: notification.availableAmount,
    };
  }

  /**
   * Calls the provider's delivery method. `send` is the documented contract;
   * channel-specific names are also accepted for common provider adapters.
   */
  private async invokeDeliveryProvider(
    provider: NotificationDeliveryProvider,
    channel: NotificationChannel,
    request: NotificationDeliveryRequest
  ): Promise<DeliveryReceipt> {
    const candidate = provider as any;
    const channelMethods: Record<NotificationChannel, string[]> = {
      email: ['sendEmail', 'sendMail'],
      sms: ['sendSms', 'sendSMS'],
      webhook: ['postWebhook', 'notifyWebhook'],
    };
    const methods = [
      ...(typeof candidate === 'function' ? [candidate] : []),
      ...channelMethods[channel].map((name) => candidate?.[name]),
      candidate?.send,
      candidate?.deliver,
    ].filter((method): method is (...args: any[]) => any => typeof method === 'function');

    if (methods.length === 0) {
      return {
        accepted: false,
        reason: `The configured ${channel} delivery provider has no send() method`,
      };
    }

    const result = await methods[0].call(
      typeof candidate === 'function' ? undefined : candidate,
      request,
      request.message,
      request.notification
    );
    return normalizeDeliveryReceipt(result, channel);
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
      if (newConfig.deliveryProviders) {
        this.setDeliveryProviders(newConfig.deliveryProviders);
      }
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
