import * as components from '../components';

describe('public component exports', () => {
  it('exposes the documented component and notification API', () => {
    expect(components.BeneficiaryRegistration).toBeDefined();
    expect(components.EmergencyDeployer).toBeDefined();
    expect(components.MerchantMap).toBeDefined();
    expect(components.TransferCard).toBeDefined();
    expect(components.Dashboard).toBeDefined();
    expect(components.ConfirmDialog).toBeDefined();
    expect(components.ErrorMessage).toBeDefined();
    expect(components.friendlyError).toBeDefined();
    expect(components.FormField).toBeDefined();
    expect(components.NotificationProvider).toBeDefined();
    expect(components.useNotifications).toBeDefined();
  });

  it('does not expose internal accessibility implementation hooks', () => {
    expect('useFocusTrap' in components).toBe(false);
  });
});
