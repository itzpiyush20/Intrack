// ============================================
// CouponsTab — create and manage coupon codes.
//
// The only part of the admin panel that writes. Every call goes through
// /api/admin, which re-checks profiles.is_admin server-side using the
// caller's token. Nothing here is trusted: hiding this tab in the browser is
// convenience, the endpoint is the gate.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { Card, Button, Input, Select, ConfirmDialog, EmptyState, Badge } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { AdminError, TableSkeleton, TABLE_WRAP, TABLE, TABLE_HEAD, TABLE_HEAD_CELL, TABLE_HEAD_CELL_NUM, TABLE_ROW, TABLE_CELL, TABLE_CELL_NUM, TABLE_CELL_STRONG } from './adminUi'
import { Plus } from 'lucide-react'

interface PromoCode {
  code: string
  plan_type: 'monthly' | 'annual'
  duration_days: number
  active: boolean
  max_uses: number | null
  used_count: number
  note: string | null
  created_at: string
  /** When the CODE stops working. Null = never. Not the length of access it grants. */
  expires_at: string | null
}

interface AdminPromoResponse {
  codes?: PromoCode[]
  success?: boolean
  code?: string
  error?: string
}

async function callAdminPromo(body: Record<string, unknown> | null): Promise<AdminPromoResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session expired. Please sign in again.')

  const response = await fetch('/api/admin', {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Request failed.')
  return result
}

export default function CouponsTab() {
  // Same shape as useAdminQuery: state is written only from the async
  // callback, and `loading` is derived by comparing the settled result's key
  // to the current one. Setting it synchronously inside the effect would cause
  // a cascading render and trips react-hooks/set-state-in-effect.
  const [refreshKey, setRefreshKey] = useState(0)
  const [result, setResult] = useState<{ key: number; codes: PromoCode[]; error: string | null }>({
    key: -1,
    codes: [],
    error: null,
  })

  const [code, setCode] = useState('')
  // The endpoint has always accepted 'annual' and promo_codes has always stored
  // it; this form just hardcoded 'monthly', so yearly coupons were unreachable
  // from the panel and could only be created by hand in SQL.
  const [planType, setPlanType] = useState<'monthly' | 'annual'>('monthly')
  const [days, setDays] = useState('30')
  const [maxUses, setMaxUses] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // The coupon a delete is pending confirmation for — same gate window.confirm
  // used to provide, now the shared confirm dialog so it matches every other
  // destructive action in the app.
  const [deleteTarget, setDeleteTarget] = useState<PromoCode | null>(null)

  const load = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    callAdminPromo(null)
      .then((response) => {
        if (!cancelled) setResult({ key: refreshKey, codes: response.codes ?? [], error: null })
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ key: refreshKey, codes: [], error: e.message })
      })
    return () => { cancelled = true }
  }, [refreshKey])

  const loading = result.key !== refreshKey
  const codes = result.codes
  const error = result.error

  const create = async () => {
    setSaving(true)
    setFormError(null)
    setSuccess(null)
    try {
      const created = await callAdminPromo({
        action: 'create',
        code,
        durationDays: Number(days),
        maxUses: maxUses.trim() === '' ? null : Number(maxUses),
        // One number, two jobs: the code stays redeemable for this many days,
        // and each person who redeems it gets this many days of access from
        // their own redemption date.
        codeValidDays: Number(days),
        planType,
        note,
      })
      setSuccess(`Coupon ${created.code} created — usable for the next ${days} days, and gives each person ${days} days of ${planType} access.`)
      setCode(''); setPlanType('monthly'); setDays('30'); setMaxUses(''); setNote('')
      load()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    if (!target) return
    try {
      await callAdminPromo({ action: 'delete', code: target.code })
      setSuccess(`Coupon ${target.code} deleted.`)
      load()
    } catch (e) {
      setFormError(`Could not delete ${target.code}: ${(e as Error).message}`)
    } finally {
      setDeleteTarget(null)
    }
  }

  const toggle = async (target: PromoCode) => {
    try {
      await callAdminPromo({ action: 'set_active', code: target.code, active: !target.active })
      load()
    } catch (e) {
      setFormError(`Could not update ${target.code}: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-1 text-base font-bold text-zinc-100">Create a coupon</h2>
        <p className="mb-4 text-sm text-zinc-400 leading-relaxed">
          Anyone who has the code can redeem it once, for as long as the code is still
          valid. Each person gets full premium access counted from the day they redeem,
          so someone redeeming on the last day still gets the full run.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              // Clear the previous result once a new code is being typed,
              // otherwise the panel reads as if THIS code was just created.
              setSuccess(null)
              setFormError(null)
            }}
            placeholder="DIWALI2026"
          />
          <div>
            <Input label="Valid for (days)" value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" className="tnum" />
            <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
              Code works for this many days from today, and each person who redeems it
              gets this many days of access from their own redemption date.
            </p>
          </div>
          <div>
            <Select
              label="Plan granted"
              value={planType}
              onChange={(e) => setPlanType(e.target.value === 'annual' ? 'annual' : 'monthly')}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Annual' },
              ]}
            />
            <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
              Which plan the coupon grants. The length of access is set by the days field —
              this only decides which plan name the account ends up on.
            </p>
          </div>
          <Input
            label="Usage limit (blank = unlimited)"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="100"
            className="tnum"
          />
          <div className="sm:col-span-2">
            <Input label="Note (optional, for you)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Instagram launch" />
          </div>
        </div>

        {formError && (
          <p className="mt-3 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 py-2 text-sm text-[var(--status-danger-text)]">
            {formError}
          </p>
        )}
        {success && (
          <p className="mt-3 rounded-lg border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] px-3 py-2 text-sm text-[var(--status-positive-text)]">
            {success}
          </p>
        )}

        <div className="mt-4">
          <Button onClick={create} loading={saving} disabled={saving || !code.trim()} className="gap-1.5">
            <Plus className="h-4 w-4" /> Create coupon
          </Button>
        </div>
      </Card>

      <Card noPadding>
        <h2 className="border-b border-border-subtle p-4 text-base font-bold text-zinc-100">
          Existing coupons
        </h2>

        {loading && <TableSkeleton rows={4} cols={7} />}
        {error && <div className="p-4"><AdminError message={error} onRetry={load} /></div>}
        {!loading && !error && codes.length === 0 && (
          <EmptyState icon="🎟️" title="No coupons yet" description="Create one above to give someone free access." />
        )}

        {!loading && !error && codes.length > 0 && (
          <div className={TABLE_WRAP}>
            <table className={TABLE}>
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className={TABLE_HEAD_CELL}>Code</th>
                  <th className={TABLE_HEAD_CELL}>Grants</th>
                  <th className={TABLE_HEAD_CELL_NUM}>Used</th>
                  <th className={TABLE_HEAD_CELL}>Code expires</th>
                  <th className={TABLE_HEAD_CELL}>Status</th>
                  <th className={TABLE_HEAD_CELL}>Note</th>
                  <th className={TABLE_HEAD_CELL}></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.code} className={TABLE_ROW}>
                    <td className={TABLE_CELL_STRONG}>{c.code}</td>
                    <td className={`${TABLE_CELL} tnum`}>{c.duration_days} days · {c.plan_type}</td>
                    <td className={TABLE_CELL_NUM}>
                      {c.used_count}{c.max_uses !== null ? ` / ${c.max_uses}` : ''}
                    </td>
                    <td className={`${TABLE_CELL} tnum`}>
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-IN') : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.active ? 'success' : 'default'}>{c.active ? 'Active' : 'Disabled'}</Badge>
                    </td>
                    <td className={`${TABLE_CELL} text-zinc-500`}>{c.note || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toggle(c)} className="px-2">
                          {c.active ? 'Disable' : 'Enable'}
                        </Button>
                        {/* Only unused codes can be deleted; once redeemed, the
                            record of who got free access must outlive the code. */}
                        {c.used_count === 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(c)}
                            className="px-2 text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]"
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-zinc-500 leading-relaxed">
        Disable pauses a code but keeps it listed. Delete removes it entirely and stops
        anyone redeeming it — people who already redeemed it keep the access they were
        given, and the record of who redeemed it is kept underneath. A user can redeem
        any given code only once.
      </p>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deleteTarget?.code}?`}
        message="Nobody has redeemed it, so nothing is lost. This cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}
