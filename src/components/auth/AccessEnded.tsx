// ============================================
// AccessEnded — what a lapsed account sees instead of the app
//
// There is no free tier (owner decision, 2026-09-04): after the 7-day trial,
// access stops unless the user pays. ProtectedRoute used to answer that with a
// bare `<Navigate to="/pricing">`, which drops someone onto a long marketing
// page with no explanation of why they landed there and no word about the data
// they spent a week entering. That reads as the app being broken at exactly the
// moment they decide whether to pay.
//
// This screen says three things instead: what happened, that nothing was
// deleted, and what it costs to come back.
// ============================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/context'
import { PauseCircle, ShieldCheck } from 'lucide-react'
import { Card, Button, BrandMark } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { formatDate } from '@/utils'

export default function AccessEnded() {
  const { profile, signOut } = useAuth()

  // How much they have riding on this. Purely reassurance — the screen is
  // correct and complete without it, so every failure path just leaves it out
  // rather than blocking the render or showing an error.
  const [txCount, setTxCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count, error }: { count: number | null; error: unknown }) => {
        if (cancelled || error || count == null) return
        setTxCount(count)
      })
    return () => { cancelled = true }
  }, [profile?.id])

  // A trial that ran out and a subscription that lapsed are different events to
  // the person reading this, even though the gate treats them identically.
  const endedFromTrial =
    profile?.subscription_status === 'trial' ||
    profile?.subscription_plan_type === 'trial' ||
    !profile?.subscription_plan_type

  const expiredOn = profile?.subscription_expires_at
    ? formatDate(profile.subscription_expires_at)
    : null

  return (
    <main className="flex min-h-svh items-center justify-center bg-surface-0 px-4 py-12 sm:px-6">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="flex justify-center">
          <BrandMark className="text-brand-500" />
        </div>

        <Card className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--status-warning-text)]">
              <PauseCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Access paused
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 text-balance">
              {endedFromTrial ? 'Your 7-day trial has ended' : 'Your plan has ended'}
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              {expiredOn ? `Access ended on ${expiredOn}. ` : ''}
              Intrack has no free version — a plan is what keeps scanning, budgets and insights
              switched on.
            </p>
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface-2/50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ShieldCheck className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
              Nothing has been deleted
            </p>
            <p className="text-sm leading-relaxed text-zinc-400">
              {txCount != null && txCount > 0
                ? <>All <span className="font-medium text-zinc-200 tnum">{txCount}</span> transaction{txCount === 1 ? '' : 's'} you logged are still here, exactly as you left them. Pay and everything is back where it was.</>
                : 'Everything you logged is still here, exactly as you left it. Pay and everything is back where it was.'}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link to="/pricing" className="block w-full">
              <Button block className="!h-11 justify-center">See plans — from ₹31</Button>
            </Link>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link to="/settings" className="block w-full">
                <Button variant="secondary" block className="!h-11 justify-center">
                  Export my data
                </Button>
              </Link>
              <Link to="/support" className="block w-full">
                <Button variant="secondary" block className="!h-11 justify-center">
                  Contact support
                </Button>
              </Link>
            </div>
          </div>
        </Card>

        <button
          type="button"
          onClick={() => { void signOut() }}
          className="mx-auto cursor-pointer rounded px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Sign out
        </button>
      </div>
    </main>
  )
}
