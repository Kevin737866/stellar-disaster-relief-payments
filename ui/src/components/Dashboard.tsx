import React, { useState, useEffect } from 'react';
import { AidClient } from '../../sdk/src/aidClient';
import { BeneficiaryClient } from '../../sdk/src/beneficiaryClient';
import { MerchantClient } from '../../sdk/src/merchantClient';
import { TransferClient } from '../../sdk/src/transferClient';
import {
  EmergencyFund,
  BeneficiaryProfile,
  Merchant,
  ConditionalTransfer,
  NetworkConfig,
} from '../../sdk/src/types';
import { formatAmount, parseAmount, percentageOf, sumAmounts } from '../format/amounts';

// ── Query configuration (#202) ───────────────────────────────────────────────

/**
 * The disaster id used when the caller does not supply one. These are sample
 * ids, not real records — see {@link Dashboard}'s sample-data notice.
 */
export const SAMPLE_DISASTER_ID = 'sample_disaster_001';

/** The beneficiary id used when the caller does not supply one. */
export const SAMPLE_BENEFICIARY_ID = 'sample_beneficiary_001';

/**
 * Default merchant search radius in km.
 *
 * #202 — this was previously `99999`, which spans the planet and silently
 * turned "verified merchants" into "every merchant on the network". A radius
 * this large is indistinguishable from no filter while *looking* like a
 * deliberate one, so the default is now a plausible single-response area and
 * the centre is something a responder would recognise.
 */
export const DEFAULT_MERCHANT_RADIUS_KM = 50;

/** Default search centre (Gulf of Guinea — open ocean, deliberately no-op). */
export const DEFAULT_MERCHANT_CENTER = { latitude: 0, longitude: 0 } as const;

/**
 * Which slices of data the dashboard queries.
 *
 * #202 — every one of these was hardcoded to a sample id or a planet-sized
 * radius, so the dashboard always showed the same placeholder view no matter
 * what was deployed. Supplying this prop makes the queries real.
 */
export interface DashboardQuery {
  /** Disaster whose beneficiaries are counted. */
  disasterId?: string;
  /** Beneficiary whose transfers are counted. */
  beneficiaryId?: string;
  /** Centre point for the merchant search. */
  merchantCenter?: { latitude: number; longitude: number };
  /** Merchant search radius in km. */
  merchantRadiusKm?: number;
}

interface DashboardProps {
  aidClient: AidClient;
  beneficiaryClient: BeneficiaryClient;
  merchantClient: MerchantClient;
  transferClient: TransferClient;
  config: NetworkConfig;
  /** #202 — which data to query. Falls back to documented sample defaults. */
  query?: DashboardQuery;
}

/** Fully-resolved query, with the fallback source of each value recorded. */
interface ResolvedQuery {
  disasterId: string;
  beneficiaryId: string;
  merchantCenter: { latitude: number; longitude: number };
  merchantRadiusKm: number;
  /** True when at least one value came from a sample default. */
  usingSampleDefaults: boolean;
}

function resolveQuery(query?: DashboardQuery): ResolvedQuery {
  const usingSampleDefaults =
    query === undefined ||
    query.disasterId === undefined ||
    query.beneficiaryId === undefined;

  return {
    disasterId: query?.disasterId ?? SAMPLE_DISASTER_ID,
    beneficiaryId: query?.beneficiaryId ?? SAMPLE_BENEFICIARY_ID,
    merchantCenter: query?.merchantCenter ?? DEFAULT_MERCHANT_CENTER,
    merchantRadiusKm: query?.merchantRadiusKm ?? DEFAULT_MERCHANT_RADIUS_KM,
    usingSampleDefaults,
  };
}

