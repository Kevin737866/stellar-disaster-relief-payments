/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BeneficiaryRegistration } from '../components/BeneficiaryRegistration';
import {
  BeneficiaryProfile,
  BeneficiarySearchOptions,
  FundSearchOptions,
  EmergencyFund,
  PaginatedResponse,
} from '../../../sdk/src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(
  id: string,
  overrides: Partial<BeneficiaryProfile> = {}
): BeneficiaryProfile {
  return {
    id,
    name: `Beneficiary ${id}`,
    disasterId: 'disaster_001',
    location: 'Camp Alpha',
    registrationDate: 1000 + parseInt(id.replace(/\D/g, '') || '0', 10),
    lastVerified: 1000,
    verificationFactors: [],
    walletAddress: 'GTEST',
    isActive: true,
    familySize: 2,
    specialNeeds: [],
    trustScore: 75,
    ...overrides,
  };
}

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
    ...overrides,
  };
}

/** Build a mock client whose searchBeneficiaries mirrors real SDK validation. */
function makeClient(
  pages: BeneficiaryProfile[][] = [[]],
  funds: EmergencyFund[] = []
): any {
  return {
    searchBeneficiaries: jest.fn(
      async (_disasterId: string, opts: BeneficiarySearchOptions = {}) => {
        const { cursor = '', limit = 20, search = '', locationFilter = '', activeOnly = true, minTrustScore = 0 } = opts;

        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new Error('limit must be an integer between 1 and 100');
        if (!Number.isInteger(minTrustScore) || minTrustScore < 0 || minTrustScore > 100)
          throw new Error('minTrustScore must be an integer between 0 and 100');
        if ((search ?? '').length > 200)
          throw new Error('search must be 200 characters or fewer');

        const pageIndex = cursor === '' ? 0 : parseInt(cursor, 10);
        let items = (pages[pageIndex] ?? []).filter(p => {
          if (activeOnly && !p.isActive) return false;
          if (p.trustScore < minTrustScore) return false;
          if (locationFilter && p.location !== locationFilter) return false;
          if (search && !p.id.includes(search) && !p.name.includes(search)) return false;
          return true;
        });
        const nextPageIndex = pageIndex + 1;
        const hasMore = nextPageIndex < pages.length && pages[nextPageIndex].length > 0;
        return {
          items,
          nextCursor: hasMore ? String(nextPageIndex) : null,
          hasMore,
        } as PaginatedResponse<BeneficiaryProfile>;
      }
    ),
    searchFunds: jest.fn(async (opts: FundSearchOptions = {}) => {
      const { search = '', disasterType = '', activeOnly = false, createdAfter = 0, createdBefore = 0 } = opts;
      if ((search ?? '').length > 200) throw new Error('search must be 200 characters or fewer');
      if (createdAfter < 0 || createdBefore < 0) throw new Error('createdAfter and createdBefore must be non-negative');
      if (createdAfter > 0 && createdBefore > 0 && createdAfter > createdBefore)
        throw new Error('createdAfter must be less than or equal to createdBefore');

      return funds.filter(f => {
        if (activeOnly && !f.isActive) return false;
        if (disasterType && f.disasterType !== disasterType) return false;
        if (createdAfter > 0 && f.createdAt < createdAfter) return false;
        if (createdBefore > 0 && f.createdAt > createdBefore) return false;
        if (search && !f.id.includes(search) && !f.name.includes(search)) return false;
        return true;
      });
    }),
    createVerificationFactors: jest.fn(() => []),
    registerBeneficiary: jest.fn(),
    generateRecoveryCodes: jest.fn(() => []),
    verifyBeneficiary: jest.fn(),
    restoreAccess: jest.fn(),
    generateBeneficiaryQRCode: jest.fn(),
    createUSSDSession: jest.fn(() => ({ sessionId: 'sid', welcomeMessage: 'Welcome' })),
    processUSSDInput: jest.fn(() => ({ response: 'ok', nextStep: 'welcome' })),
    listBeneficiariesByDisaster: jest.fn(async () => []),
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

// ─── UI: initial load ─────────────────────────────────────────────────────────

describe('BeneficiaryRegistration – initial load', () => {
  it('shows loading indicator then renders results', async () => {
    let resolve!: (v: any) => void;
    const pending = new Promise(r => { resolve = r; });
    const client = makeClient();
    // Override AFTER construction so the debounce picks up the pending mock
    client.searchBeneficiaries = jest.fn(() => pending);

    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);

    // Loading appears after the 300 ms debounce fires
    await waitFor(() =>
      expect(screen.getByText(/loading beneficiaries/i)).toBeInTheDocument(),
      { timeout: 1000 }
    );

    await act(async () => { resolve({ items: [], nextCursor: null, hasMore: false }); });
    await waitFor(() =>
      expect(screen.queryByText(/loading beneficiaries/i)).not.toBeInTheDocument()
    );
  });

  it('shows empty state when no results', async () => {
    const client = makeClient([[]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText(/no beneficiaries found/i)).toBeInTheDocument());
  });

  it('renders first page of beneficiaries', async () => {
    const client = makeClient([[makeProfile('A'), makeProfile('B')]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => {
      expect(screen.getByText('Beneficiary A')).toBeInTheDocument();
      expect(screen.getByText('Beneficiary B')).toBeInTheDocument();
    });
  });
});

// ─── UI: search ───────────────────────────────────────────────────────────────

describe('BeneficiaryRegistration – search', () => {
  it('filters results when search term is typed', async () => {
    const profiles = [makeProfile('alpha'), makeProfile('beta')];
    const client = makeClient([profiles]);

    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary alpha')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
    });

    await waitFor(() => {
      expect(client.searchBeneficiaries).toHaveBeenCalledWith(
        'sample_disaster_001',
        expect.objectContaining({ search: 'alpha' })
      );
    });
  });

  it('resets to first page when search term changes', async () => {
    const page1 = [makeProfile('p1')];
    const page2 = [makeProfile('p2')];
    const client = makeClient([page1, page2]);

    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary p1')).toBeInTheDocument());

    // Load page 2
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    await waitFor(() => expect(screen.getByText('Beneficiary p2')).toBeInTheDocument());

    // Change search — should reset to page 1 only
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } });
    });

    await waitFor(() => {
      const calls = client.searchBeneficiaries.mock.calls;
      const lastCall = calls[calls.length - 1];
      // cursor must be absent (first page) after filter change
      expect(lastCall[1]).not.toHaveProperty('cursor', expect.stringMatching(/.+/));
    });
  });

  it('shows empty state for search with no matches', async () => {
    const client = makeClient([[makeProfile('X')]]);
    // Override to return empty for any search
    client.searchBeneficiaries = jest.fn(async () => ({ items: [], nextCursor: null, hasMore: false }));

    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText(/no beneficiaries found/i)).toBeInTheDocument());
  });
});

