// ============================================
// UsersTab — browse accounts, grant or end paid access, inspect scan history.
//
// The read side goes through admin_user_list (RPC, admin-gated in SQL). The
// write side goes through /api/admin, which re-checks profiles.is_admin
// server-side using the caller's token — hiding these buttons in the browser is
// convenience, the endpoint is the gate. That endpoint also refuses when an
// admin targets their own account, and that refusal is shown verbatim rather
// than swallowed, because it is a rule the operator needs to see.
// ============================================

import { Fragment, useEffect, useState } from 'react'
import { Card, Button, Input, Select, ConfirmDialog, EmptyState } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useAdminQuery } from './useAdminQuery'
import {
  AdminError, TableSkeleton, Pager,
  TABLE_WRAP, TABLE, TABLE_HEAD, TABLE_HEAD_CELL, TABLE_HEAD_CELL_NUM,
  TABLE_ROW, TABLE_CELL, TABLE_CELL_NUM, TABLE_CELL_STRONG,
} from './adminUi'
import { Gift, CircleSlash, History, ChevronDown, ChevronUp } from 'lucide-react'

interface UserRow {
  id: string
  email: string
  subscription_status: string | null
  subscription_plan_type: string | null
  subscription_expires_at: string | null
  created_at: string
  last_signin_at: string | null
  scans_30d: number
  total_count: number
}

interface ScanLogRow {
  scanned_at: string
  scan_mode: string | null
  status: string
  emails_processed: number
  transactions_found: number
  error_message: string | null
}

interface AdminUserOpsResponse {
  success?: boolean
  email?: string
  expiresAt?: string
  /** True when the account already held unexpired time that this grant added to. */
  extended?: boolean
  /** The plan an "end access" just cancelled out of the queue, if there was one. */
  cancelledQueuedPlan?: string | null
  /** Its Razorpay order id, so a refund can be traced. */
  cancelledQueuedOrderId?: string | null
  error?: string
}

type PlanType = 'monthly' | 'annual'

const PAGE_SIZE = 25
const HISTORY_LIMIT = 20
const COLUMN_COUNT = 8

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN')
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN')
}

async function callAdminUserOps(body: Record<string, unknown>): Promise<AdminUserOpsResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session expired. Please sign in again.')

  const response = await fetch('/api/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const result: AdminUserOpsResponse = await response.json()
  // The endpoint's 400s carry the real reason ("You cannot change your own
  // subscription here.", "Days must be…"). Surface it instead of a generic one.
  if (!response.ok) throw new Error(result.error || 'Request failed.')
  return result
}

