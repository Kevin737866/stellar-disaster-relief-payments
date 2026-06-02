import React, { useState, useEffect } from 'react';
import { TransferClient, ConditionalTransfer, SpendingRule, NetworkConfig, TransferTransaction } from '../../sdk/src/types';
import { ExportButton, conditionalTransferFields, transferTransactionFields } from '../export';

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
  const [transactions, setTransactions] = useState<TransferTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);

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

  const createValidation = useFormValidation<typeof createForm>({
    transferId: compose(required('Transfer ID'), identifier('Transfer ID')),
    beneficiaryId: compose(required('Beneficiary ID'), identifier('Beneficiary ID')),
    amount: compose(required('Amount'), isPositiveNumber('Amount'), minValue(1, 'Amount')),
    token: compose(required('Token'), tokenType),
    expiresAt: compose(required('Expiry Date'), futureDate('Expiry Date')),
    purpose: compose(required('Purpose'), minLength(2, 'Purpose'), maxLength(200, 'Purpose')),
  });

  const spendValidation = useFormValidation<typeof spendForm>({
    transferId: compose(required('Transfer ID'), identifier('Transfer ID')),
    beneficiaryKey: required('Beneficiary Key'),
    merchantId: compose(required('Merchant ID'), identifier('Merchant ID')),
    amount: compose(required('Amount'), isPositiveNumber('Amount'), minValue(1, 'Amount')),
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

  const loadTransferTransactions = async (transferId: string) => {
    setTransactionsLoading(true);
    setTransactionsError(null);
    try {
      const txns = await transferClient.getTransactions(transferId);
      setTransactions(txns);
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setTransactionsError('Failed to load transaction history. Please try again.');
      setTransactions([]);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createValidation.validateAll(createForm as Record<keyof typeof createForm, string>)) return;
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
      createValidation.reset();
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
    if (!spendValidation.validateAll(spendForm as Record<keyof typeof spendForm, string>)) return;
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
        spendValidation.reset();
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
                <div>
                  <input type="text" placeholder="Transfer ID" value={createForm.transferId} aria-label="Transfer ID" aria-describedby="ct-transferId-error"
                    onChange={e => { setCreateForm({ ...createForm, transferId: e.target.value }); createValidation.validateField('transferId', e.target.value); }}
                    onBlur={e => createValidation.validateField('transferId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.transferId && createValidation.errors.transferId ? 'border-red-500' : ''}`} />
                  <FieldError id="ct-transferId-error" error={createValidation.touched.transferId ? createValidation.errors.transferId : null} />
                </div>
                <div>
                  <input type="text" placeholder="Beneficiary ID" value={createForm.beneficiaryId} aria-label="Beneficiary ID" aria-describedby="ct-beneficiaryId-error"
                    onChange={e => { setCreateForm({ ...createForm, beneficiaryId: e.target.value }); createValidation.validateField('beneficiaryId', e.target.value); }}
                    onBlur={e => createValidation.validateField('beneficiaryId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.beneficiaryId && createValidation.errors.beneficiaryId ? 'border-red-500' : ''}`} />
                  <FieldError id="ct-beneficiaryId-error" error={createValidation.touched.beneficiaryId ? createValidation.errors.beneficiaryId : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="number" placeholder="Amount" value={createForm.amount} aria-label="Amount" aria-describedby="ct-amount-error"
                    onChange={e => { setCreateForm({ ...createForm, amount: e.target.value }); createValidation.validateField('amount', e.target.value); }}
                    onBlur={e => createValidation.validateField('amount', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.amount && createValidation.errors.amount ? 'border-red-500' : ''}`} />
                  <FieldError id="ct-amount-error" error={createValidation.touched.amount ? createValidation.errors.amount : null} />
                </div>
                <div>
                  <select value={createForm.token} aria-label="Token" aria-describedby="ct-token-error"
                    onChange={e => { setCreateForm({ ...createForm, token: e.target.value }); createValidation.validateField('token', e.target.value); }}
                    onBlur={e => createValidation.validateField('token', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.token && createValidation.errors.token ? 'border-red-500' : ''}`}>
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                    <option value="EURT">EURT</option>
                  </select>
                  <FieldError id="ct-token-error" error={createValidation.touched.token ? createValidation.errors.token : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="datetime-local" value={createForm.expiresAt} aria-label="Expiry Date" aria-describedby="ct-expiresAt-error"
                    onChange={e => { setCreateForm({ ...createForm, expiresAt: e.target.value }); createValidation.validateField('expiresAt', e.target.value); }}
                    onBlur={e => createValidation.validateField('expiresAt', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.expiresAt && createValidation.errors.expiresAt ? 'border-red-500' : ''}`} />
                  <FieldError id="ct-expiresAt-error" error={createValidation.touched.expiresAt ? createValidation.errors.expiresAt : null} />
                </div>
                <div>
                  <input type="text" placeholder="Purpose" value={createForm.purpose} aria-label="Purpose" aria-describedby="ct-purpose-error"
                    onChange={e => { setCreateForm({ ...createForm, purpose: e.target.value }); createValidation.validateField('purpose', e.target.value); }}
                    onBlur={e => createValidation.validateField('purpose', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${createValidation.touched.purpose && createValidation.errors.purpose ? 'border-red-500' : ''}`} />
                  <FieldError id="ct-purpose-error" error={createValidation.touched.purpose ? createValidation.errors.purpose : null} />
                </div>
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
                <div>
                  <input type="text" placeholder="Transfer ID" value={spendForm.transferId} aria-label="Transfer ID" aria-describedby="sp-transferId-error"
                    onChange={e => { setSpendForm({ ...spendForm, transferId: e.target.value }); spendValidation.validateField('transferId', e.target.value); }}
                    onBlur={e => spendValidation.validateField('transferId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${spendValidation.touched.transferId && spendValidation.errors.transferId ? 'border-red-500' : ''}`} />
                  <FieldError id="sp-transferId-error" error={spendValidation.touched.transferId ? spendValidation.errors.transferId : null} />
                </div>
                <div>
                  <input type="password" placeholder="Beneficiary Key" value={spendForm.beneficiaryKey} aria-label="Beneficiary Key" aria-describedby="sp-beneficiaryKey-error"
                    onChange={e => { setSpendForm({ ...spendForm, beneficiaryKey: e.target.value }); spendValidation.validateField('beneficiaryKey', e.target.value); }}
                    onBlur={e => spendValidation.validateField('beneficiaryKey', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${spendValidation.touched.beneficiaryKey && spendValidation.errors.beneficiaryKey ? 'border-red-500' : ''}`} />
                  <FieldError id="sp-beneficiaryKey-error" error={spendValidation.touched.beneficiaryKey ? spendValidation.errors.beneficiaryKey : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Merchant ID" value={spendForm.merchantId} aria-label="Merchant ID" aria-describedby="sp-merchantId-error"
                    onChange={e => { setSpendForm({ ...spendForm, merchantId: e.target.value }); spendValidation.validateField('merchantId', e.target.value); }}
                    onBlur={e => spendValidation.validateField('merchantId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${spendValidation.touched.merchantId && spendValidation.errors.merchantId ? 'border-red-500' : ''}`} />
                  <FieldError id="sp-merchantId-error" error={spendValidation.touched.merchantId ? spendValidation.errors.merchantId : null} />
                </div>
                <div>
                  <input type="number" placeholder="Amount" value={spendForm.amount} aria-label="Amount" aria-describedby="sp-amount-error"
                    onChange={e => { setSpendForm({ ...spendForm, amount: e.target.value }); spendValidation.validateField('amount', e.target.value); }}
                    onBlur={e => spendValidation.validateField('amount', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${spendValidation.touched.amount && spendValidation.errors.amount ? 'border-red-500' : ''}`} />
                  <FieldError id="sp-amount-error" error={spendValidation.touched.amount ? spendValidation.errors.amount : null} />
                </div>
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
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Active Transfers</h2>
            <ExportButton
              rows={transfers}
              fields={conditionalTransferFields}
              filenamePrefix="transfers"
              label="Export"
            />
          </div>
          
          {loading ? (
            <div className="text-center py-4">Loading...</div>
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
                      
                      <div className="mt-4 space-x-2">
                        <button
                          onClick={() => {
                            setSelectedTransfer(transfer);
                            setTransactions([]);
                            setTransactionsError(null);
                          }}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
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
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Actions</h3>
                  <div className="mt-2 space-x-2">
                    <button
                      onClick={() => loadTransferTransactions(selectedTransfer.id)}
                      className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                      View Transactions
                    </button>
                    <button
                      onClick={() => transferClient.getTransferStatistics(selectedTransfer.id)}
                      className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600"
                    >
                      Get Statistics
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-semibold">Transaction History</h3>
                    <ExportButton
                      rows={transactions}
                      fields={transferTransactionFields}
                      filenamePrefix={`transfer_transactions_${selectedTransfer.id}`}
                      label="Export"
                      disabled={transactionsLoading || transactions.length === 0}
                    />
                  </div>

                  {transactionsLoading ? (
                    <p className="text-sm text-gray-500 mt-3">Loading transactions…</p>
                  ) : transactionsError ? (
                    <p className="text-sm text-red-600 mt-3">{transactionsError}</p>
                  ) : transactions.length === 0 ? (
                    <p className="text-sm text-gray-500 mt-3">No transaction history loaded. Click "View Transactions" to fetch history.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {transactions.map((tx) => (
                        <div key={tx.id} className="border rounded p-3 bg-gray-50">
                          <div className="flex justify-between items-center text-sm">
                            <span><strong>ID:</strong> {tx.id}</span>
                            <span className={tx.isApproved ? 'text-green-600' : 'text-red-600'}>
                              {tx.isApproved ? 'Approved' : 'Rejected'}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 text-sm mt-2 sm:grid-cols-2">
                            <span><strong>Merchant:</strong> {tx.merchantId}</span>
                            <span><strong>Amount:</strong> {tx.amount}</span>
                            <span><strong>Category:</strong> {tx.category}</span>
                            <span><strong>Location:</strong> {tx.location}</span>
                            <span><strong>Time:</strong> {formatDate(tx.timestamp)}</span>
                            {tx.rejectionReason && <span><strong>Reason:</strong> {tx.rejectionReason}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
