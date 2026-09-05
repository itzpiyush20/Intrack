// ============================================
// SupportTab — the support inbox.
//
// Reads through admin_support_ticket_list / admin_support_ticket_summary, both
// SECURITY DEFINER and both opening with an is_admin() guard, same as every
// other admin RPC. The only write is marking a ticket handled, which migration
// 031 permits directly via an admin-only RLS policy — it touches no protected
// column and carries no privilege, so it needs no serverless endpoint.
//
// Deliberately separate from FeedbackTab: feedback carries a 1-5 rating that
// feeds an average, tickets do not.
// ============================================

import { useState } from 'react'
import { Card, Button, EmptyState } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAdminQuery } from './useAdminQuery'
import { StatCard, StatGridSkeleton, AdminError, FeedCardSkeleton, Pager } from './adminUi'
import { Mail } from 'lucide-react'

interface SummaryRow {
  total: number
  unhandled: number
  last_7d: number
}

interface TicketRow {
  id: string
  name: string
  email: string
  subject: string
  message: string
  created_at: string
  handled_at: string | null
  total_count: number
}

const PAGE_SIZE = 20

export default function SupportTab() {
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const [openOnly, setOpenOnly] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const summary = useAdminQuery<SummaryRow[]>('admin_support_ticket_summary')
  const list = useAdminQuery<TicketRow[]>('admin_support_ticket_list', {
    lim: PAGE_SIZE,
    off: page * PAGE_SIZE,
  })

  const s = summary.data?.[0]
  const allRows = list.data ?? []
  const total = allRows[0]?.total_count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  // Filtering is client-side over the current page. The RPC already sorts open
  // tickets first, so this is a focus aid rather than a search.
  const rows = openOnly ? allRows.filter((t) => t.handled_at === null) : allRows

  const listReload = list.reload

  const setHandled = async (t: TicketRow, handled: boolean) => {
    setBusyId(t.id)
    setActionError(null)
    const { error } = await supabase
      .from('support_tickets')
      .update(
        handled
          ? { handled_at: new Date().toISOString(), handled_by: user?.id ?? null }
          : { handled_at: null, handled_by: null }
      )
      .eq('id', t.id)

    setBusyId(null)
    if (error) {
      setActionError(`Could not update that ticket: ${error.message}`)
      return
    }
    listReload()
  }

  return (
    <div className="space-y-6">
      {summary.loading ? (
        <StatGridSkeleton count={3} />
      ) : s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Open tickets" value={String(s.unhandled)} emphasis={s.unhandled > 0} />
          <StatCard label="Total received" value={String(s.total)} />
          <StatCard label="Last 7 days" value={String(s.last_7d)} />
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {([false, true] as const).map((only) => (
          <button
            key={only ? 'open' : 'all'}
            onClick={() => setOpenOnly(only)}
            className={
              openOnly === only
                ? 'rounded-full bg-brand-500/15 border border-brand-500/30 px-3 py-1.5 text-xs font-semibold text-brand-500'
                : 'rounded-full border border-transparent px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-300'
            }
          >
            {only ? 'Open only' : 'All'}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] px-3 py-2 text-sm text-[var(--status-danger-text)]">
          {actionError}
        </p>
      )}

      {list.loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <FeedCardSkeleton key={i} />)}
        </div>
      )}

      {list.error && (
        <div>
          <AdminError message={`Could not load support tickets: ${list.error}`} onRetry={list.reload} />
          <p className="mt-2 text-xs text-zinc-500">
            If this says the function does not exist, run supabase/031_support_tickets.sql.
          </p>
        </div>
      )}

      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon="📬"
          title={openOnly && allRows.length > 0 ? 'All caught up' : 'No support tickets yet'}
          description={openOnly && allRows.length > 0 ? 'Every ticket on this page has been handled.' : undefined}
        />
      )}

      {rows.map((t) => {
        const handled = t.handled_at !== null
        return (
          <Card key={t.id} className={handled ? 'opacity-60' : 'border-l-2 border-l-brand-500'}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={handled ? 'text-sm text-zinc-400' : 'text-sm font-semibold text-zinc-100'}>
                  {t.subject}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {t.name} ·{' '}
                  <a href={`mailto:${t.email}?subject=Re: ${encodeURIComponent(t.subject)}`} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-zinc-300">
                    <Mail className="h-3 w-3" aria-hidden="true" />
                    {t.email}
                  </a>{' '}
                  · {new Date(t.created_at).toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            <p
              className={
                handled
                  ? 'mt-3 whitespace-pre-wrap text-sm text-zinc-400'
                  : 'mt-3 whitespace-pre-wrap text-sm text-zinc-300'
              }
            >
              {t.message}
            </p>

            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-xs text-zinc-500">
                {handled && t.handled_at !== null
                  ? `Handled ${new Date(t.handled_at).toLocaleDateString('en-IN')}`
                  : 'Needs a reply'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHandled(t, !handled)}
                loading={busyId === t.id}
                className="px-2"
              >
                {handled ? 'Reopen' : 'Mark handled'}
              </Button>
            </div>
          </Card>
        )
      })}

      <Pager
        page={page}
        pages={pages}
        total={total}
        noun="tickets"
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    </div>
  )
}
