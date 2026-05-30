import React, { useState, useEffect } from 'react';
import { BeneficiaryClient, BeneficiaryProfile, VerificationFactor, NetworkConfig } from '../../sdk/src/types';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorMessage, friendlyError } from './ErrorMessage';
import { useNotifications } from './NotificationSystem';

interface BeneficiaryRegistrationProps {
  beneficiaryClient: BeneficiaryClient;
  config: NetworkConfig;
  registrarKey: string;
}

export const BeneficiaryRegistration: React.FC<BeneficiaryRegistrationProps> = ({
  beneficiaryClient,
  config,
  registrarKey
}) => {
  const { notify } = useNotifications();
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [showVerificationForm, setShowVerificationForm] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<BeneficiaryProfile | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // Registration form state
  const [registrationForm, setRegistrationForm] = useState({
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
  const [verificationForm, setVerificationForm] = useState({
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

  useEffect(() => {
    loadBeneficiaries();
  }, []);

  const loadBeneficiaries = async () => {
    try {
      setLoading(true);
      setError(null);
      // Load beneficiaries for a sample disaster
      const beneficiaries = await beneficiaryClient.listBeneficiariesByDisaster('sample_disaster_001');
      setBeneficiaries(beneficiaries);
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
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
      loadBeneficiaries();
      notify({ type: 'success', title: 'Beneficiary registered', message: 'Save the recovery codes shown below.' });
    } catch (error) {
      console.error('Failed to register beneficiary:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
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
        notify({ type: 'success', title: 'Identity verified', message: `Beneficiary ${verificationForm.beneficiaryId} has been verified.` });
      } else {
        setError('Verification failed. The provided factors did not match. Please check and try again.');
      }

      setShowVerificationForm(false);
      setVerificationForm({
        beneficiaryId: '',
        verifierKey: '',
        providedFactors: ''
      });
      loadBeneficiaries();
    } catch (error) {
      console.error('Failed to verify beneficiary:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreAccess = async (beneficiaryId: string, recoveryCode: string) => {
    try {
      const newWalletAddress = prompt('Enter new wallet address:');
      if (!newWalletAddress) return;

      const restored = await beneficiaryClient.restoreAccess(beneficiaryId, recoveryCode, newWalletAddress);
      
      if (restored) {
        notify({ type: 'success', title: 'Access restored', message: 'The wallet address has been updated.' });
        loadBeneficiaries();
      } else {
        setError('Failed to restore access. Check the recovery code and try again.');
      }
    } catch (error) {
      console.error('Failed to restore access:', error);
      setError(friendlyError(error));
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
      alert('USSD registration completed!');
      setUssdSession({
        sessionId: '',
        phoneNumber: '',
        currentStep: 'welcome',
        response: ''
      });
    }
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Beneficiary Registration</h1>
        <p className="text-gray-600 mb-6">
          Biometric-free identity management for displaced persons
        </p>

        <div className="flex space-x-4 mb-6">
          <button
            onClick={() => setShowRegistrationForm(!showRegistrationForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Register Beneficiary
          </button>
          <button
            onClick={() => setShowVerificationForm(!showVerificationForm)}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Verify Identity
          </button>
          <button
            onClick={() => handleUSSDSession('+1234567890')}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
          >
            USSD Demo
          </button>
        </div>

        <ErrorMessage error={error} onDismiss={() => setError(null)} className="mb-4" />

        {/* Registration Form */}
        {showRegistrationForm && (
          <div className="bg-blue-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Register New Beneficiary</h2>
            <form onSubmit={handleRegistration} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Beneficiary ID"
                  value={registrationForm.beneficiaryId}
                  onChange={(e) => setRegistrationForm({...registrationForm, beneficiaryId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={registrationForm.name}
                  onChange={(e) => setRegistrationForm({...registrationForm, name: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Disaster ID"
                  value={registrationForm.disasterId}
                  onChange={(e) => setRegistrationForm({...registrationForm, disasterId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Location"
                  value={registrationForm.location}
                  onChange={(e) => setRegistrationForm({...registrationForm, location: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Wallet Address"
                  value={registrationForm.walletAddress}
                  onChange={(e) => setRegistrationForm({...registrationForm, walletAddress: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="number"
                  placeholder="Family Size"
                  value={registrationForm.familySize}
                  onChange={(e) => setRegistrationForm({...registrationForm, familySize: e.target.value})}
                  className="px-3 py-2 border rounded"
                  min="1"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Special Needs (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g., medical, mobility, dietary"
                  value={registrationForm.specialNeeds}
                  onChange={(e) => setRegistrationForm({...registrationForm, specialNeeds: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Possession Factors (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g., phone_number, id_card, family_photo"
                  value={registrationForm.possessionFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, possessionFactors: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Behavioral Factors (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g., signature_pattern, voice_sample, handwriting"
                  value={registrationForm.behavioralFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, behavioralFactors: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Social Factors (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g., community_leader_vouch, neighbor_confirmation, local_organization"
                  value={registrationForm.socialFactors}
                  onChange={(e) => setRegistrationForm({...registrationForm, socialFactors: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="flex space-x-4">
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
            <form onSubmit={handleVerification} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Beneficiary ID"
                  value={verificationForm.beneficiaryId}
                  onChange={(e) => setVerificationForm({...verificationForm, beneficiaryId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="password"
                  placeholder="Verifier Key"
                  value={verificationForm.verifierKey}
                  onChange={(e) => setVerificationForm({...verificationForm, verifierKey: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Provided Factors (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g., phone_number, signature_pattern, community_vouch"
                  value={verificationForm.providedFactors}
                  onChange={(e) => setVerificationForm({...verificationForm, providedFactors: e.target.value})}
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="flex space-x-4">
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
              
              <div className="bg-white p-4 rounded border">
                <p className="font-mono">{ussdSession.response}</p>
              </div>
              
              <input
                type="text"
                placeholder="Enter your choice"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleUSSDInput((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
                className="w-full px-3 py-2 border rounded"
              />
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
            <div className="text-center py-4">Loading...</div>
          ) : beneficiaries.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No beneficiaries found</div>
          ) : (
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
                      <div className={`font-semibold ${getTrustScoreColor(beneficiary.trustScore)}`}>
                        Trust Score: {beneficiary.trustScore}/100
                      </div>
                      <div className="mt-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          beneficiary.isActive 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {beneficiary.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          onClick={() => setSelectedBeneficiary(beneficiary)}
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
          )}
        </div>

        {/* Beneficiary Details Modal */}
        {selectedBeneficiary && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">{selectedBeneficiary.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Personal Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
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
                  onClick={() => setSelectedBeneficiary(null)}
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
