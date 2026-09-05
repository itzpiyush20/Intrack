import { useState } from 'react'
import { Card, Badge } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'
import { scanSuccessRate } from './adminMetrics'
import AdminBarChart from './AdminBarChart'
import { StatCard, StatGridSkeleton, AdminError, TableSkeleton, TABLE_WRAP, TABLE, TABLE_HEAD, TABLE_HEAD_CELL, TABLE_ROW, TABLE_CELL } from './adminUi'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'

interface ScannerRow {
  day: string
  manual_scans: number
  scheduled_scans: number
  succeeded: number
  partial: number
  failed: number
  emails_processed: number
  transactions_found: number
}

interface FailureRow {
  scanned_at: string
  email: string
  error_message: string | null
  scan_mode: string | null
}

interface GateRow {
  gate: string
  rejections: number
}

interface GateSenderRow {
  sender_domain: string
  rejections: number
  last_seen: string
}

// Fragments that mark a sending domain as "probably real money mail". A gate
// rejecting these is throwing away receipts the user wanted; a gate rejecting
// newsletters and shopping blasts is doing its job. This is a display hint
// only — it colours the row so the distinction is visible at a glance, it does
// not change what the scanner does.
const FINANCIAL_DOMAIN_HINTS = [
  'bank', 'hdfc', 'icici', 'sbi', 'axis', 'kotak', 'idfc', 'indusind', 'yesbank',
  'rbl', 'canara', 'pnb', 'bob', 'federal', 'aubank', 'bandhan',
  'paytm', 'phonepe', 'gpay', 'googlepay', 'amazonpay', 'upi', 'cred',
  'razorpay', 'payu', 'billdesk', 'cashfree', 'visa', 'mastercard', 'amex',
  'americanexpress', 'onecard', 'slice', 'jupiter', 'fi.money', 'niyo',
]

function looksFinancial(domain: string): boolean {
  const lower = domain.toLowerCase()
  return FINANCIAL_DOMAIN_HINTS.some((hint) => lower.includes(hint))
}

