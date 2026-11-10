import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
} from 'stellar-sdk';
import { NetworkError, ValidationError } from './errors';
import { validateAddress } from './validation';

const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 365;
const SECONDS_PER_DAY = 24 * 60 * 60;

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
  notificationThresholdDays: number; // Days before expiry to send notification (1-365)
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
  status: 'sent' | 'failed' | 'bounced';
  message: string;
  retryCount: number;
  acknowledged?: boolean;
  acknowledgedAt?: number;
  notificationId?: string;
}

export interface NotificationDeliveryResult {
  accepted: boolean;
  bounced?: boolean;
  reason?: string;
  externalId?: string;
}

export interface NotificationChannelProvider {
  send(payload: {
    channel: 'email' | 'sms' | 'webhook';
    recipient: string;
    subject?: string;
    message: string;
    notification: ExpiryNotification;
  }): Promise<NotificationDeliveryResult>;
}

export interface NotificationDeliveryProviders {
  email?: NotificationChannelProvider;
  sms?: NotificationChannelProvider;
  webhook?: NotificationChannelProvider;
}

export interface ExpiringFundRecord {
  id: string;
  name: string;
  expiresAt: number;
  totalAmount: string | number | bigint;
  releasedAmount: string | number | bigint;
  reservedForRecall?: string | number | bigint;
  adminAddress?: string;
  isActive?: boolean;
  currentStatus?: string;
  notificationStatus?: 'pending' | 'sent' | 'acknowledged';
}

export interface FundDataProvider {
  getFund(fundId: string): Promise<ExpiringFundRecord | null>;
}

export interface NotificationHistoryProvider {
  append(record: NotificationLog): Promise<void>;
  listByFund(fundId: string): Promise<NotificationLog[]>;
  markAcknowledged?(notificationId: string, acknowledgedAt: number, fundId?: string): Promise<void>;
}

export interface NotificationConfigStore {
  loadConfig():
    | Promise<Partial<ExpiryNotificationConfig> | null>
    | Partial<ExpiryNotificationConfig>
    | null;
  saveConfig(adminAddress: string, config: ExpiryNotificationConfig): Promise<void>;
}

export interface FundExpiryNotificationsOptions {
  fundProvider?: FundDataProvider;
  deliveryProviders?: NotificationDeliveryProviders;
  historyProvider?: NotificationHistoryProvider;
  configStore?: NotificationConfigStore;
}

/**
 * Fund Expiry Notifications Client
 * Manages notifications to admins when funds are about to expire.
 */
export class FundExpiryNotificationsClient {
  private contractId: string;
  private signingKey: Keypair;
  private server: any;
  private networkPassphrase: string;
  private notificationConfig: ExpiryNotificationConfig;
  private fundProvider?: FundDataProvider;
  private deliveryProviders: NotificationDeliveryProviders;
  private historyProvider?: NotificationHistoryProvider;
  private configStore?: NotificationConfigStore;
  private localHistory: Map<string, NotificationLog[]> = new Map();
  private registeredFundByNotificationId: Map<string, string> = new Map();

  constructor(
    contractId: string,
    signingKey: Keypair,
    server: any,
    notificationConfig: ExpiryNotificationConfig = {
      notificationThresholdDays: 7, // Notify 7 days before expiry
      enableAutoNotifications: true,
    },
    networkPassphrase: string = Networks.TESTNET,
    options: FundExpiryNotificationsOptions = {}
  ) {
    this.validateNotificationConfig(notificationConfig);
    this.contractId = contractId;
    this.signingKey = signingKey;
    this.server = server;
    this.networkPassphrase = networkPassphrase;
    this.notificationConfig = { ...notificationConfig };
    this.fundProvider = options.fundProvider;
    this.deliveryProviders = options.deliveryProviders ?? {};
    this.historyProvider = options.historyProvider;
    this.configStore = options.configStore;
  }

