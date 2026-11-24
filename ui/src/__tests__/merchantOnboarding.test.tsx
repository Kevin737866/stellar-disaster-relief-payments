/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MerchantMap, BUSINESS_TYPE_TO_CATEGORY } from '../components/MerchantMap';

// ─── Mock the SDK clients ─────────────────────────────────────────────────────

function makeClients() {
  const createOnboardingRequest = jest.fn().mockReturnValue({
    name: 'Test Merchant',
    businessType: 'grocery',
    category: 0,
    locationLatLng: '10.0,20.0',
    locationAddress: '1 Main St',
    locationCity: 'City',
    locationCountry: 'Country',
    locationPostalCode: '12345',
    contactInfo: 'test@example.com',
    acceptedTokens: ['XLM'],
    vouchers: [],
    emergencyFastTrack: false,
  });

  const registerMerchant = jest.fn().mockResolvedValue('registered');

  const merchantClient: any = {
    findMerchantsByLocation: jest.fn().mockResolvedValue([]),
    getVerificationQueue: jest.fn().mockResolvedValue([]),
    createOnboardingRequest,
    registerMerchant,
    verifyMerchant: jest.fn().mockResolvedValue('ok'),
    batchVerifyMerchants: jest.fn().mockResolvedValue([]),
    generateMerchantQRCode: jest.fn().mockReturnValue('{}'),
    updateReputation: jest.fn().mockResolvedValue('ok'),
    getMerchantTransactions: jest.fn().mockResolvedValue([]),
  };

  return { merchantClient, createOnboardingRequest, registerMerchant };
}

const defaultConfig: any = {
  network: 'testnet',
  rpcUrl: 'https://example.com',
  horizonUrl: 'https://example.com',
  contractIds: {
    platform: '', aidRegistry: '', beneficiaryManager: '',
    merchantNetwork: '', cashTransfer: '', supplyChainTracker: '', antiFraud: '',
  },
};

/** Fill the onboarding form with valid values and return the submit button. */
async function fillAndOpenForm(merchantClient: any) {
  render(
    <MerchantMap
      merchantClient={merchantClient}
      config={defaultConfig}
      adminKey="SADMIN"
    />
  );

  // Open the form
  await act(async () => {
    fireEvent.click(screen.getByText('Onboard Merchant'));
  });

  fireEvent.change(screen.getByPlaceholderText('Merchant ID'), { target: { value: 'merchant_001' } });
  fireEvent.change(screen.getByPlaceholderText('Business Name'), { target: { value: 'Test Merchant' } });
  fireEvent.change(screen.getByPlaceholderText('Contact Information'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Latitude'), { target: { value: '10.5' } });
  fireEvent.change(screen.getByPlaceholderText('Longitude'), { target: { value: '20.3' } });
  fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '1 Main St' } });
  fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Port-au-Prince' } });
  fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Haiti' } });

  return screen.getByRole('button', { name: /onboard merchant/i });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MerchantMap – onboarding argument mapping', () => {
  it('calls createOnboardingRequest with all 11 arguments in the correct order', async () => {
    const { merchantClient, createOnboardingRequest } = makeClients();
    const submitBtn = await fillAndOpenForm(merchantClient);

    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(createOnboardingRequest).toHaveBeenCalledTimes(1));

    const args = createOnboardingRequest.mock.calls[0];
    // arg 0: name
    expect(args[0]).toBe('Test Merchant');
    // arg 1: businessType
    expect(args[1]).toBe('grocery');
    // arg 2: category — must be a number
    expect(typeof args[2]).toBe('number');
    // arg 3: locationLatLng — must be "lat,lng" string
    expect(typeof args[3]).toBe('string');
    expect(args[3]).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    // arg 4-7: individual location strings
    expect(typeof args[4]).toBe('string'); // locationAddress
    expect(typeof args[5]).toBe('string'); // locationCity
    expect(typeof args[6]).toBe('string'); // locationCountry
    expect(typeof args[7]).toBe('string'); // locationPostalCode
    // arg 8: contactInfo
    expect(typeof args[8]).toBe('string');
    // arg 9: vouchers array
    expect(Array.isArray(args[9])).toBe(true);
    // arg 10: emergencyFastTrack boolean
    expect(typeof args[10]).toBe('boolean');
    // exactly 11 arguments
    expect(args).toHaveLength(11);
  });

  it('builds locationLatLng as "lat,lng" from separate latitude and longitude fields', async () => {
    const { merchantClient, createOnboardingRequest } = makeClients();
    const submitBtn = await fillAndOpenForm(merchantClient);

    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(createOnboardingRequest).toHaveBeenCalledTimes(1));

    const locationLatLng = createOnboardingRequest.mock.calls[0][3];
    expect(locationLatLng).toBe('10.5,20.3');
  });

  it('never passes a Location object as an argument', async () => {
    const { merchantClient, createOnboardingRequest } = makeClients();
    const submitBtn = await fillAndOpenForm(merchantClient);

    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(createOnboardingRequest).toHaveBeenCalledTimes(1));

    const args = createOnboardingRequest.mock.calls[0];
    for (const arg of args) {
      // No argument should be a plain object with latitude/longitude keys
      expect(
        arg !== null && typeof arg === 'object' && !Array.isArray(arg) && 'latitude' in arg
      ).toBe(false);
    }
  });
});