// Mounted only while a row is expanded, so the hook — and the RPC — never runs
// with a missing user id.
function ScanHistory({ userId }: { userId: string }) {
  const { data, loading, error, reload } = useAdminQuery<ScanLogRow[]>('admin_user_scan_history', {
    target: userId,
    lim: HISTORY_LIMIT,
  })

  if (loading) return <TableSkeleton rows={3} cols={6} />

  if (error) {
    return <AdminError message={`Could not load scan history: ${error}`} onRetry={reload} />
  }

  if ((data?.length ?? 0) === 0) {
    return <p className="text-sm text-zinc-500">This account has never run a scan.</p>
  }

  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead className={TABLE_HEAD}>
          <tr>
            <th className={TABLE_HEAD_CELL}>Scanned</th>
            <th className={TABLE_HEAD_CELL}>Mode</th>
            <th className={TABLE_HEAD_CELL}>Status</th>
            <th className={TABLE_HEAD_CELL_NUM}>Emails</th>
            <th className={TABLE_HEAD_CELL_NUM}>Transactions</th>
            <th className={TABLE_HEAD_CELL}>Error</th>
          </tr>
        </thead>
        <tbody>
          {data!.map((log, index) => (
            <tr key={`${log.scanned_at}-${index}`} className={TABLE_ROW}>
              <td className={`${TABLE_CELL} whitespace-nowrap`}>{formatDateTime(log.scanned_at)}</td>
              <td className={TABLE_CELL}>{log.scan_mode ?? '—'}</td>
              <td className={TABLE_CELL}>{log.status}</td>
              <td className={TABLE_CELL_NUM}>{log.emails_processed}</td>
              <td className={TABLE_CELL_NUM}>{log.transactions_found}</td>
              <td className="px-4 py-3 text-[var(--status-danger-text)]">{log.error_message ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * How long typing must pause before the search actually runs.
 *
 * `search` feeds useAdminQuery's args, which are part of its request key, so
 * without this every keystroke fired admin_user_list — a SECURITY DEFINER
 * function doing an unanchored ILIKE over `profiles` plus two correlated
 * subqueries per returned row. Typing an eleven-character address issued
 * eleven full scans and eleven sets of those subqueries, of which ten were
 * discarded on arrival.
 */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Escape a search term so LIKE wildcards in it match literally.
 *
 * admin_user_list interpolates the term into `email ILIKE '%' || search || '%'`,
 * so a typed `%` matched anything and `_` matched any single character. Nobody
 * is attacking anything with this — the term is a bound parameter, not
 * concatenated SQL — but searching for an address containing an underscore
 * quietly returned the wrong rows, which is worse than returning none.
 *
 * Backslash first, or it would escape the escapes added after it. Postgres
 * LIKE/ILIKE treats backslash as the escape character by default.
 */
function escapeLikeWildcards(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`)
}

export default function UsersTab() {
  // `search` is what the box shows and must update on every keystroke, or
  // typing feels broken. `debouncedSearch` is what the RPC actually runs on.
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(escapeLikeWildcards(search)), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [grantFor, setGrantFor] = useState<string | null>(null)
  const [grantDays, setGrantDays] = useState('30')
  const [grantPlan, setGrantPlan] = useState<PlanType>('monthly')
  const [busyUser, setBusyUser] = useState<string | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const [opSuccess, setOpSuccess] = useState<string | null>(null)
  // The account a destructive "End access" is pending confirmation for.
  // Nothing here fires until the operator confirms in the dialog — same gate
  // window.confirm used to provide, just in the app's own shared component.
  const [expireTarget, setExpireTarget] = useState<UserRow | null>(null)

  const { data, loading, error, reload } = useAdminQuery<UserRow[]>('admin_user_list', {
    search: debouncedSearch,
    lim: PAGE_SIZE,
    off: page * PAGE_SIZE,
  })

  const total = data?.[0]?.total_count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  const openGrant = (userId: string) => {
    setOpError(null)
    setOpSuccess(null)
    setGrantFor((current) => (current === userId ? null : userId))
    setGrantDays('30')
    setGrantPlan('monthly')
  }

  const grant = async (user: UserRow) => {
    setBusyUser(user.id)
    setOpError(null)
    setOpSuccess(null)
    try {
      const result = await callAdminUserOps({
        action: 'grant',
        userId: user.id,
        days: Number(grantDays),
        planType: grantPlan,
      })
      // "extended to" rather than "now has ... for N days": the grant adds to
      // whatever the account already held, so quoting the number of days
      // granted next to the new expiry would read as a contradiction for
      // anyone who still had time left.
      setOpSuccess(
        result.extended
          ? `${user.email} had unexpired access, so ${grantDays} ${grantPlan} days were added — now valid until ${formatDate(result.expiresAt ?? null)}.`
          : `${user.email} now has ${grantPlan} access for ${grantDays} days (until ${formatDate(result.expiresAt ?? null)}).`
      )
      setGrantFor(null)
      reload()
    } catch (e) {
      setOpError((e as Error).message)
    } finally {
      setBusyUser(null)
    }
  }

  const confirmExpire = async () => {
    const user = expireTarget
    if (!user) return
    setBusyUser(user.id)
    setOpError(null)
    setOpSuccess(null)
    try {
      const result = await callAdminUserOps({ action: 'expire', userId: user.id })
      // Ending access also cancels a queued plan, which the customer has
      // already paid for. Nothing here refunds it, so the operator has to be
      // told plainly — with the order id, or the refund cannot be traced.
      setOpSuccess(
        result.cancelledQueuedPlan
          ? `Paid access for ${user.email} has ended. A queued ${result.cancelledQueuedPlan} plan was also cancelled — they PAID for it${result.cancelledQueuedOrderId ? ` (order ${result.cancelledQueuedOrderId})` : ''}, so refund it in Razorpay.`
          : `Paid access for ${user.email} has ended.`
      )
      setGrantFor(null)
      reload()
    } catch (e) {
      setOpError((e as Error).message)
    } finally {
      setBusyUser(null)
      setExpireTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        placeholder="Search by email"
      />

      {opError && (
        <p className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 py-2 text-sm text-[var(--status-danger-text)]">
          {opError}
        </p>
      )}
      {opSuccess && (
        <p className="rounded-lg border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] px-3 py-2 text-sm text-[var(--status-positive-text)]">
          {opSuccess}
        </p>
      )}

      {loading && (
        <Card noPadding>
          <TableSkeleton rows={6} cols={COLUMN_COUNT} />
        </Card>
      )}

      {error && <AdminError message={`Could not load users: ${error}`} onRetry={reload} />}

      {!loading && !error && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon="👤"
          title={debouncedSearch ? 'No matches' : 'No accounts yet'}
          description={debouncedSearch ? 'No accounts match that search.' : 'Accounts will appear here as people sign up.'}
        />
      )}

      {!loading && !error && (data?.length ?? 0) > 0 && (
        <Card noPadding className={TABLE_WRAP}>
          <table className={TABLE}>
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_HEAD_CELL}>Email</th>
                <th className={TABLE_HEAD_CELL}>Status</th>
                <th className={TABLE_HEAD_CELL}>Plan</th>
                <th className={TABLE_HEAD_CELL}>Expires</th>
                <th className={TABLE_HEAD_CELL}>Joined</th>
                <th className={TABLE_HEAD_CELL}>Last seen</th>
                <th className={TABLE_HEAD_CELL_NUM}>Scans 30d</th>
                <th className={TABLE_HEAD_CELL}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((u) => (
                <Fragment key={u.id}>
                  <tr className={TABLE_ROW}>
                    <td className={TABLE_CELL_STRONG}>{u.email}</td>
                    <td className={TABLE_CELL}>{u.subscription_status ?? '—'}</td>
                    <td className={TABLE_CELL}>{u.subscription_plan_type ?? '—'}</td>
                    <td className={TABLE_CELL}>{formatDate(u.subscription_expires_at)}</td>
                    <td className={TABLE_CELL}>{formatDate(u.created_at)}</td>
                    <td className={TABLE_CELL}>{formatDate(u.last_signin_at)}</td>
                    <td className={TABLE_CELL_NUM}>{u.scans_30d}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openGrant(u.id)}
                          disabled={busyUser === u.id}
                          className="gap-1.5 px-2"
                        >
                          <Gift className="h-3.5 w-3.5" /> Grant
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpireTarget(u)}
                          disabled={busyUser === u.id}
                          className="gap-1.5 px-2 text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]"
                        >
                          <CircleSlash className="h-3.5 w-3.5" /> End access
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setHistoryFor((current) => (current === u.id ? null : u.id))}
                          className="gap-1.5 px-2"
                          aria-expanded={historyFor === u.id}
                        >
                          <History className="h-3.5 w-3.5" />
                          History
                          {historyFor === u.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {grantFor === u.id && (
                    <tr className="border-b border-border-subtle/50 bg-surface-2/40">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-4">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-28">
                            <Input
                              label="Days"
                              value={grantDays}
                              onChange={(e) => setGrantDays(e.target.value)}
                              placeholder="30"
                              className="tnum"
                            />
                          </div>
                          <div className="w-40">
                            <Select
                              label="Plan"
                              value={grantPlan}
                              onChange={(e) => setGrantPlan(e.target.value === 'annual' ? 'annual' : 'monthly')}
                              options={[
                                { value: 'monthly', label: 'Monthly' },
                                { value: 'annual', label: 'Annual' },
                              ]}
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => grant(u)}
                            loading={busyUser === u.id}
                            disabled={grantDays.trim() === ''}
                          >
                            Grant access
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setGrantFor(null)}>
                            Cancel
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-zinc-500">
                          Between 1 and 365 days. Added to any unexpired time the account already
                          has, never replacing it. Recorded in payments as a ₹0 admin payment.
                        </p>
                      </td>
                    </tr>
                  )}

                  {historyFor === u.id && (
                    <tr className="border-b border-border-subtle/50 bg-surface-2/40">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-4">
                        <ScanHistory userId={u.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Pager
        page={page}
        pages={pages}
        total={total}
        noun="accounts"
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />

      <ConfirmDialog
        isOpen={!!expireTarget}
        onClose={() => setExpireTarget(null)}
        onConfirm={confirmExpire}
        title={`End access for ${expireTarget?.email}?`}
        message={
          `They lose premium features immediately, and any plan queued to start later is ` +
          `cancelled too — if they paid for one, you will need to refund it in Razorpay.`
        }
        confirmLabel="End access"
        danger
      />
    </div>
  )
}