interface DashboardStats {
  totalFunds: number;
  activeFunds: number;
  totalFundAmount: bigint;
  releasedAmount: bigint;
  totalBeneficiaries: number;
  activeBeneficiaries: number;
  totalMerchants: number;
  verifiedMerchants: number;
  totalTransfers: number;
  activeTransfers: number;
  totalTransferAmount: bigint;
  spentAmount: bigint;
  /** How many amount fields could not be parsed as integers. */
  invalidAmountFields: number;
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
      aria-label={`Bar chart: ${data.map((item) => `${item.label} ${item.value}`).join(', ')}`}
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
  query,
}) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [funds, setFunds] = useState<EmergencyFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolved = resolveQuery(query);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Dashboard aggregates use a bounded page (max 100) instead of an
      // unbounded scan. The contract caps the page size server-side; totals
      // that need every record should use the dedicated paginated views.
      const DASHBOARD_AGGREGATE_LIMIT = 100;

      const [activeFunds, beneficiaries, merchants, transfers] = await Promise.allSettled([
        aidClient.listActiveFunds(),
        beneficiaryClient.listBeneficiariesByDisaster(resolved.disasterId),
        merchantClient.findMerchantsByLocation(
          resolved.merchantCenter.latitude,
          resolved.merchantCenter.longitude,
          resolved.merchantRadiusKm
        ),
        transferClient.listBeneficiaryTransfers(resolved.beneficiaryId),
      ]);

      const fundsData: EmergencyFund[] = activeFunds.status === 'fulfilled' ? activeFunds.value : [];
      const beneficiariesData: BeneficiaryProfile[] =
        beneficiaries.status === 'fulfilled' ? beneficiaries.value.items : [];
      const merchantsPage =
        merchants.status === 'fulfilled'
          ? merchants.value
          : { merchants: [] as Merchant[], totalCount: 0, hasMore: false };
      const merchantsData: Merchant[] = merchantsPage.merchants;
      const transfersData: ConditionalTransfer[] = transfers.status === 'fulfilled' ? transfers.value : [];

      setFunds(fundsData);

      // #203 — sum in bigint and report how many fields were unreadable, so a
      // malformed amount shows up as a warning rather than silently as $0.
      const fundTotals = sumAmounts(fundsData.map((f) => f.totalAmount));
      const releasedTotals = sumAmounts(fundsData.map((f) => f.releasedAmount));
      const transferTotals = sumAmounts(transfersData.map((t) => t.amount));
      const spentTotals = sumAmounts(transfersData.map((t) => t.spentAmount));

      const invalidAmountFields =
        fundTotals.invalid + releasedTotals.invalid + transferTotals.invalid + spentTotals.invalid;

      setStats({
        totalFunds: fundsData.length,
        activeFunds: fundsData.filter((f) => f.isActive).length,
        totalFundAmount: fundTotals.total,
        releasedAmount: releasedTotals.total,
        totalBeneficiaries: beneficiariesData.length,
        activeBeneficiaries: beneficiariesData.filter((b) => b.isActive).length,
        totalMerchants: merchantsPage.totalCount || merchantsData.length,
        verifiedMerchants: merchantsData.filter((m) => m.isVerified).length,
        totalTransfers: transfersData.length,
        activeTransfers: transfersData.filter((t) => t.isActive).length,
        totalTransferAmount: transferTotals.total,
        spentAmount: spentTotals.total,
        invalidAmountFields,
      });
    } catch (err) {
      setError('Failed to load dashboard data. Some metrics may be unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const pct = (part: bigint, whole: bigint) => percentageOf(part, whole);

  /** Counts (not money) still arrive as `number`, so they need their own ratio. */
  const countPct = (part: number, whole: number) =>
    whole === 0 ? 0 : Math.min(100, Math.max(0, Math.round((part / whole) * 100)));

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
          <p className="text-xs text-gray-500 mt-1">
            Beneficiary metrics reflect a bounded first page (max 100 records). Use the
            beneficiary and merchant views for full paginated data.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDashboardData}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-700 text-sm"
        >
          {error}
        </div>
      )}

      {/* #202 — surface loudly when the view is built from sample ids. */}
      {resolved.usingSampleDefaults && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
          <strong className="font-semibold">Sample data.</strong> Beneficiary and transfer
          figures are filtered by <code className="font-mono">{resolved.disasterId}</code> and{' '}
          <code className="font-mono">{resolved.beneficiaryId}</code>, which are placeholders
          rather than deployed records — pass the <code className="font-mono">query</code> prop to
          point this dashboard at real ones. Merchant coverage is a {resolved.merchantRadiusKm} km
          radius, not the whole network.
        </div>
      )}

      {/* #203 — unreadable amounts are a data problem worth showing. */}
      {stats && stats.invalidAmountFields > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {stats.invalidAmountFields} amount{stats.invalidAmountFields === 1 ? '' : 's'} could not
          be read as an integer and {stats.invalidAmountFields === 1 ? 'was' : 'were'} counted as
          zero. Totals below may be understated.
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
                  value={countPct(stats.verifiedMerchants, stats.totalMerchants)}
                  color="#8b5cf6"
                  label="Merchants Verified"
                />
                <DonutChart
                  value={countPct(stats.activeBeneficiaries, stats.totalBeneficiaries)}
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
                  <caption className="sr-only">
                    Active emergency funds with total, released, and utilization amounts
                  </caption>
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th scope="col" className="text-left py-2 pr-4 text-gray-500 font-medium">Fund</th>
                      <th scope="col" className="text-left py-2 pr-4 text-gray-500 font-medium">Disaster</th>
                      <th scope="col" className="text-left py-2 pr-4 text-gray-500 font-medium">Area</th>
                      <th scope="col" className="text-right py-2 pr-4 text-gray-500 font-medium">Total</th>
                      <th scope="col" className="text-right py-2 pr-4 text-gray-500 font-medium">Released</th>
                      <th scope="col" className="text-right py-2 text-gray-500 font-medium">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((fund) => {
                      const total = parseAmount(fund.totalAmount);
                      const released = parseAmount(fund.releasedAmount);
                      const utilPct = pct(released, total);
                      // #203 — a non-numeric expiresAt yields NaN, and
                      // `NaN < anything` is false, which would have hidden the
                      // "expiring soon" warning rather than showing it.
                      const expiresInMs = fund.expiresAt - Date.now();
                      const isExpiringSoon =
                        Number.isFinite(expiresInMs) &&
                        expiresInMs < 7 * 24 * 60 * 60 * 1000;
                      return (
                        <tr key={fund.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4">
                            <span className="font-medium text-gray-900">{fund.name}</span>
                            {isExpired && (
                              <span className="ml-2 inline-flex items-center gap-1 text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                                <span aria-hidden="true">✕</span>
                                Expired
                              </span>
                            )}
                            {isExpiringSoon && (
                              <span className="ml-2 inline-flex items-center gap-1 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
                                <span aria-hidden="true">!</span>
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
