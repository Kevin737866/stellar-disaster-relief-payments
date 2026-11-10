/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from '../components/Dashboard';
import {
  BeneficiaryProfile,
  ConditionalTransfer,
  EmergencyFund,
  NetworkConfig,
} from '../../../sdk/src/types';

const CONFIG: NetworkConfig = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  contractIds: {
    platform: 'C0',
    aidRegistry: 'C1',
    beneficiaryManager: 'C2',
    merchantNetwork: 'C3',
    cashTransfer: 'C4',
    supplyChainTracker: 'C5',
    antiFraud: 'C6',
  },
};

const FUTURE = Date.now() + 30 * 24 * 60 * 60 * 1000;

const FUNDS: EmergencyFund[] = [
  {
    id: 'fund_flood',
    name: 'Coastal Flood Relief',
    description: 'Flood response',
    totalAmount: '1000',
    releasedAmount: '400',
    disasterType: 'flood',
    geographicScope: 'Coast',
    createdAt: 1,
    expiresAt: FUTURE,
    isActive: true,
    releaseTriggers: [],
    requiredSignatures: 1,
  },
  {
    id: 'fund_quake',
    name: 'Mountain Quake Relief',
    description: 'Earthquake response',
    totalAmount: '3000',
    releasedAmount: '1500',
    disasterType: 'earthquake',
    geographicScope: 'Highlands',
    createdAt: 1,
    expiresAt: FUTURE,
    isActive: true,
    releaseTriggers: [],
    requiredSignatures: 1,
  },
];

const BENEFICIARIES: BeneficiaryProfile[] = [
  {
    id: 'ben_flood_1',
    name: 'Alice',
    disasterId: 'flood',
    location: 'Coast',
    registrationDate: 1,
    lastVerified: 1,
    identityHash: null,
    verificationFactors: [],
    isActive: true,
    familySize: 3,
    specialNeeds: [],
    trustScore: 90,
    walletAddress: 'G1',
  },
  {
    id: 'ben_quake_1',
    name: 'Bob',
    disasterId: 'earthquake',
    location: 'Highlands',
    registrationDate: 1,
    lastVerified: 1,
    identityHash: null,
    verificationFactors: [],
    isActive: false,
    familySize: 2,
    specialNeeds: [],
    trustScore: 80,
    walletAddress: 'G2',
  },
];

const TRANSFERS: ConditionalTransfer[] = [
  {
    id: 'tr_flood',
    beneficiaryId: 'ben_flood_1',
    amount: '200',
    token: 'USDC',
    createdAt: 1,
    expiresAt: FUTURE,
    spendingRules: [],
    isActive: true,
    spentAmount: '100',
    remainingAmount: '100',
    creator: 'GADMIN',
    purpose: 'shelter',
  },
  {
    id: 'tr_quake',
    beneficiaryId: 'ben_quake_1',
    amount: '800',
    token: 'USDC',
    createdAt: 1,
    expiresAt: FUTURE,
    spendingRules: [],
    isActive: true,
    spentAmount: '200',
    remainingAmount: '600',
    creator: 'GADMIN',
    purpose: 'medical',
  },
];

function makeClients() {
  return {
    aidClient: { listActiveFunds: jest.fn(async () => FUNDS) } as any,
    beneficiaryClient: {
      listBeneficiariesByDisaster: jest.fn(async () => ({
        items: BENEFICIARIES,
        nextCursor: null,
        hasMore: false,
      })),
    } as any,
    merchantClient: {
      findMerchantsByLocation: jest.fn(async () => ({
        merchants: [],
        totalCount: 0,
        hasMore: false,
      })),
    } as any,
    transferClient: { listBeneficiaryTransfers: jest.fn(async () => TRANSFERS) } as any,
  };
}

describe('Dashboard disaster filter (#296)', () => {
  it('shows loading state initially, filters all summaries and records together, and restores on clear', async () => {
    const clients = makeClients();
    render(<Dashboard {...clients} config={CONFIG} />);

    expect(screen.getByText(/Loading dashboard/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Coastal Flood Relief')).toBeInTheDocument();
    });
    expect(screen.getByText('Mountain Quake Relief')).toBeInTheDocument();
    expect(screen.getByText('4,000')).toBeInTheDocument(); // 1000 + 3000 total fund amount

    // Select 'flood' filter
    const select = screen.getByLabelText('Filter by disaster') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'flood' } });

    expect(screen.getByText('Coastal Flood Relief')).toBeInTheDocument();
    expect(screen.queryByText('Mountain Quake Relief')).not.toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument(); // flood fund total
    expect(screen.getByText('400')).toBeInTheDocument();   // flood released total
    expect(screen.getByText('200')).toBeInTheDocument();   // flood transfer volume
    expect(screen.getByText('100')).toBeInTheDocument();   // flood spent amount

    // BarChart aria-label also reflects scoped counts
    const barChart = screen.getByRole('img', { name: /Bar chart:/i });
    expect(barChart.getAttribute('aria-label')).toContain('Active 1');
    expect(barChart.getAttribute('aria-label')).toContain('Benefic. 1');

    // Clear filter restores full unfiltered view
    fireEvent.click(screen.getByRole('button', { name: /Clear filter/i }));
    expect(select.value).toBe('');
    expect(screen.getByText('Coastal Flood Relief')).toBeInTheDocument();
    expect(screen.getByText('Mountain Quake Relief')).toBeInTheDocument();
    expect(screen.getByText('4,000')).toBeInTheDocument();
  });

  it('displays an understandable empty state when a disaster filter matches no records', async () => {
    const clients = makeClients();
    render(<Dashboard {...clients} config={CONFIG} query={{ disasterId: 'tsunami' }} />);

    await waitFor(() => {
      expect(
        screen.getByText(/No emergency funds match disaster/i)
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Clear filter/i }));
    expect(screen.getByText('Coastal Flood Relief')).toBeInTheDocument();
    expect(screen.getByText('Mountain Quake Relief')).toBeInTheDocument();
  });
});