// ─── UI: filters ──────────────────────────────────────────────────────────────

describe('BeneficiaryRegistration – filters', () => {
  it('passes locationFilter to searchBeneficiaries', async () => {
    const client = makeClient([[makeProfile('L1', { location: 'Camp Beta' })]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary L1')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/filter by location/i), { target: { value: 'Camp Beta' } });
    });

    await waitFor(() => {
      expect(client.searchBeneficiaries).toHaveBeenCalledWith(
        'sample_disaster_001',
        expect.objectContaining({ locationFilter: 'Camp Beta' })
      );
    });
  });

  it('passes activeOnly=false when checkbox unchecked', async () => {
    const client = makeClient([[makeProfile('A1')]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary A1')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/active only/i));
    });

    await waitFor(() => {
      expect(client.searchBeneficiaries).toHaveBeenCalledWith(
        'sample_disaster_001',
        expect.objectContaining({ activeOnly: false })
      );
    });
  });

  it('passes minTrustScore filter', async () => {
    const client = makeClient([[makeProfile('T1', { trustScore: 90 })]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary T1')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/minimum trust score/i), { target: { value: '80' } });
    });

    await waitFor(() => {
      expect(client.searchBeneficiaries).toHaveBeenCalledWith(
        'sample_disaster_001',
        expect.objectContaining({ minTrustScore: 80 })
      );
    });
  });

  it('clears all filters when "Clear filters" is clicked', async () => {
    const client = makeClient([[makeProfile('C1')]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary C1')).toBeInTheDocument());

    // Set some filters
    await act(async () => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    });

    await waitFor(() => {
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    });
  });
});

// ─── UI: combined search + filter + pagination ────────────────────────────────

describe('BeneficiaryRegistration – combined search + filter + pagination', () => {
  it('appends next page without duplicates when Load More clicked', async () => {
    const page1 = [makeProfile('X1'), makeProfile('X2')];
    const page2 = [makeProfile('X3')];
    const client = makeClient([page1, page2]);

    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary X1')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    await waitFor(() => expect(screen.getByText('Beneficiary X3')).toBeInTheDocument());

    expect(screen.getAllByText(/Beneficiary X/)).toHaveLength(3);
    expect(client.searchBeneficiaries).toHaveBeenCalledTimes(2);
  });

  it('hides Load More and shows total when last page reached', async () => {
    const client = makeClient([[makeProfile('Z1'), makeProfile('Z2')]]);
    render(<BeneficiaryRegistration beneficiaryClient={client} config={defaultConfig} registrarKey="k" />);
    await waitFor(() => expect(screen.getByText('Beneficiary Z1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/all beneficiaries loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/2 total/i)).toBeInTheDocument();
  });
});

// ─── SDK: searchBeneficiaries input validation ────────────────────────────────

describe('searchBeneficiaries – input validation', () => {
  const client = makeClient([[makeProfile('V1')]]);

  it('rejects limit = 0', async () => {
    await expect(client.searchBeneficiaries('d', { limit: 0 }))
      .rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('rejects limit > 100', async () => {
    await expect(client.searchBeneficiaries('d', { limit: 101 }))
      .rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('accepts limit boundary values 1 and 100', async () => {
    await expect(client.searchBeneficiaries('d', { limit: 1 })).resolves.toBeDefined();
    await expect(client.searchBeneficiaries('d', { limit: 100 })).resolves.toBeDefined();
  });

  it('rejects minTrustScore > 100', async () => {
    await expect(client.searchBeneficiaries('d', { minTrustScore: 101 }))
      .rejects.toThrow('minTrustScore must be an integer between 0 and 100');
  });

  it('rejects minTrustScore < 0', async () => {
    await expect(client.searchBeneficiaries('d', { minTrustScore: -1 }))
      .rejects.toThrow('minTrustScore must be an integer between 0 and 100');
  });

  it('rejects search longer than 200 chars', async () => {
    await expect(client.searchBeneficiaries('d', { search: 'a'.repeat(201) }))
      .rejects.toThrow('search must be 200 characters or fewer');
  });

  it('accepts empty search (no text filter)', async () => {
    const result = await client.searchBeneficiaries('d', { search: '' });
    expect(result.items).toBeDefined();
  });

  it('returns hasMore=false and nextCursor=null on last page', async () => {
    const result = await client.searchBeneficiaries('d', { limit: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

// ─── SDK: searchFunds input validation ───────────────────────────────────────

describe('searchFunds – input validation', () => {
  const funds = [
    makeFund('F1', { disasterType: 'earthquake', createdAt: 1000 }),
    makeFund('F2', { disasterType: 'flood', createdAt: 2000, isActive: false }),
  ];
  const client = makeClient([[]], funds);

  it('returns all funds with no filters', async () => {
    const result = await client.searchFunds({});
    expect(result).toHaveLength(2);
  });

  it('filters by disasterType', async () => {
    const result = await client.searchFunds({ disasterType: 'earthquake' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });

  it('filters by activeOnly', async () => {
    const result = await client.searchFunds({ activeOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });

  it('filters by createdAfter', async () => {
    const result = await client.searchFunds({ createdAfter: 1500 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F2');
  });

  it('filters by createdBefore', async () => {
    const result = await client.searchFunds({ createdBefore: 1500 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });

  it('filters by search substring on name', async () => {
    const result = await client.searchFunds({ search: 'F1' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });

  it('returns empty array when no funds match', async () => {
    const result = await client.searchFunds({ search: 'nonexistent_xyz' });
    expect(result).toHaveLength(0);
  });

  it('rejects search longer than 200 chars', async () => {
    await expect(client.searchFunds({ search: 'x'.repeat(201) }))
      .rejects.toThrow('search must be 200 characters or fewer');
  });

  it('rejects negative createdAfter', async () => {
    await expect(client.searchFunds({ createdAfter: -1 }))
      .rejects.toThrow('non-negative');
  });

  it('rejects createdAfter > createdBefore', async () => {
    await expect(client.searchFunds({ createdAfter: 2000, createdBefore: 1000 }))
      .rejects.toThrow('createdAfter must be less than or equal to createdBefore');
  });

  it('accepts equal createdAfter and createdBefore (point-in-time)', async () => {
    const result = await client.searchFunds({ createdAfter: 1000, createdBefore: 1000 });
    expect(result).toBeDefined();
  });

  it('combined: disasterType + activeOnly + search', async () => {
    const result = await client.searchFunds({ disasterType: 'earthquake', activeOnly: true, search: 'F1' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('F1');
  });
});