  private validateNotificationConfig(config: Partial<ExpiryNotificationConfig>): void {
    if (!config || typeof config !== 'object') {
      throw new ValidationError('notificationConfig', 'Notification config must be an object');
    }
    if (config.notificationThresholdDays !== undefined) {
      const days = config.notificationThresholdDays;
      if (
        typeof days !== 'number' ||
        !Number.isFinite(days) ||
        days < MIN_THRESHOLD_DAYS ||
        days > MAX_THRESHOLD_DAYS
      ) {
        throw new ValidationError(
          'notificationThresholdDays',
          `notificationThresholdDays must be a finite number between ${MIN_THRESHOLD_DAYS} and ${MAX_THRESHOLD_DAYS}`,
          { notificationThresholdDays: days }
        );
      }
    }
    if (
      config.enableAutoNotifications !== undefined &&
      typeof config.enableAutoNotifications !== 'boolean'
    ) {
      throw new ValidationError(
        'enableAutoNotifications',
        'enableAutoNotifications must be a boolean',
        { enableAutoNotifications: config.enableAutoNotifications }
      );
    }
  }

  private assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(field, `${field} must be a non-empty string`, { [field]: value });
    }
    return value.trim();
  }

  private toBigIntAmount(value: unknown, field: string): bigint {
    if (typeof value === 'bigint') {
      if (value < BigInt(0)) {
        throw new ValidationError(field, `${field} cannot be negative`);
      }
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ValidationError(field, `${field} must be a non-negative integer`);
      }
      return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
    throw new ValidationError(field, `Malformed integer amount for ${field}`);
  }

  private extractContractNotificationId(response: any, fundId: string): {
    notificationId: string;
    identifierSource: 'contract' | 'tx-correlation';
  } {
    if (
      !response ||
      response.status === 'FAILED' ||
      response.status === 'ERROR' ||
      response.successful === false
    ) {
      throw new NetworkError(
        'register expiry notification',
        response?.errorResultXdr || response?.status || 'Transaction submission failed',
        { fundId, transactionHash: response?.hash }
      );
    }

    const txHash = typeof response.hash === 'string' && response.hash.trim() ? response.hash.trim() : '';
    const candidate = response?.result?.retval ?? response?.returnValue;

    if (candidate !== undefined && candidate !== null) {
      let decoded: unknown;
      try {
        decoded = typeof candidate === 'string' ? candidate : scValToNative(candidate);
      } catch (decodeErr: any) {
        throw new ValidationError(
          'notificationId',
          `Failed to decode contract notification identifier: ${decodeErr?.message || String(decodeErr)}`,
          { fundId, transactionHash: txHash }
        );
      }

      if (typeof decoded !== 'string' || !decoded.trim()) {
        throw new ValidationError(
          'notificationId',
          'Contract returned an invalid notification identifier',
          { fundId, transactionHash: txHash, decoded }
        );
      }

      return { notificationId: decoded.trim(), identifierSource: 'contract' };
    }

    if (!txHash) {
      throw new ValidationError(
        'transactionHash',
        'Confirmed registration response is missing both a contract notification ID and a transaction hash',
        { fundId }
      );
    }

    return {
      notificationId: `tx:${txHash}:${fundId}`,
      identifierSource: 'tx-correlation',
    };
  }

  /**
   * Registers a notification threshold for a fund.
   * Derives `notificationId` from the confirmed contract return value when
   * present, or returns a deterministic `tx:<hash>:<fundId>` correlation ID
   * when the contract entrypoint does not emit a separate string ID.
   */
  async registerFundExpiryNotification(
    adminAddress: string,
    fundId: string,
    fundName: string,
    expiresAt: number,
    notificationEmail: string
  ): Promise<{
    success: boolean;
    transactionHash: string;
    notificationId: string;
    identifierSource: 'contract' | 'tx-correlation';
  }> {
    validateAddress(adminAddress, 'adminAddress');
    this.assertNonEmptyString(fundId, 'fundId');
    this.assertNonEmptyString(fundName, 'fundName');
    this.assertNonEmptyString(notificationEmail, 'notificationEmail');
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      throw new ValidationError('expiresAt', 'expiresAt must be a positive finite timestamp', {
        expiresAt,
      });
    }

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
            new Address(adminAddress).toScVal(),
            nativeToScVal(fundId),
            nativeToScVal(fundName),
            nativeToScVal(expiresAt),
            nativeToScVal(notificationEmail)
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      let response = await this.server.submitTransaction(transaction);

      if (
        response?.status === 'PENDING' &&
        response?.hash &&
        typeof this.server?.getTransaction === 'function'
      ) {
        response = {
          ...(await this.server.getTransaction(response.hash)),
          hash: response.hash,
        };
      }

      const { notificationId, identifierSource } = this.extractContractNotificationId(
        response,
        fundId
      );
      this.registeredFundByNotificationId.set(notificationId, fundId);

      return {
        success: true,
        transactionHash: response.hash || '',
        notificationId,
        identifierSource,
      };
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(
        'register expiry notification',
        error?.message || String(error),
        { fundId, adminAddress }
      );
    }
  }

  private async fetchFundRecord(fundId: string): Promise<ExpiringFundRecord | null> {
    if (this.fundProvider) {
      return this.fundProvider.getFund(fundId);
    }

    if (!this.server || typeof this.server.simulateTransaction !== 'function') {
      throw new NetworkError(
        'check expiring funds',
        'No fund data provider or Soroban simulateTransaction server configured',
        { fundId }
      );
    }

    const publicKey = this.signingKey.publicKey();
    const sourceAccount =
      typeof this.server.loadAccount === 'function'
        ? await this.server.loadAccount(publicKey)
        : {
            accountId: () => publicKey,
            sequenceNumber: () => '0',
            incrementSequenceNumber: () => {},
          };

    const contract = new Contract(this.contractId) as any;
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call('get_fund', nativeToScVal(fundId)))
      .setTimeout(30)
      .build();

    const simResponse = await this.server.simulateTransaction(transaction);
    if (simResponse?.error) {
      throw new NetworkError('check expiring funds', String(simResponse.error), { fundId });
    }

    const retval = simResponse?.result?.retval ?? simResponse?.retval;
    if (retval === undefined) {
      throw new ValidationError('simulationResponse', 'Missing return value from get_fund', {
        fundId,
      });
    }
    if (retval === null) {
      return null;
    }

    const raw = scValToNative(retval);
    if (raw === null || raw === undefined) {
      return null;
    }

    return {
      id: String(raw.id ?? fundId),
      name: String(raw.name ?? fundId),
      expiresAt: Number(raw.expiresAt ?? raw.expires_at ?? 0),
      totalAmount: raw.totalAmount ?? raw.total_amount ?? '0',
      releasedAmount: raw.releasedAmount ?? raw.released_amount ?? '0',
      reservedForRecall: raw.reservedForRecall ?? raw.reserved_for_recall ?? '0',
      adminAddress: typeof raw.adminAddress === 'string'
        ? raw.adminAddress
        : typeof raw.admin_address === 'string'
          ? raw.admin_address
          : this.signingKey.publicKey(),
      isActive: raw.isActive ?? raw.is_active ?? true,
      currentStatus: raw.currentStatus ?? raw.current_status,
      notificationStatus: raw.notificationStatus,
    };
  }

  /**
   * Checks for requested funds expiring within `notificationThresholdDays`.
   *
   * Rules:
   * - Missing funds (`null`) are skipped.
   * - Inactive, recalled/released/expired, or already-acknowledged funds are excluded.
   * - Already-expired funds (`expiresAt <= now`) are excluded from pre-expiry alerts.
   * - Funds with `0 < expiresAt - now <= thresholdSeconds` and positive available
   *   balance (`total - released - reserved > 0`) are returned.
   * - Provider/RPC errors are surfaced and never converted to an empty list.
   */
  async checkExpiringFunds(fundIds: string[]): Promise<ExpiryNotification[]> {
    if (!Array.isArray(fundIds)) {
      throw new ValidationError('fundIds', 'fundIds must be an array of fund identifiers');
    }

    const expiringFunds: ExpiryNotification[] = [];
    const currentTime = Math.floor(Date.now() / 1000);
    const thresholdSeconds = this.notificationConfig.notificationThresholdDays * SECONDS_PER_DAY;

    for (const rawId of fundIds) {
      const fundId = this.assertNonEmptyString(rawId, 'fundId');
      const fund = await this.fetchFundRecord(fundId);
      if (!fund) {
        continue;
      }

      if (
        fund.isActive === false ||
        fund.currentStatus === 'recalled' ||
        fund.currentStatus === 'released' ||
        fund.currentStatus === 'expired' ||
        fund.notificationStatus === 'acknowledged'
      ) {
        continue;
      }

      const history = await this.getNotificationHistory(fundId);
      if (history.some((entry) => entry.acknowledged === true)) {
        continue;
      }

      const secondsUntilExpiry = fund.expiresAt - currentTime;
      if (secondsUntilExpiry <= 0 || secondsUntilExpiry > thresholdSeconds) {
        continue;
      }

      const total = this.toBigIntAmount(fund.totalAmount, 'totalAmount');
      const released = this.toBigIntAmount(fund.releasedAmount, 'releasedAmount');
      const reserved = this.toBigIntAmount(fund.reservedForRecall ?? '0', 'reservedForRecall');
      const available = total - released - reserved;
      if (available <= BigInt(0)) {
        continue;
      }

      expiringFunds.push({
        id: `${fundId}_expiry_${fund.expiresAt}`,
        fundId,
        fundName: fund.name,
        expiresAt: fund.expiresAt,
        daysUntilExpiry: Math.ceil(secondsUntilExpiry / SECONDS_PER_DAY),
        totalAmount: total.toString(),
        releasedAmount: released.toString(),
        availableAmount: available.toString(),
        adminAddress: fund.adminAddress || this.signingKey.publicKey(),
        notificationSentAt: currentTime,
        notificationStatus: fund.notificationStatus ?? 'pending',
      });
    }

    return expiringFunds;
  }

  private async persistHistoryRecord(log: NotificationLog): Promise<void> {
    const existing = this.localHistory.get(log.fundId) ?? [];
    existing.push(log);
    this.localHistory.set(log.fundId, existing);

    if (this.historyProvider) {
      await this.historyProvider.append(log);
    }
  }

  /**
   * Sends expiry notifications to fund administrators across configured channels.
   */
  async sendExpiryNotifications(
    notifications: ExpiryNotification[],
    channels: ('email' | 'sms' | 'webhook')[] = ['email']
  ): Promise<{ success: boolean; sentCount: number; failedCount: number; logs: NotificationLog[] }> {
    let sentCount = 0;
    let failedCount = 0;
    const logs: NotificationLog[] = [];

    for (const notification of notifications) {
      for (const channel of channels) {
        let log: NotificationLog;
        try {
          log = await this.sendNotificationViaChannel(notification, channel);
        } catch (error: any) {
          log = {
            id: `${notification.fundId}_${channel}_${Date.now()}`,
            fundId: notification.fundId,
            notificationType: channel,
            recipient: notification.adminAddress,
            sentAt: Math.floor(Date.now() / 1000),
            status: 'failed',
            message: error?.message || String(error),
            retryCount: 0,
            notificationId: notification.id,
          };
        }

        await this.persistHistoryRecord(log);
        logs.push(log);
        if (log.status === 'sent') {
          sentCount++;
        } else {
          failedCount++;
        }
      }
    }

    return {
      success: failedCount === 0,
      sentCount,
      failedCount,
      logs,
    };
  }

  /**
   * Sends notification via a specific configured delivery provider.
   * Marks status as `'sent'` only when the configured provider confirms acceptance;
   * missing or rejecting providers result in `'failed'` or `'bounced'`.
   */
  private async sendNotificationViaChannel(
    notification: ExpiryNotification,
    channel: 'email' | 'sms' | 'webhook'
  ): Promise<NotificationLog> {
    const message = this.generateNotificationMessage(notification, channel);
    const timestamp = Math.floor(Date.now() / 1000);
    const logId = `${notification.fundId}_${channel}_${timestamp}`;
    const provider = this.deliveryProviders[channel];

    if (!provider) {
      return {
        id: logId,
        fundId: notification.fundId,
        notificationType: channel,
        recipient: notification.adminAddress,
        sentAt: timestamp,
        status: 'failed',
        message: `No delivery provider configured for channel '${channel}'`,
        retryCount: 0,
        notificationId: notification.id,
      };
    }

    try {
      const result = await provider.send({
        channel,
        recipient: notification.adminAddress,
        subject: channel === 'email' ? `Fund Expiry Alert: ${notification.fundName}` : undefined,
        message,
        notification,
      });

      if (result?.accepted === true) {
        return {
          id: logId,
          fundId: notification.fundId,
          notificationType: channel,
          recipient: notification.adminAddress,
          sentAt: timestamp,
          status: 'sent',
          message,
          retryCount: 0,
          notificationId: notification.id,
        };
      }

      return {
        id: logId,
        fundId: notification.fundId,
        notificationType: channel,
        recipient: notification.adminAddress,
        sentAt: timestamp,
        status: result?.bounced ? 'bounced' : 'failed',
        message: result?.reason || `Delivery rejected by '${channel}' provider`,
        retryCount: 0,
        notificationId: notification.id,
      };
    } catch (error: any) {
      return {
        id: logId,
        fundId: notification.fundId,
        notificationType: channel,
        recipient: notification.adminAddress,
        sentAt: timestamp,
        status: 'failed',
        message: error?.message || `Delivery error on '${channel}' provider`,
        retryCount: 0,
        notificationId: notification.id,
      };
    }
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

  private resolveFundIdFromNotificationId(notificationId: string): string | undefined {
    const mapped = this.registeredFundByNotificationId.get(notificationId);
    if (mapped) {
      return mapped;
    }
    if (notificationId.startsWith('tx:')) {
      const parts = notificationId.split(':');
      if (parts.length >= 3 && parts[2]) {
        return parts.slice(2).join(':');
      }
    }
    for (const [fundId, logs] of this.localHistory.entries()) {
      if (logs.some((l) => l.notificationId === notificationId || l.id === notificationId)) {
        return fundId;
      }
    }
    return undefined;
  }

  /**
   * Acknowledges expiry notification and records acknowledgement state in history
   */
  async acknowledgeNotification(
    adminAddress: string,
    notificationId: string
  ): Promise<{ success: boolean; acknowledgedAt: number }> {
    validateAddress(adminAddress, 'adminAddress');
    this.assertNonEmptyString(notificationId, 'notificationId');

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
            new Address(adminAddress).toScVal(),
            nativeToScVal(notificationId)
          )
        )
        .setTimeout(300)
        .build();

      transaction.sign(this.signingKey);
      await this.server.submitTransaction(transaction);

      const acknowledgedAt = Math.floor(Date.now() / 1000);
      const fundId = this.resolveFundIdFromNotificationId(notificationId);

      if (fundId) {
        const logs = this.localHistory.get(fundId) ?? [];
        let matched = false;
        for (const entry of logs) {
          if (entry.notificationId === notificationId || entry.id === notificationId) {
            entry.acknowledged = true;
            entry.acknowledgedAt = acknowledgedAt;
            matched = true;
          }
        }
        if (!matched) {
          const ackRecord: NotificationLog = {
            id: `${notificationId}:ack:${acknowledgedAt}`,
            fundId,
            notificationType: 'in-app',
            recipient: adminAddress,
            sentAt: acknowledgedAt,
            status: 'sent',
            message: `Notification ${notificationId} acknowledged`,
            retryCount: 0,
            acknowledged: true,
            acknowledgedAt,
            notificationId,
          };
          await this.persistHistoryRecord(ackRecord);
        } else if (this.historyProvider?.markAcknowledged) {
          await this.historyProvider.markAcknowledged(notificationId, acknowledgedAt, fundId);
        }
      } else if (this.historyProvider?.markAcknowledged) {
        await this.historyProvider.markAcknowledged(notificationId, acknowledgedAt);
      }

      return {
        success: true,
        acknowledgedAt,
      };
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof NetworkError) {
        throw error;
      }
      throw new NetworkError(
        'acknowledge notification',
        error?.message || String(error),
        { notificationId, adminAddress }
      );
    }
  }

  /**
   * Gets persisted notification history for a fund, sorted deterministically by
   * `sentAt` ascending (tie-broken by `id`) with bounded pagination.
   */
  async getNotificationHistory(
    fundId: string,
    options: { offset?: number; limit?: number } = {}
  ): Promise<NotificationLog[]> {
    this.assertNonEmptyString(fundId, 'fundId');
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;

    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('offset', 'offset must be a non-negative integer', { offset });
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new ValidationError('limit', 'limit must be an integer between 1 and 500', { limit });
    }

    const records = this.historyProvider
      ? await this.historyProvider.listByFund(fundId)
      : [...(this.localHistory.get(fundId) ?? [])];

    const sorted = records
      .filter((r) => r.fundId === fundId)
      .slice()
      .sort((a, b) => (a.sentAt !== b.sentAt ? a.sentAt - b.sentAt : a.id.localeCompare(b.id)));

    return sorted.slice(offset, offset + limit);
  }

  /**
   * Loads persisted notification configuration from the configured store if present.
   */
  async loadNotificationConfig(): Promise<ExpiryNotificationConfig> {
    if (this.configStore) {
      const persisted = await this.configStore.loadConfig();
      if (persisted) {
        this.validateNotificationConfig(persisted);
        this.notificationConfig = { ...this.notificationConfig, ...persisted };
      }
    }
    return { ...this.notificationConfig };
  }

  /**
   * Validates and updates notification configuration.
   * Explicitly reports whether persistence is `'persistent'` (via `configStore`)
   * or `'local-only'` when no config store is configured.
   */
  async updateNotificationConfig(
    adminAddress: string,
    newConfig: Partial<ExpiryNotificationConfig>
  ): Promise<{
    success: boolean;
    updatedAt: number;
    persistenceScope: 'persistent' | 'local-only';
    config: ExpiryNotificationConfig;
  }> {
    validateAddress(adminAddress, 'adminAddress');
    this.validateNotificationConfig(newConfig);

    const merged: ExpiryNotificationConfig = {
      ...this.notificationConfig,
      ...newConfig,
    };
    this.validateNotificationConfig(merged);

    let persistenceScope: 'persistent' | 'local-only' = 'local-only';
    if (this.configStore) {
      await this.configStore.saveConfig(adminAddress, merged);
      persistenceScope = 'persistent';
    }

    this.notificationConfig = merged;
    return {
      success: true,
      updatedAt: Math.floor(Date.now() / 1000),
      persistenceScope,
      config: { ...merged },
    };
  }

  /**
   * Disables notifications for a specific fund
   */
  async disableFundNotifications(
    adminAddress: string,
    fundId: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    validateAddress(adminAddress, 'adminAddress');
    this.assertNonEmptyString(fundId, 'fundId');

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
            new Address(adminAddress).toScVal(),
            nativeToScVal(fundId)
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
      throw new NetworkError(
        'disable fund notifications',
        error?.message || String(error),
        { fundId, adminAddress }
      );
    }
  }
}
