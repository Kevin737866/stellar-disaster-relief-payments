"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FundExpiryNotificationsClient = void 0;
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Fund Expiry Notifications Client
 * Manages notifications to admins when funds are about to expire
 */
class FundExpiryNotificationsClient {
    constructor(contractId, signingKey, server, notificationConfig = {
        notificationThresholdDays: 7, // Notify 7 days before expiry
        enableAutoNotifications: true,
    }, networkPassphrase = stellar_sdk_1.Networks.TESTNET) {
        this.contractId = contractId;
        this.signingKey = signingKey;
        this.server = server;
        this.networkPassphrase = networkPassphrase;
        this.notificationConfig = notificationConfig;
    }
    /**
     * Registers a notification threshold for a fund
     * Triggers notifications when fund expiry approaches
     */
    async registerFundExpiryNotification(adminAddress, fundId, fundName, expiresAt, notificationEmail) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('register_expiry_notification', new stellar_sdk_1.Address(adminAddress), fundId, fundName, expiresAt, notificationEmail))
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
        }
        catch (error) {
            throw new Error(`Failed to register expiry notification: ${error.message}`);
        }
    }
    /**
     * Checks for funds expiring within the notification threshold
     * Returns list of funds requiring notifications
     */
    async checkExpiringFunds(fundIds) {
        try {
            const expiringFunds = [];
            const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
            const thresholdSeconds = this.notificationConfig.notificationThresholdDays * 24 * 60 * 60;
            // This would typically query the contract or a backend service
            // For now, returning empty array as placeholder
            return expiringFunds;
        }
        catch (error) {
            throw new Error(`Failed to check expiring funds: ${error.message}`);
        }
    }
    /**
     * Sends expiry notifications to fund administrators
     * Supports multiple notification channels
     */
    async sendExpiryNotifications(notifications, channels = ['email']) {
        try {
            let sentCount = 0;
            let failedCount = 0;
            const logs = [];
            for (const notification of notifications) {
                for (const channel of channels) {
                    try {
                        const log = await this.sendNotificationViaChannel(notification, channel);
                        logs.push(log);
                        if (log.status === 'sent') {
                            sentCount++;
                        }
                        else {
                            failedCount++;
                        }
                    }
                    catch (error) {
                        failedCount++;
                        logs.push({
                            id: `${notification.fundId}_${channel}_${Date.now()}`,
                            fundId: notification.fundId,
                            notificationType: channel,
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
        }
        catch (error) {
            throw new Error(`Failed to send expiry notifications: ${error.message}`);
        }
    }
    /**
     * Sends notification via specific channel
     */
    async sendNotificationViaChannel(notification, channel) {
        const message = this.generateNotificationMessage(notification, channel);
        const timestamp = Math.floor(Date.now() / 1000);
        const logId = `${notification.fundId}_${channel}_${timestamp}`;
        // Simulate sending notification
        // In production, integrate with actual notification services
        let status = 'sent';
        try {
            if (channel === 'email') {
                // Call email service
                // await sendEmail(notification.adminAddress, 'Fund Expiry Notification', message);
            }
            else if (channel === 'sms') {
                // Call SMS service
                // await sendSMS(notification.adminAddress, message);
            }
            else if (channel === 'webhook') {
                // Call webhook
                // await notifyWebhook(notification.adminAddress, message);
            }
        }
        catch (error) {
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
    generateNotificationMessage(notification, channel) {
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
        }
        else if (channel === 'sms') {
            return `ALERT: ${fundName} expires in ${daysRemaining} days. Available: ${availableAmount}. Action required.`;
        }
        else {
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
    async acknowledgeNotification(adminAddress, notificationId) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('acknowledge_notification', new stellar_sdk_1.Address(adminAddress), notificationId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            await this.server.submitTransaction(transaction);
            return {
                success: true,
                acknowledgedAt: Math.floor(Date.now() / 1000),
            };
        }
        catch (error) {
            throw new Error(`Failed to acknowledge notification: ${error.message}`);
        }
    }
    /**
     * Gets notification history for a fund
     */
    async getNotificationHistory(fundId) {
        try {
            // Query notification history from contract or backend
            // This would typically retrieve from storage
            return [];
        }
        catch (error) {
            throw new Error(`Failed to retrieve notification history: ${error.message}`);
        }
    }
    /**
     * Updates notification configuration
     */
    async updateNotificationConfig(adminAddress, newConfig) {
        try {
            this.notificationConfig = { ...this.notificationConfig, ...newConfig };
            return {
                success: true,
                updatedAt: Math.floor(Date.now() / 1000),
            };
        }
        catch (error) {
            throw new Error(`Failed to update notification config: ${error.message}`);
        }
    }
    /**
     * Disables notifications for a specific fund
     */
    async disableFundNotifications(adminAddress, fundId) {
        try {
            const sourceAccount = await this.server.loadAccount(adminAddress);
            const contract = new stellar_sdk_1.Contract(this.contractId);
            const transaction = new stellar_sdk_1.TransactionBuilder(sourceAccount, {
                fee: stellar_sdk_1.BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('disable_fund_notifications', new stellar_sdk_1.Address(adminAddress), fundId))
                .setTimeout(300)
                .build();
            transaction.sign(this.signingKey);
            const response = await this.server.submitTransaction(transaction);
            return {
                success: true,
                transactionHash: response.hash,
            };
        }
        catch (error) {
            throw new Error(`Failed to disable fund notifications: ${error.message}`);
        }
    }
}
exports.FundExpiryNotificationsClient = FundExpiryNotificationsClient;
//# sourceMappingURL=fundExpiryNotifications.js.map