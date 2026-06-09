import React, { useState, useEffect } from 'react';
import {
  AidClient,
  BeneficiaryClient,
  MerchantClient,
  TransferClient,
  EmergencyFund,
  BeneficiaryProfile,
  Merchant,
  ConditionalTransfer,
  NetworkConfig,
} from '../../sdk/src/types';

interface DashboardProps {
  aidClient: AidClient;
  beneficiaryClient: BeneficiaryClient;
  merchantClient: MerchantClient;
  transferClient: TransferClient;
  config: NetworkConfig;
}

interface DashboardStats {
  totalFunds: number;
  activeFunds: number;
  totalFundAmount: number;
  releasedAmount: number;
  totalBeneficiaries: number;
  activeBeneficiaries: number;
  totalMerchants: number;
  verifiedMerchants: number;
  totalTransfers: number;
  activeTransfers: number;
  totalTransferAmount: number;
  spentAmount: number;
}

// ── Minimal SVG bar chart ──────────────────────────────────────────────────

interface BarChartProps {
  data: { label: string; value: number; color: string }[];
  height?: number;
}

const BarChart: React.FC<BarChartProps> = ({ data, height = 160 }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 40;
  const gap = 20;
  const paddingLeft = 40;
  const paddingBottom = 30;
  const chartHeight = height - paddingBottom;
  const totalWidth = paddingLeft + data.length * (barWidth + gap);

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      className="w-full"
      role="img"
      aria-label="Bar chart"
    >
      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const y = chartHeight - ratio * chartHeight;
        return (
          <g key={ratio}>
            <line x1={paddingLeft} y1={y} x2={totalWidth} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={paddingLeft - 4} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              {Math.round(max * ratio)}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {data.map((d, i) => {
        const barHeight = (d.value / max) * chartHeight;
        const x = paddingLeft + i * (barWidth + gap);
        const y = chartHeight - barHeight;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill={d.color} rx={3} />
            <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="#6b7280">
              {d.label}
            </text>
            <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="#374151" fontWeight="600">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

// ── Donut chart ────────────────────────────────────────────────────────────

interface DonutChartProps {
  value: number;   // 0–100
  color: string;
  label: string;
  size?: number;
}

const DonutChart: React.FC<DonutChartProps> = ({ value, color, label, size = 100 }) => {
  const r = 38;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} role="img" aria-label={`${label}: ${value}%`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fontWeight="700" fill="#111827">
          {value}%
        </text>
      </svg>
      <span className="text-xs text-gray-500 mt-1">{label}</span>
    </div>
  );
};

// ── Stat card ──────────────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> = ({
  label,
  value,
  sub,
  color = 'text-gray-900',
}) => (
  <div className="bg-white rounded-lg border border-gray-200 p-4">
    <p className="text-sm text-gray-500">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
  </div>
);

// ── Main Dashboard ─────────────────────────────────────────────────────────

export const Dashboard: React.FC<DashboardProps> = ({
  aidClient,
  beneficiaryClient,
  merchantClient,
  transferClient,
}) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [funds, setFunds] = useState<EmergencyFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [activeFunds, beneficiaries, merchants, transfers] = await Promise.allSettled([
        aidClient.listActiveFunds(),
        beneficiaryClient.listBeneficiariesByDisaster('sample_disaster_001'),
        merchantClient.findMerchantsByLocation(0, 0, 99999),
        transferClient.listBeneficiaryTransfers('sample_beneficiary_001'),
      ]);

      const fundsData: EmergencyFund[] = activeFunds.status === 'fulfilled' ? activeFunds.value : [];
      const beneficiariesData: BeneficiaryProfile[] = beneficiaries.status === 'fulfilled' ? beneficiaries.value : [];
      const merchantsData: Merchant[] = merchants.status === 'fulfilled' ? merchants.value : [];
      const transfersData: ConditionalTransfer[] = transfers.status === 'fulfilled' ? transfers.value : [];

      setFunds(fundsData);

      const totalFundAmount = fundsData.reduce((sum, f) => sum + parseInt(f.totalAmount || '0'), 0);
      const releasedAmount = fundsData.reduce((sum, f) => sum + parseInt(f.releasedAmount || '0'), 0);
      const totalTransferAmount = transfersData.reduce((sum, t) => sum + parseInt(t.amount || '0'), 0);
      const spentAmount = transfersData.reduce((sum, t) => sum + parseInt(t.spentAmount || '0'), 0);

      setStats({
        totalFunds: fundsData.length,
        activeFunds: fundsData.filter((f) => f.isActive).length,
        totalFundAmount,
        releasedAmount,
        totalBeneficiaries: beneficiariesData.length,
        activeBeneficiaries: beneficiariesData.filter((b) => b.isActive).length,
        totalMerchants: merchantsData.length,
        verifiedMerchants: merchantsData.filter((m) => m.isVerified).length,
        totalTransfers: transfersData.length,
        activeTransfers: transfersData.filter((t) => t.isActive).length,
        totalTransferAmount,
        spentAmount,
      });
    } catch (err) {
      setError('Failed to load dashboard data. Some metrics may be unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (n: number) =>
    new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center h-64 text-gray-500">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Relief Operations Dashboard</h1>
          <p className="text-gray-500 mt-1">Real-time overview of aid distribution</p>
        </div>
        <button
          onClick={loadDashboardData}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-700 text-sm">
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Emergency Funds"
              value={stats.activeFunds}
              sub={`${stats.totalFunds} total`}
              color="text-blue-600"
            />
            <StatCard
              label="Beneficiaries"
              value={stats.activeBeneficiaries}
              sub={`${stats.totalBeneficiaries} registered`}
              color="text-green-600"
            />
            <StatCard
              label="Verified Merchants"
              value={stats.verifiedMerchants}
              sub={`${stats.totalMerchants} in network`}
              color="text-purple-600"
            />
            <StatCard
              label="Active Transfers"
              value={stats.activeTransfers}
              sub={`${stats.totalTransfers} total`}
              color="text-orange-600"
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fund allocation bar chart */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-4">Fund Overview</h2>
              <BarChart
                data={[
                  { label: 'Active', value: stats.activeFunds, color: '#3b82f6' },
                  { label: 'Inactive', value: stats.totalFunds - stats.activeFunds, color: '#d1d5db' },
                  { label: 'Transfers', value: stats.activeTransfers, color: '#f97316' },
                  { label: 'Merchants', value: stats.verifiedMerchants, color: '#8b5cf6' },
                  { label: 'Benefic.', value: stats.activeBeneficiaries, color: '#10b981' },
                ]}
              />
            </div>

            {/* Utilization donuts */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-4">Utilization Rates</h2>
              <div className="flex justify-around items-center h-40">
                <DonutChart
                  value={pct(stats.releasedAmount, stats.totalFundAmount)}
                  color="#3b82f6"
                  label="Funds Released"
                />
                <DonutChart
                  value={pct(stats.spentAmount, stats.totalTransferAmount)}
                  color="#f97316"
                  label="Transfers Spent"
                />
                <DonutChart
                  value={pct(stats.verifiedMerchants, stats.totalMerchants)}
                  color="#8b5cf6"
                  label="Merchants Verified"
                />
                <DonutChart
                  value={pct(stats.activeBeneficiaries, stats.totalBeneficiaries)}
                  color="#10b981"
                  label="Beneficiaries Active"
                />
              </div>
            </div>
          </div>

          {/* Financial summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Fund Amount" value={formatAmount(stats.totalFundAmount)} sub="XLM equivalent" />
            <StatCard label="Released to Date" value={formatAmount(stats.releasedAmount)} sub={`${pct(stats.releasedAmount, stats.totalFundAmount)}% of total`} />
            <StatCard label="Transfer Volume" value={formatAmount(stats.totalTransferAmount)} sub="across all transfers" />
            <StatCard label="Amount Spent" value={formatAmount(stats.spentAmount)} sub={`${pct(stats.spentAmount, stats.totalTransferAmount)}% utilization`} />
          </div>

          {/* Active funds table */}
          {funds.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-4">Active Emergency Funds</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-4 text-gray-500 font-medium">Fund</th>
                      <th className="text-left py-2 pr-4 text-gray-500 font-medium">Disaster</th>
                      <th className="text-left py-2 pr-4 text-gray-500 font-medium">Area</th>
                      <th className="text-right py-2 pr-4 text-gray-500 font-medium">Total</th>
                      <th className="text-right py-2 pr-4 text-gray-500 font-medium">Released</th>
                      <th className="text-right py-2 text-gray-500 font-medium">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((fund) => {
                      const total = parseInt(fund.totalAmount || '0');
                      const released = parseInt(fund.releasedAmount || '0');
                      const utilPct = pct(released, total);
                      const isExpiringSoon =
                        fund.expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
                      return (
                        <tr key={fund.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4">
                            <span className="font-medium text-gray-900">{fund.name}</span>
                            {isExpiringSoon && (
                              <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                                Expiring soon
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-600 capitalize">{fund.disasterType}</td>
                          <td className="py-2 pr-4 text-gray-600">{fund.geographicScope}</td>
                          <td className="py-2 pr-4 text-right text-gray-900">{formatAmount(total)}</td>
                          <td className="py-2 pr-4 text-right text-gray-900">{formatAmount(released)}</td>
                          <td className="py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-1.5">
                                <div
                                  className="bg-blue-500 h-1.5 rounded-full"
                                  style={{ width: `${utilPct}%` }}
                                />
                              </div>
                              <span className="text-gray-600 w-8 text-right">{utilPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
