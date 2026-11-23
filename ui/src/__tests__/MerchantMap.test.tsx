/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MerchantMap } from '../components/MerchantMap';
import { MerchantClient } from '../../../sdk/src/merchantClient';
import { Merchant, NetworkConfig } from '../../../sdk/src/types';

const testConfig: NetworkConfig = {
  network: 'testnet',
  rpcUrl: '',
  horizonUrl: '',
  contractIds: {
    platform: '',
    aidRegistry: '',
    beneficiaryManager: '',
    merchantNetwork: '',
    cashTransfer: '',
    supplyChainTracker: '',
    antiFraud: '',
  },
};

const makeMerchant = (): Merchant => ({
  id: 'merchant-1',
  name: 'Relief Market',
  owner: 'owner-1',
  businessType: 'grocery',
  location: {
    latitude: 40.7128,
    longitude: -74.006,
    address: '1 Main St',
    city: 'New York',
    country: 'US',
    postalCode: '10001',
  },
  contactInfo: 'contact@example.com',
  registrationDate: 0,
  isVerified: true,
  verificationDocuments: [],
  stellarTomlUrl: '',
  acceptedTokens: ['XLM'],
  dailyLimit: '1000',
  monthlyLimit: '10000',
  currentMonthVolume: '0',
  reputationScore: 90,
  isActive: true,
});

function renderMerchantMap(findMerchantsByLocation: jest.Mock) {
  const merchantClient = {
    findMerchantsByLocation,
    getVerificationQueue: jest.fn().mockResolvedValue([]),
  } as unknown as MerchantClient;

  return render(
    <MerchantMap
      merchantClient={merchantClient}
      config={testConfig}
      adminKey="admin-key"
    />
  );
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('MerchantMap location search', () => {
  it('announces rejected searches and offers a retry action', async () => {
    const findMerchantsByLocation = jest.fn().mockRejectedValue(new Error('RPC unavailable'));
    renderMerchantMap(findMerchantsByLocation);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Unable to search merchants for this location. Please try again.'
    );
    expect(screen.getByRole('button', { name: 'Retry merchant search' })).toBeInTheDocument();
  });

  it('keeps successful empty results distinct from a search failure', async () => {
    renderMerchantMap(jest.fn().mockResolvedValue([]));

    expect(await screen.findByText('No merchants found in this area')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry merchant search' })).not.toBeInTheDocument();
  });

  it('clears a search error and displays results after a successful retry', async () => {
    const findMerchantsByLocation = jest
      .fn()
      .mockRejectedValueOnce(new Error('RPC unavailable'))
      .mockResolvedValueOnce([makeMerchant()]);
    renderMerchantMap(findMerchantsByLocation);

    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry merchant search' }));

    expect(await screen.findByText('Relief Market')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(findMerchantsByLocation).toHaveBeenCalledTimes(2);
  });
});
