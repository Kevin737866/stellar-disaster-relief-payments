import React, { useState, useEffect } from 'react';
import { TransferClient, ConditionalTransfer, SpendingRule, NetworkConfig, TransferTransaction } from '../../sdk/src/types';
import { StellarNetworkConfig } from '../../sdk/src/networkConfig';
import { ExportButton, conditionalTransferFields, transferTransactionFields } from '../export';

interface TransferCardProps {
  transferClient: TransferClient;
  config: StellarNetworkConfig | NetworkConfig;
  creatorKey: string;
}

export const TransferCard: React.FC<TransferCardProps> = ({
  transferClient,
  config,
  creatorKey
}) => {
  const [transfers, setTransfers] = useState<ConditionalTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSpendForm, setShowSpendForm] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<ConditionalTransfer | null>(null);
  const [transactions, setTransactions] = useState<TransferTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);

  // Create transfer form state
  const [createForm, setCreateForm] = useState({
    transferId: '',
    beneficiaryId: '',
    amount: '',
    token: 'XLM',
    expiresAt: '',
    purpose: '',
    rules: [
      { type: 'category_limit', category: 'food', limit: '500' },
      { type: 'category_limit', category: 'medical', limit: '300' },
      { type: 'time_window', startTime: '', endTime: '' },
      { type: 'location_based', location: '' }
    ]
  });

  // Spend form state
  const [spendForm, setSpendForm] = useState({
    transferId: '',
    beneficiaryKey: '',
    merchantId: '',
    amount: '',
    category: 'food',
    location: ''
  });

  useEffect(() => {
    loadTransfers();
  }, []);

  const loadTransfers = async () => {
    try {
      setLoading(true);
      // Load transfers for a sample beneficiary
      const beneficiaryTransfers = await transferClient.listBeneficiaryTransfers('sample_beneficiary_001');
      setTransfers(beneficiaryTransfers);
    } catch (error) {
      console.error('Failed to load transfers:', error);
    } finally {
      setLoading(false);
    }
  };

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
    try {
      setLoading(true);
      
      // Create spending rules
      const spendingRules: SpendingRule[] = [];
      
      createForm.rules.forEach(rule => {
        if (rule.type === 'category_limit' && rule.category && rule.limit) {
          spendingRules.push(transferClient.createCategoryLimitRule(rule.category, rule.limit));
        } else if (rule.type === 'time_window' && rule.startTime && rule.endTime) {
          spendingRules.push(transferClient.createTimeWindowRule(
            new Date(rule.startTime).getTime(),
            new Date(rule.endTime).getTime()
          ));
        } else if (rule.type === 'location_based' && rule.location) {
          spendingRules.push(transferClient.createLocationRule(rule.location));
        }
      });

      await transferClient.createTransfer(
        creatorKey,
        createForm.transferId,
        createForm.beneficiaryId,
        createForm.amount,
        createForm.token,
        new Date(createForm.expiresAt).getTime(),
        spendingRules,
        createForm.purpose
      );

      setShowCreateForm(false);
      setCreateForm({
        transferId: '',
        beneficiaryId: '',
        amount: '',
        token: 'XLM',
        expiresAt: '',
        purpose: '',
        rules: [
          { type: 'category_limit', category: 'food', limit: '500' },
          { type: 'category_limit', category: 'medical', limit: '300' },
          { type: 'time_window', startTime: '', endTime: '' },
          { type: 'location_based', location: '' }
        ]
      });
      loadTransfers();
      alert('Conditional transfer created successfully!');
    } catch (error) {
      console.error('Failed to create transfer:', error);
      alert('Failed to create transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleSpend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const success = await transferClient.spend(
        spendForm.beneficiaryKey,
        spendForm.transferId,
        spendForm.merchantId,
        spendForm.amount,
        spendForm.category,
        spendForm.location
      );

      if (success) {
        alert('Payment processed successfully!');
        setShowSpendForm(false);
        setSpendForm({
          transferId: '',
          beneficiaryKey: '',
          merchantId: '',
          amount: '',
          category: 'food',
          location: ''
        });
        loadTransfers();
      } else {
        alert('Payment rejected by spending rules');
      }
    } catch (error) {
      console.error('Failed to process payment:', error);
      alert('Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  const handleRecallFunds = async (transferId: string) => {
    try {
      setLoading(true);
      const result = await transferClient.recallFunds(creatorKey, transferId);
      alert(result);
      loadTransfers();
    } catch (error) {
      console.error('Failed to recall funds:', error);
      alert('Failed to recall funds');
    } finally {
      setLoading(false);
    }
  };

  const handleExtendExpiry = async (transferId: string) => {
    try {
      const newExpiry = prompt('Enter new expiry date (YYYY-MM-DD):');
      if (!newExpiry) return;

      setLoading(true);
      await transferClient.extendExpiry(creatorKey, transferId, new Date(newExpiry).getTime());
      alert('Transfer expiry extended successfully!');
      loadTransfers();
    } catch (error) {
      console.error('Failed to extend expiry:', error);
      alert('Failed to extend expiry');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (transfer: ConditionalTransfer) => {
    const now = Date.now();
    if (!transfer.isActive) return 'text-gray-600';
    if (now > transfer.expiresAt) return 'text-red-600';
    if (now > transfer.expiresAt - (7 * 24 * 60 * 60 * 1000)) return 'text-yellow-600';
    return 'text-green-600';
  };

  const getStatusText = (transfer: ConditionalTransfer) => {
    const now = Date.now();
    if (!transfer.isActive) return 'Inactive';
    if (now > transfer.expiresAt) return 'Expired';
    if (now > transfer.expiresAt - (7 * 24 * 60 * 60 * 1000)) return 'Expiring Soon';
    return 'Active';
  };

  const getUtilizationRate = (transfer: ConditionalTransfer) => {
    const spent = BigInt(transfer.spentAmount);
    const total = BigInt(transfer.amount);
    return Number((spent * BigInt(100)) / total);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Conditional Cash Transfers</h1>
        <p className="text-gray-600 mb-6">
          Conditional cash transfers with spending rules and expiry management
        </p>

        <div className="flex space-x-4 mb-6">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Create Transfer
          </button>
          <button
            onClick={() => setShowSpendForm(!showSpendForm)}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Process Payment
          </button>
          <button
            onClick={() => transferClient.cleanupExpiredTransfers()}
            disabled={loading}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
          >
            Cleanup Expired
          </button>
        </div>

        {/* Create Transfer Form */}
        {showCreateForm && (
          <div className="bg-blue-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Create Conditional Transfer</h2>
            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Transfer ID"
                  value={createForm.transferId}
                  onChange={(e) => setCreateForm({...createForm, transferId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Beneficiary ID"
                  value={createForm.beneficiaryId}
                  onChange={(e) => setCreateForm({...createForm, beneficiaryId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  placeholder="Amount"
                  value={createForm.amount}
                  onChange={(e) => setCreateForm({...createForm, amount: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <select
                  value={createForm.token}
                  onChange={(e) => setCreateForm({...createForm, token: e.target.value})}
                  className="px-3 py-2 border rounded"
                >
                  <option value="XLM">XLM</option>
                  <option value="USDC">USDC</option>
                  <option value="EURT">EURT</option>
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="datetime-local"
                  placeholder="Expiry Date"
                  value={createForm.expiresAt}
                  onChange={(e) => setCreateForm({...createForm, expiresAt: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Purpose"
                  value={createForm.purpose}
                  onChange={(e) => setCreateForm({...createForm, purpose: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Spending Rules</h3>
                <div className="space-y-3">
                  {createForm.rules.map((rule, index) => (
                    <div key={index} className="border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{rule.type.replace('_', ' ').toUpperCase()}</span>
                        <span className="text-sm text-gray-600">
                          {rule.type === 'category_limit' && rule.category && rule.limit && 
                            `${rule.category}: ${rule.limit}`}
                          {rule.type === 'time_window' && rule.startTime && rule.endTime && 
                            `${new Date(rule.startTime).toLocaleDateString()} - ${new Date(rule.endTime).toLocaleDateString()}`}
                          {rule.type === 'location_based' && rule.location && 
                            `Location: ${rule.location}`}
                        </span>
                      </div>
                      
                      {rule.type === 'category_limit' && (
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder="Category"
                            value={rule.category || ''}
                            onChange={(e) => {
                              const newRules = [...createForm.rules];
                              newRules[index].category = e.target.value;
                              setCreateForm({...createForm, rules: newRules});
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                          <input
                            type="number"
                            placeholder="Limit"
                            value={rule.limit || ''}
                            onChange={(e) => {
                              const newRules = [...createForm.rules];
                              newRules[index].limit = e.target.value;
                              setCreateForm({...createForm, rules: newRules});
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                        </div>
                      )}
                      
                      {rule.type === 'time_window' && (
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="datetime-local"
                            value={rule.startTime || ''}
                            onChange={(e) => {
                              const newRules = [...createForm.rules];
                              newRules[index].startTime = e.target.value;
                              setCreateForm({...createForm, rules: newRules});
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                          <input
                            type="datetime-local"
                            value={rule.endTime || ''}
                            onChange={(e) => {
                              const newRules = [...createForm.rules];
                              newRules[index].endTime = e.target.value;
                              setCreateForm({...createForm, rules: newRules});
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                        </div>
                      )}
                      
                      {rule.type === 'location_based' && (
                        <input
                          type="text"
                          placeholder="Location restriction"
                          value={rule.location || ''}
                          onChange={(e) => {
                            const newRules = [...createForm.rules];
                            newRules[index].location = e.target.value;
                            setCreateForm({...createForm, rules: newRules});
                          }}
                          className="w-full px-2 py-1 border rounded text-sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex space-x-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Creating...' : 'Create Transfer'}
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

        {/* Spend Form */}
        {showSpendForm && (
          <div className="bg-green-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Process Payment</h2>
            <form onSubmit={handleSpend} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Transfer ID"
                  value={spendForm.transferId}
                  onChange={(e) => setSpendForm({...spendForm, transferId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="password"
                  placeholder="Beneficiary Key"
                  value={spendForm.beneficiaryKey}
                  onChange={(e) => setSpendForm({...spendForm, beneficiaryKey: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Merchant ID"
                  value={spendForm.merchantId}
                  onChange={(e) => setSpendForm({...spendForm, merchantId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={spendForm.amount}
                  onChange={(e) => setSpendForm({...spendForm, amount: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={spendForm.category}
                  onChange={(e) => setSpendForm({...spendForm, category: e.target.value})}
                  className="px-3 py-2 border rounded"
                >
                  <option value="food">Food</option>
                  <option value="medical">Medical</option>
                  <option value="shelter">Shelter</option>
                  <option value="clothing">Clothing</option>
                  <option value="transport">Transport</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="text"
                  placeholder="Location"
                  value={spendForm.location}
                  onChange={(e) => setSpendForm({...spendForm, location: e.target.value})}
                  className="px-3 py-2 border rounded"
                />
              </div>
              
              <div className="flex space-x-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Processing...' : 'Process Payment'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSpendForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
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
            <div className="text-gray-500 text-center py-4">No active transfers found</div>
          ) : (
            <div className="grid gap-4">
              {transfers.map((transfer) => (
                <div key={transfer.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
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
                      
                      <div className="mt-3">
                        <h4 className="font-medium text-sm mb-1">Spending Rules:</h4>
                        <div className="flex flex-wrap gap-2">
                          {transfer.spendingRules.map((rule, index) => (
                            <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                              {rule.ruleType}: {rule.limit}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className={`font-semibold ${getStatusColor(transfer)}`}>
                        {getStatusText(transfer)}
                      </div>
                      
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
                        <button
                          onClick={() => transferClient.generateTransferQRCode(transfer.id, transfer)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600"
                        >
                          QR Code
                        </button>
                        {Date.now() > transfer.expiresAt && (
                          <button
                            onClick={() => handleRecallFunds(transfer.id)}
                            className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600"
                          >
                            Recall
                          </button>
                        )}
                        <button
                          onClick={() => handleExtendExpiry(transfer.id)}
                          className="bg-yellow-500 text-white px-3 py-1 text-sm rounded hover:bg-yellow-600"
                        >
                          Extend
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transfer Details Modal */}
        {selectedTransfer && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">{selectedTransfer.id}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Transfer Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2">
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
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <p><strong>Total Amount:</strong> {selectedTransfer.amount}</p>
                    <p><strong>Spent Amount:</strong> {selectedTransfer.spentAmount}</p>
                    <p><strong>Remaining:</strong> {selectedTransfer.remainingAmount}</p>
                    <p><strong>Utilization Rate:</strong> {getUtilizationRate(selectedTransfer)}%</p>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Spending Rules</h3>
                  <div className="mt-2 space-y-2">
                    {selectedTransfer.spendingRules.map((rule, index) => (
                      <div key={index} className="bg-gray-50 p-3 rounded">
                        <p><strong>Type:</strong> {rule.ruleType}</p>
                        <p><strong>Limit:</strong> {rule.limit}</p>
                        <p><strong>Current Usage:</strong> {rule.currentUsage}</p>
                        <div className="mt-1">
                          <strong>Parameters:</strong>
                          <ul className="ml-4 text-sm">
                            {Object.entries(rule.parameters).map(([key, value]) => (
                              <li key={key}>{key}: {value}</li>
                            ))}
                          </ul>
                        </div>
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
                <button
                  onClick={() => setSelectedTransfer(null)}
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
