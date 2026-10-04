import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = persistent
}

interface NotificationContextValue {
  notify: (notification: Omit<Notification, 'id'>) => void;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotifications = (): NotificationContextValue => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};

const icons: Record<NotificationType, React.ReactNode> = {
  success: (
    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const borderColors: Record<NotificationType, string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
};

const NotificationItem: React.FC<{ notification: Notification; onDismiss: (id: string) => void }> = ({
  notification,
  onDismiss,
}) => (
  <div
    role="alert"
    className={`flex items-start gap-3 bg-white rounded-lg shadow-lg border border-gray-200 border-l-4 ${borderColors[notification.type]} p-4 min-w-72 max-w-sm`}
  >
    <div className="flex-shrink-0 mt-0.5">{icons[notification.type]}</div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 text-sm">{notification.title}</p>
      {notification.message && (
        <p className="text-gray-600 text-sm mt-0.5">{notification.message}</p>
      )}
    </div>
    <button
      onClick={() => onDismiss(notification.id)}
      className="flex-shrink-0 text-gray-400 hover:text-gray-600 ml-1"
      aria-label="Dismiss notification"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (notification: Omit<Notification, 'id'>) => {
      const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const duration = notification.duration ?? (notification.type === 'error' ? 0 : 5000);
      setNotifications((prev) => [...prev, { ...notification, id, duration }]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
    },
    [dismiss]
  );

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end"
      >
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onDismiss={dismiss} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
};
