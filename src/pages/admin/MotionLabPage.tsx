// ============================================
// MotionLabPage — /motion-lab, admins only, not linked anywhere.
//
// Where the owner tries every animation from the motion kit on a phone and
// picks the speed and curve before any real screen changes. The values shown
// at the top are what gets written into motion.ts afterwards.
//
// Temporary: deleted, with its route, when the motion rollout finishes
// (docs/superpowers/specs/2026-09-16-app-motion-design.md).
// ============================================

import { useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Check, Plus, Trash2, X } from 'lucide-react'
import {
  Card, GLIDE, MorphSurface, PRESS_SCALE, RollingNumber, SlidingIndicator, SwipeCard,
  glide, haptics, type Bezier,
} from '@/components/ui'
import { formatCurrency } from '@/utils'

const CURVES: Record<string, { label: string; ease: Bezier }> = {
  glide: { label: 'Approved glide', ease: [0.22, 1, 0.36, 1] },
  softer: { label: 'Softer', ease: [0.33, 1, 0.68, 1] },
  quicker: { label: 'Quicker settle', ease: [0.16, 1, 0.3, 1] },
}

const BALANCES = [42350, 42850, 118420, 506900]
const PERIODS = ['Week', 'Month', 'Year'] as const
const SPENDS: Record<(typeof PERIODS)[number], number[]> = {
  Week: [30, 55, 20, 70],
  Month: [60, 40, 85, 35],
  Year: [90, 65, 50, 75],
}
const BAR_LABELS = ['Food', 'Travel', 'Bills', 'Shopping']
const PENDING = [
  { id: 1, merchant: 'Swiggy', source: 'HDFC alert, 14/09/2026', amount: 386 },
  { id: 2, merchant: 'Uber', source: 'ICICI alert, 15/09/2026', amount: 212 },
  { id: 3, merchant: 'Amazon', source: 'Order receipt, 15/09/2026', amount: 1499 },
]
const NEW_ROWS = ['Chai', 'Petrol', 'Movie', 'Groceries', 'Pharmacy']

const sectionLabel = 'text-xs font-bold uppercase tracking-wide text-text-secondary'

