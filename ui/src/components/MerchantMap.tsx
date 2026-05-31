import React, { useState, useEffect } from 'react';
import { MerchantClient, Merchant, Location, NetworkConfig } from '../../sdk/src/types';

interface MerchantMapProps {
  merchantClient: MerchantClient;
  config: NetworkConfig;
  adminKey: string;
}

export const MerchantMap: React.FC<MerchantMapProps> = ({
  merchantClient,
  config,
  adminKey
}) => {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [verificationQueue, setVerificationQueue] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showOnboardingForm, setShowOnboardingForm] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [mapCenter, setMapCenter] = useState({ lat: 40.7128, lng: -74.0060 }); // NYC default
  const [searchRadius, setSearchRadius] = useState(10); // km

  // Onboarding form state
  const [onboardingForm, setOnboardingForm] = useState({
    merchantId: '',
    name: '',
    businessType: 'grocery',
    contactInfo: '',
    stellarAddress: '',
    acceptedTokens: 'XLM',
    dailyLimit: '1000',
    monthlyLimit: '10000',
    location: {
      latitude: '',
      longitude: '',
      address: '',
      city: '',
      country: '',
      postalCode: '',
      facilityName: '',
      contactPerson: ''
    }
  });

  useEffect(() => {
    loadMerchants();
    loadVerificationQueue();
  }, []);

  const loadMerchants = async () => {
    try {
      setLoading(true);
      const nearbyMerchants = await merchantClient.findMerchantsByLocation(
        mapCenter.lat,
        mapCenter.lng,
        searchRadius
      );
      setMerchants(nearbyMerchants);
    } catch (error) {
      console.error('Failed to load merchants:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadVerificationQueue = async () => {
    try {
      const queue = await merchantClient.getVerificationQueue();
      setVerificationQueue(queue);
    } catch (error) {
      console.error('Failed to load verification queue:', error);
    }
  };

  const handleOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const location: Location = {
        latitude: parseFloat(onboardingForm.location.latitude),
        longitude: parseFloat(onboardingForm.location.longitude),
        address: onboardingForm.location.address,
        city: onboardingForm.location.city,
        country: onboardingForm.location.country,
        postalCode: onboardingForm.location.postalCode
      };

      const request = merchantClient.createOnboardingRequest(
        onboardingForm.name,
        onboardingForm.businessType,
        location,
        onboardingForm.contactInfo,
        onboardingForm.stellarAddress
      );

      await merchantClient.registerMerchant(
        adminKey,
        onboardingForm.merchantId,
        request
      );

      setShowOnboardingForm(false);
      setOnboardingForm({
        merchantId: '',
        name: '',
        businessType: 'grocery',
        contactInfo: '',
        stellarAddress: '',
        acceptedTokens: 'XLM',
        dailyLimit: '1000',
        monthlyLimit: '10000',
        location: {
          latitude: '',
          longitude: '',
          address: '',
          city: '',
          country: '',
          postalCode: '',
          facilityName: '',
          contactPerson: ''
        }
      });
      loadVerificationQueue();
      alert('Merchant registered successfully! Awaiting verification.');
    } catch (error) {
      console.error('Failed to onboard merchant:', error);
      alert('Failed to onboard merchant');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMerchant = async (merchantId: string, approved: boolean) => {
    try {
      setLoading(true);
      await merchantClient.verifyMerchant(adminKey, merchantId, approved, '');
      loadVerificationQueue();
      loadMerchants();
      alert(`Merchant ${approved ? 'approved' : 'rejected'} successfully`);
    } catch (error) {
      console.error('Failed to verify merchant:', error);
      alert('Failed to verify merchant');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchVerify = async (approved: boolean) => {
    try {
      setLoading(true);
      const results = await merchantClient.batchVerifyMerchants(
        adminKey,
        verificationQueue,
        approved,
        'Batch verification'
      );
      loadVerificationQueue();
      loadMerchants();
      alert(`Batch verification completed: ${results.join(', ')}`);
    } catch (error) {
      console.error('Failed to batch verify:', error);
      alert('Failed to batch verify merchants');
    } finally {
      setLoading(false);
    }
  };

  const handleLocationSearch = () => {
    loadMerchants();
  };

  const getReputationColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusColor = (merchant: Merchant) => {
    if (!merchant.isActive) return 'bg-gray-100 text-gray-800';
    if (!merchant.isVerified) return 'bg-yellow-100 text-yellow-800';
    return 'bg-green-100 text-green-800';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Merchant Network</h1>
        <p className="text-gray-600 mb-6">
          Local merchant onboarding and GPS-verified payment acceptance
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setShowOnboardingForm(!showOnboardingForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Onboard Merchant
          </button>
          <button
            onClick={handleLocationSearch}
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Search Location
          </button>
          {verificationQueue.length > 0 && (
            <button
              onClick={() => handleBatchVerify(true)}
              disabled={loading}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
            >
              Approve All ({verificationQueue.length})
            </button>
          )}
        </div>

        {/* Onboarding Form */}
        {showOnboardingForm && (
          <div className="bg-blue-50 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-semibold mb-4">Onboard New Merchant</h2>
            <form onSubmit={handleOnboarding} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Merchant ID"
                  value={onboardingForm.merchantId}
                  onChange={(e) => setOnboardingForm({...onboardingForm, merchantId: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Business Name"
                  value={onboardingForm.name}
                  onChange={(e) => setOnboardingForm({...onboardingForm, name: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <select
                  value={onboardingForm.businessType}
                  onChange={(e) => setOnboardingForm({...onboardingForm, businessType: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                >
                  <option value="grocery">Grocery Store</option>
                  <option value="pharmacy">Pharmacy</option>
                  <option value="hardware">Hardware Store</option>
                  <option value="fuel_station">Fuel Station</option>
                  <option value="clothing">Clothing Store</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="transport">Transport</option>
                  <option value="communication">Communication</option>
                </select>
                <input
                  type="text"
                  placeholder="Contact Information"
                  value={onboardingForm.contactInfo}
                  onChange={(e) => setOnboardingForm({...onboardingForm, contactInfo: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Stellar Address"
                  value={onboardingForm.stellarAddress}
                  onChange={(e) => setOnboardingForm({...onboardingForm, stellarAddress: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="text"
                  placeholder="Accepted Tokens (comma-separated)"
                  value={onboardingForm.acceptedTokens}
                  onChange={(e) => setOnboardingForm({...onboardingForm, acceptedTokens: e.target.value})}
                  className="px-3 py-2 border rounded"
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  type="number"
                  placeholder="Daily Limit"
                  value={onboardingForm.dailyLimit}
                  onChange={(e) => setOnboardingForm({...onboardingForm, dailyLimit: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
                <input
                  type="number"
                  placeholder="Monthly Limit"
                  value={onboardingForm.monthlyLimit}
                  onChange={(e) => setOnboardingForm({...onboardingForm, monthlyLimit: e.target.value})}
                  className="px-3 py-2 border rounded"
                  required
                />
              </div>
              
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">Location Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={onboardingForm.location.latitude}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, latitude: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                    required
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={onboardingForm.location.longitude}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, longitude: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  <input
                    type="text"
                    placeholder="Address"
                    value={onboardingForm.location.address}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, address: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                    required
                  />
                  <input
                    type="text"
                    placeholder="City"
                    value={onboardingForm.location.city}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, city: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  <input
                    type="text"
                    placeholder="Country"
                    value={onboardingForm.location.country}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, country: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Postal Code"
                    value={onboardingForm.location.postalCode}
                    onChange={(e) => setOnboardingForm({
                      ...onboardingForm, 
                      location: {...onboardingForm.location, postalCode: e.target.value}
                    })}
                    className="px-3 py-2 border rounded"
                  />
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  {loading ? 'Onboarding...' : 'Onboard Merchant'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowOnboardingForm(false)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Location Search */}
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <h3 className="font-semibold mb-2">Search Location</h3>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={mapCenter.lat}
                onChange={(e) => setMapCenter({...mapCenter, lat: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={mapCenter.lng}
                onChange={(e) => setMapCenter({...mapCenter, lng: parseFloat(e.target.value)})}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium mb-1">Radius (km)</label>
              <input
                type="number"
                value={searchRadius}
                onChange={(e) => setSearchRadius(parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
          </div>
        </div>

        {/* Verification Queue */}
        {verificationQueue.length > 0 && (
          <div className="bg-yellow-50 p-4 rounded-lg mb-6">
            <h3 className="font-semibold mb-2">Verification Queue ({verificationQueue.length} merchants)</h3>
            <div className="space-y-2">
              {verificationQueue.map((merchantId) => (
                <div key={merchantId} className="flex items-center justify-between bg-white p-3 rounded border">
                  <span className="font-medium">{merchantId}</span>
                  <div className="space-x-2">
                    <button
                      onClick={() => handleVerifyMerchant(merchantId, true)}
                      className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleVerifyMerchant(merchantId, false)}
                      className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Merchants List */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Merchants ({merchants.length})</h2>
          
          {loading ? (
            <div className="text-center py-4">Loading...</div>
          ) : merchants.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No merchants found in this area</div>
          ) : (
            <div className="grid gap-4">
              {merchants.map((merchant) => (
                <div key={merchant.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
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
                      <div className="mt-2">
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(merchant)}`}>
                          {merchant.isVerified ? 'Verified' : 'Pending'}
                        </span>
                      </div>
                      
                      <div className="mt-2 space-y-1 text-sm">
                        <p><strong>Daily Limit:</strong> {merchant.dailyLimit}</p>
                        <p><strong>Monthly:</strong> {merchant.monthlyLimit}</p>
                        <p><strong>Current:</strong> {merchant.currentMonthVolume}</p>
                      </div>
                      
                      <div className="mt-4 space-x-2">
                        <button
                          onClick={() => setSelectedMerchant(merchant)}
                          className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => merchantClient.generateMerchantQRCode(merchant.id, merchant)}
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

        {/* Merchant Details Modal */}
        {selectedMerchant && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white rounded-lg p-4 sm:p-6 max-w-2xl w-full max-h-screen overflow-y-auto">
              <h2 className="text-2xl font-bold mb-4">{selectedMerchant.name}</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Business Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
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
                  <div className="mt-2 space-y-1">
                    <p><strong>Address:</strong> {selectedMerchant.location.address}</p>
                    <p><strong>City:</strong> {selectedMerchant.location.city}</p>
                    <p><strong>Country:</strong> {selectedMerchant.location.country}</p>
                    <p><strong>Postal:</strong> {selectedMerchant.location.postalCode}</p>
                    <p><strong>Coordinates:</strong> {selectedMerchant.location.latitude}, {selectedMerchant.location.longitude}</p>
                  </div>
                </div>
                
                <div>
                  <h3 className="font-semibold">Financial Limits</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    <p><strong>Daily Limit:</strong> {selectedMerchant.dailyLimit}</p>
                    <p><strong>Monthly Limit:</strong> {selectedMerchant.monthlyLimit}</p>
                    <p><strong>Current Volume:</strong> {selectedMerchant.currentMonthVolume}</p>
                    <p><strong>Monthly Utilization:</strong> {
                      Math.round((parseInt(selectedMerchant.currentMonthVolume) / parseInt(selectedMerchant.monthlyLimit)) * 100)
                    }%</p>
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
                  <div className="mt-2 flex flex-wrap gap-2">
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
                      onClick={() => merchantClient.getMerchantTransactions(selectedMerchant.id)}
                      className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                    >
                      View Transactions
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedMerchant(null)}
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
