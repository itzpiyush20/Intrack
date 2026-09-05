// ============================================
// RefundReviewCard — purchases that landed on an occupied queue.
//
// create-order.ts refuses a second purchase while a plan is queued, so two only
// get through on near-simultaneous submission: a double-clicked button, or
// gateway lag. apply_plan_purchase() returns 'queue_extended' and adds the
// duration onto the queued plan rather than dropping it — money already taken
// must always buy the customer time.
//
// That is right, and it is not the whole answer. The published Cancellation &
// Refund Policy commits to refunding a payment source "charged multiple times
// for a single subscription cycle due to payment gateway lag or server errors",
// and silently turning that charge into extra days leaves the customer unaware
// they paid twice and the operator unaware they owe a refund.
//
// Nothing here moves money. Refunding is a Razorpay action and a human
// judgement; this card exists so the judgement gets made at all.
//
// It renders NOTHING when there is nothing to review, which is almost always.
// A card that is permanently present with a zero in it is a card the operator
// stops reading.
// ============================================

import { useState } from 'react'
import { Card } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAdminQuery } from './useAdminQuery'

interface ChargeRow {
  id: string
  email: string
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  plan_type: string
  amount_inr: number
  created_at: string
}

export default function RefundReviewCard() {
  const { user } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, loading, error, reload } = useAdminQuery<ChargeRow[]>('admin_charges_needing_review', {
    lim: 50,
  })

  const rows = data ?? []

  // Silent while loading and silent on the happy path. The only failure worth
  // showing is one that could HIDE a pending refund — if the query errored,
  // "nothing to review" would be a lie.
  if (loading) return null
  if (error) {
    return (
      <Card className="border-amber-200/80 bg-amber-50/70 p-4 shadow-card">
        <p className="text-sm font-semibold text-amber-900">
          Could not check for double charges: {error}
        </p>
        <p className="mt-1 text-xs text-sb-ink-muted">
          If this says the function does not exist, run supabase/041_flag_double_charges.sql.
        </p>
        <button onClick={reload} className="mt-2 text-sm font-semibold text-brand-600 underline hover:text-brand-700">Retry</button>
      </Card>
    )
  }
  if (rows.length === 0) return null

  const markReviewed = async (row: ChargeRow) => {
    setBusyId(row.id)
    setActionError(null)
    // Migration 041 adds an admin-only UPDATE policy on payments, so this
    // writes directly — same as marking feedback or a support ticket handled.
    const { error: updateError } = await supabase
      .from('payments')
      .update({ refund_reviewed_at: new Date().toISOString(), refund_reviewed_by: user?.id ?? null })
      .eq('id', row.id)

    setBusyId(null)
    if (updateError) {
      setActionError(`Could not mark that reviewed: ${updateError.message}`)
      return
    }
    reload()
  }

  return (
    <Card className="border-amber-200/80 bg-amber-50/50 p-4 shadow-card">
      <h2 className="text-sm font-semibold text-amber-900">
        {rows.length === 1
          ? '1 payment may need refunding'
          : `${rows.length} payments may need refunding`}
      </h2>
      <p className="mt-1 text-xs text-sb-ink-secondary leading-relaxed">
        These purchases arrived while a plan was already queued — almost always a double-click
        or gateway lag. The customer was charged and the time was added to their queued plan,
        so nobody lost anything. But your refund policy covers duplicate charges, and the
        customer has not been told. Refund in Razorpay using the order id, or mark it reviewed
        if you have decided not to.
      </p>

      {actionError && <p className="mt-3 text-sm text-rose-600 font-medium">{actionError}</p>}

      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-2 rounded-xl border border-sb-hairline bg-surface-1 p-3 text-xs sm:flex-row sm:items-center sm:justify-between shadow-xs"
          >
            <div className="min-w-0">
              <p className="font-semibold text-sb-ink">{row.email}</p>
              <p className="mt-0.5 text-sb-ink-muted">
                ₹{Number(row.amount_inr).toLocaleString('en-IN')} · {row.plan_type} ·{' '}
                {new Date(row.created_at).toLocaleString('en-IN')}
              </p>
              {/* Selectable and monospaced: this gets pasted into Razorpay. */}
              <p className="mt-0.5 font-mono text-[11px] text-sb-ink-muted select-all break-all">
                {row.razorpay_order_id ?? 'no order id'}
                {row.razorpay_payment_id ? ` · ${row.razorpay_payment_id}` : ''}
              </p>
            </div>
            <button
              onClick={() => markReviewed(row)}
              disabled={busyId === row.id}
              className="shrink-0 text-xs font-semibold text-brand-600 underline hover:text-brand-700 disabled:opacity-40 cursor-pointer"
            >
              {busyId === row.id ? 'Saving…' : 'Mark reviewed'}
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}
