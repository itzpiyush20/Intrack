import { useState } from 'react'
import { Card, Button, EmptyState } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { useAdminQuery } from './useAdminQuery'
import { StatCard, StatGridSkeleton, AdminError, FeedCardSkeleton, Pager } from './adminUi'

interface SummaryRow {
  total: number
  average_rating: number
  bug: number
  feature_request: number
  ui_ux: number
  other: number
}

interface FeedbackRow {
  id: string
  email: string
  rating: number
  category: string
  message: string
  created_at: string
  handled_at: string | null
  total_count: number
}

const PAGE_SIZE = 20

export default function FeedbackTab() {
  const { user } = useAuth()
  const [page, setPage] = useState(0)
  const [unhandledOnly, setUnhandledOnly] = useState(false)
  // Which row is mid-write, so its button can disable itself without freezing
  // the whole list.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const summary = useAdminQuery<SummaryRow[]>('admin_feedback_summary')
  const list = useAdminQuery<FeedbackRow[]>('admin_feedback_list', {
    lim: PAGE_SIZE,
    off: page * PAGE_SIZE,
  })

  const s = summary.data?.[0]
  const allRows = list.data ?? []
  const total = allRows[0]?.total_count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  // Filtering is client-side over the current page. The RPC already sorts
  // unhandled first, so "Unhandled only" is a focus aid, not a search.
  const rows = unhandledOnly ? allRows.filter((f) => f.handled_at === null) : allRows

  const listReload = list.reload

  const setHandled = async (f: FeedbackRow, handled: boolean) => {
    setBusyId(f.id)
    setActionError(null)
    // Migration 028 adds an RLS policy letting admins UPDATE feedback, so this
    // writes directly — no serverless endpoint in between.
    const { error } = await supabase
      .from('feedback')
      .update(
        handled
          ? { handled_at: new Date().toISOString(), handled_by: user?.id ?? null }
          : { handled_at: null, handled_by: null }
      )
      .eq('id', f.id)

    setBusyId(null)
    if (error) {
      setActionError(`Could not update that feedback: ${error.message}`)
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
          <StatCard label="Average rating" value={s.total === 0 ? '—' : `${s.average_rating} / 5`} />
          <StatCard label="Total feedback" value={String(s.total)} />
          <Card className="relative overflow-hidden p-4 border-sb-hairline shadow-card before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/25 before:to-transparent">
            <p className="text-xs font-semibold uppercase tracking-wider text-sb-ink-muted">Breakdown</p>
            <p className="mt-2 text-sm text-sb-ink font-semibold tnum">
              {s.bug} bugs · {s.feature_request} features · {s.ui_ux} UI · {s.other} other
            </p>
          </Card>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {([false, true] as const).map((only) => (
          <button
            key={only ? 'unhandled' : 'all'}
            onClick={() => setUnhandledOnly(only)}
            className={
              unhandledOnly === only
                ? 'rounded-full bg-brand-50 border border-brand-200/80 px-3.5 py-1 text-xs font-semibold text-brand-700 shadow-xs cursor-pointer'
                : 'rounded-full border border-sb-hairline bg-surface-1 px-3.5 py-1 text-xs font-medium text-sb-ink-muted hover:text-sb-ink cursor-pointer transition-colors'
            }
          >
            {only ? 'Unhandled only' : 'All'}
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

      {list.error && <AdminError message={`Could not load feedback: ${list.error}`} onRetry={list.reload} />}

      {!list.loading && !list.error && rows.length === 0 && (
        <EmptyState
          icon="💬"
          title={unhandledOnly && allRows.length > 0 ? 'All caught up' : 'No feedback submitted yet'}
          description={unhandledOnly && allRows.length > 0 ? 'Everything on this page has been handled.' : undefined}
        />
      )}

      {rows.map((f) => {
        const handled = f.handled_at !== null
        return (
          <Card
            key={f.id}
            className={`border border-sb-hairline bg-surface-1 shadow-card ${handled ? 'opacity-60' : 'border-l-4 border-l-brand-500'}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={handled ? 'text-sm text-sb-ink-muted' : 'text-sm font-semibold text-sb-ink'}>
                  {f.email}
                </p>
                <p className="mt-0.5 text-xs text-sb-ink-muted">
                  {f.category} · {new Date(f.created_at).toLocaleDateString('en-IN')}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-sb-ink tnum">{f.rating}/5</span>
            </div>

            <p className={handled ? 'mt-3 whitespace-pre-wrap text-sm text-sb-ink-muted' : 'mt-3 whitespace-pre-wrap text-sm text-sb-ink-secondary leading-relaxed'}>
              {f.message}
            </p>

            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-xs text-sb-ink-muted">
                {handled && f.handled_at !== null
                  ? `Handled ${new Date(f.handled_at).toLocaleDateString('en-IN')}`
                  : 'Needs a reply'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHandled(f, !handled)}
                loading={busyId === f.id}
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
        noun="entries"
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    </div>
  )
}
