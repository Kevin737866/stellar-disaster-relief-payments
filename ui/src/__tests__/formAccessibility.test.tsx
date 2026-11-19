/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BeneficiaryRegistration } from '../components/BeneficiaryRegistration';
import { BeneficiaryProfile } from '../../../sdk/src/types';

function makeProfile(overrides: Partial<BeneficiaryProfile> = {}): BeneficiaryProfile {
  return {
    id: 'beneficiary_001',
    name: 'Amina Yusuf',
    disasterId: 'sample_disaster_001',
    location: 'Camp Alpha',
    registrationDate: 1000,
    lastVerified: 1000,
    verificationFactors: [],
    walletAddress: 'GTEST',
    isActive: true,
    familySize: 4,
    specialNeeds: [],
    trustScore: 90,
    ...overrides,
  };
}

function makeClient(beneficiaries: BeneficiaryProfile[] = []): any {
  return {
    listBeneficiariesByDisaster: jest.fn(async () => beneficiaries),
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
    platform: '',
    aidRegistry: '',
    beneficiaryManager: '',
    merchantNetwork: '',
    cashTransfer: '',
    supplyChainTracker: '',
    antiFraud: '',
  },
};

describe('BeneficiaryRegistration accessibility', () => {
  it('associates a required-field error with its input', async () => {
    render(
      <BeneficiaryRegistration
        beneficiaryClient={makeClient()}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /register beneficiary/i }));

    const input = screen.getByLabelText(/beneficiary id/i);
    expect(input).toHaveAttribute('id', 'reg-beneficiary-id');
    expect(input).toBeRequired();

    fireEvent.blur(input);

    const message = await screen.findByText('Beneficiary ID is required.');
    expect(message).toHaveAttribute('id', 'reg-beneficiary-id-error');
    expect(message).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'reg-beneficiary-id-error');
  });

  it('labels the verification form and exposes errors through aria-describedby', async () => {
    render(
      <BeneficiaryRegistration
        beneficiaryClient={makeClient()}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /verify identity/i }));

    const beneficiaryId = screen.getByLabelText(/beneficiary id/i);
    const verifierKey = screen.getByLabelText(/verifier key/i);

    expect(beneficiaryId).toHaveAttribute('id', 'verify-beneficiary-id');
    expect(verifierKey).toHaveAttribute('id', 'verify-verifier-key');
    expect(verifierKey).toHaveAttribute('type', 'password');

    fireEvent.blur(verifierKey);

    const message = await screen.findByText('Verifier key is required.');
    expect(message).toHaveAttribute('id', 'verify-verifier-key-error');
    expect(verifierKey).toHaveAttribute('aria-invalid', 'true');
    expect(verifierKey).toHaveAttribute('aria-describedby', 'verify-verifier-key-error');
  });

  it('shows trust and active status with text and icons, not colour alone', async () => {
    render(
      <BeneficiaryRegistration
        beneficiaryClient={makeClient([makeProfile({ trustScore: 90, isActive: true })])}
        config={defaultConfig}
        registrarKey="key"
      />
    );

    await waitFor(() =>
      expect(document.body.textContent).toContain('Trust score: 90/100 (High)')
    );
    expect(document.body.textContent).toContain('Status: Active');
    expect(
      screen.getAllByText('✓', { selector: '[aria-hidden="true"]' }).length
    ).toBeGreaterThan(0);
  });
});