// Rendered only while a gate is selected. Keeping it in its own component means
// useAdminQuery is mounted with a real gate every time it runs — no conditional
// hook, and no need for the hook to support "don't fetch yet".
function GateSenders({ gate }: { gate: string }) {
  const senders = useAdminQuery<GateSenderRow[]>('admin_gate_senders', {
    target_gate: gate,
    days: 30,
    lim: 20,
  })

  if (senders.loading) return <TableSkeleton rows={3} cols={3} />

  if (senders.error) {
    return <div className="p-3"><AdminError message={`Could not load senders: ${senders.error}`} onRetry={senders.reload} /></div>
  }

  const rows = senders.data ?? []
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-sm text-zinc-500">No senders recorded for this gate.</p>
  }

  const flagged = rows.filter((r) => looksFinancial(r.sender_domain)).length

  return (
    <div className="px-3 py-3">
      <p className="mb-2 text-xs text-zinc-500 leading-relaxed">
        {flagged === 0
          ? 'Top senders this gate rejected. None look like a bank or payment provider.'
          : `Top senders this gate rejected. ${flagged} look${flagged === 1 ? 's' : ''} like a bank or payment provider — check these.`}
      </p>
      <div className={TABLE_WRAP}>
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1.5 pr-4 font-medium">Sender domain</th>
              <th className="py-1.5 pr-4 text-right font-medium">Rejected</th>
              <th className="py-1.5 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const financial = looksFinancial(r.sender_domain)
              return (
                <tr key={r.sender_domain} className="border-t border-border-subtle/40">
                  <td className={`py-1.5 pr-4 ${financial ? 'font-semibold text-[var(--status-warning-text)]' : 'text-zinc-300'}`}>
                    <span className="inline-flex items-center gap-1.5">
                      {financial && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      {r.sender_domain}
                    </span>
                    {financial && (
                      <Badge variant="warning" className="ml-2 py-0 text-[10px]">bank / payments</Badge>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tnum text-zinc-400">{r.rejections}</td>
                  <td className="py-1.5 text-right tnum text-zinc-500">
                    {new Date(r.last_seen).toLocaleDateString('en-IN')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        Domains only — subject lines are never shown here.
      </p>
    </div>
  )
}

export default function ScannerTab() {
  const [openGate, setOpenGate] = useState<string | null>(null)
  const stats = useAdminQuery<ScannerRow[]>('admin_scanner_stats', { days: 30 })
  const failures = useAdminQuery<FailureRow[]>('admin_scan_failures', { lim: 20 })
  const gates = useAdminQuery<GateRow[]>('admin_rejection_gates', { days: 30 })

  if (stats.loading) return <StatGridSkeleton count={4} />
  if (stats.error) {
    return <AdminError message={`Could not load scanner stats: ${stats.error}`} onRetry={stats.reload} />
  }

  const rows = stats.data ?? []
  const totals = rows.reduce(
    (acc, r) => ({
      succeeded: acc.succeeded + r.succeeded,
      partial: acc.partial + r.partial,
      failed: acc.failed + r.failed,
      manual: acc.manual + r.manual_scans,
      scheduled: acc.scheduled + r.scheduled_scans,
      emails: acc.emails + r.emails_processed,
      found: acc.found + r.transactions_found,
    }),
    { succeeded: 0, partial: 0, failed: 0, manual: 0, scheduled: 0, emails: 0, found: 0 }
  )

  const rate = scanSuccessRate(totals)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Success rate" value={rate === null ? '—' : `${rate}%`} hint="partial counts as success" emphasis />
        <StatCard label="Failed scans" value={String(totals.failed)} hint="last 30 days" />
        <StatCard label="Manual / auto" value={`${totals.manual} / ${totals.scheduled}`} />
        <StatCard label="Txns found" value={String(totals.found)} hint={`from ${totals.emails} emails`} />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Scans per day (30 days)</h2>
        <AdminBarChart
          data={rows.map((r) => ({ label: r.day, value: r.manual_scans + r.scheduled_scans }))}
          emptyMessage="No scans yet."
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Rejections by gate (30 days)</h2>
        {gates.loading ? (
          <TableSkeleton rows={3} cols={2} />
        ) : (gates.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No rejections recorded.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-zinc-500">
              Select a gate to see which domains it is rejecting.
            </p>
            <ul className="space-y-1 text-sm">
              {gates.data!.map((g) => {
                const open = openGate === g.gate
                return (
                  <li key={g.gate}>
                    <button
                      type="button"
                      onClick={() => setOpenGate(open ? null : g.gate)}
                      aria-expanded={open}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                        open ? 'bg-surface-2 text-zinc-100' : 'text-zinc-300'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                        {g.gate}
                      </span>
                      <span className="tnum text-zinc-500">{g.rejections}</span>
                    </button>
                    {open && (
                      <div className="mt-1 rounded-lg border border-border-subtle/60 bg-surface-2/40">
                        <GateSenders gate={g.gate} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Recent failures</h2>
        {failures.loading ? (
          <TableSkeleton rows={3} cols={2} />
        ) : (failures.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No failed scans. Good.</p>
        ) : (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_HEAD_CELL}>Email</th>
                  <th className={TABLE_HEAD_CELL}>Mode</th>
                  <th className={TABLE_HEAD_CELL}>When</th>
                  <th className={TABLE_HEAD_CELL}>Error</th>
                </tr>
              </thead>
              <tbody>
                {failures.data!.map((f, i) => (
                  <tr key={i} className={TABLE_ROW}>
                    <td className={TABLE_CELL}>{f.email}</td>
                    <td className={TABLE_CELL}>{f.scan_mode ?? 'unknown'}</td>
                    <td className={`${TABLE_CELL} whitespace-nowrap tnum`}>{new Date(f.scanned_at).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-[var(--status-danger-text)]">{f.error_message ?? 'no message'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
