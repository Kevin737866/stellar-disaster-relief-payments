import React, { useState, useEffect, useCallback } from 'react';
import { BeneficiaryClient, BeneficiaryProfile, VerificationFactor, NetworkConfig } from '../../sdk/src/types';
import {
  useFormValidation,
  FieldError,
  compose,
  required,
  minLength,
  maxLength,
  identifier,
  isInteger,
  minValue,
  stellarAddress,
  commaSeparatedRequired,
} from '../validation';
import {
  SkeletonList,
  StatusMessage,
  EmptyState,
  ErrorState,
  LoadingButton,
  PageLoadingOverlay,
} from './LoadingPrimitives';

interface BeneficiaryRegistrationProps {
  beneficiaryClient: BeneficiaryClient;
  config: NetworkConfig;
  registrarKey: string;
}

export const BeneficiaryRegistration: React.FC<BeneficiaryRegistrationProps> = ({
  beneficiaryClient, config, registrarKey,
}) => {
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryProfile[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [showVerificationForm, setShowVerificationForm] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<BeneficiaryProfile | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);
  const openModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [registrationForm, setRegistrationForm] = useState({
    beneficiaryId: '', name: '', disasterId: '', location: '', walletAddress: '',
    familySize: '1', specialNeeds: '', possessionFactors: '', behavioralFactors: '', socialFactors: '',
  });

  const [verificationForm, setVerificationForm] = useState({
    beneficiaryId: '', verifierKey: '', providedFactors: '',
  });

  const regValidation = useFormValidation<typeof registrationForm>({
    beneficiaryId: compose(required('Beneficiary ID'), identifier('Beneficiary ID')),
    name: compose(required('Full Name'), minLength(2, 'Full Name'), maxLength(100, 'Full Name')),
    disasterId: compose(required('Disaster ID'), identifier('Disaster ID')),
    location: compose(required('Location'), minLength(2, 'Location'), maxLength(200, 'Location')),
    walletAddress: compose(required('Wallet Address'), stellarAddress),
    familySize: compose(required('Family Size'), isInteger('Family Size'), minValue(1, 'Family Size')),
    possessionFactors: compose(required('Possession Factors'), commaSeparatedRequired('Possession Factors')),
    behavioralFactors: compose(required('Behavioral Factors'), commaSeparatedRequired('Behavioral Factors')),
    socialFactors: compose(required('Social Factors'), commaSeparatedRequired('Social Factors')),
  });

  const verifyValidation = useFormValidation<typeof verificationForm>({
    beneficiaryId: compose(required('Beneficiary ID'), identifier('Beneficiary ID')),
    verifierKey: required('Verifier Key'),
    providedFactors: compose(required('Provided Factors'), commaSeparatedRequired('Provided Factors')),
  });

  const [ussdSession, setUssdSession] = useState({
    sessionId: '', phoneNumber: '', currentStep: 'welcome', response: '',
  });
  const ussdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadBeneficiaries(); }, []);

  const loadBeneficiaries = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await beneficiaryClient.listBeneficiariesByDisaster('sample_disaster_001');
      setBeneficiaries(data);
    } catch {
      setListError('Failed to load beneficiaries. Please try again.');
    } finally {
      setListLoading(false);
    }
  }, [beneficiaryClient]);

  useEffect(() => { loadBeneficiaries(); }, [loadBeneficiaries]);

  const handleRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regValidation.validateAll(registrationForm as Record<keyof typeof registrationForm, string>)) return;
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const verificationFactors = beneficiaryClient.createVerificationFactors(
        registrationForm.possessionFactors.split(',').map(f => f.trim()),
        registrationForm.behavioralFactors.split(',').map(f => f.trim()),
        registrationForm.socialFactors.split(',').map(f => f.trim())
      );
      await beneficiaryClient.registerBeneficiary(
        registrarKey, registrationForm.beneficiaryId, registrationForm.name,
        registrationForm.disasterId, registrationForm.location, registrationForm.walletAddress,
        parseInt(registrationForm.familySize),
        registrationForm.specialNeeds.split(',').map(f => f.trim()).filter(Boolean),
        verificationFactors
      );
      const codes = beneficiaryClient.generateRecoveryCodes(registrationForm.beneficiaryId);
      setRecoveryCodes(codes);
      setShowRegistrationForm(false);
      setRegistrationForm({ beneficiaryId: '', name: '', disasterId: '', location: '', walletAddress: '', familySize: '1', specialNeeds: '', possessionFactors: '', behavioralFactors: '', socialFactors: '' });
      regValidation.reset();
      setSubmitStatus({ type: 'success', message: 'Beneficiary registered successfully. Save your recovery codes.' });
      loadBeneficiaries();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to register beneficiary. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyValidation.validateAll(verificationForm as Record<keyof typeof verificationForm, string>)) return;
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const providedFactors: VerificationFactor[] = verificationForm.providedFactors
        .split(',').map(f => ({ factorType: 'possession', value: f.trim(), weight: 50, verifiedAt: Date.now() }));
      const verified = await beneficiaryClient.verifyBeneficiary(
        verificationForm.verifierKey, verificationForm.beneficiaryId, providedFactors
      );
      setSubmitStatus(verified
        ? { type: 'success', message: 'Beneficiary verified successfully.' }
        : { type: 'error', message: 'Verification failed. Please check the provided factors.' }
      );
      setShowVerificationForm(false);
      setVerificationForm({ beneficiaryId: '', verifierKey: '', providedFactors: '' });
      verifyValidation.reset();
      loadBeneficiaries();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to verify beneficiary.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUSSDSession = (phoneNumber: string) => {
    const session = beneficiaryClient.createUSSDSession(phoneNumber);
    setUssdSession({ sessionId: session.sessionId, phoneNumber, currentStep: 'welcome', response: session.welcomeMessage });
  };

  const handleUSSDInput = (input: string) => {
    const result = beneficiaryClient.processUSSDInput(ussdSession.sessionId, input, ussdSession.currentStep);
    setUssdSession({ ...ussdSession, currentStep: result.nextStep, response: result.response });
    if (result.completed) {
      setSubmitStatus({ type: 'success', message: 'USSD registration completed.' });
      setUssdSession({ sessionId: '', phoneNumber: '', currentStep: 'welcome', response: '' });
    }
  };

  const getTrustScoreLabel = (score: number) => {
    if (score >= 80) return { label: 'High', className: 'text-green-600' };
    if (score >= 60) return { label: 'Medium', className: 'text-yellow-600' };
    return { label: 'Low', className: 'text-red-600' };
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto p-6">
      {submitting && <PageLoadingOverlay message="Processing registration…" />}

      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Beneficiary Registration</h1>
        <p className="text-gray-600 mb-6">Biometric-free identity management for displaced persons</p>

        {submitStatus && (
          <StatusMessage type={submitStatus.type} message={submitStatus.message}
            onDismiss={() => setSubmitStatus(null)} className="mb-4" />
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={() => setShowRegistrationForm(!showRegistrationForm)}
            aria-expanded={showRegistrationForm}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Register Beneficiary
          </button>
          <button onClick={() => setShowVerificationForm(!showVerificationForm)}
            aria-expanded={showVerificationForm}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
            Verify Identity
          </button>
          <button onClick={() => handleUSSDSession('+1234567890')}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
            USSD Demo
          </button>
        </div>

          {/* Registration Form */}
          <section id="registration-form" aria-label="Register New Beneficiary" hidden={!showRegistrationForm} className="bg-blue-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Register New Beneficiary</h2>
            <form onSubmit={handleRegistration} className="space-y-4" aria-label="Beneficiary registration form">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Beneficiary ID" value={registrationForm.beneficiaryId} aria-label="Beneficiary ID" aria-describedby="reg-beneficiaryId-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, beneficiaryId: e.target.value }); regValidation.validateField('beneficiaryId', e.target.value); }}
                    onBlur={e => regValidation.validateField('beneficiaryId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.beneficiaryId && regValidation.errors.beneficiaryId ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-beneficiaryId-error" error={regValidation.touched.beneficiaryId ? regValidation.errors.beneficiaryId : null} />
                </div>
                <div>
                  <input type="text" placeholder="Full Name" value={registrationForm.name} aria-label="Full Name" aria-describedby="reg-name-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, name: e.target.value }); regValidation.validateField('name', e.target.value); }}
                    onBlur={e => regValidation.validateField('name', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.name && regValidation.errors.name ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-name-error" error={regValidation.touched.name ? regValidation.errors.name : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Disaster ID" value={registrationForm.disasterId} aria-label="Disaster ID" aria-describedby="reg-disasterId-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, disasterId: e.target.value }); regValidation.validateField('disasterId', e.target.value); }}
                    onBlur={e => regValidation.validateField('disasterId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.disasterId && regValidation.errors.disasterId ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-disasterId-error" error={regValidation.touched.disasterId ? regValidation.errors.disasterId : null} />
                </div>
                <div>
                  <input type="text" placeholder="Location" value={registrationForm.location} aria-label="Location" aria-describedby="reg-location-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, location: e.target.value }); regValidation.validateField('location', e.target.value); }}
                    onBlur={e => regValidation.validateField('location', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.location && regValidation.errors.location ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-location-error" error={regValidation.touched.location ? regValidation.errors.location : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Wallet Address" value={registrationForm.walletAddress} aria-label="Wallet Address" aria-describedby="reg-walletAddress-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, walletAddress: e.target.value }); regValidation.validateField('walletAddress', e.target.value); }}
                    onBlur={e => regValidation.validateField('walletAddress', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.walletAddress && regValidation.errors.walletAddress ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-walletAddress-error" error={regValidation.touched.walletAddress ? regValidation.errors.walletAddress : null} />
                </div>
                <div>
                  <input type="number" placeholder="Family Size" value={registrationForm.familySize} min="1" aria-label="Family Size" aria-describedby="reg-familySize-error"
                    onChange={e => { setRegistrationForm({ ...registrationForm, familySize: e.target.value }); regValidation.validateField('familySize', e.target.value); }}
                    onBlur={e => regValidation.validateField('familySize', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched.familySize && regValidation.errors.familySize ? 'border-red-500' : ''}`} />
                  <FieldError id="reg-familySize-error" error={regValidation.touched.familySize ? regValidation.errors.familySize : null} />
                </div>
              </div>
              {[
                { label: 'Special Needs (comma-separated)', field: 'specialNeeds' as const, placeholder: 'e.g., medical, mobility', required: false },
                { label: 'Possession Factors (comma-separated)', field: 'possessionFactors' as const, placeholder: 'e.g., phone_number, id_card', required: true },
                { label: 'Behavioral Factors (comma-separated)', field: 'behavioralFactors' as const, placeholder: 'e.g., signature_pattern', required: true },
                { label: 'Social Factors (comma-separated)', field: 'socialFactors' as const, placeholder: 'e.g., community_leader_vouch', required: true },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label className="block text-sm font-medium mb-1">{label}</label>
                  <input type="text" placeholder={placeholder} value={registrationForm[field]} aria-label={label} aria-describedby={`reg-${field}-error`}
                    onChange={e => { setRegistrationForm({ ...registrationForm, [field]: e.target.value }); regValidation.validateField(field, e.target.value); }}
                    onBlur={e => regValidation.validateField(field, e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${regValidation.touched[field] && regValidation.errors[field] ? 'border-red-500' : ''}`} />
                  <FieldError id={`reg-${field}-error`} error={regValidation.touched[field] ? regValidation.errors[field] : null} />
                </div>
              ))}
              <div className="flex gap-3">
                <LoadingButton type="submit" loading={submitting} loadingLabel="Registering…"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                  Register Beneficiary
                </LoadingButton>
                <button type="button" onClick={() => setShowRegistrationForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </section>

          {/* Verification Form */}
          <section id="verification-form" aria-label="Verify Beneficiary Identity" hidden={!showVerificationForm} className="bg-green-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Verify Beneficiary Identity</h2>
            <form onSubmit={handleVerification} className="space-y-4" aria-label="Verification form">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Beneficiary ID" value={verificationForm.beneficiaryId} aria-label="Beneficiary ID" aria-describedby="ver-beneficiaryId-error"
                    onChange={e => { setVerificationForm({ ...verificationForm, beneficiaryId: e.target.value }); verifyValidation.validateField('beneficiaryId', e.target.value); }}
                    onBlur={e => verifyValidation.validateField('beneficiaryId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${verifyValidation.touched.beneficiaryId && verifyValidation.errors.beneficiaryId ? 'border-red-500' : ''}`} />
                  <FieldError id="ver-beneficiaryId-error" error={verifyValidation.touched.beneficiaryId ? verifyValidation.errors.beneficiaryId : null} />
                </div>
                <div>
                  <input type="password" placeholder="Verifier Key" value={verificationForm.verifierKey} aria-label="Verifier Key" aria-describedby="ver-verifierKey-error"
                    onChange={e => { setVerificationForm({ ...verificationForm, verifierKey: e.target.value }); verifyValidation.validateField('verifierKey', e.target.value); }}
                    onBlur={e => verifyValidation.validateField('verifierKey', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${verifyValidation.touched.verifierKey && verifyValidation.errors.verifierKey ? 'border-red-500' : ''}`} />
                  <FieldError id="ver-verifierKey-error" error={verifyValidation.touched.verifierKey ? verifyValidation.errors.verifierKey : null} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Provided Factors (comma-separated)</label>
                <input type="text" placeholder="e.g., phone_number, signature_pattern" value={verificationForm.providedFactors} aria-label="Provided Factors" aria-describedby="ver-providedFactors-error"
                  onChange={e => { setVerificationForm({ ...verificationForm, providedFactors: e.target.value }); verifyValidation.validateField('providedFactors', e.target.value); }}
                  onBlur={e => verifyValidation.validateField('providedFactors', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${verifyValidation.touched.providedFactors && verifyValidation.errors.providedFactors ? 'border-red-500' : ''}`} />
                <FieldError id="ver-providedFactors-error" error={verifyValidation.touched.providedFactors ? verifyValidation.errors.providedFactors : null} />
              </div>
              <div className="flex gap-3">
                <LoadingButton type="submit" loading={submitting} loadingLabel="Verifying…"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                  Verify Identity
                </LoadingButton>
                <button type="button" onClick={() => setShowVerificationForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </section>

        {/* USSD Demo */}
        {ussdSession.sessionId && (
          <div className="bg-purple-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">USSD Session (Feature Phone)</h2>
            <p className="text-sm text-gray-600 mb-2">Phone: {ussdSession.phoneNumber} | Session: {ussdSession.sessionId}</p>
            <div className="bg-white p-4 rounded border mb-3" aria-live="polite" aria-label="USSD response">
              <p className="font-mono">{ussdSession.response}</p>
            </div>
            <input type="text" placeholder="Enter your choice" aria-label="USSD input"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleUSSDInput((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = '';
                }
              }}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
        )}

        {/* Recovery Codes */}
        {recoveryCodes.length > 0 && (
          <div className="bg-yellow-50 p-6 rounded-lg mb-6" role="alert">
            <h2 className="text-xl font-semibold mb-4 text-red-600">Important: Save Your Recovery Codes</h2>
            <div className="space-y-2">
              {recoveryCodes.map((code, i) => (
                <div key={i} className="bg-white p-3 rounded border font-mono text-sm">
                  Recovery Code {i + 1}: {code}
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mt-4">Store these codes safely. They restore access if you lose your device.</p>
            <button onClick={() => setRecoveryCodes([])} className="mt-3 text-sm text-gray-500 underline hover:text-gray-700">
              Dismiss
            </button>
          </div>
        )}

        {/* Beneficiaries List */}
        <section aria-label="Registered Beneficiaries">
          <h2 className="text-xl font-semibold mb-4">Registered Beneficiaries</h2>
          {listLoading ? (
            <SkeletonList count={3} />
          ) : listError ? (
            <ErrorState message={listError} onRetry={loadBeneficiaries} />
          ) : beneficiaries.length === 0 ? (
            <EmptyState title="No beneficiaries registered" description="Register a beneficiary to get started." icon="👤"
              action={
                <button onClick={() => setShowRegistrationForm(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  Register Beneficiary
                </button>
              } />
          ) : (
            <div className="grid gap-4" role="list" aria-label="Beneficiaries">
              {beneficiaries.map(b => (
                <div key={b.id} role="listitem" className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{b.name}</h3>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>ID:</strong> {b.id}</p>
                        <p><strong>Disaster:</strong> {b.disasterId}</p>
                        <p><strong>Location:</strong> {b.location}</p>
                        <p><strong>Family Size:</strong> {b.familySize}</p>
                        <p><strong>Registered:</strong> {formatDate(b.registrationDate)}</p>
                        {b.specialNeeds.length > 0 && <p><strong>Special Needs:</strong> {b.specialNeeds.join(', ')}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${getTrustScoreColor(b.trustScore)}`}>
                        Trust Score: {b.trustScore}/100
                      </div>
                      <span className={`mt-2 inline-block px-2 py-1 rounded text-xs ${b.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {b.isActive ? 'Active' : 'Inactive'}
                      </span>
                      <div className="mt-4 flex gap-2 justify-end">
                        <button onClick={() => setSelectedBeneficiary(b)}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400">
                          Details
                        </button>
                        <button onClick={() => beneficiaryClient.generateBeneficiaryQRCode(b.id, b)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400">
                          QR Code
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Beneficiary Details Modal */}
        {selectedBeneficiary && (
          <div role="dialog" aria-modal="true" aria-labelledby="beneficiary-modal-title"
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 id="beneficiary-modal-title" className="text-2xl font-bold mb-4">{selectedBeneficiary.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Personal Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <p><strong>ID:</strong> {selectedBeneficiary.id}</p>
                    <p><strong>Status:</strong> {selectedBeneficiary.isActive ? 'Active' : 'Inactive'}</p>
                    <p><strong>Trust Score:</strong> {selectedBeneficiary.trustScore}/100</p>
                    <p><strong>Family Size:</strong> {selectedBeneficiary.familySize}</p>
                    <p><strong>Wallet:</strong> {selectedBeneficiary.walletAddress}</p>
                    <p><strong>Location:</strong> {selectedBeneficiary.location}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Verification Factors</h3>
                  <div className="mt-2 space-y-2">
                    {selectedBeneficiary.verificationFactors.map((f, i) => (
                      <div key={i} className="bg-gray-50 p-2 rounded text-sm">
                        <p><strong>Type:</strong> {f.factorType}</p>
                        <p><strong>Weight:</strong> {f.weight}</p>
                        <p><strong>Verified:</strong> {formatDate(f.verifiedAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setSelectedBeneficiary(null)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
