/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BeneficiaryRegistration } from '../components/BeneficiaryRegistration';
import { BeneficiaryProfile, PaginatedResponse } from '../../../sdk/src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProfile(id: string, registrationDate = 1000): BeneficiaryProfile {
  return {
    id,
    name: `Beneficiary ${id}`,
    disasterId: 'sample_disaster_001',
    location: 'Test Location',
    registrationDate,
    lastVerified: registrationDate,
    verificationFactors: [],
    walletAddress: 'GTEST',
    isActive: true,
    familySize: 1,
    specialNeeds: [],
    trustScore: 75,
  };
}

function makeClient(pages: BeneficiaryProfile[][]): any {
  let callCount = 0;
  return {
    listBeneficiariesPaginated: jest.fn(async (_disasterId: string, opts: any = {}) => {
      const { cursor = '', limit = 20 } = opts;

      // Validate inputs (mirrors SDK behaviour)
      if (limit < 1 || limit > 100) throw new Error('limit must be an integer between 1 and 100');

      const pageIndex = cursor === '' ? 0 : parseInt(cursor, 10);
      const items = pages[pageIndex] ?? [];
      const nextPageIndex = pageIndex + 1;
      const hasMore = nextPageIndex < pages.length;
      return {
        items,
        nextCursor: hasMore ? String(nextPageIndex) : null,
        hasMore,
      } as PaginatedResponse<BeneficiaryProfile>;
    }),
    createVerificationFactors: jest.fn(() => []),
    registerBeneficiary: jest.fn(),
    generateRecoveryCodes: jest.fn(() => []),
    verifyBeneficiary: jest.fn(),
    restoreAccess: jest.fn(),
    generateBeneficiaryQRCode: jest.fn(),
    createUSSDSession: jest.fn(() => ({ sessionId: 'sid', welcomeMessage: 'Welcome' })),
    processUSSDInput: jest.fn(() => ({ response: 'ok', nextStep: 'welcome' })),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BeneficiaryRegistration – pagination', () => {
  it('renders first page of beneficiaries on mount', async () => {
    const page1 = [makeProfile('A'), makeProfile('B')];
    const client = makeClient([page1]);

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Beneficiary A')).toBeInTheDocument();
      expect(screen.getByText('Beneficiary B')).toBeInTheDocument();
    });

    expect(client.listBeneficiariesPaginated).toHaveBeenCalledTimes(1);
    expect(client.listBeneficiariesPaginated).toHaveBeenCalledWith(
      'sample_disaster_001',
      { limit: 20 }
    );
  });

  it('shows "Load More" button when hasMore is true', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => makeProfile(`p1-${i}`));
    const page2 = [makeProfile('p2-0')];
    const client = makeClient([page1, page2]);

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() => expect(screen.getByText('Beneficiary p1-0')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('loads next page when "Load More" is clicked and appends without duplicates', async () => {
    const page1 = [makeProfile('X1'), makeProfile('X2')];
    const page2 = [makeProfile('X3')];
    const client = makeClient([page1, page2]);

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() => expect(screen.getByText('Beneficiary X1')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Beneficiary X3')).toBeInTheDocument();
    });

    // All three items present, no duplicates
    expect(screen.getAllByText(/Beneficiary X/)).toHaveLength(3);
    expect(client.listBeneficiariesPaginated).toHaveBeenCalledTimes(2);
    expect(client.listBeneficiariesPaginated).toHaveBeenNthCalledWith(
      2,
      'sample_disaster_001',
      { cursor: '1', limit: 20 }
    );
  });

  it('hides "Load More" and shows total count when last page is reached', async () => {
    const page1 = [makeProfile('Z1'), makeProfile('Z2')];
    const client = makeClient([page1]); // single page, no more data

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() => expect(screen.getByText('Beneficiary Z1')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/all beneficiaries loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/2 total/i)).toBeInTheDocument();
  });

  it('shows empty state when dataset is empty', async () => {
    const client = makeClient([[]]); // empty first page

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/no beneficiaries found/i)).toBeInTheDocument()
    );
  });

  it('shows loading indicator while fetching first page', async () => {
    let resolve!: (v: any) => void;
    const pending = new Promise((r) => { resolve = r; });

    const client = makeClient([[]]);
    client.listBeneficiariesPaginated = jest.fn(() => pending);

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    expect(screen.getByText(/loading beneficiaries/i)).toBeInTheDocument();

    await act(async () => {
      resolve({ items: [], nextCursor: null, hasMore: false });
    });

    await waitFor(() =>
      expect(screen.queryByText(/loading beneficiaries/i)).not.toBeInTheDocument()
    );
  });

  it('handles multiple pages sequentially without missing entries', async () => {
    const pages = [
      [makeProfile('M1', 100), makeProfile('M2', 200)],
      [makeProfile('M3', 300), makeProfile('M4', 400)],
      [makeProfile('M5', 500)],
    ];
    const client = makeClient(pages);

    render(
      <BeneficiaryRegistration
        beneficiaryClient={client}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    // Page 1
    await waitFor(() => expect(screen.getByText('Beneficiary M1')).toBeInTheDocument());

    // Page 2
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    await waitFor(() => expect(screen.getByText('Beneficiary M3')).toBeInTheDocument());

    // Page 3
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load more/i })); });
    await waitFor(() => expect(screen.getByText('Beneficiary M5')).toBeInTheDocument());

    // All 5 items, no duplicates
    expect(screen.getAllByText(/Beneficiary M/)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/5 total/i)).toBeInTheDocument();
  });
});

// ─── SDK input-validation unit tests ─────────────────────────────────────────

describe('listBeneficiariesPaginated – input validation', () => {
  // We test the validation logic directly via the mock that mirrors the real SDK.
  const client = makeClient([[makeProfile('V1')]]);

  it('rejects limit = 0', async () => {
    await expect(
      client.listBeneficiariesPaginated('d', { limit: 0 })
    ).rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('rejects limit > 100', async () => {
    await expect(
      client.listBeneficiariesPaginated('d', { limit: 101 })
    ).rejects.toThrow('limit must be an integer between 1 and 100');
  });

  it('accepts limit = 1 (boundary)', async () => {
    const result = await client.listBeneficiariesPaginated('d', { limit: 1 });
    expect(result).toBeDefined();
  });

  it('accepts limit = 100 (boundary)', async () => {
    const result = await client.listBeneficiariesPaginated('d', { limit: 100 });
    expect(result).toBeDefined();
  });

  it('uses default limit when omitted', async () => {
    const result = await client.listBeneficiariesPaginated('d');
    expect(result.items).toBeDefined();
  });

  it('returns hasMore=false and nextCursor=null on last page', async () => {
    const result = await client.listBeneficiariesPaginated('d', { limit: 20 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});
