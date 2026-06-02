import React, { useState, useEffect } from 'react';
import { MerchantClient, Merchant, Location, NetworkConfig, Transaction } from '../../sdk/src/types';
import { ExportButton, merchantFields, merchantTransactionFields } from '../export';

interface MerchantMapProps {
  merchantClient: MerchantClient;
  config: NetworkConfig;
  adminKey: string;
}

export const MerchantMap: React.FC<MerchantMapProps> = ({ merchantClient, config, adminKey }) => {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [verificationQueue, setVerificationQueue] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showOnboardingForm, setShowOnboardingForm] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [merchantTransactions, setMerchantTransactions] = useState<Transaction[]>([]);
  const [merchantTransactionsLoading, setMerchantTransactionsLoading] = useState(false);
  const [merchantTransactionsError, setMerchantTransactionsError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: 40.7128, lng: -74.0060 }); // NYC default
  const [searchRadius, setSearchRadius] = useState(10); // km

  const [onboardingForm, setOnboardingForm] = useState({
    merchantId: '', name: '', businessType: 'grocery', contactInfo: '', stellarAddress: '',
    acceptedTokens: 'XLM', dailyLimit: '1000', monthlyLimit: '10000',
    location: { latitude: '', longitude: '', address: '', city: '', country: '', postalCode: '', facilityName: '', contactPerson: '' },
  });

  type FlatOnboarding = { merchantId: string; name: string; businessType: string; contactInfo: string; stellarAddress: string; latitude: string; longitude: string; address: string; city: string; country: string; dailyLimit: string; monthlyLimit: string; };
  const onboardValidation = useFormValidation<FlatOnboarding>({
    merchantId: compose(required('Merchant ID'), identifier('Merchant ID')),
    name: compose(required('Business Name'), minLength(2, 'Business Name'), maxLength(100, 'Business Name')),
    businessType: compose(required('Business Type'), businessType),
    contactInfo: compose(required('Contact Information'), minLength(2, 'Contact Information')),
    stellarAddress: compose(required('Stellar Address'), stellarAddress),
    latitude: compose(required('Latitude'), latitude),
    longitude: compose(required('Longitude'), longitude),
    address: compose(required('Address'), minLength(2, 'Address')),
    city: compose(required('City'), minLength(2, 'City')),
    country: compose(required('Country'), minLength(2, 'Country')),
    dailyLimit: compose(required('Daily Limit'), isPositiveNumber('Daily Limit'), minValue(1, 'Daily Limit')),
    monthlyLimit: compose(required('Monthly Limit'), isPositiveNumber('Monthly Limit'), minValue(1, 'Monthly Limit')),
  });

  const loadMerchants = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await merchantClient.findMerchantsByLocation(mapCenter.lat, mapCenter.lng, searchRadius);
      setMerchants(data);
    } catch {
      setListError('Failed to load merchants. Please try again.');
    } finally {
      setListLoading(false);
    }
  }, [merchantClient, mapCenter.lat, mapCenter.lng, searchRadius]);

  const loadVerificationQueue = useCallback(async () => {
    try {
      const queue = await merchantClient.getVerificationQueue();
      setVerificationQueue(queue);
    } catch {
      console.error('Failed to load verification queue');
    }
  }, [merchantClient]);

  useEffect(() => {
    loadMerchants();
    loadVerificationQueue();
  }, [loadMerchants, loadVerificationQueue]);

  const loadMerchantTransactions = async (merchantId: string) => {
    setMerchantTransactionsLoading(true);
    setMerchantTransactionsError(null);
    try {
      const txns = await merchantClient.getMerchantTransactions(merchantId);
      setMerchantTransactions(txns);
    } catch (error) {
      console.error('Failed to load merchant transactions:', error);
      setMerchantTransactionsError('Failed to load transaction history. Please try again.');
      setMerchantTransactions([]);
    } finally {
      setMerchantTransactionsLoading(false);
    }
  };

  const handleOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    const flat = { ...onboardingForm, ...onboardingForm.location } as Record<string, string>;
    if (!onboardValidation.validateAll(flat as never)) return;
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const location: Location = {
        latitude: parseFloat(onboardingForm.location.latitude),
        longitude: parseFloat(onboardingForm.location.longitude),
        address: onboardingForm.location.address,
        city: onboardingForm.location.city,
        country: onboardingForm.location.country,
        postalCode: onboardingForm.location.postalCode,
      };
      const request = merchantClient.createOnboardingRequest(
        onboardingForm.name, onboardingForm.businessType, location,
        onboardingForm.contactInfo, onboardingForm.stellarAddress
      );
      await merchantClient.registerMerchant(adminKey, onboardingForm.merchantId, request);
      setShowOnboardingForm(false);
      setOnboardingForm({
        merchantId: '', name: '', businessType: 'grocery', contactInfo: '', stellarAddress: '',
        acceptedTokens: 'XLM', dailyLimit: '1000', monthlyLimit: '10000',
        location: { latitude: '', longitude: '', address: '', city: '', country: '', postalCode: '', facilityName: '', contactPerson: '' },
      });
      onboardValidation.reset();
      setSubmitStatus({ type: 'success', message: 'Merchant registered successfully. Awaiting verification.' });
      loadVerificationQueue();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to onboard merchant. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyMerchant = async (merchantId: string, approved: boolean) => {
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      await merchantClient.verifyMerchant(adminKey, merchantId, approved, '');
      setSubmitStatus({ type: 'success', message: `Merchant ${approved ? 'approved' : 'rejected'} successfully.` });
      loadVerificationQueue();
      loadMerchants();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to verify merchant.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchVerify = async (approved: boolean) => {
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const results = await merchantClient.batchVerifyMerchants(adminKey, verificationQueue, approved, 'Batch verification');
      setSubmitStatus({ type: 'success', message: `Batch verification completed: ${results.length} merchants processed.` });
      loadVerificationQueue();
      loadMerchants();
    } catch {
      setSubmitStatus({ type: 'error', message: 'Failed to batch verify merchants.' });
    } finally {
      setSubmitting(false);
    }
  };

  const getReputationColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusBadge = (merchant: Merchant) => {
    if (!merchant.isActive) return 'bg-gray-100 text-gray-800';
    if (!merchant.isVerified) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  return (
    <div className="max-w-6xl mx-auto p-6">
      {submitting && <PageLoadingOverlay message="Processing merchant operation…" />}

      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Merchant Network</h1>
        <p className="text-gray-600 mb-6">Local merchant onboarding and GPS-verified payment acceptance</p>

        {submitStatus && (
          <StatusMessage type={submitStatus.type} message={submitStatus.message}
            onDismiss={() => setSubmitStatus(null)} className="mb-4" />
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={() => setShowOnboardingForm(!showOnboardingForm)}
            aria-expanded={showOnboardingForm}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Onboard Merchant
          </button>
          <LoadingButton onClick={loadMerchants} loading={listLoading} loadingLabel="Searching…"
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
            Search Location
          </LoadingButton>
          {verificationQueue.length > 0 && (
            <LoadingButton onClick={() => handleBatchVerify(true)} loading={submitting} loadingLabel="Approving…"
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500">
              Approve All ({verificationQueue.length})
            </LoadingButton>
          )}
        </div>

          {/* Onboarding Form */}
          <section
            id="onboarding-form"
            aria-label="Onboard New Merchant"
            hidden={!showOnboardingForm}
            className="bg-blue-50 p-6 rounded-lg mb-6"
          >
            <h2 className="text-xl font-semibold mb-4">Onboard New Merchant</h2>
            <form onSubmit={handleOnboarding} className="space-y-4" aria-label="Merchant onboarding form">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Merchant ID" value={onboardingForm.merchantId} aria-label="Merchant ID" aria-describedby="mo-merchantId-error"
                    onChange={e => { setOnboardingForm({ ...onboardingForm, merchantId: e.target.value }); onboardValidation.validateField('merchantId', e.target.value); }}
                    onBlur={e => onboardValidation.validateField('merchantId', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.merchantId && onboardValidation.errors.merchantId ? 'border-red-500' : ''}`} />
                  <FieldError id="mo-merchantId-error" error={onboardValidation.touched.merchantId ? onboardValidation.errors.merchantId : null} />
                </div>
                <div>
                  <input type="text" placeholder="Business Name" value={onboardingForm.name} aria-label="Business Name" aria-describedby="mo-name-error"
                    onChange={e => { setOnboardingForm({ ...onboardingForm, name: e.target.value }); onboardValidation.validateField('name', e.target.value); }}
                    onBlur={e => onboardValidation.validateField('name', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.name && onboardValidation.errors.name ? 'border-red-500' : ''}`} />
                  <FieldError id="mo-name-error" error={onboardValidation.touched.name ? onboardValidation.errors.name : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <select value={onboardingForm.businessType} aria-label="Business Type" aria-describedby="mo-businessType-error"
                    onChange={e => { setOnboardingForm({ ...onboardingForm, businessType: e.target.value }); onboardValidation.validateField('businessType', e.target.value); }}
                    onBlur={e => onboardValidation.validateField('businessType', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.businessType && onboardValidation.errors.businessType ? 'border-red-500' : ''}`}>
                    <option value="grocery">Grocery Store</option>
                    <option value="pharmacy">Pharmacy</option>
                    <option value="hardware">Hardware Store</option>
                    <option value="fuel_station">Fuel Station</option>
                    <option value="clothing">Clothing Store</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="transport">Transport</option>
                    <option value="communication">Communication</option>
                  </select>
                  <FieldError id="mo-businessType-error" error={onboardValidation.touched.businessType ? onboardValidation.errors.businessType : null} />
                </div>
                <div>
                  <input type="text" placeholder="Contact Information" value={onboardingForm.contactInfo} aria-label="Contact Information" aria-describedby="mo-contactInfo-error"
                    onChange={e => { setOnboardingForm({ ...onboardingForm, contactInfo: e.target.value }); onboardValidation.validateField('contactInfo', e.target.value); }}
                    onBlur={e => onboardValidation.validateField('contactInfo', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.contactInfo && onboardValidation.errors.contactInfo ? 'border-red-500' : ''}`} />
                  <FieldError id="mo-contactInfo-error" error={onboardValidation.touched.contactInfo ? onboardValidation.errors.contactInfo : null} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <input type="text" placeholder="Stellar Address" value={onboardingForm.stellarAddress} aria-label="Stellar Address" aria-describedby="mo-stellarAddress-error"
                    onChange={e => { setOnboardingForm({ ...onboardingForm, stellarAddress: e.target.value }); onboardValidation.validateField('stellarAddress', e.target.value); }}
                    onBlur={e => onboardValidation.validateField('stellarAddress', e.target.value)}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.stellarAddress && onboardValidation.errors.stellarAddress ? 'border-red-500' : ''}`} />
                  <FieldError id="mo-stellarAddress-error" error={onboardValidation.touched.stellarAddress ? onboardValidation.errors.stellarAddress : null} />
                </div>
                <input type="text" placeholder="Accepted Tokens" value={onboardingForm.acceptedTokens} aria-label="Accepted Tokens"
                  onChange={e => setOnboardingForm({ ...onboardingForm, acceptedTokens: e.target.value })}
                  className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Location Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input type="number" step="any" placeholder="Latitude" value={onboardingForm.location.latitude} aria-label="Latitude" aria-describedby="mo-latitude-error"
                      onChange={e => { setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, latitude: e.target.value } }); onboardValidation.validateField('latitude', e.target.value); }}
                      onBlur={e => onboardValidation.validateField('latitude', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.latitude && onboardValidation.errors.latitude ? 'border-red-500' : ''}`} />
                    <FieldError id="mo-latitude-error" error={onboardValidation.touched.latitude ? onboardValidation.errors.latitude : null} />
                  </div>
                  <div>
                    <input type="number" step="any" placeholder="Longitude" value={onboardingForm.location.longitude} aria-label="Longitude" aria-describedby="mo-longitude-error"
                      onChange={e => { setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, longitude: e.target.value } }); onboardValidation.validateField('longitude', e.target.value); }}
                      onBlur={e => onboardValidation.validateField('longitude', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.longitude && onboardValidation.errors.longitude ? 'border-red-500' : ''}`} />
                    <FieldError id="mo-longitude-error" error={onboardValidation.touched.longitude ? onboardValidation.errors.longitude : null} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <input type="text" placeholder="Address" value={onboardingForm.location.address} aria-label="Address" aria-describedby="mo-address-error"
                      onChange={e => { setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, address: e.target.value } }); onboardValidation.validateField('address', e.target.value); }}
                      onBlur={e => onboardValidation.validateField('address', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.address && onboardValidation.errors.address ? 'border-red-500' : ''}`} />
                    <FieldError id="mo-address-error" error={onboardValidation.touched.address ? onboardValidation.errors.address : null} />
                  </div>
                  <div>
                    <input type="text" placeholder="City" value={onboardingForm.location.city} aria-label="City" aria-describedby="mo-city-error"
                      onChange={e => { setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, city: e.target.value } }); onboardValidation.validateField('city', e.target.value); }}
                      onBlur={e => onboardValidation.validateField('city', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.city && onboardValidation.errors.city ? 'border-red-500' : ''}`} />
                    <FieldError id="mo-city-error" error={onboardValidation.touched.city ? onboardValidation.errors.city : null} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <input type="text" placeholder="Country" value={onboardingForm.location.country} aria-label="Country" aria-describedby="mo-country-error"
                      onChange={e => { setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, country: e.target.value } }); onboardValidation.validateField('country', e.target.value); }}
                      onBlur={e => onboardValidation.validateField('country', e.target.value)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${onboardValidation.touched.country && onboardValidation.errors.country ? 'border-red-500' : ''}`} />
                    <FieldError id="mo-country-error" error={onboardValidation.touched.country ? onboardValidation.errors.country : null} />
                  </div>
                  <input type="text" placeholder="Postal Code" value={onboardingForm.location.postalCode} aria-label="Postal Code"
                    onChange={e => setOnboardingForm({ ...onboardingForm, location: { ...onboardingForm.location, postalCode: e.target.value } })}
                    className="px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex gap-3">
                <LoadingButton type="submit" loading={submitting} loadingLabel="Onboarding…"
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                  Onboard Merchant
                </LoadingButton>
                <button type="button" onClick={() => setShowOnboardingForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Location Search */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <h3 className="font-semibold mb-2">Search Location</h3>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" htmlFor="lat-input">Latitude</label>
              <input id="lat-input" type="number" step="any" value={mapCenter.lat}
                onChange={e => setMapCenter({ ...mapCenter, lat: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" htmlFor="lng-input">Longitude</label>
              <input id="lng-input" type="number" step="any" value={mapCenter.lng}
                onChange={e => setMapCenter({ ...mapCenter, lng: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium mb-1" htmlFor="radius-input">Radius (km)</label>
              <input id="radius-input" type="number" value={searchRadius}
                onChange={e => setSearchRadius(parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>

        {/* Verification Queue */}
        {verificationQueue.length > 0 && (
          <div className="bg-yellow-50 p-4 rounded-lg mb-6" role="region" aria-label="Verification queue">
            <h3 className="font-semibold mb-2">Verification Queue ({verificationQueue.length} merchants)</h3>
            <div className="space-y-2">
              {verificationQueue.map(merchantId => (
                <div key={merchantId} className="flex items-center justify-between bg-white p-3 rounded border">
                  <span className="font-medium">{merchantId}</span>
                  <div className="flex gap-2">
                    <LoadingButton onClick={() => handleVerifyMerchant(merchantId, true)} loading={submitting} loadingLabel="…"
                      className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400">
                      Approve
                    </LoadingButton>
                    <LoadingButton onClick={() => handleVerifyMerchant(merchantId, false)} loading={submitting} loadingLabel="…"
                      className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400">
                      Reject
                    </LoadingButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Merchants List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Active Merchants ({merchants.length})</h2>
            <ExportButton rows={merchants} fields={merchantFields} filenamePrefix="merchants" label="Export" />
          </div>
          
          {loading ? (
            <div className="text-center py-4">Loading...</div>
          ) : merchants.length === 0 ? (
            <EmptyState title="No merchants found in this area"
              description="Try expanding the search radius or onboard a new merchant." icon="🏪"
              action={
                <button onClick={() => setShowOnboardingForm(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  Onboard Merchant
                </button>
              } />
          ) : (
            <div className="grid gap-4" role="list" aria-label="Merchants">
              {merchants.map(merchant => (
                <div key={merchant.id} role="listitem" className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{merchant.name}</h3>
                      <p className="text-gray-600">{merchant.businessType}</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>ID:</strong> {merchant.id}</p>
                        <p><strong>Address:</strong> {merchant.location.address}</p>
                        <p><strong>City:</strong> {merchant.location.city}, {merchant.location.country}</p>
                        <p><strong>Contact:</strong> {merchant.contactInfo}</p>
                        <p><strong>Registered:</strong> {formatDate(merchant.registrationDate)}</p>
                        <p><strong>Accepted Tokens:</strong> {merchant.acceptedTokens.join(', ')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-semibold ${getReputationColor(merchant.reputationScore)}`}>
                        Reputation: {merchant.reputationScore}/100
                      </div>
                      <span className={`mt-2 inline-block px-2 py-1 rounded text-xs ${getStatusBadge(merchant)}`}>
                        {merchant.isVerified ? 'Verified' : 'Pending'}
                      </span>
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Daily Limit:</strong> {merchant.dailyLimit}</p>
                        <p><strong>Monthly:</strong> {merchant.monthlyLimit}</p>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          onClick={() => {
                            setSelectedMerchant(merchant);
                            setMerchantTransactions([]);
                            setMerchantTransactionsError(null);
                          }}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
                          Details
                        </button>
                        <button onClick={() => merchantClient.generateMerchantQRCode(merchant.id, merchant)}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400">
                          QR Code
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        {/* Merchant Details Modal */}
        {selectedMerchant && (
          <div role="dialog" aria-modal="true" aria-labelledby="merchant-modal-title"
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 id="merchant-modal-title" className="text-2xl font-bold mb-4">{selectedMerchant.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Business Information</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <p><strong>ID:</strong> {selectedMerchant.id}</p>
                    <p><strong>Type:</strong> {selectedMerchant.businessType}</p>
                    <p><strong>Status:</strong> {selectedMerchant.isVerified ? 'Verified' : 'Pending'}</p>
                    <p><strong>Reputation:</strong> {selectedMerchant.reputationScore}/100</p>
                    <p><strong>Owner:</strong> {selectedMerchant.owner}</p>
                    <p><strong>Registered:</strong> {formatDate(selectedMerchant.registrationDate)}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Location</h3>
                  <div className="mt-2 space-y-1 text-sm">
                    <p><strong>Address:</strong> {selectedMerchant.location.address}</p>
                    <p><strong>City:</strong> {selectedMerchant.location.city}</p>
                    <p><strong>Country:</strong> {selectedMerchant.location.country}</p>
                    <p><strong>Coordinates:</strong> {selectedMerchant.location.latitude}, {selectedMerchant.location.longitude}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Financial Limits</h3>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <p><strong>Daily Limit:</strong> {selectedMerchant.dailyLimit}</p>
                    <p><strong>Monthly Limit:</strong> {selectedMerchant.monthlyLimit}</p>
                    <p><strong>Current Volume:</strong> {selectedMerchant.currentMonthVolume}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold">Payment Information</h3>
                  <div className="mt-2">
                    <p><strong>Accepted Tokens:</strong></p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {selectedMerchant.acceptedTokens.map((token, index) => (
                        <span key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                          {token}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2"><strong>Stellar TOML:</strong> {selectedMerchant.stellarTomlUrl}</p>
                </div>
                
                <div>
                  <h3 className="font-semibold">Actions</h3>
                  <div className="mt-2 space-x-2">
                    <button
                      onClick={() => {
                        const feedback = prompt('Enter feedback score (-10 to +10):');
                        if (feedback) {
                          merchantClient.updateReputation(adminKey, selectedMerchant.id, parseInt(feedback));
                        }
                      }}
                      className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                    >
                      Update Reputation
                    </button>
                    <button
                      onClick={() => loadMerchantTransactions(selectedMerchant.id)}
                      className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                      View Transactions
                    </button>
                  </div>
                </dl>
              </section>

              <section aria-label="Payment Information">
                <h3 className="font-semibold">Accepted Tokens</h3>
                <ul className="flex flex-wrap gap-2 mt-2" aria-label="Accepted payment tokens">
                  {selectedMerchant.acceptedTokens.map((token, index) => (
                    <li key={index} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">{token}</li>
                  ))}
                </ul>
                {selectedMerchant.stellarTomlUrl && (
                  <p className="mt-2 text-sm">
                    <strong>Stellar TOML:</strong>{' '}
                    <a href={selectedMerchant.stellarTomlUrl} className="text-blue-600 underline focus:outline-none focus:ring-2 focus:ring-blue-500" target="_blank" rel="noopener noreferrer">
                      {selectedMerchant.stellarTomlUrl}
                    </a>
                  </p>
                )}
              </section>

              <section aria-label="Actions">
                <h3 className="font-semibold mb-2">Actions</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const feedback = window.prompt('Enter feedback score (-10 to +10):');
                      if (feedback !== null) {
                        merchantClient.updateReputation(adminKey, selectedMerchant.id, parseInt(feedback));
                        setStatusMessage('Reputation updated.');
                      }
                    }}
                    className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2"
                    aria-label={`Update reputation for ${selectedMerchant.name}`}
                  >
                    Update Reputation
                  </button>
                  <button
                    onClick={() => merchantClient.getMerchantTransactions(selectedMerchant.id)}
                    className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                    aria-label={`View transactions for ${selectedMerchant.name}`}
                  >
                    View Transactions
                  </button>
                </div>

                <div className="mt-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-semibold">Merchant Transaction History</h3>
                    <ExportButton
                      rows={merchantTransactions}
                      fields={merchantTransactionFields}
                      filenamePrefix={`merchant_transactions_${selectedMerchant.id}`}
                      label="Export"
                      disabled={merchantTransactionsLoading || merchantTransactions.length === 0}
                    />
                  </div>

                  {merchantTransactionsLoading ? (
                    <p className="text-sm text-gray-500 mt-3">Loading transactions…</p>
                  ) : merchantTransactionsError ? (
                    <p className="text-sm text-red-600 mt-3">{merchantTransactionsError}</p>
                  ) : merchantTransactions.length === 0 ? (
                    <p className="text-sm text-gray-500 mt-3">No transaction history loaded. Click "View Transactions" to fetch history.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {merchantTransactions.map((tx) => (
                        <div key={tx.id} className="border rounded p-3 bg-gray-50">
                          <div className="flex justify-between items-center text-sm">
                            <span><strong>ID:</strong> {tx.id}</span>
                            <span className={tx.isSettled ? 'text-green-600' : 'text-yellow-600'}>
                              {tx.isSettled ? 'Settled' : 'Pending'}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 text-sm mt-2 sm:grid-cols-2">
                            <span><strong>Merchant:</strong> {tx.merchantId}</span>
                            <span><strong>Beneficiary:</strong> {tx.beneficiaryId}</span>
                            <span><strong>Amount:</strong> {tx.amount}</span>
                            <span><strong>Token:</strong> {tx.token}</span>
                            <span><strong>Purpose:</strong> {tx.purpose}</span>
                            <span><strong>Time:</strong> {formatDate(tx.timestamp)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setSelectedMerchant(null)}
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
