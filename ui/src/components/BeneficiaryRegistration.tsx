import React, { useState, useEffect } from 'react';
import { BeneficiaryProfile, VerificationFactor, NetworkConfig } from '../../sdk/src/types';
import { BeneficiaryClient } from '../../sdk/src/beneficiaryClient';
import { useFocusTrap } from '../accessibility/useFocusTrap';

/** Default page size for the beneficiary list. */
const PAGE_SIZE = 20;

interface BeneficiaryRegistrationProps {
  beneficiaryClient: BeneficiaryClient;
  config: NetworkConfig;
  registrarKey: string;
}

/** Append `incoming` to `existing`, dropping items whose id is already present. */
function mergeUnique(
  existing: BeneficiaryProfile[],
  incoming: BeneficiaryProfile[]
): BeneficiaryProfile[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}

export const BeneficiaryRegistration: React.FC<BeneficiaryRegistrationProps> = ({
  beneficiaryClient,
  config,
  registrarKey
}) => {
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [showVerificationForm, setShowVerificationForm] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<BeneficiaryProfile | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string | null>(null);

  const closeDetails = () => setSelectedBeneficiary(null);
  const detailsModalRef = useFocusTrap<HTMLDivElement>(
    selectedBeneficiary !== null,
    closeDetails
  );

  // Registration form state
  const [registrationForm, setRegistrationForm] = useState<RegistrationFields>({
    beneficiaryId: '',
    name: '',
    disasterId: '',
    location: '',
    walletAddress: '',
    familySize: '1',
    specialNeeds: '',
    possessionFactors: '',
    behavioralFactors: '',
    socialFactors: ''
  });

  // Verification form state
  const [verificationForm, setVerificationForm] = useState<VerificationFields>({
    beneficiaryId: '',
    verifierKey: '',
    providedFactors: ''
  });

  // USSD session state
  const [ussdSession, setUssdSession] = useState({
    sessionId: '',
    phoneNumber: '',
    currentStep: 'welcome',
    response: ''
  });
  const [ussdInput, setUssdInput] = useState('');

  const registrationValidation = useFormValidation<RegistrationFields>(registrationRules);
  const verificationValidation = useFormValidation<VerificationFields>(verificationRules);

  const registrationError = (field: keyof RegistrationFields) =>
    registrationValidation.touched[field] ? registrationValidation.errors[field] : undefined;

  const verificationError = (field: keyof VerificationFields) =>
    verificationValidation.touched[field] ? verificationValidation.errors[field] : undefined;

  useEffect(() => {
    loadBeneficiaries();
  }, []);

  const loadBeneficiaries = async () => {
    try {
      setLoading(true);
      // Load the first page of beneficiaries for a sample disaster.
      const page = await beneficiaryClient.listBeneficiariesPaginated(
        'sample_disaster_001',
        { limit: PAGE_SIZE }
      );
      setBeneficiaries(page.items);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      console.error('Failed to load beneficiaries:', error);
      setBeneficiaries([]);
      setNextCursor(null);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreBeneficiaries = async () => {
    if (!nextCursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const page = await beneficiaryClient.listBeneficiariesPaginated(
        'sample_disaster_001',
        { cursor: nextCursor, limit: PAGE_SIZE }
      );
      setBeneficiaries((previous) => mergeUnique(previous, page.items));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (error) {
      console.error('Failed to load more beneficiaries:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormStatus(null);

    if (!registrationValidation.validateAll(registrationForm)) {
      return;
    }

    try {
      setLoading(true);
      
      // Create verification factors
      const verificationFactors = beneficiaryClient.createVerificationFactors(
        registrationForm.possessionFactors.split(',').map(f => f.trim()),
        registrationForm.behavioralFactors.split(',').map(f => f.trim()),
        registrationForm.socialFactors.split(',').map(f => f.trim())
      );

      await beneficiaryClient.registerBeneficiary(
        registrarKey,
        registrationForm.beneficiaryId,
        registrationForm.name,
        registrationForm.disasterId,
        registrationForm.location,
        registrationForm.walletAddress,
        parseInt(registrationForm.familySize),
        registrationForm.specialNeeds.split(',').map(f => f.trim()).filter(f => f),
        verificationFactors
      );

      // Generate recovery codes
      const codes = beneficiaryClient.generateRecoveryCodes(registrationForm.beneficiaryId);
      setRecoveryCodes(codes);

      setShowRegistrationForm(false);
      setRegistrationForm({
        beneficiaryId: '',
        name: '',
        disasterId: '',
        location: '',
        walletAddress: '',
        familySize: '1',
        specialNeeds: '',
        possessionFactors: '',
        behavioralFactors: '',
        socialFactors: ''
      });
      registrationValidation.reset();
      loadBeneficiaries();
      setFormStatus('Beneficiary registered successfully. Save the recovery codes below.');
    } catch (error) {
      console.error('Failed to register beneficiary:', error);
      setFormError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormStatus(null);

    if (!verificationValidation.validateAll(verificationForm)) {
      return;
    }

    try {
      setLoading(true);
      
      const providedFactors: VerificationFactor[] = verificationForm.providedFactors
        .split(',')
        .map(f => ({
          factorType: 'possession', // Simplified
          value: f.trim(),
          weight: 50,
          verifiedAt: Date.now()
        }));

      const verified = await beneficiaryClient.verifyBeneficiary(
        verificationForm.verifierKey,
        verificationForm.beneficiaryId,
        providedFactors
      );

      if (verified) {
        setFormStatus('Beneficiary verified successfully.');
      } else {
        setFormError('Verification failed. Please check the provided factors.');
      }

      setShowVerificationForm(false);
      setVerificationForm({
        beneficiaryId: '',
        verifierKey: '',
        providedFactors: ''
      });
      verificationValidation.reset();
      loadBeneficiaries();
    } catch (error) {
      console.error('Failed to verify beneficiary:', error);
      setFormError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreAccess = async (beneficiaryId: string, recoveryCode: string) => {
    setFormError(null);
    setFormStatus(null);
    try {
      const newWalletAddress = prompt('Enter new wallet address:');
      if (!newWalletAddress) return;

      const restored = await beneficiaryClient.restoreAccess(beneficiaryId, recoveryCode, newWalletAddress);
      
      if (restored) {
        setFormStatus('Access restored successfully.');
        loadBeneficiaries();
      } else {
        setFormError('Failed to restore access. Check the recovery code.');
      }
    } catch (error) {
      console.error('Failed to restore access:', error);
      setFormError(friendlyError(error));
    }
  };

  const handleUSSDSession = (phoneNumber: string) => {
    const session = beneficiaryClient.createUSSDSession(phoneNumber);
    setUssdSession({
      sessionId: session.sessionId,
      phoneNumber,
      currentStep: 'welcome',
      response: session.welcomeMessage
    });
  };

  const handleUSSDInput = (input: string) => {
    const result = beneficiaryClient.processUSSDInput(
      ussdSession.sessionId,
      input,
      ussdSession.currentStep
    );
    
    setUssdSession({
      ...ussdSession,
      currentStep: result.nextStep,
      response: result.response
    });

    if (result.completed) {
      setFormStatus('USSD registration completed.');
      setUssdSession({
        sessionId: '',
        phoneNumber: '',
        currentStep: 'welcome',
        response: ''
      });
    }
  };

  const submitUssdInput = () => {
    const value = ussdInput.trim();
    if (!value) return;
    handleUSSDInput(value);
    setUssdInput('');
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Beneficiary Registration</h1>
        <p className="text-gray-600 mb-6">
          Biometric-free identity management for displaced persons
        </p>

        <ErrorMessage error={formError} onDismiss={() => setFormError(null)} className="mb-4" />
        {formStatus && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          >
            {formStatus}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setShowRegistrationForm(!showRegistrationForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Register Beneficiary
          </button>
          <button
            type="button"
            onClick={() => setShowVerificationForm(!showVerificationForm)}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Verify Identity
          </button>
          <button
            type="button"
            onClick={() => handleUSSDSession('+1234567890')}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          >
            USSD Demo
          </button>
        </div>

        {/* Registration Form */}
        {showRegistrationForm && (
          <div className="bg-blue-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Register New Beneficiary</h2>
            <form onSubmit={handleRegistration} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="reg-beneficiary-id"
                  label="Beneficiary ID"
                  required
                  error={registrationError('beneficiaryId')}
                >
                  <input
                    id="reg-beneficiary-id"
                    name="beneficiaryId"
                    type="text"
                    value={registrationForm.beneficiaryId}
                    onChange={(e) => setRegistrationForm({...registrationForm, beneficiaryId: e.target.value})}
                    onBlur={() => registrationValidation.validateField('beneficiaryId', registrationForm.beneficiaryId)}
                    aria-invalid={registrationError('beneficiaryId') ? true : undefined}
                    aria-describedby={registrationError('beneficiaryId') ? 'reg-beneficiary-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="reg-name"
                  label="Full name"
                  required
                  error={registrationError('name')}
                >
                  <input
                    id="reg-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={registrationForm.name}
                    onChange={(e) => setRegistrationForm({...registrationForm, name: e.target.value})}
                    onBlur={() => registrationValidation.validateField('name', registrationForm.name)}
                    aria-invalid={registrationError('name') ? true : undefined}
                    aria-describedby={registrationError('name') ? 'reg-name-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="reg-disaster-id"
                  label="Disaster ID"
                  required
                  error={registrationError('disasterId')}
                >
                  <input
                    id="reg-disaster-id"
                    name="disasterId"
                    type="text"
                    value={registrationForm.disasterId}
                    onChange={(e) => setRegistrationForm({...registrationForm, disasterId: e.target.value})}
                    onBlur={() => registrationValidation.validateField('disasterId', registrationForm.disasterId)}
                    aria-invalid={registrationError('disasterId') ? true : undefined}
                    aria-describedby={registrationError('disasterId') ? 'reg-disaster-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="reg-location"
                  label="Location"
                  required
                  error={registrationError('location')}
                >
                  <input
                    id="reg-location"
                    name="location"
                    type="text"
                    value={registrationForm.location}
                    onChange={(e) => setRegistrationForm({...registrationForm, location: e.target.value})}
                    onBlur={() => registrationValidation.validateField('location', registrationForm.location)}
                    aria-invalid={registrationError('location') ? true : undefined}
                    aria-describedby={registrationError('location') ? 'reg-location-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="reg-wallet-address"
                  label="Wallet address"
                  required
                  error={registrationError('walletAddress')}
                >
                  <input
                    id="reg-wallet-address"
                    name="walletAddress"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={registrationForm.walletAddress}
                    onChange={(e) => setRegistrationForm({...registrationForm, walletAddress: e.target.value})}
                    onBlur={() => registrationValidation.validateField('walletAddress', registrationForm.walletAddress)}
                    aria-invalid={registrationError('walletAddress') ? true : undefined}
                    aria-describedby={registrationError('walletAddress') ? 'reg-wallet-address-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="reg-family-size"
                  label="Family size"
                  required
                  error={registrationError('familySize')}
                >
                  <input
                    id="reg-family-size"
                    name="familySize"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={registrationForm.familySize}
                    onChange={(e) => setRegistrationForm({...registrationForm, familySize: e.target.value})}
                    onBlur={() => registrationValidation.validateField('familySize', registrationForm.familySize)}
                    aria-invalid={registrationError('familySize') ? true : undefined}
                    aria-describedby={registrationError('familySize') ? 'reg-family-size-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <FormField
                id="reg-special-needs"
                label="Special needs (comma-separated)"
                error={registrationError('specialNeeds')}
              >
                <input
                  id="reg-special-needs"
                  name="specialNeeds"
                  type="text"
                  placeholder="e.g., medical, mobility, dietary"
                  value={registrationForm.specialNeeds}
                  onChange={(e) => setRegistrationForm({...registrationForm, specialNeeds: e.target.value})}
                  onBlur={() => registrationValidation.validateField('specialNeeds', registrationForm.specialNeeds)}
                  aria-invalid={registrationError('specialNeeds') ? true : undefined}
                  aria-describedby={registrationError('specialNeeds') ? 'reg-special-needs-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                />
              </FormField>
              
              <FormField
                id="reg-possession-factors"
                label="Possession factors (comma-separated)"
                required
                error={registrationError('possessionFactors')}
              >
                <input
                  id="reg-possession-factors"
                  name="possessionFactors"
                  type="text"
                  placeholder="e.g., phone_number, id_card, family_photo"
                  value={registrationForm.possessionFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, possessionFactors: e.target.value})}
                  onBlur={() => registrationValidation.validateField('possessionFactors', registrationForm.possessionFactors)}
                  aria-invalid={registrationError('possessionFactors') ? true : undefined}
                  aria-describedby={registrationError('possessionFactors') ? 'reg-possession-factors-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </FormField>
              
              <FormField
                id="reg-behavioral-factors"
                label="Behavioral factors (comma-separated)"
                required
                error={registrationError('behavioralFactors')}
              >
                <input
                  id="reg-behavioral-factors"
                  name="behavioralFactors"
                  type="text"
                  placeholder="e.g., signature_pattern, voice_sample, handwriting"
                  value={registrationForm.behavioralFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, behavioralFactors: e.target.value})}
                  onBlur={() => registrationValidation.validateField('behavioralFactors', registrationForm.behavioralFactors)}
                  aria-invalid={registrationError('behavioralFactors') ? true : undefined}
                  aria-describedby={registrationError('behavioralFactors') ? 'reg-behavioral-factors-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </FormField>
              
              <FormField
                id="reg-social-factors"
                label="Social factors (comma-separated)"
                required
                error={registrationError('socialFactors')}
              >
                <input
                  id="reg-social-factors"
                  name="socialFactors"
                  type="text"
                  placeholder="e.g., community_leader_vouch, neighbor_confirmation, local_organization"
                  value={registrationForm.socialFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, socialFactors: e.target.value})}
                  onBlur={() => registrationValidation.validateField('socialFactors', registrationForm.socialFactors)}
                  aria-invalid={registrationError('socialFactors') ? true : undefined}
                  aria-describedby={registrationError('socialFactors') ? 'reg-social-factors-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </FormField>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Registering...' : 'Register Beneficiary'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegistrationForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Verification Form */}
        {showVerificationForm && (
          <div className="bg-green-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Verify Beneficiary Identity</h2>
            <form onSubmit={handleVerification} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="verify-beneficiary-id"
                  label="Beneficiary ID"
                  required
                  error={verificationError('beneficiaryId')}
                >
                  <input
                    id="verify-beneficiary-id"
                    name="beneficiaryId"
                    type="text"
                    value={verificationForm.beneficiaryId}
                    onChange={(e) => setVerificationForm({...verificationForm, beneficiaryId: e.target.value})}
                    onBlur={() => verificationValidation.validateField('beneficiaryId', verificationForm.beneficiaryId)}
                    aria-invalid={verificationError('beneficiaryId') ? true : undefined}
                    aria-describedby={verificationError('beneficiaryId') ? 'verify-beneficiary-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="verify-verifier-key"
                  label="Verifier key"
                  required
                  error={verificationError('verifierKey')}
                >
                  <input
                    id="verify-verifier-key"
                    name="verifierKey"
                    type="password"
                    autoComplete="off"
                    value={verificationForm.verifierKey}
                    onChange={(e) => setVerificationForm({...verificationForm, verifierKey: e.target.value})}
                    onBlur={() => verificationValidation.validateField('verifierKey', verificationForm.verifierKey)}
                    aria-invalid={verificationError('verifierKey') ? true : undefined}
                    aria-describedby={verificationError('verifierKey') ? 'verify-verifier-key-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <FormField
                id="verify-provided-factors"
                label="Provided factors (comma-separated)"
                required
                error={verificationError('providedFactors')}
              >
                <input
                  id="verify-provided-factors"
                  name="providedFactors"
                  type="text"
                  placeholder="e.g., phone_number, signature_pattern, community_vouch"
                  value={verificationForm.providedFactors}
                  onChange={(e) => setVerificationForm({...verificationForm, providedFactors: e.target.value})}
                  onBlur={() => verificationValidation.validateField('providedFactors', verificationForm.providedFactors)}
                  aria-invalid={verificationError('providedFactors') ? true : undefined}
                  aria-describedby={verificationError('providedFactors') ? 'verify-provided-factors-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </FormField>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Verifying...' : 'Verify Identity'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowVerificationForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* USSD Demo */}
        {ussdSession.sessionId && (
          <div className="bg-purple-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">USSD Session (Feature Phone)</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Phone: {ussdSession.phoneNumber}</p>
                <p className="text-sm text-gray-600">Session: {ussdSession.sessionId}</p>
              </div>
              
              <div
                className="bg-white p-4 rounded border"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <p className="font-mono whitespace-pre-line">{ussdSession.response}</p>
              </div>
              
              <div>
                <label htmlFor="ussd-choice" className="block text-sm font-medium mb-1">
                  USSD response
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="ussd-choice"
                    name="ussdChoice"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    placeholder="Enter your choice"
                    value={ussdInput}
                    onChange={(e) => setUssdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitUssdInput();
                      }
                    }}
                    aria-describedby="ussd-choice-help"
                    className="w-full px-3 py-2 border rounded"
                  />
                  <button
                    type="button"
                    onClick={submitUssdInput}
                    className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
                  >
                    Send
                  </button>
                </div>
                <p id="ussd-choice-help" className="mt-1 text-xs text-gray-500">
                  Type a menu number or response, then press Enter or choose Send.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recovery Codes Display */}
        {recoveryCodes.length > 0 && (
          <div className="bg-yellow-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4 text-red-600">Important: Save Your Recovery Codes</h2>
            <div className="space-y-2">
              {recoveryCodes.map((code, index) => (
                <div key={index} className="bg-white p-3 rounded border font-mono text-sm">
                  Recovery Code {index + 1}: {code}
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mt-4">
              Store these codes safely. They can be used to restore access to your account if you lose your device.
            </p>
          </div>
        )}

        {/* Beneficiaries List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Registered Beneficiaries</h2>
          
          {loading ? (
            <div className="text-center py-4">Loading beneficiaries...</div>
          ) : beneficiaries.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No beneficiaries found</div>
          ) : (
            <>
            <div className="grid gap-4">
              {beneficiaries.map((beneficiary) => (
                <div key={beneficiary.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{beneficiary.name}</h3>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>ID:</strong> {beneficiary.id}</p>
                        <p><strong>Disaster:</strong> {beneficiary.disasterId}</p>
                        <p><strong>Location:</strong> {beneficiary.location}</p>
                        <p><strong>Family Size:</strong> {beneficiary.familySize}</p>
                        <p><strong>Registered:</strong> {formatDate(beneficiary.registrationDate)}</p>
                        <p><strong>Last Verified:</strong> {formatDate(beneficiary.lastVerified)}</p>
                        {beneficiary.specialNeeds.length > 0 && (
                          <p><strong>Special Needs:</strong> {beneficiary.specialNeeds.join(', ')}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className={`font-semibold ${getTrustScoreStatus(beneficiary.trustScore).className}`}>
                        <span aria-hidden="true">{getTrustScoreStatus(beneficiary.trustScore).icon}</span>{' '}
                        Trust score: {beneficiary.trustScore}/100 ({getTrustScoreStatus(beneficiary.trustScore).label})
                      </div>
                      <div className="mt-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                            beneficiary.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          <span aria-hidden="true">{beneficiary.isActive ? '✓' : '✕'}</span>
                          Status: {beneficiary.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          onClick={() => setSelectedBeneficiary(beneficiary)}
                          aria-haspopup="dialog"
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => beneficiaryClient.generateBeneficiaryQRCode(beneficiary.id, beneficiary)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600"
                        >
                          QR Code
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMoreBeneficiaries}
                  disabled={loadingMore}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {loadingMore ? 'Loading more...' : 'Load More'}
                </button>
              ) : (
                <p className="text-sm text-gray-600">All beneficiaries loaded</p>
              )}
              <p className="text-sm text-gray-600">{beneficiaries.length} total</p>
            </div>
            </>
          )}
        </div>

        {/* Beneficiary Details Modal */}
        {selectedBeneficiary && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4"
            role="presentation"
          >
            <div
              ref={detailsModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="beneficiary-detail-title"
              aria-describedby="beneficiary-detail-description"
              tabIndex={-1}
              className="bg-white rounded-lg p-4 sm:p-6 max-w-2xl w-full max-h-screen overflow-y-auto"
            >
              <h2 id="beneficiary-detail-title" className="text-2xl font-bold mb-4">{selectedBeneficiary.name}</h2>
              <p id="beneficiary-detail-description" className="sr-only">
                Beneficiary details, verification factors, and recovery options.
              </p>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Personal Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    <p><strong>ID:</strong> {selectedBeneficiary.id}</p>
                    <p><strong>Status:</strong> {selectedBeneficiary.isActive ? 'Active' : 'Inactive'}</p>
                    <p>
                      <strong>Trust score:</strong> {selectedBeneficiary.trustScore}/100 (
                      {getTrustScoreStatus(selectedBeneficiary.trustScore).label})
                    </p>
                    <p><strong>Family Size:</strong> {selectedBeneficiary.familySize}</p>
                    <p><strong>Wallet:</strong> {selectedBeneficiary.walletAddress}</p>
                    <p><strong>Location:</strong> {selectedBeneficiary.location}</p>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Verification Factors</h3>
                  <div className="mt-2 space-y-2">
                    {selectedBeneficiary.verificationFactors.map((factor, index) => (
                      <div key={index} className="bg-gray-50 p-2 rounded">
                        <p><strong>Type:</strong> {factor.factorType}</p>
                        <p><strong>Weight:</strong> {factor.weight}</p>
                        <p><strong>Verified:</strong> {formatDate(factor.verifiedAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Recovery Options</h3>
                  <button
                    onClick={() => {
                      const code = prompt('Enter recovery code:');
                      if (code) {
                        handleRestoreAccess(selectedBeneficiary.id, code);
                      }
                    }}
                    className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                  >
                    Restore Access
                  </button>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  onClick={closeDetails}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
