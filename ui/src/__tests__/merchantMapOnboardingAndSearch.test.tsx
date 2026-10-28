/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MerchantMap } from '../components/MerchantMap';
import { Merchant } from '../../../sdk/src/types';

// Mock window.alert
beforeEach(() => {
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeMockMerchant(id = 'merch_001'): Merchant {
  return {
    id,
    name: 'Bodega Central',
    businessType: 'grocery',
    owner: 'GOWNER123',
    location: {
      latitude: 40.7128,
      longitude: -74.006,
      address: '123 Main St',
      city: 'New York',
      country: 'USA',
      postalCode: '10001',
    },
    contactInfo: 'ops@bodega.org',
    acceptedTokens: ['XLM'],
    isVerified: true,
    isActive: true,
    reputationScore: 92,
    registrationDate: 1700000000000,
    dailyLimit: '5000',
    monthlyLimit: '50000',
    currentMonthVolume: '1200',
    stellarTomlUrl: 'https://bodega.org/.well-known/stellar.toml',
  };
}

function makeClient(options: {
  merchants?: Merchant[];
  searchError?: Error | null;
  registerError?: Error | null;
} = {}) {
  const {
    merchants = [],
    searchError = null,
    registerError = null,
  } = options;

  let currentMerchants = [...merchants];
  let searchCallCount = 0;

  const findMerchantsByLocation = jest.fn(async () => {
    searchCallCount++;
    if (searchError && searchCallCount === 1) {
      throw searchError;
    }
    return currentMerchants;
  });

  const getVerificationQueue = jest.fn(async () => []);

  const createOnboardingRequest = jest.fn((
    name: string,
    businessType: string,
    category: number,
    locationLatLng: string,
    locationAddress: string,
    locationCity: string,
    locationCountry: string,
    locationPostalCode: string,
    contactInfo: string,
    vouchers: string[] = [],
    emergencyFastTrack: boolean = false
  ) => ({
    name,
    businessType,
    category,
    locationLatLng,
    locationAddress,
    locationCity,
    locationCountry,
    locationPostalCode,
    contactInfo,
    acceptedTokens: ['XLM'],
    vouchers,
    emergencyFastTrack,
  }));

  const registerMerchant = jest.fn(async () => {
    if (registerError) {
      throw registerError;
    }
    return 'tx_hash_test_123';
  });

  return {
    findMerchantsByLocation,
    getVerificationQueue,
    createOnboardingRequest,
    registerMerchant,
    verifyMerchant: jest.fn(async () => true),
    batchVerifyMerchants: jest.fn(async () => ['merch_001']),
    generateMerchantQRCode: jest.fn(),
    updateReputation: jest.fn(),
    getMerchantTransactions: jest.fn(),
  };
}

describe('MerchantMap Component (Issues #314 & #324)', () => {
  const mockConfig: any = { network: 'TESTNET', rpcUrl: 'https://soroban-testnet.stellar.org' };
  const adminKey = 'SADMINTESTKEY123456789';

  describe('Issue #324: Show operators when merchant location searches fail', () => {
    test('successful empty search shows empty-state message without error alert', async () => {
      const client = makeClient({ merchants: [] });

      render(<MerchantMap merchantClient={client as any} config={mockConfig} adminKey={adminKey} />);

      await waitFor(() => {
        expect(screen.getByText('No merchants found in this area')).toBeInTheDocument();
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(client.findMerchantsByLocation).toHaveBeenCalledTimes(1);
    });

    test('failed location search displays operator-facing error alert and retry action', async () => {
      const networkErr = new Error('RPC connection timeout fetching merchants');
      const client = makeClient({
        merchants: [makeMockMerchant('merch_recovered')],
        searchError: networkErr,
      });

      render(<MerchantMap merchantClient={client as any} config={mockConfig} adminKey={adminKey} />);

      // Error alert should be displayed with retry button
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('RPC connection timeout fetching merchants');

      const retryBtn = screen.getByRole('button', { name: /retry search/i });
      expect(retryBtn).toBeInTheDocument();

      // Click retry button
      fireEvent.click(retryBtn);

      // On retry, error should clear and merchant should display
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });

      expect(screen.getByText('Bodega Central')).toBeInTheDocument();
      expect(client.findMerchantsByLocation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Issue #314: Fix MerchantMap onboarding arguments and match SDK request type', () => {
    test('onboarding maps location and category fields matching SDK createOnboardingRequest', async () => {
      const client = makeClient();

      render(<MerchantMap merchantClient={client as any} config={mockConfig} adminKey={adminKey} />);

      // Open onboarding modal/form
      const onboardBtn = screen.getByRole('button', { name: /onboard merchant/i });
      fireEvent.click(onboardBtn);

      expect(screen.getByText('Onboard New Merchant')).toBeInTheDocument();

      // Fill in all required fields
      fireEvent.change(screen.getByPlaceholderText('Merchant ID'), { target: { value: 'merch_san_juan' } });
      fireEvent.change(screen.getByPlaceholderText('Business Name'), { target: { value: 'San Juan Emergency Supplies' } });
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: '3' } }); // Medical (3)
      fireEvent.change(screen.getByLabelText('Business Type'), { target: { value: 'pharmacy' } });
      fireEvent.change(screen.getByPlaceholderText('Contact Information'), { target: { value: 'contact@sanjuanpharma.org' } });
      fireEvent.change(screen.getByPlaceholderText('Latitude'), { target: { value: '18.4655' } });
      fireEvent.change(screen.getByPlaceholderText('Longitude'), { target: { value: '-66.1057' } });
      fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: 'Calle Fortaleza 50' } });
      fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'San Juan' } });
      fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'PR' } });
      fireEvent.change(screen.getByPlaceholderText('Postal Code'), { target: { value: '00901' } });

      // Submit form
      const submitBtn = screen.getByRole('button', { name: 'Onboard Merchant' });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(client.createOnboardingRequest).toHaveBeenCalledTimes(1);
      });

      // Verify exact 11 arguments matching SDK signature
      expect(client.createOnboardingRequest).toHaveBeenCalledWith(
        'San Juan Emergency Supplies',
        'pharmacy',
        3,
        '18.4655,-66.1057',
        'Calle Fortaleza 50',
        'San Juan',
        'PR',
        '00901',
        'contact@sanjuanpharma.org',
        [],
        false
      );

      // Verify registerMerchant called with adminKey, merchantId and constructed request
      expect(client.registerMerchant).toHaveBeenCalledWith(
        adminKey,
        'merch_san_juan',
        expect.objectContaining({
          name: 'San Juan Emergency Supplies',
          businessType: 'pharmacy',
          category: 3,
          locationLatLng: '18.4655,-66.1057',
          locationAddress: 'Calle Fortaleza 50',
          locationCity: 'San Juan',
          locationCountry: 'PR',
          locationPostalCode: '00901',
          contactInfo: 'contact@sanjuanpharma.org',
          acceptedTokens: ['XLM'],
        })
      );
    });

    test('does not present unsupported token or daily/monthly limit controls as persisted inputs', async () => {
      const client = makeClient();

      render(<MerchantMap merchantClient={client as any} config={mockConfig} adminKey={adminKey} />);

      fireEvent.click(screen.getByRole('button', { name: /onboard merchant/i }));

      // Unsupported inputs that the contract does not consume must not be presented to operators
      expect(screen.queryByPlaceholderText(/accepted tokens/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/daily limit/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/monthly limit/i)).not.toBeInTheDocument();
    });

    test('displays operator-facing error alert when SDK registration fails', async () => {
      const regError = new Error('Merchant registration rejected: account already registered');
      const client = makeClient({ registerError: regError });

      render(<MerchantMap merchantClient={client as any} config={mockConfig} adminKey={adminKey} />);

      fireEvent.click(screen.getByRole('button', { name: /onboard merchant/i }));

      fireEvent.change(screen.getByPlaceholderText('Merchant ID'), { target: { value: 'merch_dup' } });
      fireEvent.change(screen.getByPlaceholderText('Business Name'), { target: { value: 'Duplicate Merchant' } });
      fireEvent.change(screen.getByPlaceholderText('Contact Information'), { target: { value: 'dup@merchant.org' } });
      fireEvent.change(screen.getByPlaceholderText('Latitude'), { target: { value: '18.0' } });
      fireEvent.change(screen.getByPlaceholderText('Longitude'), { target: { value: '-66.0' } });
      fireEvent.change(screen.getByPlaceholderText('Address'), { target: { value: 'Main St' } });
      fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Ponce' } });
      fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'PR' } });

      fireEvent.click(screen.getByRole('button', { name: 'Onboard Merchant' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Merchant registration rejected: account already registered');
    });
  });
});
