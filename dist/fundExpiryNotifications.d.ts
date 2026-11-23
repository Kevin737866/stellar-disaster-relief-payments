import { Keypair } from 'stellar-sdk';
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
    notificationThresholdDays: number;
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
}
/**
 * Fund Expiry Notifications Client
 * Manages notifications to admins when funds are about to expire
 */
export declare class FundExpiryNotificationsClient {
    private contractId;
    private signingKey;
    private server;
    private networkPassphrase;
    private notificationConfig;
    constructor(contractId: string, signingKey: Keypair, server: any, notificationConfig?: ExpiryNotificationConfig, networkPassphrase?: string);
    /**
     * Registers a notification threshold for a fund
     * Triggers notifications when fund expiry approaches
     */
    registerFundExpiryNotification(adminAddress: string, fundId: string, fundName: string, expiresAt: number, notificationEmail: string): Promise<{
        success: boolean;
        transactionHash: string;
        notificationId: string;
    }>;
    /**
     * Checks for funds expiring within the notification threshold
     * Returns list of funds requiring notifications
     */
    checkExpiringFunds(fundIds: string[]): Promise<ExpiryNotification[]>;
    /**
     * Sends expiry notifications to fund administrators
     * Supports multiple notification channels
     */
    sendExpiryNotifications(notifications: ExpiryNotification[], channels?: ('email' | 'sms' | 'webhook')[]): Promise<{
        success: boolean;
        sentCount: number;
        failedCount: number;
        logs: NotificationLog[];
    }>;
    /**
     * Sends notification via specific channel
     */
    private sendNotificationViaChannel;
    /**
     * Generates notification message with fund details
     */
    private generateNotificationMessage;
    /**
     * Acknowledges expiry notification
     */
    acknowledgeNotification(adminAddress: string, notificationId: string): Promise<{
        success: boolean;
        acknowledgedAt: number;
    }>;
    /**
     * Gets notification history for a fund
     */
    getNotificationHistory(fundId: string): Promise<NotificationLog[]>;
    /**
     * Updates notification configuration
     */
    updateNotificationConfig(adminAddress: string, newConfig: ExpiryNotificationConfig): Promise<{
        success: boolean;
        updatedAt: number;
    }>;
    /**
     * Disables notifications for a specific fund
     */
    disableFundNotifications(adminAddress: string, fundId: string): Promise<{
        success: boolean;
        transactionHash: string;
    }>;
}
//# sourceMappingURL=fundExpiryNotifications.d.ts.map