/**
 * Stable public component API.
 * Keep implementation hooks and accessibility internals out of this barrel;
 * import those directly from their owning modules when building internal UI.
 */
export { BeneficiaryRegistration } from './BeneficiaryRegistration';
export { EmergencyDeployer } from './EmergencyDeployer';
export { MerchantMap } from './MerchantMap';
export { TransferCard } from './TransferCard';
export { Dashboard } from './Dashboard';
export { ConfirmDialog } from './ConfirmDialog';
export { ErrorMessage, friendlyError } from './ErrorMessage';
export { FormField } from './FormField';
export { NotificationProvider, useNotifications } from './NotificationSystem';
export type { Notification, NotificationType } from './NotificationSystem';
