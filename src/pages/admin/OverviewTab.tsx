import { Card } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'
import { approximateMonthlyRevenue } from './adminMetrics'
import AdminBarChart from './AdminBarChart'
import RefundReviewCard from './RefundReviewCard'
import { StatCard, StatGridSkeleton, AdminError } from './adminUi'

interface OverviewRow {
  total_accounts: number
  signups_7d: number
  signups_30d: number
  paying_monthly: number
  paying_annual: number
  expiring_7d: number
  signins_7d: number
  signins_30d: number
  transactions_7d: number
  transactions_30d: number
  transactions_pending: number
}

interface GrowthRow {
  day: string
  signups: number
  signins: number
}

export default function OverviewTab() {
  const stats = useAdminQuery<OverviewRow[]>('admin_overview_stats')
  const growth = useAdminQuery<GrowthRow[]>('admin_growth_series', { days: 30 })

  if (stats.loading) {
    return (
      <div className="space-y-6">
        <StatGridSkeleton count={8} />
      </div>
    )
  }
  if (stats.error) {
    return <AdminError message={`Could not load overview: ${stats.error}`} onRetry={stats.reload} />
  }

  const s = stats.data?.[0]
  if (!s) return <p className="py-8 text-sm text-zinc-500">No data yet.</p>

  const paying = s.paying_monthly + s.paying_annual
  const mrr = approximateMonthlyRevenue(s.paying_monthly, s.paying_annual)

  return (
    <div className="space-y-6">
      {/* First thing on the page, and only when there is something to act on.
          A double charge is the one item here that costs a customer money
          while nobody is looking. Renders nothing on the happy path. */}
      <RefundReviewCard />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total accounts" value={String(s.total_accounts)} hint={`+${s.signups_7d} this week`} />
        <StatCard label="Paying" value={String(paying)} hint={`${s.paying_monthly} monthly · ${s.paying_annual} yearly`} emphasis />
        <StatCard label="Approx. revenue" value={`₹${mrr.toLocaleString('en-IN')}`} hint="per month, from current plans" emphasis />
        <StatCard label="Expiring in 7 days" value={String(s.expiring_7d)} hint="churn risk" />
        <StatCard label="Signed in (7d)" value={String(s.signins_7d)} hint={`${s.signins_30d} in 30 days`} />
        <StatCard label="New signups (30d)" value={String(s.signups_30d)} />
        <StatCard label="Transactions (30d)" value={String(s.transactions_30d)} hint={`${s.transactions_7d} this week`} />
        <StatCard label="Awaiting approval" value={String(s.transactions_pending)} hint="sitting in Pending" />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Signups per day (30 days)</h2>
        {growth.loading ? (
          <div className="skeleton h-40 rounded-xl" />
        ) : growth.error ? (
          <AdminError message={growth.error} onRetry={growth.reload} />
        ) : (
          <AdminBarChart
            data={(growth.data ?? []).map((g) => ({ label: g.day, value: g.signups }))}
            emptyMessage="No signups yet."
          />
        )}
      </Card>

      {/* This used to end "No payments table exists yet, so historic revenue
          cannot be shown." It has existed since migration 025, and
          verify-payment.ts, redeem-promo.ts and api/admin.ts have all been
          writing real receipts to it — with source and amount_inr — ever
          since. The panel was telling the operator the data did not exist
          while it was being collected. What is still true is narrower: this
          particular figure is a projection, and no view over `payments` has
          been built yet. */}
      <p className="text-xs text-zinc-500 leading-relaxed border-t border-border-subtle/50 pt-4">
        Revenue is approximate — projected from the plans people hold today, not read from
        payment records. It counts every active plan at list price, so accounts on an admin
        grant or a coupon are included even though nothing was paid for them. Real receipts
        are recorded in <code className="text-zinc-400">payments</code>; a historic view over
        them is not built yet.
      </p>
    </div>
  )
}
