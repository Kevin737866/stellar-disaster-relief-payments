import React, { useState, useEffect, useCallback } from 'react';
import { TransferClient, ConditionalTransfer, SpendingRule, NetworkConfig } from '../../sdk/src/types';
import {
  SkeletonList,
  StatusMessage,
  EmptyState,
  ErrorState,
  LoadingButton,
  PageLoadingOverlay,
} from './LoadingPrimitives';

interface TransferCardProps {
  transferClient: TransferClient;
  config: NetworkConfig;
  creatorKey: string;
}

export const TransferCard: React.FC<TransferCardProps> = ({ transferClient, config, creatorKey }) => {
  const [transfers, setTransfers] = useState<ConditionalTransfer[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<ConditionalTransfer | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);
  const openModalTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [createForm, setCreateForm] = useState({
    transferId: '', beneficiaryId: '', amount: '', token: 'XLM', expiresAt: '', purpose: '',
    rules: [
      { type: 'category_limit', category: 'food', limit: '500' },
      { type: 'category_limit', category: 'medical', limit: '300' },
      { type: 'time_window', startTime: '', endTime: '' },
      { type: 'location_based', location: '' },
    ],
  });

  const [spendForm, setSpendForm] = useState({
    transferId: '', beneficiaryKey: '', merchantId: '', amount: '', category: 'food', location: '',
  });

  const loadTransfers = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await transferClient.listBeneficiaryTransfers('sample_beneficiary_001');
      setTransfers(data);
    } catch {
      setListError('Failed to load transfers. Please try again.');
    } finally {
      setListLoading(false);
    }
  }, [transferClient]);

  useEffect(() => { loadTransfers(); }, [loadTransfers]);

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const spendingRules: SpendingRule[] = [];
      createForm.rules.forEach(rule => {
        if (rule.type === 'category_limit' && rule.category && rule.limit)
          spendingRules.push(transferClient.createCategoryLimitRule(rule.category, rule.limit));
        else if (rule.type === 'time_window' && rule.startTime && rule.endTime)
          spendingRules.push(transferClient.createTimeWindowRule(new Date(rule.startTime).getTime(), new Date(rule.endTime).getTime()));
        else if (rule.type === 'location_based' && rule.location)
          spendingRules.push(transferClient.createLocationRule(rule.location));
      });
      await transferClient.createTransfer(
        creatorKey, createForm.transferId, createForm.beneficiaryId, createForm.amount,
        createForm.token, new Date(createForm.expiresAt).getTime(), spendingRules, createForm.purpose
      );
      setShowCreateForm(false);
      setCreateForm({ transferId: '', beneficiaryId: '', amount: '', token: 'XLM', expiresAt: '', purpose: '', rules: createForm.rules });
      setSubmitStatus({ type: 'success', message: 'Conditional transfer created successfully.' });
      loadTransfers();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to create transfer. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSpend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const success = await transferClient.spend(
        spendForm.beneficiaryKey, spendForm.transferId, spendForm.merchantId,
        spendForm.amount, spendForm.category, spendForm.location
      );
      if (success) {
        setSubmitStatus({ type: 'success', message: 'Payment processed successfully.' });
        setShowSpendForm(false);
        setSpendForm({ transferId: '', beneficiaryKey: '', merchantId: '', amount: '', category: 'food', location: '' });
        loadTransfers();
      } else {
        setSubmitStatus({ type: 'error', message: 'Payment rejected by spending rules.' });
      }
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to process payment.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecallFunds = async (transferId: string) => {
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const result = await transferClient.recallFunds(creatorKey, transferId);
      setSubmitStatus({ type: 'success', message: result });
      loadTransfers();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to recall funds.' });
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (t: ConditionalTransfer) => {
    const now = Date.now();
    if (!t.isActive) return 'text-gray-600';
    if (now > t.expiresAt) return 'text-red-600';
    if (now > t.expiresAt - 7 * 24 * 60 * 60 * 1000) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusText = (t: ConditionalTransfer) => {
    const now = Date.now();
    if (!t.isActive) return 'Inactive';
    if (now > t.expiresAt) return 'Expired';
    if (now > t.expiresAt - 7 * 24 * 60 * 60 * 1000) return 'Expiring Soon';
    return 'Active';
  };

  const getUtilizationRate = (t: ConditionalTransfer) =>
    Number((BigInt(t.spentAmount) * BigInt(100)) / BigInt(t.amount));

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto p-6">
      {submitting && <PageLoadingOverlay message="Processing transaction…" />}

      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Conditional Cash Transfers</h1>
        <p className="text-gray-600 mb-6">Conditional cash transfers with spending rules and expiry management</p>

        {submitStatus && (
          <StatusMessage type={submitStatus.type} message={submitStatus.message}
            onDismiss={() => setSubmitStatus(null)} className="mb-4" />
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={() => setShowCreateForm(!showCreateForm)}
            aria-expanded={showCreateForm}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Create Transfer
          </button>
          <button onClick={() => setShowSpendForm(!showSpendForm)}
            aria-expanded={showSpendForm}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
            Process Payment
          </button>
          <button onClick={() => transferClient.cleanupExpiredTransfers()}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500">
            Cleanup Expired
          </button>
        </div>

          <div className="flex flex-wrap gap-4 mb-6">
            <button
              ref={openModalTriggerRef}
              onClick={() => setShowCreateForm(v => !v)}
              aria-expanded={showCreateForm}
              aria-controls="create-transfer-form"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {showCreateForm ? 'Hide Create Form' : 'Create Transfer'}
            </button>
            <button
              onClick={() => setShowSpendForm(v => !v)}
              aria-expanded={showSpendForm}
              aria-controls="spend-form"
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              {showSpendForm ? 'Hide Spend Form' : 'Process Payment'}
            </button>
            <button
              onClick={loadTransfers}
              disabled={loading}
              aria-disabled={loading}
              className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          {/* Create Transfer Form */}
          <section
            id="create-transfer-form"
            aria-label="Create Conditional Transfer"
            hidden={!showCreateForm}
            className="bg-blue-50 p-6 rounded-lg mb-6"
          >
            <h2 className="text-xl font-semibold mb-4">Create Conditional Transfer</h2>
            <form onSubmit={handleCreateTransfer} className="space-y-4" aria-label="Create transfer form">
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Transfer ID" value={createForm.transferId} required aria-label="Transfer ID"
                  onChange={e => setCreateForm({ ...createForm, transferId: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="text" placeholder="Beneficiary ID" value={createForm.beneficiaryId} required aria-label="Beneficiary ID"
                  onChange={e => setCreateForm({ ...createForm, beneficiaryId: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input type="number" placeholder="Amount" value={createForm.amount} required aria-label="Amount"
                  onChange={e => setCreateForm({ ...createForm, amount: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={createForm.token} aria-label="Token"
                  onChange={e => setCreateForm({ ...createForm, token: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                  <option value="EURT">EURT</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input type="datetime-local" value={createForm.expiresAt} required aria-label="Expiry Date"
                  onChange={e => setCreateForm({ ...createForm, expiresAt: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="text" placeholder="Purpose" value={createForm.purpose} required aria-label="Purpose"
                  onChange={e => setCreateForm({ ...createForm, purpose: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3">
                <LoadingButton type="submit" loading={submitting} loadingLabel="Creating…"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                  Create Transfer
                </LoadingButton>
                <button type="button" onClick={() => setShowCreateForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </section>

          {/* Spend Form */}
          <section
            id="spend-form"
            aria-label="Process Payment"
            hidden={!showSpendForm}
            className="bg-green-50 p-6 rounded-lg mb-6"
          >
            <h2 className="text-xl font-semibold mb-4">Process Payment</h2>
            <form onSubmit={handleSpend} className="space-y-4" aria-label="Process payment form">
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Transfer ID" value={spendForm.transferId} required aria-label="Transfer ID"
                  onChange={e => setSpendForm({ ...spendForm, transferId: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500" />
                <input type="password" placeholder="Beneficiary Key" value={spendForm.beneficiaryKey} required aria-label="Beneficiary Key"
                  onChange={e => setSpendForm({ ...spendForm, beneficiaryKey: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Merchant ID" value={spendForm.merchantId} required aria-label="Merchant ID"
                  onChange={e => setSpendForm({ ...spendForm, merchantId: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500" />
                <input type="number" placeholder="Amount" value={spendForm.amount} required aria-label="Amount"
                  onChange={e => setSpendForm({ ...spendForm, amount: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <select value={spendForm.category} aria-label="Category"
                  onChange={e => setSpendForm({ ...spendForm, category: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="food">Food</option>
                  <option value="medical">Medical</option>
                  <option value="shelter">Shelter</option>
                  <option value="clothing">Clothing</option>
                  <option value="transport">Transport</option>
                  <option value="other">Other</option>
                </select>
                <input type="text" placeholder="Location" value={spendForm.location} aria-label="Location"
                  onChange={e => setSpendForm({ ...spendForm, location: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="flex gap-3">
                <LoadingButton type="submit" loading={submitting} loadingLabel="Processing…"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                  Process Payment
                </LoadingButton>
                <button type="button" onClick={() => setShowSpendForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Transfers List */}
        <section aria-label="Active Transfers">
          <h2 className="text-xl font-semibold mb-4">Active Transfers</h2>
          {listLoading ? (
            <SkeletonList count={3} />
          ) : listError ? (
            <ErrorState message={listError} onRetry={loadTransfers} />
          ) : transfers.length === 0 ? (
            <EmptyState title="No active transfers" description="Create a conditional transfer to get started." icon="💳"
              action={
                <button onClick={() => setShowCreateForm(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  Create Transfer
                </button>
              } />
          ) : (
            <div className="grid gap-4" role="list" aria-label="Transfers">
              {transfers.map(transfer => (
                <div key={transfer.id} role="listitem" className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{transfer.id}</h3>
                      <p className="text-gray-600">{transfer.purpose}</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Beneficiary:</strong> {transfer.beneficiaryId}</p>
                        <p><strong>Token:</strong> {transfer.token}</p>
                        <p><strong>Created:</strong> {formatDate(transfer.createdAt)}</p>
                        <p><strong>Expires:</strong> {formatDate(transfer.expiresAt)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${getStatusColor(transfer)}`}>{getStatusText(transfer)}</div>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Total:</strong> {transfer.amount}</p>
                        <p><strong>Spent:</strong> {transfer.spentAmount}</p>
                        <p><strong>Remaining:</strong> {transfer.remainingAmount}</p>
                        <p><strong>Utilization:</strong> {getUtilizationRate(transfer)}%</p>
                      </div>
                      <div className="mt-4 flex gap-2 justify-end flex-wrap">
                        <button onClick={() => setSelectedTransfer(transfer)}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400">
                          Details
                        </button>
                        {Date.now() > transfer.expiresAt && (
                          <LoadingButton onClick={() => handleRecallFunds(transfer.id)} loading={submitting} loadingLabel="Recalling…"
                            className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400">
                            Recall
                          </LoadingButton>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Transfer Details Modal */}
        {selectedTransfer && (
          <div role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title"
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 id="transfer-modal-title" className="text-2xl font-bold mb-4">{selectedTransfer.id}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Transfer Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <p><strong>Beneficiary:</strong> {selectedTransfer.beneficiaryId}</p>
                    <p><strong>Status:</strong> {getStatusText(selectedTransfer)}</p>
                    <p><strong>Token:</strong> {selectedTransfer.token}</p>
                    <p><strong>Purpose:</strong> {selectedTransfer.purpose}</p>
                    <p><strong>Created:</strong> {formatDate(selectedTransfer.createdAt)}</p>
                    <p><strong>Expires:</strong> {formatDate(selectedTransfer.expiresAt)}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Financial Summary</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <p><strong>Total:</strong> {selectedTransfer.amount}</p>
                    <p><strong>Spent:</strong> {selectedTransfer.spentAmount}</p>
                    <p><strong>Remaining:</strong> {selectedTransfer.remainingAmount}</p>
                    <p><strong>Utilization:</strong> {getUtilizationRate(selectedTransfer)}%</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Spending Rules</h3>
                  <div className="mt-2 space-y-2">
                    {selectedTransfer.spendingRules.map((rule, i) => (
                      <div key={i} className="bg-gray-50 p-3 rounded text-sm">
                        <p><strong>Type:</strong> {rule.ruleType}</p>
                        <p><strong>Limit:</strong> {rule.limit}</p>
                        <p><strong>Usage:</strong> {rule.currentUsage}</p>
                      </div>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-label="Extend Expiry">
                <h3 className="font-semibold mb-2">Extend Expiry</h3>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    const input = (e.currentTarget.elements.namedItem('new-expiry') as HTMLInputElement).value;
                    if (input) handleExtendExpiry(selectedTransfer.id, input);
                  }}
                  className="flex gap-2"
                >
                  <div className="flex-1">
                    <label htmlFor="new-expiry" className="block text-sm font-medium text-gray-700 mb-1">New Expiry Date &amp; Time</label>
                    <input
                      id="new-expiry"
                      name="new-expiry"
                      type="datetime-local"
                      className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setSelectedTransfer(null)}
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