describe('MerchantMap – category mapping', () => {
  it('maps grocery to 0 (food)', () => {
    expect(BUSINESS_TYPE_TO_CATEGORY['grocery']).toBe(0);
  });

  it('maps pharmacy to 3 (medical)', () => {
    expect(BUSINESS_TYPE_TO_CATEGORY['pharmacy']).toBe(3);
  });

  it('maps fuel_station to 5 (fuel)', () => {
    expect(BUSINESS_TYPE_TO_CATEGORY['fuel_station']).toBe(5);
  });

  it('maps clothing to 4', () => {
    expect(BUSINESS_TYPE_TO_CATEGORY['clothing']).toBe(4);
  });

  it('calls createOnboardingRequest with numeric category matching the selected businessType', async () => {
    const { merchantClient, createOnboardingRequest } = makeClients();

    render(
      <MerchantMap
        merchantClient={merchantClient}
        config={defaultConfig}
        adminKey="SADMIN"
      />
    );

    await act(async () => { fireEvent.click(screen.getByText('Onboard Merchant')); });

    // Change businessType to pharmacy
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pharmacy' } });

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText('Merchant ID'), { target: { value: 'pharm_001' } });
    fireEvent.change(screen.getByPlaceholderText('Business Name'), { target: { value: 'City Pharmacy' } });
    fireEvent.change(screen.getByPlaceholderText('Contact Information'), { target: { value: 'ph@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Latitude'), { target: { value: '1.0' } });
    fireEvent.change(screen.getByPlaceholderText('Longitude'), { target: { value: '2.0' } });
    fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: '5 Rue St' } });
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Cap-Haïtien' } });
    fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Haiti' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /onboard merchant/i }));
    });

    await waitFor(() => expect(createOnboardingRequest).toHaveBeenCalledTimes(1));
    expect(createOnboardingRequest.mock.calls[0][2]).toBe(3); // pharmacy → 3
  });
});

describe('MerchantMap – unsupported fields removed', () => {
  it('does not render a Stellar Address input in the onboarding form', async () => {
    const { merchantClient } = makeClients();
    render(
      <MerchantMap merchantClient={merchantClient} config={defaultConfig} adminKey="SADMIN" />
    );
    await act(async () => { fireEvent.click(screen.getByText('Onboard Merchant')); });

    expect(screen.queryByPlaceholderText(/stellar address/i)).not.toBeInTheDocument();
  });

  it('does not render Daily Limit or Monthly Limit inputs in the onboarding form', async () => {
    const { merchantClient } = makeClients();
    render(
      <MerchantMap merchantClient={merchantClient} config={defaultConfig} adminKey="SADMIN" />
    );
    await act(async () => { fireEvent.click(screen.getByText('Onboard Merchant')); });

    expect(screen.queryByPlaceholderText(/daily limit/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/monthly limit/i)).not.toBeInTheDocument();
  });

  it('does not render Accepted Tokens input in the onboarding form', async () => {
    const { merchantClient } = makeClients();
    render(
      <MerchantMap merchantClient={merchantClient} config={defaultConfig} adminKey="SADMIN" />
    );
    await act(async () => { fireEvent.click(screen.getByText('Onboard Merchant')); });

    expect(screen.queryByPlaceholderText(/accepted tokens/i)).not.toBeInTheDocument();
  });
});

describe('MerchantMap – error handling', () => {
  it('shows an error message containing the SDK error reason on registration failure', async () => {
    const { merchantClient, createOnboardingRequest, registerMerchant } = makeClients();
    registerMerchant.mockRejectedValue(new Error('Insufficient signatures'));

    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    const submitBtn = await fillAndOpenForm(merchantClient);
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());

    const alertMsg = alertSpy.mock.calls[0][0] as string;
    expect(alertMsg).toContain('Insufficient signatures');

    alertSpy.mockRestore();
  });

  it('calls registerMerchant after createOnboardingRequest succeeds', async () => {
    const { merchantClient, registerMerchant } = makeClients();
    const submitBtn = await fillAndOpenForm(merchantClient);

    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(() => expect(registerMerchant).toHaveBeenCalledTimes(1));
    expect(registerMerchant).toHaveBeenCalledWith(
      'SADMIN',
      'merchant_001',
      expect.objectContaining({ name: 'Test Merchant' })
    );
  });
});
