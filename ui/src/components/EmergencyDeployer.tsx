import React, { useState, useEffect } from 'react';
import { AidClient, EmergencyFund, NetworkConfig } from '../../sdk/src/types';
import { parseAmount, formatAmount as formatBigAmount } from '../format/amounts';
import { parseExpiryInput } from '../validation/expiry';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorMessage, friendlyError } from './ErrorMessage';
import { useNotifications } from './NotificationSystem';

interface EmergencyDeployerProps {
  aidClient: AidClient;
  config: NetworkConfig;
  adminKey: string;
}

/** A fund QR payload held open in the modal. */
interface FundQrPayload {
  fundId: string;
  fundName: string;
  payload: string;
}

export const EmergencyDeployer: React.FC<EmergencyDeployerProps> = ({
  aidClient,
  config,
  adminKey
}) => {
  const { notify } = useNotifications();
  const [funds, setFunds] = useState<EmergencyFund[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRapidForm, setShowRapidForm] = useState(false);
  const [selectedFund, setSelectedFund] = useState<EmergencyFund | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [qrPayload, setQrPayload] = useState<FundQrPayload | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);

  // Form states
  const [fundForm, setFundForm] = useState<FundFields>({
    fundId: '',
    name: '',
    description: '',
    totalAmount: '',
    disasterType: '',
    geographicScope: '',
    expiresAt: '',
    requiredSignatures: '1'
  });

  const [rapidForm, setRapidForm] = useState<RapidFormState>({
    disasterId: '',
    disasterType: '',
    affectedArea: '',
    totalBudget: '',
    categories: [
      { name: 'Food', percentage: 40, description: 'Emergency food supplies' },
      { name: 'Medical', percentage: 30, description: 'Medical supplies and care' },
      { name: 'Shelter', percentage: 20, description: 'Emergency shelter materials' },
      { name: 'Water', percentage: 10, description: 'Clean water and sanitation' }
    ]
  });

  const fundValidation = useFormValidation<FundFields>(fundRules);
  const rapidValidation = useFormValidation<RapidFields>(rapidRules);

  const fundError = (field: keyof FundFields) =>
    fundValidation.touched[field] ? fundValidation.errors[field] : undefined;

  const rapidError = (field: keyof RapidFields) =>
    rapidValidation.touched[field] ? rapidValidation.errors[field] : undefined;

  useEffect(() => {
    loadActiveFunds();
  }, []);

  useEffect(() => {
    if (!selectedFund) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedFund(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFund]);

  const loadActiveFunds = async () => {
    try {
      setLoading(true);
      const activeFunds = await aidClient.listActiveFunds();
      setFunds(activeFunds);
    } catch (error) {
      console.error('Failed to load funds:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();

    // #200 — validate the expiry before anything is submitted. Previously this
    // was `new Date(...).getTime()` with no guards, so a malformed entry
    // produced NaN and still reached the contract.
    const expiry = parseExpiryInput(fundForm.expiresAt);
    if (!expiry.ok) {
      setExpiryError(expiry.reason);
      notify({ type: 'error', title: 'Cannot create fund', message: expiry.reason });
      return;
    }
    setExpiryError(null);

    try {
      setLoading(true);
      await aidClient.deployEmergencyFund(
        adminKey,
        fundForm.fundId,
        fundForm.name,
        fundForm.description,
        fundForm.totalAmount,
        fundForm.disasterType,
        fundForm.geographicScope,
        expiry.timestamp,
        [adminKey], // Simplified - would use multi-sig in production
        parseInt(fundForm.requiredSignatures)
      );

      setShowCreateForm(false);
      setFundForm({
        fundId: '',
        name: '',
        description: '',
        totalAmount: '',
        disasterType: '',
        geographicScope: '',
        expiresAt: '',
        requiredSignatures: '1'
      });
      fundValidation.reset();
      loadActiveFunds();
      setStatus(`Emergency fund "${fundForm.name}" created and active.`);
      notify({ type: 'success', title: 'Emergency fund created', message: `Fund "${fundForm.name}" is now active.` });
    } catch (error) {
      console.error('Failed to create fund:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRapidDeployment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!rapidValidation.validateAll(rapidForm)) {
      return;
    }

    try {
      setLoading(true);
      const fundIds = await aidClient.deployRapidResponse(
        adminKey,
        rapidForm.disasterId,
        rapidForm.disasterType,
        rapidForm.affectedArea,
        rapidForm.totalBudget,
        rapidForm.categories
      );
      
      setShowRapidForm(false);
      setRapidForm({
        disasterId: '',
        disasterType: '',
        affectedArea: '',
        totalBudget: '',
        categories: rapidForm.categories
      });
      rapidValidation.reset();
      loadActiveFunds();
      setStatus(`Created ${fundIds.length} emergency funds for rapid response.`);
      notify({
        type: 'success',
        title: 'Rapid response deployed',
        message: `${fundIds.length} emergency funds are now active.`,
      });
    } catch (error) {
      console.error('Failed to deploy rapid response:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleMonitorFund = async (fundId: string) => {
    try {
      const fund = await aidClient.getFund(fundId);
      if (fund) {
        setSelectedFund(fund);
      }
    } catch (error) {
      setError(friendlyError(error));
    }
  };

  const handleCleanupExpired = async () => {
    setError(null);
    setStatus(null);
    try {
      setLoading(true);
      await aidClient.cleanupExpiredFunds(adminKey);
      loadActiveFunds();
      setStatus('Expired funds cleaned up successfully.');
      notify({
        type: 'success',
        title: 'Cleanup complete',
        message: 'Expired emergency funds were removed.',
      });
    } catch (error) {
      console.error('Failed to cleanup expired funds:', error);
      setError(friendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  /**
   * #201 — this button previously called `aidClient.generateFundQRCode(...)`
   * inside the click handler and discarded the return value, so the button
   * looked like it did something and produced no visible output at all.
   *
   * The returned payload is now held in state and shown in a modal, and can
   * be copied or downloaded. Failures are surfaced rather than swallowed.
   */
  const handleGenerateQrCode = (fund: EmergencyFund) => {
    try {
      const payload = aidClient.generateFundQRCode(fund.id, fund);

      if (typeof payload !== 'string' || payload === '') {
        throw new Error('QR payload was empty');
      }

      setQrPayload({ fundId: fund.id, fundName: fund.name, payload });
      notify({
        type: 'success',
        title: 'QR code ready',
        message: `Offline payload generated for "${fund.name}".`,
      });
    } catch (err) {
      const message = friendlyError(err);
      setError(message);
      notify({ type: 'error', title: 'Could not generate QR code', message });
    }
  };

  const handleCopyQrPayload = async () => {
    if (!qrPayload) return;

    try {
      await navigator.clipboard.writeText(qrPayload.payload);
      notify({ type: 'success', title: 'Copied', message: 'QR payload copied to clipboard.' });
    } catch (err) {
      setError(friendlyError(err));
      notify({
        type: 'error',
        title: 'Clipboard unavailable',
        message: 'Copy the payload manually from the dialog.',
      });
    }
  };

  const handleDownloadQrPayload = () => {
    if (!qrPayload) return;

    try {
      // A Blob is used rather than a data: URL so the payload is not
      // round-tripped through a URL-encoded string.
      const blob = new Blob([qrPayload.payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${qrPayload.fundId}-qr.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // Release the object URL only after the click has been dispatched.
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(friendlyError(err));
      notify({ type: 'error', title: 'Download failed', message: friendlyError(err) });
    }
  };

  const formatAmount = (amount: string) => {
    // #203 — parseAmount, not parseInt: fund totals can exceed the safe
    // integer range and must not be rounded into a plausible wrong number.
    return formatBigAmount(parseAmount(amount), { compact: false });
  };

  const formatDate = (timestamp: number) => {
    return new Date(toMillis(timestamp)).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Emergency Fund Deployer</h1>
        <p className="text-gray-600 mb-6">
          Rapid deployment and monitoring of emergency relief funds
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Create Emergency Fund
          </button>
          <button
            type="button"
            onClick={() => setShowRapidForm(!showRapidForm)}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Rapid Disaster Response
          </button>
          <button
            type="button"
            onClick={() => setConfirmCleanup(true)}
            disabled={loading}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 disabled:opacity-60"
          >
            Cleanup Expired
          </button>
        </div>

        <ErrorMessage error={error} onDismiss={() => setError(null)} className="mb-4" />
        {status && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
          >
            {status}
          </div>
        )}

        <ConfirmDialog
          isOpen={confirmCleanup}
          title="Clean up expired funds?"
          message="This will permanently remove all expired emergency funds. This action cannot be undone."
          confirmLabel="Yes, clean up"
          variant="danger"
          onConfirm={() => {
            setConfirmCleanup(false);
            void handleCleanupExpired();
          }}
          onCancel={() => setConfirmCleanup(false)}
        />

        {/* Create Fund Form */}
        {showCreateForm && (
          <div className="bg-gray-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Create Emergency Fund</h2>
            <form onSubmit={handleCreateFund} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-id"
                  label="Fund ID"
                  required
                  error={fundError('fundId')}
                >
                  <input
                    id="fund-id"
                    name="fundId"
                    type="text"
                    value={fundForm.fundId}
                    onChange={(e) => setFundForm({...fundForm, fundId: e.target.value})}
                    onBlur={() => fundValidation.validateField('fundId', fundForm.fundId)}
                    aria-invalid={fundError('fundId') ? true : undefined}
                    aria-describedby={fundError('fundId') ? 'fund-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="fund-name"
                  label="Fund name"
                  required
                  error={fundError('name')}
                >
                  <input
                    id="fund-name"
                    name="name"
                    type="text"
                    value={fundForm.name}
                    onChange={(e) => setFundForm({...fundForm, name: e.target.value})}
                    onBlur={() => fundValidation.validateField('name', fundForm.name)}
                    aria-invalid={fundError('name') ? true : undefined}
                    aria-describedby={fundError('name') ? 'fund-name-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <FormField
                id="fund-description"
                label="Description"
                required
                error={fundError('description')}
              >
                <textarea
                  id="fund-description"
                  name="description"
                  value={fundForm.description}
                  onChange={(e) => setFundForm({...fundForm, description: e.target.value})}
                  onBlur={() => fundValidation.validateField('description', fundForm.description)}
                  aria-invalid={fundError('description') ? true : undefined}
                  aria-describedby={fundError('description') ? 'fund-description-error' : undefined}
                  className="w-full px-3 py-2 border rounded"
                  rows={3}
                  required
                />
              </FormField>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-total-amount"
                  label="Total amount"
                  required
                  error={fundError('totalAmount')}
                >
                  <input
                    id="fund-total-amount"
                    name="totalAmount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={fundForm.totalAmount}
                    onChange={(e) => setFundForm({...fundForm, totalAmount: e.target.value})}
                    onBlur={() => fundValidation.validateField('totalAmount', fundForm.totalAmount)}
                    aria-invalid={fundError('totalAmount') ? true : undefined}
                    aria-describedby={fundError('totalAmount') ? 'fund-total-amount-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="fund-disaster-type"
                  label="Disaster type"
                  required
                  error={fundError('disasterType')}
                >
                  <select
                    id="fund-disaster-type"
                    name="disasterType"
                    value={fundForm.disasterType}
                    onChange={(e) => setFundForm({...fundForm, disasterType: e.target.value})}
                    onBlur={() => fundValidation.validateField('disasterType', fundForm.disasterType)}
                    aria-invalid={fundError('disasterType') ? true : undefined}
                    aria-describedby={fundError('disasterType') ? 'fund-disaster-type-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  >
                    <option value="">Select disaster type</option>
                    <option value="earthquake">Earthquake</option>
                    <option value="flood">Flood</option>
                    <option value="hurricane">Hurricane</option>
                    <option value="wildfire">Wildfire</option>
                    <option value="drought">Drought</option>
                  </select>
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="fund-geographic-scope"
                  label="Geographic scope"
                  required
                />
                <div>
                  <input
                    type="datetime-local"
                    aria-label="Expiry"
                    aria-invalid={expiryError !== null}
                    aria-describedby={expiryError !== null ? 'expires-at-error' : undefined}
                    value={fundForm.expiresAt}
                    onChange={(e) => {
                      setFundForm({...fundForm, expiresAt: e.target.value});
                      setExpiryError(null);
                    }}
                    className={`w-full px-3 py-2 border rounded ${
                      expiryError !== null ? 'border-red-400' : ''
                    }`}
                    required
                  />
                  {/* #200 — feedback belongs next to the field that produced it. */}
                  {expiryError && (
                    <p id="expires-at-error" role="alert" className="mt-1 text-sm text-red-600">
                      {expiryError}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Creating...' : 'Create Fund'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rapid Response Form */}
        {showRapidForm && (
          <div className="bg-red-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Rapid Disaster Response</h2>
            <form onSubmit={handleRapidDeployment} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="rapid-disaster-id"
                  label="Disaster ID"
                  required
                  error={rapidError('disasterId')}
                >
                  <input
                    id="rapid-disaster-id"
                    name="disasterId"
                    type="text"
                    value={rapidForm.disasterId}
                    onChange={(e) => setRapidForm({...rapidForm, disasterId: e.target.value})}
                    onBlur={() => rapidValidation.validateField('disasterId', rapidForm.disasterId)}
                    aria-invalid={rapidError('disasterId') ? true : undefined}
                    aria-describedby={rapidError('disasterId') ? 'rapid-disaster-id-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="rapid-disaster-type"
                  label="Disaster type"
                  required
                  error={rapidError('disasterType')}
                >
                  <select
                    id="rapid-disaster-type"
                    name="disasterType"
                    value={rapidForm.disasterType}
                    onChange={(e) => setRapidForm({...rapidForm, disasterType: e.target.value})}
                    onBlur={() => rapidValidation.validateField('disasterType', rapidForm.disasterType)}
                    aria-invalid={rapidError('disasterType') ? true : undefined}
                    aria-describedby={rapidError('disasterType') ? 'rapid-disaster-type-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  >
                    <option value="">Select disaster type</option>
                    <option value="earthquake">Earthquake</option>
                    <option value="flood">Flood</option>
                    <option value="hurricane">Hurricane</option>
                    <option value="wildfire">Wildfire</option>
                    <option value="drought">Drought</option>
                  </select>
                </FormField>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  id="rapid-affected-area"
                  label="Affected area"
                  required
                  error={rapidError('affectedArea')}
                >
                  <input
                    id="rapid-affected-area"
                    name="affectedArea"
                    type="text"
                    value={rapidForm.affectedArea}
                    onChange={(e) => setRapidForm({...rapidForm, affectedArea: e.target.value})}
                    onBlur={() => rapidValidation.validateField('affectedArea', rapidForm.affectedArea)}
                    aria-invalid={rapidError('affectedArea') ? true : undefined}
                    aria-describedby={rapidError('affectedArea') ? 'rapid-affected-area-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
                <FormField
                  id="rapid-total-budget"
                  label="Total budget"
                  required
                  error={rapidError('totalBudget')}
                >
                  <input
                    id="rapid-total-budget"
                    name="totalBudget"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={rapidForm.totalBudget}
                    onChange={(e) => setRapidForm({...rapidForm, totalBudget: e.target.value})}
                    onBlur={() => rapidValidation.validateField('totalBudget', rapidForm.totalBudget)}
                    aria-invalid={rapidError('totalBudget') ? true : undefined}
                    aria-describedby={rapidError('totalBudget') ? 'rapid-total-budget-error' : undefined}
                    className="w-full px-3 py-2 border rounded"
                    required
                  />
                </FormField>
              </div>
              
              <div className="space-y-2">
                <h3 className="font-semibold">Fund categories</h3>
                <ul className="space-y-2" aria-label="Planned fund categories">
                  {rapidForm.categories.map((category, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="w-24">{category.name}</span>
                      <span className="w-20 font-medium">{category.percentage}%</span>
                      <span className="text-sm text-gray-600">{category.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                >
                  {loading ? 'Deploying...' : 'Deploy Rapid Response'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRapidForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Active Funds List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Emergency Funds</h2>
          
          {loading ? (
            <div className="text-center py-4">Loading...</div>
          ) : funds.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No active funds found</div>
          ) : (
            <div className="grid gap-4">
              {funds.map((fund) => {
                const fundStatus = getFundStatus(fund);
                return (
                <div key={fund.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{fund.name}</h3>
                      <p className="text-gray-600">{fund.description}</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>ID:</strong> {fund.id}</p>
                        <p><strong>Disaster:</strong> {fund.disasterType}</p>
                        <p><strong>Area:</strong> {fund.geographicScope}</p>
                        <p><strong>Created:</strong> {formatDate(fund.createdAt)}</p>
                        <p><strong>Expires:</strong> {formatDate(fund.expiresAt)}</p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className={`inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold ${fundStatus.badgeClassName}`}>
                        <span aria-hidden="true">{fundStatus.icon}</span>
                        Status: {fundStatus.label}
                      </div>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Total:</strong> {formatAmount(fund.totalAmount)}</p>
                        <p><strong>Released:</strong> {formatAmount(fund.releasedAmount)}</p>
                        <p><strong>Remaining:</strong> {formatAmount(
                          (parseAmount(fund.totalAmount) - parseAmount(fund.releasedAmount)).toString()
                        )}</p>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          type="button"
                          onClick={() => handleMonitorFund(fund.id)}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
                          Monitor
                        </button>
                        <button
                          onClick={() => handleGenerateQrCode(fund)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600"
                        >
                          QR Code
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Fund QR Modal — #201: the generated payload is now actually shown. */}
        {qrPayload && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-lg p-4 sm:p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-1">Fund QR Payload</h2>
              <p className="text-sm text-gray-600 mb-4">
                Offline access payload for <strong>{qrPayload.fundName}</strong> ({qrPayload.fundId}).
                Share or print this for offline verification.
              </p>

              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="qr-payload">
                Payload
              </label>
              <textarea
                id="qr-payload"
                readOnly
                value={qrPayload.payload}
                rows={10}
                className="w-full px-3 py-2 border rounded font-mono text-xs"
              />

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  onClick={handleCopyQrPayload}
                  className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 text-sm"
                >
                  Copy
                </button>
                <button
                  onClick={handleDownloadQrPayload}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
                >
                  Download
                </button>
                <button
                  onClick={() => setQrPayload(null)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fund Details Modal */}
        {selectedFund && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4">
            <div
              className="bg-white rounded-lg p-4 sm:p-6 max-w-2xl w-full max-h-screen overflow-y-auto"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fund-details-title"
            >
              <h2 id="fund-details-title" className="text-2xl font-bold mb-4">{selectedFund.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Fund Details</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <p><strong>ID:</strong> {selectedFund.id}</p>
                    <p><strong>Status:</strong> {getFundStatus(selectedFund).label}</p>
                    <p><strong>Total Amount:</strong> {formatAmount(selectedFund.totalAmount)}</p>
                    <p><strong>Released Amount:</strong> {formatAmount(selectedFund.releasedAmount)}</p>
                    <p><strong>Created:</strong> {formatDate(selectedFund.createdAt)}</p>
                    <p><strong>Expires:</strong> {formatDate(selectedFund.expiresAt)}</p>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Description</h3>
                  <p className="text-gray-600">{selectedFund.description}</p>
                </div>
                
                <div>
                  <h3 className="font-semibold">Disaster Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <p><strong>Type:</strong> {selectedFund.disasterType}</p>
                    <p><strong>Geographic Scope:</strong> {selectedFund.geographicScope}</p>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setSelectedFund(null)}
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
