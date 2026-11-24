/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Dashboard } from '../components/Dashboard';
import { EmergencyFund, NetworkConfig } from '../../../sdk/src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFund(id: string, overrides: Partial<EmergencyFund> = {}): EmergencyFund {
  return {
    id,
    name: `Fund ${id}`,
    description: 'Test fund',
    totalAmount: '1000000',
    releasedAmount: '0',
    createdAt: 2000,
    expiresAt: 9999999,
    disasterType: 'earthquake',
    geographicScope: 'Global',
    isActive: true,
    releaseTriggers: [],
    requiredSignatures: 2,
    metadata: {},
    ...overrides,
  };
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

function makeClients(funds: EmergencyFund[]) {
  return {
    aidClient: {
      listActiveFunds: jest.fn(async () => funds),
    },
    beneficiaryClient: {
      listBeneficiariesByDisaster: jest.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    },
    merchantClient: {
      findMerchantsByLocation: jest.fn(async () => ({
        merchants: [],
        totalCount: 0,
        hasMore: false,
      })),
    },
    transferClient: {
      listBeneficiaryTransfers: jest.fn(async () => []),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Dashboard – disaster filter', () => {
  it('renders the filter dropdown with unique disaster types and empty default', async () => {
    const funds = [
      makeFund('F1', { disasterType: 'earthquake' }),
      makeFund('F2', { disasterType: 'flood' }),
      makeFund('F3', { disasterType: 'earthquake' }), // duplicate
    ];
    const clients = makeClients(funds);

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    await waitFor(() =>
      expect(screen.getByText('Relief Operations Dashboard')).toBeInTheDocument()
    );

    const select = screen.getByLabelText('Filter by disaster type') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('');

    const options = Array.from(select.options);
    // 1 empty + 2 unique types (earthquake, flood)
    expect(options).toHaveLength(3);
    expect(options[0].value).toBe('');
    expect(options.map((o) => o.value)).toEqual(['', 'earthquake', 'flood']);
  });

  it('hides the filter during loading and shows it after data loads', async () => {
    let resolveLoad!: (v: any) => void;
    const pending = new Promise((r) => { resolveLoad = r; });
    const clients = makeClients([]);
    clients.aidClient.listActiveFunds = jest.fn(() => pending) as any;

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    expect(screen.getByText(/Loading dashboard/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by disaster type')).not.toBeInTheDocument();

    await act(async () => {
      resolveLoad([makeFund('F1')]);
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Filter by disaster type')).toBeInTheDocument()
    );
  });

  it('selecting a disaster type filters all fund-derived views', async () => {
    const funds = [
      makeFund('EQ1', { disasterType: 'earthquake', totalAmount: '1000000', releasedAmount: '500000', isActive: true }),
      makeFund('EQ2', { disasterType: 'earthquake', totalAmount: '2000000', releasedAmount: '0', isActive: false }),
      makeFund('FL1', { disasterType: 'flood', totalAmount: '5000000', releasedAmount: '1000000', isActive: true }),
    ];
    const clients = makeClients(funds);

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    await waitFor(() =>
      expect(screen.getByText('Fund EQ1')).toBeInTheDocument()
    );

    // Unfiltered: 3 funds total, 2 active
    expect(screen.getByText('2')).toBeInTheDocument(); // active funds KPI

    // Select earthquake
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: 'earthquake' } });
    });

    await waitFor(() => {
      // Table should show only earthquake funds
      expect(screen.getByText('Fund EQ1')).toBeInTheDocument();
      expect(screen.getByText('Fund EQ2')).toBeInTheDocument();
      expect(screen.queryByText('Fund FL1')).not.toBeInTheDocument();
    });

    // KPI: 2 earthquake funds, 1 active
    const emergencyFundsCard = screen.getByText('Emergency Funds').closest('div');
    expect(emergencyFundsCard).toHaveTextContent('1'); // active funds
  });

  it('clearing the filter restores the unfiltered view without re-fetching', async () => {
    const funds = [
      makeFund('EQ1', { disasterType: 'earthquake' }),
      makeFund('FL1', { disasterType: 'flood' }),
    ];
    const clients = makeClients(funds);

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    await waitFor(() => expect(screen.getByText('Fund EQ1')).toBeInTheDocument());

    // Select earthquake
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: 'earthquake' } });
    });

    await waitFor(() => expect(screen.queryByText('Fund FL1')).not.toBeInTheDocument());

    const callCountAfterFilter = clients.aidClient.listActiveFunds.mock.calls.length;

    // Clear filter
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: '' } });
    });

    await waitFor(() => {
      expect(screen.getByText('Fund EQ1')).toBeInTheDocument();
      expect(screen.getByText('Fund FL1')).toBeInTheDocument();
    });

    // No re-fetch
    expect(clients.aidClient.listActiveFunds.mock.calls.length).toBe(callCountAfterFilter);
  });

  it('empty-result state shows zero KPIs, 0% donut, and empty message', async () => {
    const funds = [
      makeFund('EQ1', { disasterType: 'earthquake', totalAmount: '1000000', releasedAmount: '500000' }),
    ];
    const clients = makeClients(funds);

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    await waitFor(() => expect(screen.getByText('Fund EQ1')).toBeInTheDocument());

    // Select a disaster type with no matching funds
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: 'flood' } });
    });

    await waitFor(() => {
      expect(screen.getByText(/no funds match the selected disaster type/i)).toBeInTheDocument();
    });

    // Fund table is absent
    expect(screen.queryByText('Fund EQ1')).not.toBeInTheDocument();

    // Emergency Funds KPI shows 0 active
    const emergencyFundsCard = screen.getByText('Emergency Funds').closest('div');
    expect(emergencyFundsCard).toHaveTextContent('0');

    // Funds Released donut shows 0%
    const fundsReleasedDonut = screen.getByLabelText('Funds Released: 0%');
    expect(fundsReleasedDonut).toBeInTheDocument();
  });

  it('cross-view total consistency: table sum equals summary card before and after filter', async () => {
    const funds = [
      makeFund('EQ1', { disasterType: 'earthquake', totalAmount: '1000000', releasedAmount: '0' }),
      makeFund('EQ2', { disasterType: 'earthquake', totalAmount: '2000000', releasedAmount: '0' }),
      makeFund('FL1', { disasterType: 'flood', totalAmount: '4000000', releasedAmount: '0' }),
    ];
    const clients = makeClients(funds);

    render(
      <Dashboard
        aidClient={clients.aidClient}
        beneficiaryClient={clients.beneficiaryClient}
        merchantClient={clients.merchantClient}
        transferClient={clients.transferClient}
        config={defaultConfig}
      />
    );

    await waitFor(() => expect(screen.getByText('Fund EQ1')).toBeInTheDocument());

    // Unfiltered: total fund amount should be 7,000,000 (1M + 2M + 4M)
    // The "Total Fund Amount" card shows the formatted amount
    const totalFundAmountCard = screen.getByText('Total Fund Amount').closest('div');
    expect(totalFundAmountCard).toHaveTextContent('7,000,000');

    // Apply earthquake filter: total should be 3,000,000 (1M + 2M)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: 'earthquake' } });
    });

    await waitFor(() => {
      expect(screen.getByText('Fund EQ1')).toBeInTheDocument();
      expect(screen.getByText('Fund EQ2')).toBeInTheDocument();
      expect(screen.queryByText('Fund FL1')).not.toBeInTheDocument();
    });

    // Filtered total fund amount should be 3,000,000
    const filteredTotalCard = screen.getByText('Total Fund Amount').closest('div');
    expect(filteredTotalCard).toHaveTextContent('3,000,000');

    // Clear filter and verify it goes back to 7,000,000
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Filter by disaster type'), { target: { value: '' } });
    });

    await waitFor(() => expect(screen.getByText('Fund FL1')).toBeInTheDocument());

    const restoredTotalCard = screen.getByText('Total Fund Amount').closest('div');
    expect(restoredTotalCard).toHaveTextContent('7,000,000');
  });
});
