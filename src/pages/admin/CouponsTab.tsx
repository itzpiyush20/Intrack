// ============================================
// CouponsTab — create and manage coupon codes.
//
// The only part of the admin panel that writes. Every call goes through
// /api/admin, which re-checks profiles.is_admin server-side using the
// caller's token. Nothing here is trusted: hiding this tab in the browser is
// convenience, the endpoint is the gate.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { Card, Button, Input } from '@/components/ui'
import { supabase } from '@/services/supabase'

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

  const remove = async (target: PromoCode) => {
    if (!window.confirm(`Delete ${target.code}? Nobody has redeemed it, so nothing is lost.`)) return

    try {
      await callAdminPromo({ action: 'delete', code: target.code })
      setSuccess(`Coupon ${target.code} deleted.`)
      load()
    } catch (e) {
      setFormError(`Could not delete ${target.code}: ${(e as Error).message}`)
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
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-zinc-200">Create a coupon</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Anyone who has the code can redeem it once, for as long as the code is still
          valid. Each person gets full premium access counted from the day they redeem,
          so someone redeeming on the last day still gets the full run.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Code</label>
            <Input
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
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Valid for (days)</label>
            <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" />
            <p className="mt-1 text-[11px] text-zinc-500">
              Code works for this many days from today, and each person who redeems it
              gets this many days of access from their own redemption date.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Plan granted</label>
            <select
              value={planType}
              onChange={(e) => setPlanType(e.target.value === 'annual' ? 'annual' : 'monthly')}
              className="h-11 w-full rounded-xl border border-border-subtle/50 bg-surface-2 px-3 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              Which plan the coupon grants. The LENGTH of access is set by the days field —
              this only decides which plan name the account ends up on.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Usage limit (blank = unlimited)</label>
            <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="100" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Note (optional, for you)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Instagram launch" />
          </div>
        </div>

        {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}
        {success && <p className="mt-3 text-sm text-emerald-400">{success}</p>}

        <div className="mt-4">
          <Button onClick={create} disabled={saving || !code.trim()}>
            {saving ? 'Creating…' : 'Create coupon'}
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <h2 className="border-b border-border-subtle p-4 text-sm font-semibold text-zinc-200">
          Existing coupons
        </h2>

        {loading && <p className="p-4 text-sm text-zinc-400">Loading…</p>}
        {error && (
          <div className="p-4">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-brand-400 underline">Retry</button>
          </div>
        )}
        {!loading && !error && codes.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">No coupons yet. Create one above.</p>
        )}

        {!loading && !error && codes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-subtle text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Grants</th>
                  <th className="px-4 py-3">Used</th>
                  <th className="px-4 py-3">Code expires</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.code} className="border-b border-border-subtle/50">
                    <td className="px-4 py-3 font-medium text-zinc-200">{c.code}</td>
                    <td className="px-4 py-3 text-zinc-400">{c.duration_days} days · {c.plan_type}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {c.used_count}{c.max_uses !== null ? ` / ${c.max_uses}` : ''}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString('en-IN') : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={c.active ? 'text-emerald-400' : 'text-zinc-500'}>
                        {c.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{c.note || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => toggle(c)} className="text-xs text-brand-400 underline">
                        {c.active ? 'Disable' : 'Enable'}
                      </button>
                      {/* Only unused codes can be deleted; once redeemed, the
                          record of who got free access must outlive the code. */}
                      {c.used_count === 0 && (
                        <button onClick={() => remove(c)} className="ml-3 text-xs text-red-400 underline">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-zinc-500">
        Disable pauses a code but keeps it listed. Delete removes it entirely and stops
        anyone redeeming it — people who already redeemed it keep the access they were
        given, and the record of who redeemed it is kept underneath. A user can redeem
        any given code only once.
      </p>
    </div>
  )
}
