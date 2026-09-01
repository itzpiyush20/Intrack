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
import { Card, Button, Input, Select } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useAdminQuery } from './useAdminQuery'

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

  if (loading) return <p className="text-sm text-zinc-400">Loading scan history…</p>

  if (error) {
    return (
      <div>
        <p className="text-sm text-red-400">Could not load scan history: {error}</p>
        <button onClick={reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
      </div>
    )
  }

  if ((data?.length ?? 0) === 0) {
    return <p className="text-sm text-zinc-500">This account has never run a scan.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 pr-4 font-medium">Scanned</th>
            <th className="py-1 pr-4 font-medium">Mode</th>
            <th className="py-1 pr-4 font-medium">Status</th>
            <th className="py-1 pr-4 font-medium">Emails</th>
            <th className="py-1 pr-4 font-medium">Transactions</th>
            <th className="py-1 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {data!.map((log, index) => (
            <tr key={`${log.scanned_at}-${index}`} className="text-zinc-400">
              <td className="py-1 pr-4 whitespace-nowrap">{formatDateTime(log.scanned_at)}</td>
              <td className="py-1 pr-4">{log.scan_mode ?? '—'}</td>
              <td className="py-1 pr-4">{log.status}</td>
              <td className="py-1 pr-4">{log.emails_processed}</td>
              <td className="py-1 pr-4">{log.transactions_found}</td>
              <td className="py-1 text-red-400">{log.error_message ?? '—'}</td>
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

  const expire = async (user: UserRow) => {
    // Taking away paid access is not undoable from here, so make it deliberate.
    if (!window.confirm(
      `End paid access for ${user.email}? They lose premium features immediately, ` +
      `and any plan queued to start later is cancelled too — if they paid for one, ` +
      `you will need to refund it in Razorpay.`
    )) {
      return
    }
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
    }
  }

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        placeholder="Search by email"
      />

      {opError && <p className="text-sm text-red-400">{opError}</p>}
      {opSuccess && <p className="text-sm text-emerald-400">{opSuccess}</p>}

      {loading && <p className="py-8 text-sm text-zinc-400">Loading…</p>}

      {error && (
        <div className="py-8">
          <p className="text-sm text-red-400">Could not load users: {error}</p>
          <button onClick={reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
        </div>
      )}

      {!loading && !error && (data?.length ?? 0) === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">
          {debouncedSearch ? 'No accounts match that search.' : 'No accounts yet.'}
        </p>
      )}

      {!loading && !error && (data?.length ?? 0) > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-subtle text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3">Scans 30d</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((u) => (
                <Fragment key={u.id}>
                  <tr className="border-b border-border-subtle/50">
                    <td className="px-4 py-3 text-zinc-200">{u.email}</td>
                    <td className="px-4 py-3 text-zinc-400">{u.subscription_status ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{u.subscription_plan_type ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(u.subscription_expires_at)}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(u.last_signin_at)}</td>
                    <td className="px-4 py-3 text-zinc-400">{u.scans_30d}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <button
                          onClick={() => openGrant(u.id)}
                          disabled={busyUser === u.id}
                          className="text-xs text-brand-400 underline disabled:opacity-40"
                        >
                          Grant
                        </button>
                        <button
                          onClick={() => expire(u)}
                          disabled={busyUser === u.id}
                          className="text-xs text-red-400 underline disabled:opacity-40"
                        >
                          End access
                        </button>
                        <button
                          onClick={() => setHistoryFor((current) => (current === u.id ? null : u.id))}
                          className="text-xs text-zinc-400 underline"
                        >
                          {historyFor === u.id ? 'Hide history' : 'History'}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {grantFor === u.id && (
                    <tr className="border-b border-border-subtle/50 bg-surface-1/40">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-28">
                            <label className="mb-1 block text-xs text-zinc-400">Days</label>
                            <Input
                              value={grantDays}
                              onChange={(e) => setGrantDays(e.target.value)}
                              placeholder="30"
                            />
                          </div>
                          <div className="w-40">
                            <label className="mb-1 block text-xs text-zinc-400">Plan</label>
                            <Select
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
                    <tr className="border-b border-border-subtle/50 bg-surface-1/40">
                      <td colSpan={COLUMN_COUNT} className="px-4 py-3">
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

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page + 1} of {pages} · {total} accounts</span>
          <button
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
