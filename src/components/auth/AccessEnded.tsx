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
    <main className="min-h-screen bg-surface-0 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <div className="flex justify-center">
          <BrandMark />
        </div>

        <Card className="p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="inline-flex self-start items-center bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] px-2.5 py-0.5 rounded-full text-xs font-semibold text-[var(--status-warning-text)]">
              Access paused
            </span>
            <h1 className="text-2xl font-bold text-sb-ink tracking-tight">
              {endedFromTrial ? 'Your 7-day trial has ended' : 'Your plan has ended'}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {expiredOn
                ? `Access ended on ${expiredOn}. `
                : ''}
              Intrack does not have a free version — a plan is what keeps scanning,
              budgets and insights switched on.
            </p>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-surface-1 p-4 flex flex-col gap-1">
            <p className="text-sm font-bold text-sb-ink">Nothing has been deleted</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {txCount != null && txCount > 0
                ? `All ${txCount} transaction${txCount === 1 ? '' : 's'} you logged are still here, exactly as you left them. Pay and everything is back where it was.`
                : 'Everything you logged is still here, exactly as you left it. Pay and everything is back where it was.'}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link to="/pricing" className="w-full">
              <Button className="w-full justify-center">See plans — from ₹31</Button>
            </Link>
            <div className="grid grid-cols-2 gap-3">
              <Link to="/settings" className="w-full">
                <Button variant="secondary" className="w-full justify-center text-xs">
                  Export my data
                </Button>
              </Link>
              <Link to="/support" className="w-full">
                <Button variant="secondary" className="w-full justify-center text-xs">
                  Contact support
                </Button>
              </Link>
            </div>
          </div>
        </Card>

        <button
          onClick={() => { void signOut() }}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors self-center cursor-pointer py-2"
        >
          Sign out
        </button>
      </div>
    </main>
  )
}