export default function MotionLabPage() {
  const reduce = useReducedMotion()
  const [speed, setSpeed] = useState(1)
  const [curveId, setCurveId] = useState('glide')
  const ease = CURVES[curveId].ease
  const t = (seconds: number) => glide(reduce, seconds * speed, ease)

  const [balanceIndex, setBalanceIndex] = useState(0)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Month')
  const [formOpen, setFormOpen] = useState(false)
  const [pending, setPending] = useState(PENDING)
  const [rows, setRows] = useState([{ id: 0, label: 'Rent', amount: 18000 }])
  const [nextRow, setNextRow] = useState(1)
  const [newestRow, setNewestRow] = useState<number | null>(null)

  function resolvePending(id: number, direction: 1 | -1) {
    void (direction === 1 ? haptics.success() : haptics.warning())
    setPending((list) => list.filter((item) => item.id !== id))
  }

  function addRow() {
    const id = nextRow
    setRows((list) => [{ id, label: NEW_ROWS[id % NEW_ROWS.length], amount: 50 + id * 37 }, ...list])
    setNextRow(id + 1)
    setNewestRow(id)
    void haptics.success()
  }

  function deleteRow(id: number) {
    void haptics.warning()
    setRows((list) => list.filter((row) => row.id !== id))
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-text-primary">Motion lab</h1>
        <p className="text-sm text-text-secondary">
          Try each animation. Tell Claude the speed and curve that feel right.
        </p>
      </header>

      <Card className="space-y-4">
        <p className={sectionLabel}>Your settings</p>
        <label className="block space-y-2">
          <span className="text-sm text-text-primary">Speed: {speed.toFixed(1)}× {speed < 1 ? '(faster)' : speed > 1 ? '(slower)' : ''}</span>
          <input
            type="range" min={0.5} max={1.6} step={0.1} value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="w-full accent-brand-500"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Curve">
          {Object.entries(CURVES).map(([id, curve]) => (
            <button
              key={id} type="button" role="radio" aria-checked={curveId === id}
              onClick={() => setCurveId(id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${curveId === id ? 'border-brand-500 bg-brand-500/10 text-brand-700 font-semibold' : 'border-border-subtle text-text-secondary'}`}
            >
              {curve.label}
            </button>
          ))}
        </div>
        {reduce && (
          <p className="text-sm text-amber-700">
            Your device has "reduce motion" on, so animations are switched off here. Turn it off to try them.
          </p>
        )}
      </Card>

      {/* 1. Rolling figure */}
      <Card className="space-y-3">
        <p className={sectionLabel}>1 · Balance changes</p>
        <RollingNumber
          value={BALANCES[balanceIndex]}
          format={(n) => formatCurrency(n)}
          duration={GLIDE.figure * speed}
          ease={ease}
          className="font-display text-3xl font-bold text-text-primary"
        />
        <div>
          <motion.button
            type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)}
            onClick={() => { setBalanceIndex((i) => (i + 1) % BALANCES.length); void haptics.tap() }}
            className="rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
          >
            Change balance
          </motion.button>
        </div>
      </Card>

      {/* 2. Period tabs + bars */}
      <Card className="space-y-4">
        <p className={sectionLabel}>2 · Period switch and chart</p>
        <LayoutGroup id="lab-periods">
          <div className="inline-flex rounded-full border border-border-subtle bg-surface-2 p-1" role="tablist">
            {PERIODS.map((p) => (
              <button
                key={p} type="button" role="tab" aria-selected={period === p}
                onClick={() => { setPeriod(p); void haptics.tap() }}
                className={`relative rounded-full px-4 py-1.5 text-sm font-semibold ${period === p ? 'text-white' : 'text-text-secondary'}`}
              >
                {period === p && (
                  <SlidingIndicator layoutId="lab-period-pill" className="rounded-full bg-brand-500" duration={GLIDE.base * speed} ease={ease} />
                )}
                <span className="relative z-10">{p}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <div className="space-y-2">
          {SPENDS[period].map((pct, i) => (
            <div key={BAR_LABELS[i]} className="flex items-center gap-3">
              <span className="w-20 text-sm text-text-secondary">{BAR_LABELS[i]}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <motion.div
                  className="h-full origin-left rounded-full bg-brand-500"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={t(GLIDE.figure)}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 3. Button grows into form */}
      <Card className="space-y-3">
        <p className={sectionLabel}>3 · Add button opens the form</p>
        <LayoutGroup id="lab-morph">
          <div className="min-h-[190px]">
            {!formOpen ? (
              <MorphSurface
                morphId="lab-add" duration={GLIDE.slow * speed} ease={ease}
                className="inline-flex bg-brand-500 text-sm font-semibold text-white"
                style={{ borderRadius: 999 }}
              >
                <button
                  type="button"
                  onClick={() => { setFormOpen(true); void haptics.tap() }}
                  className="inline-flex items-center gap-2 px-5 py-2.5"
                >
                  <motion.span layout="position" className="inline-flex items-center gap-2">
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add expense
                  </motion.span>
                </button>
              </MorphSurface>
            ) : (
              <MorphSurface
                morphId="lab-add" duration={GLIDE.slow * speed} ease={ease}
                className="space-y-3 border border-border-subtle bg-surface-1 p-4 shadow-[var(--shadow-md)]"
                style={{ borderRadius: 16 }}
              >
                <motion.div
                  layout="position" className="space-y-3"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ ...t(GLIDE.base), delay: reduce ? 0 : GLIDE.fast * speed }}
                >
                  <p className="font-semibold text-text-primary">Add transaction</p>
                  <p className="text-sm text-text-secondary">Amount: ₹450 · Category: Food</p>
                  <button
                    type="button"
                    onClick={() => { setFormOpen(false); void haptics.success() }}
                    className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Save
                  </button>
                </motion.div>
              </MorphSurface>
            )}
          </div>
        </LayoutGroup>
      </Card>

      {/* 4. Pending cards */}
      <Card className="space-y-3">
        <p className={sectionLabel}>4 · Pending: swipe or tap</p>
        <p className="text-sm text-text-secondary">Swipe right to approve, left to reject. On the phone app you also feel a tick.</p>
        <div className="overflow-hidden">
          <AnimatePresence initial={false}>
            {pending.map((item) => (
              // SwipeCard owns the sideways exit (swipe and buttons alike);
              // this wrapper only closes the gap. The spacing is padding
              // inside it, not space-y margin, so the collapse takes the gap
              // with it instead of snapping at the end.
              <motion.div
                key={item.id}
                className="overflow-hidden pb-2"
                exit={{ opacity: 0, height: 0, paddingBottom: 0 }}
                transition={t(GLIDE.slow)}
              >
                <SwipeCard
                  onSwipeRight={() => resolvePending(item.id, 1)}
                  onSwipeLeft={() => resolvePending(item.id, -1)}
                  duration={GLIDE.slow * speed} ease={ease}
                >
                  {({ swipeRight, swipeLeft, leaving }) => (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-3">
                      <div>
                        <p className="font-semibold text-text-primary">{item.merchant}</p>
                        <p className="text-xs text-text-secondary">{item.source}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(item.amount)}</span>
                        <button type="button" aria-label={`Approve ${item.merchant}`} onClick={swipeRight} disabled={leaving} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-700 hover:bg-surface-2">
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" aria-label={`Reject ${item.merchant}`} onClick={swipeLeft} disabled={leaving} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </SwipeCard>
              </motion.div>
            ))}
          </AnimatePresence>
          {pending.length === 0 && (
            <button type="button" onClick={() => setPending(PENDING)} className="text-sm font-semibold text-brand-700">
              Bring the cards back
            </button>
          )}
        </div>
      </Card>

      {/* 5. List add / delete */}
      <Card className="space-y-3">
        <p className={sectionLabel}>5 · Adding and deleting rows</p>
        <motion.button
          type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)} onClick={addRow}
          className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add a row
        </motion.button>
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={row.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={t(GLIDE.base)}
                className="relative flex items-center justify-between rounded-xl px-3 py-2.5"
              >
                {row.id === newestRow && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xl bg-brand-500/10"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ ...t(1.2), delay: reduce ? 0 : 0.4 * speed }}
                  />
                )}
                <span className="relative text-sm text-text-primary">{row.label}</span>
                <span className="relative flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(row.amount)}</span>
                  <button type="button" aria-label={`Delete ${row.label}`} onClick={() => deleteRow(row.id)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      {/* 6. Haptics */}
      <Card className="space-y-3">
        <p className={sectionLabel}>6 · Phone vibration (app only)</p>
        <div className="flex flex-wrap gap-2">
          {([['Tap', haptics.tap], ['Success', haptics.success], ['Warning', haptics.warning]] as const).map(([label, fire]) => (
            <motion.button
              key={label} type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)}
              onClick={() => void fire()}
              className="rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
            >
              {label}
            </motion.button>
          ))}
        </div>
      </Card>
    </div>
  )
}
