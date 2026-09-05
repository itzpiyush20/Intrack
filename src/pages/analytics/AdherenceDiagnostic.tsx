import { Card } from '@/components/ui'
import { formatCurrency } from '@/utils'
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'

interface AdherenceDiagnosticProps {
  healthScore: number
  totalIncome: number
  totalDebit: number
  onClick?: () => void
}

/**
 * How close this period's split sits to 50/30/20.
 *
 * The card used to badge itself "✓ Platform Verified" in monospace, which
 * promised an audit that does not happen — the number is derived from the
 * user's own categories and nothing verifies anything. It now says what it
 * actually measures, which is the only thing that makes a score like this
 * trustworthy.
 *
 * The drill-down used to fire from a click on the whole card. It is a real
 * button at the foot of the card now: a `<div role="button">` wrapping
 * headings and a description list is neither keyboard-operable nor valid, and
 * a card that silently swallows clicks gives no hint that it would.
 */
export function AdherenceDiagnostic({ healthScore, totalIncome, totalDebit, onClick }: AdherenceDiagnosticProps) {
  const band =
    healthScore >= 80
      ? { label: 'Close to balanced', color: 'var(--status-positive-text)', Icon: CheckCircle2 }
      : healthScore >= 55
        ? { label: 'Some way off', color: 'var(--status-warning-text)', Icon: AlertTriangle }
        : { label: 'Well off balance', color: 'var(--status-danger-text)', Icon: AlertTriangle }

  // A ring drawn with stroke-dasharray: the arc length carries the score, and
  // the number in the middle says it plainly for anyone the arc does not reach.
  const R = 44
  const CIRCUMFERENCE = 2 * Math.PI * R
  const filled = (Math.min(100, Math.max(0, healthScore)) / 100) * CIRCUMFERENCE

  return (
    <Card className="relative overflow-hidden flex flex-col items-center text-center md:col-span-1 border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
          <circle cx="50" cy="50" r={R} fill="none" stroke="#e6ede8" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={band.color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-extrabold tracking-tight text-sb-ink tnum">{healthScore}</span>
          <span className="text-xs font-medium text-sb-ink-muted">out of 100</span>
        </div>
      </div>

      <h2 className="mt-4 text-base font-bold text-sb-ink">Balance score</h2>
      <p className="mt-1 text-sm leading-relaxed text-sb-ink-muted">
        How close this period&rsquo;s needs, wants and savings sit to a 50/30/20 split.
      </p>

      {/* State is said in words and shown with an icon; the colour only
          repeats what they already say. */}
      <p
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sb-hairline bg-surface-2 px-3 py-1 text-xs font-semibold shadow-xs"
        style={{ color: band.color }}
      >
        <band.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {band.label}
      </p>

      <dl className="mt-6 w-full space-y-2.5 text-sm">
        <div className="flex items-center justify-between gap-3 border-b border-sb-hairline pb-2.5">
          <dt className="text-sb-ink-muted">Money in</dt>
          <dd className="font-bold text-sb-ink tnum">{formatCurrency(totalIncome)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-sb-ink-muted">Money out</dt>
          <dd className="font-bold text-sb-ink tnum">{formatCurrency(totalDebit)}</dd>
        </div>
      </dl>

      {onClick && (
        <button
          type="button"
          onClick={onClick}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-sb-hairline px-3 text-sm font-semibold text-brand-700 bg-surface-2/40 shadow-xs transition-all hover:bg-surface-2 hover:border-brand-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          See every transaction in this period
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      )}
    </Card>
  )
}

export default AdherenceDiagnostic
