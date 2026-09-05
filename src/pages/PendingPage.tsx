// ============================================
// PendingPage — UPI Transaction Approval Flow
// Auto-scans bank alerts and reviews pending txns
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
import { useNextScan } from '@/hooks'
import {
  Card, Button, Input, Select, Badge, EmptyState, Modal, TransactionIdentity,
  Skeleton, SECTION_LABEL, transition, rowVariants,
} from '@/components/ui'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  getTransactions,
  updateTransaction,
  deleteTransaction,
  scanRealGmailInbox,
  saveMerchantRule,
  supabase,
  applyMerchantRules,
  formatScanProgress,
} from '@/services'
import { fetchAllTransactions } from '@/services/transactions'
import { saveMerchantRuleToDb } from '@/services/learningEngine'
import { mergePayments } from '@/services/paymentMerge'
import { useAuth } from '@/context/AuthContext'
import { cn, formatCurrency, formatDate, parsePaymentSource, formatPaymentSource, isCardPayment, withTimeout, getCurrentMonth, resolveTransactionIdentity, formatNextScanTime, HOME_CURRENCY } from '@/utils'
import type { Database } from '@/types/database'
import { useToast } from '@/context'
import { useCategories } from '@/context/CategoriesContext'
import {
  ArrowDown,
  ArrowUp,
  Crown,
  Zap,
  Brain,
  BarChart3,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Clock,
  Link2,
  Key,
  Shield,
  Lightbulb,
  CreditCard,
  Building2,
  Check,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  CopyCheck,
  Mail,
  X,
} from 'lucide-react'

/**
 * How a confidence score is shown: an icon, a word and a colour.
 *
 * Presentation only — the 80 / 50 bands are the ones this page has always
 * used, and nothing here decides what happens to a transaction. Every band
 * carries an icon and a word so the meaning never rests on colour alone.
 */
function confidenceTone(confidence: number): { icon: typeof CheckCircle2; className: string; label: string } {
  if (confidence >= 80) {
    return { icon: CheckCircle2, className: 'text-[var(--status-positive-text)]', label: 'High confidence' }
  }
  if (confidence >= 50) {
    return { icon: AlertCircle, className: 'text-[var(--status-warning-text)]', label: 'Worth a look' }
  }
  return { icon: AlertTriangle, className: 'text-zinc-400', label: 'Low confidence' }
}

type TransactionRow = Database['public']['Tables']['transactions']['Row']

/** How many pending rows the list renders. See fetchPendingData for why 250. */
const PENDING_LIST_LIMIT = 250

/** Page size for the auto-categorisation review sweep. */
const AUTO_REVIEW_PAGE_SIZE = 500

/** Exactly the columns the auto-categorisation review modal reads. */
type AutoReviewRow = Pick<
  TransactionRow,
  'id' | 'amount' | 'type' | 'category' | 'currency' | 'date' | 'merchant' | 'description' | 'possible_duplicate_of'
>

function parseTransactionTime(txn: TransactionRow): string {
  // Prefer the dedicated transaction_time column (added in Phase 2)
  const txTime = (txn as any).transaction_time
  if (txTime) return txTime

  // Fallback: parse from notes (legacy records)
  const notes = (txn as any).notes || ''
  const timeMatch = notes.match(/([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?/i)
  if (timeMatch) {
    const hh = timeMatch[1]
    const mm = timeMatch[2]
    const ampm = timeMatch[4] ? ` ${timeMatch[4].toUpperCase()}` : ''
    return `${hh}:${mm}${ampm}`
  }

  try {
    const date = new Date(txn.created_at)
    if (!isNaN(date.getTime())) {
      return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    }
  } catch {}

  return '—'
}

function parseShortDescription(description: string, notes: string, merchant: string): string {
  if (
    description &&
    !description.includes('Auto-Parsed') &&
    !description.includes('Auto Detected') &&
    !description.includes('Bank Transaction') &&
    description.length < 40
  ) {
    return description
  }

  const text = notes.toLowerCase()

  if (text.includes('swiggy')) return 'Swiggy meal delivery'
  if (text.includes('zomato')) return 'Zomato food order'
  if (text.includes('uber eats')) return 'Uber Eats order'
  if (text.includes('uber')) return 'Uber cab ride'
  if (text.includes('ola')) return 'Ola cab ride'
  if (text.includes('netflix')) return 'Netflix subscription'
  if (text.includes('spotify')) return 'Spotify premium'
  if (text.includes('myntra')) return 'Myntra fashion purchase'
  if (text.includes('amazon')) return 'Amazon checkout'
  if (text.includes('flipkart')) return 'Flipkart shopping'
  if (text.includes('blinkit')) return 'Blinkit quick delivery'
  if (text.includes('bigbasket')) return 'BigBasket groceries'
  if (text.includes('zepto')) return 'Zepto quick commerce'
  if (text.includes('airtel') || text.includes('broadband')) return 'Telecom / broadband bill'
  if (text.includes('jio')) return 'Jio recharge'
  if (text.includes('electricity') || text.includes('bescom') || text.includes('tata power')) return 'Electricity bill'
  if (text.includes('salary')) return 'Corporate payroll credit'
  if (text.includes('refund')) return 'Refund credit'
  if (text.includes('cashback')) return 'Cashback credit'
  if (text.includes('emi')) return 'EMI debit'
  if (text.includes('insurance')) return 'Insurance premium'
  if (text.includes('mutual fund') || text.includes('sip')) return 'Investment SIP debit'

  if (merchant && merchant.length > 1) {
    const cleanMerchant = merchant.replace(/(?:outflow|ride|sub|rides|alert|payment|fashion)/i, '').trim()
    if (cleanMerchant.length > 1) return `${cleanMerchant} payment`
  }

  const paymentSrc = parsePaymentSource(notes)
  if (paymentSrc !== 'Bank' && paymentSrc !== 'Main Wallet') return `${paymentSrc} transaction`

  return 'Bank transaction'
}

/** Format card issuer + brand line for display e.g. "HDFC · Visa" */
function formatCardDetails(txn: TransactionRow): string | null {
  const issuer = (txn as any).card_issuer as string | null
  const brand = (txn as any).card_brand as string | null
  if (issuer && brand) return `${issuer} · ${brand}`
  if (issuer) return issuer
  if (brand) return brand
  return null
}

/**
 * What this row contributes to one of the two pending headline figures.
 *
 * `amount` is an unsigned magnitude — the direction lives in `type` — so summing
 * it across both directions netted a salary credit into "pending spend". And the
 * cards render a ₹ figure, so a foreign-currency row counts towards neither:
 * converting is not this page's job.
 */
function homeCurrencyAmount(txn: Pick<TransactionRow, 'amount' | 'type' | 'currency'>, type: 'debit' | 'credit'): number {
  if ((txn.currency ?? HOME_CURRENCY) !== HOME_CURRENCY) return 0
  return txn.type === type ? Number(txn.amount) : 0
}

/** Message off a thrown Error or a Supabase error object, with a fallback. */
function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

export default function PendingPage() {
  const { user, signInWithGoogle, hasGoogleToken, notifyGoogleTokenCleared, profile } = useAuth()
  const { categories, getStyle } = useCategories()
  const [pendingTxns, setPendingTxns] = useState<TransactionRow[]>([])
  // Motion reports that a row arrived or left the review list. Nothing here
  // decorates, and all of it collapses under a reduced-motion preference.
  const reduceMotion = useReducedMotion()
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanSuccessMessage, setScanSuccessMessage] = useState<{
    total: number
    autoApproved: number
    pendingReview: number
    lowConfidence: number
    merged: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isGoogleConnected = hasGoogleToken
  const [totalPendingCount, setTotalPendingCount] = useState(0)
  const [totalPendingValue, setTotalPendingValue] = useState(0)
  const [totalPendingCredits, setTotalPendingCredits] = useState(0)

  // Keeps the two headline figures in step with the optimistic row removals
  // below, so an approved credit never comes off the outgoing total.
  const adjustPendingTotals = useCallback((txns: TransactionRow[], sign: 1 | -1) => {
    const debits = txns.reduce((sum, t) => sum + homeCurrencyAmount(t, 'debit'), 0)
    const credits = txns.reduce((sum, t) => sum + homeCurrencyAmount(t, 'credit'), 0)
    setTotalPendingValue((prev) => Math.max(0, prev + sign * debits))
    setTotalPendingCredits((prev) => Math.max(0, prev + sign * credits))
  }, [])

  const [showInactivityBanner, setShowInactivityBanner] = useState(false)

  const [editingFields, setEditingFields] = useState<
    Record<string, { category: string; description: string }>
  >({})

  const { showToast } = useToast()

  const [ruleSuggestion, setRuleSuggestion] = useState<{ merchant: string; category: string } | null>(null)
  const [creatingRule, setCreatingRule] = useState(false)

  const [autoCategorizedTxns, setAutoCategorizedTxns] = useState<any[]>([])
  const [showAutoReviewModal, setShowAutoReviewModal] = useState(false)
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set())
  const [autoCategorySelections, setAutoCategorySelections] = useState<Record<string, string>>({})

  // Scan rate-limit / cooldown state
  const [scanCooldownMessage, setScanCooldownMessage] = useState<string | null>(null)


  // Which flagged row currently has a merge / keep-both write in flight.
  const [duplicateActionId, setDuplicateActionId] = useState<string | null>(null)

  // Premium gate state
  const [isPremiumRequired, setIsPremiumRequired] = useState(false)

  // Scan dashboard state
  const [lastScanLog, setLastScanLog] = useState<any>(null)
  // Next-scan availability, shared with DashboardPage so the two cannot drift.
  // Re-checked when a scan completes, since that is what consumes the allowance.
  const { nextScanAt, quotaExhausted } = useNextScan({
    enabled: !!user,
    refreshKey: lastScanLog,
    onExpire: () => setScanCooldownMessage(null),
  })

  // Shows a "still working" hint once a scan runs past a few seconds, so a
  // legitimately slow scan (large inbox, many AI classification calls) isn't
  // indistinguishable from a frozen one. Superseded by live progress as soon
  // as the engine reports its first phase.
  const [scanTakingLong, setScanTakingLong] = useState(false)
  const [scanProgress, setScanProgress] = useState<string | null>(null)

  // ── Fetch last scan log ──────────────────────────────────
  const fetchLastScanLog = useCallback(async () => {
    if (!user) return null
    try {
      const { data } = await supabase
        .from('email_scan_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('scanned_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) {
        setLastScanLog(data[0])
        return data[0]
      }
      return null
    } catch {
      return null
    }
  }, [user])

  const [recentRejections, setRecentRejections] = useState<
    { id: string; sender_domain: string | null; subject: string | null; gate: string; rejected_at: string }[]
  >([])
  const [showRejectionsPanel, setShowRejectionsPanel] = useState(false)

  const fetchRecentRejections = useCallback(async (scanLogId: string | null) => {
    if (!scanLogId) {
      setRecentRejections([])
      return
    }
    const { data, error } = await supabase
      .from('email_scan_rejections')
      .select('id, sender_domain, subject, gate, rejected_at')
      .eq('scan_log_id', scanLogId)
      .order('rejected_at', { ascending: false })
      .limit(20)
    if (!error && data) setRecentRejections(data)
  }, [])

  // ── Fetch unconfirmed auto-categorized transactions ──────
  const fetchUnconfirmedCategorizations = useCallback(async () => {
    if (!user) return
    try {
      // Scoped to the current month only — older transactions that never
      // got an explicit category_confirmed_at (a historical data gap in
      // how some insert paths wrote rows) should not keep resurfacing in
      // this review modal indefinitely. Anything already confirmed is
      // permanently excluded regardless of date; this only stops PAST
      // months' never-confirmed rows from being asked about again — it
      // does not retroactively mark them confirmed.
      const monthStart = `${getCurrentMonth()}-01`
      // Only auto-APPROVED rows belong here. Per migration 007, a NULL
      // category_confirmed_at means "auto-categorized and auto-approved
      // without human review" — a row still awaiting approval is already
      // surfaced in the main Pending Review list below (which has its own
      // category dropdown), so including it here made the same transaction
      // demand confirmation twice, in two different places.
      //
      // Paged by hand rather than through fetchAllTransactions. That helper
      // cannot express `category_confirmed_at IS NULL`, so routing through it
      // meant pulling every approved row for the month and discarding almost
      // all of them — on a phone, hundreds of rows fetched to keep five. The
      // server does the filtering here, and the page loop still removes the
      // silent 1000-row ceiling the original bare .select() had.
      const data: AutoReviewRow[] = []
      for (let offset = 0; ; ) {
        // A fresh builder per page: PostgrestFilterBuilder can only be awaited
        // once, so the same instance cannot be re-ranged and re-executed.
        const { data: page, error: pageError } = await supabase
          .from('transactions')
          .select('id, amount, type, category, currency, date, merchant, description, possible_duplicate_of')
          .eq('approval_status', 'approved')
          .is('category_confirmed_at', null)
          .gte('date', monthStart)
          .order('id', { ascending: true })
          .range(offset, offset + AUTO_REVIEW_PAGE_SIZE - 1)

        if (pageError) throw pageError
        const rows = page ?? []
        data.push(...rows)
        // Advance by what arrived, not by what was asked for — PostgREST clamps
        // a response to its own db-max-rows, so a short page is not proof the
        // result set is finished.
        if (rows.length === 0) break
        offset += rows.length
      }
      if (data.length > 0) {
        setAutoCategorizedTxns(data)
        setAutoCategorySelections(
          Object.fromEntries(data.map((t) => [t.id, t.category]))
        )
        setShowAutoReviewModal(true)
      }
    } catch (e) {
      console.warn('Failed to fetch unconfirmed categorizations:', e)
    }
  }, [user])

  // ── "Still working" hint for slow-but-live scans ────────
  useEffect(() => {
    if (!scanning) {
      setScanTakingLong(false)
      return
    }
    const timer = setTimeout(() => setScanTakingLong(true), 6000)
    return () => clearTimeout(timer)
  }, [scanning])

  const fetchPendingData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // The whole queue, not the first 15.
      //
      // There is no "load more" control on this page, so a 15-row limit meant a
      // user with 40 pending alerts could only ever see 15 of them and had to
      // approve or reject their way down before the rest appeared — which reads
      // as transactions going missing. It also hid the other half of a
      // possible-duplicate pair whenever the partner fell past the cut, leaving
      // a duplicate badge pointing at a row that was not on screen.
      //
      // Pending is self-limiting: it holds one scan window's unreviewed alerts,
      // and the user's own queue peaked around 40. 250 is far above that while
      // still capping a pathological case.
      const txnsRes = await withTimeout(
        getTransactions({ status: 'pending', limit: PENDING_LIST_LIMIT }),
        45000,
        'Pending data fetch'
      )

      if (txnsRes.error) throw txnsRes.error

      const txns = txnsRes.data || []
      setPendingTxns(txns)
      setTotalPendingCount(txnsRes.count || 0)

      // The list above is capped, so the headline figures need their own query;
      // fetchAllTransactions pages, where the bare .select() this replaced was
      // silently truncated at PostgREST's 1000-row ceiling.
      const { data: allPending } = await fetchAllTransactions({ status: 'pending' })
      setTotalPendingValue(
        (allPending ?? []).reduce((acc, t) => acc + homeCurrencyAmount(t, 'debit'), 0)
      )
      setTotalPendingCredits(
        (allPending ?? []).reduce((acc, t) => acc + homeCurrencyAmount(t, 'credit'), 0)
      )

      const fieldsMap: Record<string, { category: string; description: string }> = {}
      txns.forEach((t) => {
        fieldsMap[t.id] = {
          category: t.category,
          description: parseShortDescription(t.description || '', (t as any).notes || '', t.merchant || ''),
        }
      })
      setEditingFields(fieldsMap)
    } catch (err: any) {
      console.error('Error loading pending transactions:', err)
      setError(err.message || 'Failed to load reviews.')
    } finally {
      setLoading(false)
    }
  }, [])

  const checkScanInactivity = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: scanLogs } = await supabase
        .from('email_scan_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'success')
        .order('scanned_at', { ascending: false })
        .limit(1)

      const lastScan = scanLogs && scanLogs.length > 0 ? new Date(scanLogs[0].scanned_at) : null
      // Deliberately does NOT call setLastScanLog. This query is filtered to
      // status='success' because the inactivity/auto-sync decisions below need
      // the last SUCCESSFUL scan — but it used to also drive the "Last Scan"
      // card, racing fetchLastScanLog (which is unfiltered) on mount and
      // usually winning. The card was therefore pinned to the last successful
      // scan, so a failing scan showed nothing at all: its row was hidden here,
      // and its error banner was lost on the next refresh. The card renders
      // `status === 'failed' && error_message`, which is the whole diagnostic —
      // it just never got the failed row to render.

      const now = new Date()

      if (!lastScan || (now.getTime() - lastScan.getTime() > 24 * 60 * 60 * 1000)) {
        setShowInactivityBanner(true)
      }

    } catch (err) {
      console.error('Pending page inactivity check error:', err)
    }
  }, [])

  useEffect(() => {
    document.title = `Pending Alerts | ${APP_CONFIG.APP_NAME}`
    fetchPendingData()
    // The skipped-emails panel sits under the scan log and describes the same
    // scan, so it has to be loaded on mount too — fetching it only after a scan
    // meant it vanished on the next page load while the log above it stayed.
    fetchLastScanLog().then((log) => fetchRecentRejections(log?.id ?? null))
    fetchUnconfirmedCategorizations()
  }, [fetchPendingData, fetchLastScanLog, fetchRecentRejections, fetchUnconfirmedCategorizations])

  useEffect(() => {
    checkScanInactivity()
  }, [checkScanInactivity])

  const handleFieldChange = (id: string, key: 'category' | 'description', value: string) => {
    setEditingFields((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }))
  }

  // Checks whether this merchant is eligible for a "create a rule?" suggestion.
  // Does NOT save anything — rule creation is explicit-only now. Returns the
  // merchant name if eligible (caller decides whether/how to surface it), or
  // null if not eligible.
  const getMerchantRuleSuggestion = (txn: TransactionRow): string | null => {
    const merchant = txn.merchant || ''
    if (
      !merchant ||
      merchant.length <= 2 ||
      ['Retail Transaction', 'Incoming Credit', 'Bank Transaction'].includes(merchant)
    ) {
      return null
    }
    return merchant
  }

  // Writes the actual approval to the database. Split from the tap handler
  // below so the write can be delayed a few seconds for the undo window.
  const commitApproval = async (txn: TransactionRow, fields: { category: string; description: string }) => {
    try {
      // Approving/recategorizing this transaction only ever writes this one row —
      // it must never silently recategorize other same-merchant transactions.
      const { error } = await updateTransaction(txn.id, {
        category: fields.category,
        description: fields.description,
        approval_status: 'approved',
        // Approving here IS the human review, so stamp the confirmation.
        // Migration 007's contract says anything approved via Pending Alerts
        // carries a timestamp — without this the row stays NULL forever and
        // the Auto-Categorization Review popup keeps asking about a
        // transaction the user already approved.
        category_confirmed_at: new Date().toISOString(),
      })
      if (error) throw error

      // Only offer the rule-creation suggestion once the approval has actually
      // committed — otherwise a user who hits Undo could still create a rule
      // for a categorization that was never saved.
      const suggestedMerchant = getMerchantRuleSuggestion(txn)
      if (suggestedMerchant) {
        setRuleSuggestion({ merchant: suggestedMerchant, category: fields.category })
      }
    } catch (err: any) {
      console.error('Error approving transaction:', err)
      showToast(err.message || 'Failed to approve transaction.', 'error')
      // Put it back in view so the user isn't left wondering where it went.
      await fetchPendingData()
    }
  }

  // One-tap approve: removes the row immediately (feels instant), commits
  // the write a few seconds later, and gives the user a real Undo window
  // in between instead of a confirm-before-you-can-act modal.
  const pendingCommitTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pendingCommitTimers = pendingCommitTimersRef.current

  const handleApproveWithUndo = (txn: TransactionRow) => {
    const fields = editingFields[txn.id] || { category: txn.category, description: txn.description || '' }

    setPendingTxns((prev) => prev.filter((t) => t.id !== txn.id))
    setTotalPendingCount((prev) => Math.max(0, prev - 1))
    adjustPendingTotals([txn], -1)

    const timer = setTimeout(() => {
      pendingCommitTimers.delete(txn.id)
      commitApproval(txn, fields)
    }, 5000)
    pendingCommitTimers.set(txn.id, timer)

    showToast('Transaction approved.', 'success', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingCommitTimers.get(txn.id)
          if (pending) {
            clearTimeout(pending)
            pendingCommitTimers.delete(txn.id)
          }
          setPendingTxns((prev) => [txn, ...prev])
          setTotalPendingCount((prev) => prev + 1)
          adjustPendingTotals([txn], 1)
        },
      },
    })
  }

  // Bulk approve — only offered for high-confidence suggestions (>=80%,
  // the same threshold already used for the green confidence badge), so it
  // never silently approves something the categorizer wasn't sure about.
  const handleApproveAllHighConfidence = () => {
    const eligible = pendingTxns.filter((txn) => {
      const suggestion = applyMerchantRules(txn.merchant || '', (txn as any).notes || '', txn.category)
      return suggestion.confidence >= 80
    })
    if (eligible.length === 0) return

    setPendingTxns((prev) => prev.filter((t) => !eligible.some((e) => e.id === t.id)))
    setTotalPendingCount((prev) => Math.max(0, prev - eligible.length))
    adjustPendingTotals(eligible, -1)

    const snapshot = eligible.map((txn) => ({
      txn,
      fields: editingFields[txn.id] || { category: txn.category, description: txn.description || '' },
    }))
    // Bulk approve intentionally never offers a rule-creation suggestion —
    // showing one banner per merchant across many transactions would be spammy.
    // Rule creation stays a single-transaction, explicit opt-in action.

    const timer = setTimeout(() => {
      snapshot.forEach(({ txn }) => pendingCommitTimers.delete(txn.id))
      snapshot.forEach(({ txn, fields }) => commitApproval(txn, fields))
    }, 5000)
    snapshot.forEach(({ txn }) => pendingCommitTimers.set(txn.id, timer))

    showToast(`Approved ${eligible.length} high-confidence transaction${eligible.length === 1 ? '' : 's'}.`, 'success', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          snapshot.forEach(({ txn }) => {
            const pending = pendingCommitTimers.get(txn.id)
            if (pending) {
              clearTimeout(pending)
              pendingCommitTimers.delete(txn.id)
            }
          })
          setPendingTxns((prev) => [...snapshot.map((s) => s.txn), ...prev])
          setTotalPendingCount((prev) => prev + eligible.length)
          adjustPendingTotals(eligible, 1)
        },
      },
    })
  }

  // Writes the actual rejection to the database. Split from the tap handler
  // below so the write can be delayed a few seconds for the undo window —
  // mirrors commitApproval's split for the same reason.
  const handleReject = async (txn: TransactionRow) => {
    try {
      // Rejecting marks the row, it does NOT delete it.
      //
      // Deleting erased the only record that this email had ever been seen —
      // the scanner builds its dedup set from the transactions table — so the
      // next scan re-detected it and put it straight back in Pending: reject,
      // rescan, reappear, with no way out. Approving never had this problem
      // because that row survives and stays in the dedup set.
      //
      // A first attempt at this wrote the id to email_scan_rejections before
      // deleting. That worked only if a SECOND write succeeded, and silently
      // reverted to the bug if it did not. Keeping the row is unconditional:
      // the dedup set is built from exactly this table with no status filter,
      // so a rejected row can no longer be missed. Every view filters by
      // approval_status, so it stays invisible in the UI.
      const { error } = await updateTransaction(txn.id, { approval_status: 'rejected' })
      if (error) throw error
    } catch (err: any) {
      console.error('Error rejecting transaction:', err)
      showToast(err.message || 'Failed to reject transaction.', 'error')
      // Put it back in view so the user isn't left wondering where it went.
      await fetchPendingData()
    }
  }

  // One-tap reject: removes the row immediately, commits the delete a few
  // seconds later, and gives a real Undo window — same friction-reduction
  // pattern as handleApproveWithUndo, since a blocking confirm modal here
  // was an arbitrary extra step for a comparably reversible action.
  const handleRejectWithUndo = (txn: TransactionRow) => {
    setPendingTxns((prev) => prev.filter((t) => t.id !== txn.id))
    setTotalPendingCount((prev) => Math.max(0, prev - 1))
    adjustPendingTotals([txn], -1)

    const timer = setTimeout(() => {
      pendingCommitTimers.delete(txn.id)
      handleReject(txn)
    }, 5000)
    pendingCommitTimers.set(txn.id, timer)

    showToast('Alert rejected.', 'success', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingCommitTimers.get(txn.id)
          if (pending) {
            clearTimeout(pending)
            pendingCommitTimers.delete(txn.id)
          }
          setPendingTxns((prev) => [txn, ...prev])
          setTotalPendingCount((prev) => prev + 1)
          adjustPendingTotals([txn], 1)
        },
      },
    })
  }

  // ── Bulk actions on a selection the user makes ───────────
  // handleApproveAllHighConfidence above is a fixed sweep: it decides which
  // rows qualify and the user only gets to fire it. This is the other half —
  // tick the rows you mean, then act on them.
  //
  // Both paths funnel into the same 5-second delayed commit with a single
  // Undo, so a bulk action is exactly as reversible as a single one, and
  // nothing is written without an explicit press. R9 ("nothing auto-approves")
  // is untouched: a press on twelve chosen rows is still a press.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Derived, never stored. Rows leave `pendingTxns` as they are approved or
  // rejected; ids left behind in the selection simply stop matching, so there
  // is no stale-selection state to keep in sync.
  const selectedTxns = pendingTxns.filter((t) => selectedIds.has(t.id))

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  /**
   * Shared body of bulk approve and bulk reject: clear the rows from view at
   * once, schedule one timer that commits them all, and offer one Undo for the
   * whole batch. Twelve separate toasts for twelve rows would bury the Undo
   * that matters.
   */
  const runBulk = (
    txns: TransactionRow[],
    commit: (txn: TransactionRow) => void,
    message: (n: number) => string
  ) => {
    if (txns.length === 0) return
    const snapshot = txns.slice()
    const ids = new Set(snapshot.map((t) => t.id))

    setPendingTxns((prev) => prev.filter((t) => !ids.has(t.id)))
    setTotalPendingCount((prev) => Math.max(0, prev - snapshot.length))
    adjustPendingTotals(snapshot, -1)
    clearSelection()

    const timer = setTimeout(() => {
      snapshot.forEach((txn) => pendingCommitTimers.delete(txn.id))
      snapshot.forEach(commit)
    }, 5000)
    snapshot.forEach((txn) => pendingCommitTimers.set(txn.id, timer))

    showToast(message(snapshot.length), 'success', {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          snapshot.forEach((txn) => {
            const pending = pendingCommitTimers.get(txn.id)
            if (pending) {
              clearTimeout(pending)
              pendingCommitTimers.delete(txn.id)
            }
          })
          setPendingTxns((prev) => [...snapshot, ...prev])
          setTotalPendingCount((prev) => prev + snapshot.length)
          adjustPendingTotals(snapshot, 1)
        },
      },
    })
  }

  const handleBulkApprove = () => {
    runBulk(
      selectedTxns,
      (txn) =>
        commitApproval(
          txn,
          editingFields[txn.id] || { category: txn.category, description: txn.description || '' }
        ),
      (n) => `Approved ${n} transaction${n === 1 ? '' : 's'}.`
    )
  }

  const handleBulkReject = () => {
    runBulk(
      selectedTxns,
      (txn) => { void handleReject(txn) },
      (n) => `Rejected ${n} alert${n === 1 ? '' : 's'}.`
    )
  }

  /**
   * Recategorising in bulk deliberately writes nothing. It fills the same
   * per-row edit buffer the category dropdown fills, so the choice reaches the
   * database on approval and by exactly the same path. Mutating an unapproved
   * row directly would change a transaction the user has not accepted yet.
   */
  const handleBulkCategory = (category: string) => {
    if (!category || selectedTxns.length === 0) return
    const count = selectedTxns.length
    setEditingFields((prev) => {
      const next = { ...prev }
      selectedTxns.forEach((txn) => {
        next[txn.id] = {
          category,
          description: prev[txn.id]?.description ?? txn.description ?? '',
        }
      })
      return next
    })
    showToast(
      `${count} transaction${count === 1 ? '' : 's'} set to ${category}. Approve to save.`,
      'success'
    )
  }

  // ── Possible-duplicate resolution ────────────────────────
  // The scanner flags a row it could not PROVE is the same payment as another
  // (see src/services/paymentMerge.ts). Both rows are inserted and the newer
  // one carries `possible_duplicate_of`; the decision is the user's.

  /** "Keep both" — clear the flag so the hint never comes back for this pair. */
  const handleKeepBothDuplicates = async (txn: TransactionRow) => {
    setDuplicateActionId(txn.id)
    try {
      const { error: updateErr } = await updateTransaction(txn.id, { possible_duplicate_of: null })
      if (updateErr) throw updateErr
      setPendingTxns((prev) =>
        prev.map((t) => (t.id === txn.id ? { ...t, possible_duplicate_of: null } : t))
      )
      showToast('Kept both transactions.', 'success')
    } catch (err) {
      console.error('Error clearing duplicate flag:', err)
      showToast(errorMessage(err, 'Failed to update transaction.'), 'error')
    } finally {
      setDuplicateActionId(null)
    }
  }

  /**
   * "Merge" — union the pair into the richer row and delete the other. The
   * survivor stays PENDING: merging is a de-duplication decision, never an
   * approval.
   */
  const handleMergeDuplicates = async (txn: TransactionRow, partner: TransactionRow) => {
    setDuplicateActionId(txn.id)
    try {
      // mergePayments builds on whichever record carries more identifying
      // detail, so the row it returns tells us which one survives.
      const merged = mergePayments(txn, partner)
      const survivor = merged.id === partner.id ? partner : txn
      const absorbed = survivor.id === txn.id ? partner : txn

      // Carry the absorbed row's Gmail message ids onto the survivor, or the
      // next scan would see that email as unknown and recreate the row the
      // user just merged away.
      const messageIds = [
        ...(survivor.merged_email_message_ids ?? []),
        ...(absorbed.merged_email_message_ids ?? []),
        absorbed.email_message_id,
      ].filter((id): id is string => !!id)

      const mergedRow: TransactionRow = {
        ...merged,
        approval_status: 'pending',
        possible_duplicate_of: null,
        merged_email_message_ids: messageIds.length > 0 ? messageIds : null,
      }

      const { error: updateErr } = await updateTransaction(survivor.id, {
        merchant: mergedRow.merchant,
        description: mergedRow.description,
        reference_id: mergedRow.reference_id,
        payment_mode: mergedRow.payment_mode,
        card_issuer: mergedRow.card_issuer,
        card_brand: mergedRow.card_brand,
        transaction_time: mergedRow.transaction_time,
        confidence_score: mergedRow.confidence_score,
        merged_email_message_ids: mergedRow.merged_email_message_ids,
        // Explicit, not incidental: a merged row still needs the user's yes.
        approval_status: 'pending',
        possible_duplicate_of: null,
      })
      if (updateErr) throw updateErr

      // Only after the survivor holds the union is it safe to drop the other.
      const { error: deleteErr } = await deleteTransaction(absorbed.id)
      if (deleteErr) throw deleteErr

      setPendingTxns((prev) =>
        prev.filter((t) => t.id !== absorbed.id).map((t) => (t.id === survivor.id ? mergedRow : t))
      )
      setTotalPendingCount((prev) => Math.max(0, prev - 1))
      adjustPendingTotals([absorbed], -1)
      setEditingFields((prev) => {
        const next = { ...prev }
        delete next[absorbed.id]
        next[survivor.id] = {
          category: prev[survivor.id]?.category ?? mergedRow.category,
          description: parseShortDescription(
            mergedRow.description || '',
            mergedRow.notes || '',
            mergedRow.merchant || ''
          ),
        }
        return next
      })
      showToast('Transactions merged.', 'success')
    } catch (err) {
      console.error('Error merging duplicate transactions:', err)
      showToast(errorMessage(err, 'Failed to merge transactions.'), 'error')
      // A half-applied merge must not stay on screen — reload the truth.
      await fetchPendingData()
    } finally {
      setDuplicateActionId(null)
    }
  }

  const handleAutoCategorySelect = (txnId: string, newCategory: string) => {
    setAutoCategorySelections((prev) => ({ ...prev, [txnId]: newCategory }))
  }

  const handleConfirmCategorization = async (txn: TransactionRow) => {
    const selectedCategory = autoCategorySelections[txn.id] || txn.category
    setConfirmingIds((prev) => new Set(prev).add(txn.id))
    try {
      const { error: updateErr } = await supabase
        .from('transactions')
        .update({ category: selectedCategory, category_confirmed_at: new Date().toISOString() })
        .eq('id', txn.id)

      if (updateErr) throw updateErr

      if (selectedCategory !== txn.category) {
        const suggestedMerchant = getMerchantRuleSuggestion(txn)
        if (suggestedMerchant) {
          setRuleSuggestion({ merchant: suggestedMerchant, category: selectedCategory })
        }
      }

      setAutoCategorizedTxns((prev) => prev.filter((t) => t.id !== txn.id))
      setAutoCategorySelections((prev) => {
        const next = { ...prev }
        delete next[txn.id]
        return next
      })
    } catch (err) {
      console.error('Failed to confirm categorization:', err)
      showToast('Error confirming category. Please try again.', 'error')
    } finally {
      setConfirmingIds((prev) => {
        const next = new Set(prev)
        next.delete(txn.id)
        return next
      })
    }
  }

  const handleScan = async () => {
    setScanning(true)
    setScanProgress(null)
    setScanSuccessMessage(null)
    setScanCooldownMessage(null)
    setError(null)
    setIsPremiumRequired(false)

    try {
      if (!isGoogleConnected) {
        setError('Gmail Inbox not connected. Please click "Connect Gmail Inbox" below to link your inbox.')
        setScanning(false)
        return
      }

      const res = await withTimeout(
        scanRealGmailInbox({ onProgress: (p) => setScanProgress(formatScanProgress(p)) }),
        90000,
        'Gmail scan'
      )

      if (res.error) {
        const msg = res.error.message || ''

        // Premium gate — show upgrade prompt
        if (msg.includes('Premium feature') || msg.includes('Upgrade to')) {
          setIsPremiumRequired(true)
          return
        }

        // Cooldown — show countdown timer. Matched on the engine's own phrases,
        // never on a bare 'hour': any unrelated failure whose text happened to
        // contain that word was dressed up as a cooldown and returned here, so
        // the real error never reached the user.
        if (msg.includes('Next scan available') || msg.includes('Daily scan limit reached')) {
          setScanCooldownMessage(msg)
          await fetchLastScanLog()
          return
        }

        // Token expired
        if (
          msg.includes('expired') ||
          msg.includes('TOKEN_EXPIRED') ||
          msg.includes('List failed') ||
          msg.includes('Forbidden')
        ) {
          notifyGoogleTokenCleared()
        }

        throw res.error
      }

      const count = res.data?.transactions?.length || 0
      const autoApproved = res.data?.autoApprovedCount || 0
      const pendingCount = count - autoApproved
      const lowConfidence = (res.data as any)?.lowConfidencePendingCount || 0
      const merged = (res.data as any)?.mergedDuplicateCount || 0

      // Per-transaction detail already lives in the auto-categorization review
      // modal below — this stays a short, glanceable summary, not a repeat dump.
      setScanSuccessMessage({ total: count, autoApproved, pendingReview: pendingCount, lowConfidence, merged })
      // The scan the banner asked for just happened, so the warning is spent.
      // It also outranks the success summary in the priority chain below, so
      // leaving it up would hide the very result the user pressed Sync Now for.
      setShowInactivityBanner(false)

      await fetchPendingData()
      const freshScanLog = await fetchLastScanLog()
      await fetchRecentRejections(freshScanLog?.id ?? null)
      await fetchUnconfirmedCategorizations()
    } catch (err: any) {
      console.error('Scan error:', err)
      const msg: string = err.message || 'Scan failed. Please try again.'
      // withTimeout's generic copy tells the user to refresh the page, which is
      // wrong advice here — the scan keeps running, and thanks to incremental
      // flushing whatever it already found is saved.
      setError(
        msg.includes('timed out')
          ? 'Scan is taking longer than expected. Anything already found has been saved — scan again to pick up where it left off.'
          : msg
      )
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  const handleReconnectGoogle = async () => {
    try {
      setScanning(true)
      setError(null)
      const { error } = await signInWithGoogle('/pending', true)
      if (error) throw new Error(error)
    } catch (err: any) {
      setError(err.message || 'Failed to redirect to Google.')
      setScanning(false)
    }
  }


  // Only one banner shows at a time — a first-time or trial user hitting this
  // page could otherwise see up to six stacked alerts before a single
  // transaction. Priority: blocking error > premium gate > connect prompt >
  // inactivity > cooldown > success.
  const activeBanner: 'error' | 'premium' | 'connect' | 'inactivity' | 'cooldown' | 'success' | null =
    error ? 'error'
    : isPremiumRequired ? 'premium'
    : !isGoogleConnected ? 'connect'
    : showInactivityBanner ? 'inactivity'
    : scanCooldownMessage ? 'cooldown'
    : scanSuccessMessage ? 'success'
    : null

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">

        {/* ── Premium Gate ──────────────────────────────────── */}
        {activeBanner === 'premium' && (
          <div className="rounded-3xl bg-brand-500/10 border border-brand-500/30 p-6 flex flex-col items-center text-center gap-4 shadow-[var(--shadow-md)] animate-fade-in">
            <div className="h-14 w-14 rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-3xl">
              <Crown className="h-7 w-7 text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Email Scanning is a Premium Feature</h2>
              <p className="text-sm text-zinc-400 mt-1.5 max-w-md">
                Automatically capture transactions from your Gmail inbox. Upgrade to Premium to scan your bank alerts and let Intrack do the work.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
              <Link to="/pricing">
                <Button className="font-bold px-6 gap-1.5">
                  <Crown className="h-4 w-4" /> Upgrade to Premium
                </Button>
              </Link>
              <Button
                variant="secondary"
                onClick={() => setIsPremiumRequired(false)}
                className="text-xs"
              >
                Maybe later
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-sm mt-2">
              {[
                { icon: <Zap className="h-5 w-5 text-brand-400" />, label: 'Auto-scan inbox' },
                { icon: <Brain className="h-5 w-5 text-brand-400" />, label: 'AI categorization' },
                { icon: <BarChart3 className="h-5 w-5 text-brand-400" />, label: 'Full insights' },
              ].map((f) => (
                <div key={f.label} className="rounded-xl bg-surface-2 border border-border-subtle p-2.5 text-center flex flex-col items-center justify-center">
                  <span className="block mb-1">{f.icon}</span>
                  <span className="text-xs text-zinc-400 font-semibold block">{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Pending Alerts</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Bank alerts scanned from email notifications. Review, correct category, and approve them.
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => handleScan()}
                loading={scanning}
                disabled={scanning || !!scanCooldownMessage}
                className="shrink-0 gap-1.5 shadow-md justify-center"
                aria-label="Scan Gmail Inbox for new bank alerts"
              >
                <Sparkles className="h-4 w-4 text-brand-300" /> Scan Bank Alerts
              </Button>
            </div>
            {scanning && (scanProgress || scanTakingLong) ? (
              <span role="status" className="text-xs text-zinc-500">
                {scanProgress ?? 'Still scanning your inbox — large inboxes can take up to a minute…'}
              </span>
            ) : nextScanAt ? (
              /* Directly under the scan button: when the next scan is due, as a
                 clock time in the viewer's own timezone. Replaced a badge that
                 claimed the app catches up on its own, which stopped being true
                 when automatic scanning was removed on 2026-08-27. */
              <span className="text-xs font-semibold text-brand-300 bg-surface-2 border border-border-subtle/50 px-2 py-0.5 rounded-md flex items-center gap-1">
                <Calendar className="h-3 w-3 text-brand-300 shrink-0" /> Next scan {formatNextScanTime(nextScanAt)}
              </span>
            ) : (
              <span className="text-xs text-zinc-500">Ready to scan</span>
            )}
          </div>
        </div>

        {/* ── Scan Dashboard ───────────────────────────────── */}
        {lastScanLog && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="bg-surface-1 border-border-subtle p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Last Scan</p>
              <p className="text-sm font-bold text-white">
                {new Date(lastScanLog.scanned_at).toLocaleDateString('en-IN', {
                  day: '2-digit', month: 'short', year: 'numeric',
                })}
              </p>
              <p className="text-xs text-zinc-500">
                {new Date(lastScanLog.scanned_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit', minute: '2-digit', hour12: true,
                })}
              </p>
            </Card>

            <Card className="bg-surface-1 border-border-subtle p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Last Scan Stats</p>
              <p className="text-sm font-bold text-white">{lastScanLog.transactions_found} transactions</p>
              <p className="text-xs text-zinc-500">{lastScanLog.emails_processed} emails processed</p>
              {/* A failed scan showed "0 transactions" and nothing else, which
                  is indistinguishable from a scan that simply found nothing.
                  The engine records the stage it failed in — show it. */}
              {lastScanLog.status === 'failed' && lastScanLog.error_message && (
                <p className="text-xs text-[var(--status-danger-text)] mt-1 break-words">
                  Failed: {lastScanLog.error_message}
                </p>
              )}
              {/* A SUCCESSFUL scan can still carry a note — low-confidence
                  rows, or the AI being unavailable so everything fell back to
                  regex matching. Those notes were written to the log but
                  rendered nowhere, which is how a ten-week AI outage stayed
                  invisible: the scan said "success" and no one could see that
                  every email had been categorised by the fallback. */}
              {lastScanLog.status === 'success' && lastScanLog.error_message && (
                <p className="text-xs text-[var(--status-warning-text)] mt-1 break-words">
                  {lastScanLog.error_message}
                </p>
              )}
            </Card>

            <Card className="bg-surface-1 border-border-subtle p-4 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {nextScanAt ? 'Next Scan' : 'Scan Status'}
              </p>
              {nextScanAt ? (
                <>
                  <p className="text-sm font-bold text-brand-400">{formatNextScanTime(nextScanAt)}</p>
                  <p className="text-xs text-zinc-500">
                    {quotaExhausted ? "Today's scans used" : 'Scans are at least 4 hours apart'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-[var(--status-positive-text)]">Ready to scan</p>
                  <p className="text-xs text-zinc-500">Click "Scan Bank Alerts" above</p>
                </>
              )}
            </Card>
          </div>
        )}

        {lastScanLog && recentRejections.length > 0 && (
          <div className="rounded-2xl border border-border-subtle bg-surface-1">
            <button
              type="button"
              onClick={() => setShowRejectionsPanel((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300"
            >
              <span>Recently skipped emails ({recentRejections.length})</span>
              <span className="text-xs text-zinc-500">{showRejectionsPanel ? 'Hide' : 'Show'}</span>
            </button>
            {showRejectionsPanel && (
              <div className="px-4 pb-4 space-y-2">
                {recentRejections.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs border-t border-border-subtle/50 pt-2"
                  >
                    <span className="text-zinc-400 truncate">
                      {r.sender_domain || 'unknown sender'} — {r.subject || '(no subject)'}
                    </span>
                    <Badge variant="default" className="shrink-0 w-fit">
                      {r.gate}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {activeBanner === 'error' && error && (
          <div role="alert" className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-md">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 text-[var(--status-danger-text)] shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
            {(error.includes('expired') || error.includes('not connected') || error.includes('TOKEN_EXPIRED') || error.includes('Forbidden')) && (
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0 text-[var(--status-danger-text)] border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] hover:bg-[var(--status-danger-border)] hover:border-[var(--status-danger-text)]/40 transition-all text-xs justify-center font-bold gap-1.5"
                onClick={handleReconnectGoogle}
                loading={scanning}
                disabled={scanning}
              >
                <Key className="h-3.5 w-3.5" /> Connect Gmail Inbox
              </Button>
            )}
          </div>
        )}

        {/* Inactivity banner */}
        {activeBanner === 'inactivity' && (
          <div role="alert" className="rounded-2xl bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] p-4 text-sm text-[var(--status-warning-text)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in shadow-md">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 text-[var(--status-warning-text)] shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white">Refresh Alert — Action Required</p>
                <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                  Your transaction tracker has not refreshed in the last 24 hours. Please refresh the tracker again to cover any transactions you may have missed.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 text-[var(--status-warning-text)] border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] hover:bg-[var(--status-warning-border)] hover:border-[var(--status-warning-text)]/40 transition-all text-xs justify-center gap-1.5"
              onClick={handleScan}
              loading={scanning}
              disabled={scanning}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Sync Now
            </Button>
          </div>
        )}

        {/* Success message */}
        {activeBanner === 'success' && scanSuccessMessage && (
          <div
            role="status"
            className="rounded-2xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-4 sm:p-5
                       flex items-start justify-between gap-3 animate-fade-in"
          >
            <div className="flex items-start gap-3 min-w-0">
              <CheckCircle2 className="h-5 w-5 text-[var(--status-positive-text)] shrink-0 mt-px" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--status-positive-text)]">
                  {scanSuccessMessage.total === 0
                    ? scanSuccessMessage.merged > 0
                      // Every email matched a transaction already on file. Say so
                      // — "no new transactions" alone reads like the scan failed.
                      ? `Scan complete — ${scanSuccessMessage.merged} receipt${scanSuccessMessage.merged === 1 ? '' : 's'} matched transactions you already have.`
                      : 'Scan complete — nothing new in your inbox.'
                    : `Scan complete — ${scanSuccessMessage.total} new transaction${scanSuccessMessage.total === 1 ? '' : 's'} found.`}
                </p>
                {/* Deliberately does not print an "auto-approved" figure. Every
                    scanned transaction lands in Pending for an explicit yes
                    (CLAUDE.md invariant 1), so a line implying otherwise would
                    describe behaviour this app does not have. */}
                {scanSuccessMessage.total > 0 && (
                  <p className="mt-1 text-sm text-zinc-300 leading-relaxed">
                    {scanSuccessMessage.pendingReview > 0
                      ? `${scanSuccessMessage.pendingReview} waiting below for your approval`
                      : 'Everything found is waiting below for your approval'}
                    {scanSuccessMessage.lowConfidence > 0 ? ` · ${scanSuccessMessage.lowConfidence} worth a closer look` : ''}
                    {scanSuccessMessage.merged > 0 ? ` · ${scanSuccessMessage.merged} duplicate receipt${scanSuccessMessage.merged === 1 ? '' : 's'} merged` : ''}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setScanSuccessMessage(null)}
              className="shrink-0 -my-2 -mr-2 min-h-11 min-w-11 px-3 rounded-lg flex items-center justify-center cursor-pointer
                         text-xs font-semibold text-[var(--status-positive-text)] transition-colors hover:bg-[var(--status-positive-border)]/30
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              aria-label="Dismiss scan summary"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Cooldown banner with live countdown */}
        {activeBanner === 'cooldown' && (
          <div
            role="status"
            className="rounded-2xl border border-border-default bg-surface-2/60 p-4 sm:p-5
                       flex items-start justify-between gap-3 animate-fade-in"
          >
            <div className="flex items-start gap-3 min-w-0">
              <Clock className="h-5 w-5 text-zinc-400 shrink-0 mt-px" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-50">
                  {quotaExhausted ? "Today's scans are used up" : 'The next scan is not ready yet'}
                </p>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{scanCooldownMessage}</p>
                {nextScanAt && (
                  <p className="mt-2 text-sm font-semibold text-brand-700 tnum">
                    Next scan {formatNextScanTime(nextScanAt)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setScanCooldownMessage(null) }}
              className="shrink-0 -my-2 -mr-2 min-h-11 min-w-11 px-3 rounded-lg flex items-center justify-center cursor-pointer
                         text-xs font-semibold text-zinc-400 transition-colors hover:bg-surface-3 hover:text-zinc-100
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              aria-label="Dismiss scan limit message"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Gmail connect prompt */}
        {activeBanner === 'connect' && (
          <div
            role="status"
            className="rounded-2xl border border-brand-500/25 bg-brand-500/[0.06] p-4 sm:p-5
                       flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in"
          >
            <div className="flex items-start gap-3 min-w-0">
              <Link2 className="h-5 w-5 text-brand-500 shrink-0 mt-px" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-50">Connect Gmail to start finding transactions</p>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                  Intrack reads your bank alert emails only when you press Scan — never on its own.{' '}
                  {profile?.subscription_status === 'trial'
                    ? '(Trial account active)'
                    : profile?.subscription_plan_type === 'monthly'
                    ? '(Monthly account active)'
                    : '(Yearly account active)'}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <Button
                className="h-11 justify-center gap-1.5"
                onClick={handleReconnectGoogle}
                loading={scanning}
                disabled={scanning}
              >
                <Key className="h-4 w-4" aria-hidden="true" /> Connect Gmail
              </Button>
              {(profile?.subscription_status === 'trial' ||
                (profile?.subscription_status === 'active' &&
                  profile?.subscription_plan_type === 'monthly')) && (
                <Link to="/pricing" className="shrink-0">
                  <Button variant="secondary" block className="h-11 justify-center gap-1.5">
                    <Crown className="h-4 w-4" aria-hidden="true" /> Upgrade to yearly
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* NOT gated by activeBanner — this explainer should always show
            alongside the connect banner above, regardless of banner priority. */}
        {!isGoogleConnected && (
          <Card className="animate-fade-in">
            <div className="flex items-center gap-2.5">
              <Shield className="h-5 w-5 text-brand-500 shrink-0" aria-hidden="true" />
              <h2 className="text-base font-semibold tracking-tight text-zinc-50">
                What happens to your mail
              </h2>
            </div>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              Your inbox is read <em>straight from Gmail</em> over a read-only connection — no server
              here keeps a copy of your mailbox. To tell a real transaction from a newsletter, an
              alert's subject and the start of its body pass through our server to Google's Gemini
              for a moment, and are discarded immediately after.
            </p>
            <div className="mt-4 rounded-xl border border-border-subtle bg-surface-2/60 p-3.5 flex items-start gap-2.5">
              <Lightbulb className="h-4 w-4 text-[var(--status-warning-icon)] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm text-zinc-400 leading-relaxed">
                <strong className="font-semibold text-zinc-100">What is kept:</strong> the transaction
                itself — merchant, amount, date, category — saved to a database row only your account
                can read.{' '}
                <strong className="font-semibold text-zinc-100">What we never see:</strong> your Gmail
                password, your net-banking credentials, PINs, or OTPs.
              </p>
            </div>
            {/* This warning used to sit in the sign-up modal, back when
                logging in with Google also requested the inbox scope. Sign-in
                now asks only for name and email, which Google shows without
                any warning, so the note belongs here — at the one button that
                really does trigger the unverified-app screen. Delete it once
                Google's verification review completes. */}
            <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
              Because {APP_CONFIG.APP_NAME} is still completing Google's formal app verification, the
              next screen may warn that the app is unverified and show a developer key instead of our
              name. That is expected — choose{' '}
              <span className="font-mono text-zinc-300">Advanced → Go to {APP_CONFIG.APP_NAME}</span>{' '}
              to continue. You can revoke this access at any time from your Google Account, or from
              Settings here.
            </p>
          </Card>
        )}

        {/* Quick summary stats */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4 sm:p-5">
            <p className={SECTION_LABEL}>Waiting for you</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 tnum">
              {totalPendingCount}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {totalPendingCount === 1 ? 'transaction to review' : 'transactions to review'}
            </p>
            {/* The list below is capped; the count above is not. Say so, rather
                than letting the headline disagree with what is on screen. */}
            {totalPendingCount > pendingTxns.length && !loading && (
              <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                Showing {pendingTxns.length} of {totalPendingCount} — approve or reject to see the rest
              </p>
            )}
          </Card>
          <Card className="p-4 sm:p-5">
            <p className={SECTION_LABEL}>Value on hold</p>
            {/* Both directions, side by side and never netted. A single figure
                cannot describe this card honestly: summing them hides that the
                amounts move opposite ways, and netting them lets one large
                salary credit mask a large pending spend behind a healthy
                positive number. When nothing incoming is waiting — the common
                case — only the outgoing figure renders. */}
            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight text-zinc-50 tnum">
                <ArrowDown className="h-4 w-4 shrink-0 self-center text-zinc-400" aria-hidden="true" />
                {formatCurrency(totalPendingValue)}
                <span className="text-xs font-medium text-zinc-400">out</span>
              </span>
              {totalPendingCredits > 0 && (
                <span className="flex items-baseline gap-1.5 text-2xl font-semibold tracking-tight text-[var(--status-positive-text)] tnum">
                  <ArrowUp className="h-4 w-4 shrink-0 self-center" aria-hidden="true" />
                  {formatCurrency(totalPendingCredits)}
                  <span className="text-xs font-medium text-zinc-400">in</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-400">Nothing counted until you approve it (₹ only)</p>
          </Card>
        </div>

        {/* Opt-in merchant rule suggestion — rule creation is explicit-only */}
        {ruleSuggestion && (
          <div className="flex flex-col gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.06] p-4 sm:flex-row sm:items-center">
            <p className="flex-1 min-w-0 text-sm text-zinc-300 leading-relaxed">
              Always file <strong className="font-semibold text-zinc-50">{ruleSuggestion.merchant}</strong> under{' '}
              <strong className="font-semibold text-zinc-50">{getStyle(ruleSuggestion.category).label}</strong> in
              future? Each one will still wait here for your approval.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                loading={creatingRule}
                disabled={creatingRule}
                onClick={async () => {
                  if (creatingRule) return
                  setCreatingRule(true)
                  try {
                    if (user?.id) {
                      await saveMerchantRuleToDb(user.id, ruleSuggestion.merchant, ruleSuggestion.category, true)
                      saveMerchantRule(ruleSuggestion.merchant, ruleSuggestion.category, true)
                    }
                    showToast(`Rule saved: ${ruleSuggestion.merchant} → ${getStyle(ruleSuggestion.category).label}`, 'success')
                    setRuleSuggestion(null)
                  } finally {
                    setCreatingRule(false)
                  }
                }}
                className="h-11 flex-1 sm:flex-none justify-center"
              >
                Create rule
              </Button>
              <button
                type="button"
                aria-label="Dismiss rule suggestion"
                onClick={() => setRuleSuggestion(null)}
                className="h-11 w-11 shrink-0 rounded-lg flex items-center justify-center cursor-pointer
                           text-zinc-400 transition-colors hover:bg-surface-2 hover:text-zinc-100
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Transaction review list */}
        <div className="w-full space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="max-w-xl">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Your review queue</h2>
              {/* The 7 days is the SCAN window, not the display window: this
                  list is every unreviewed alert, however old. */}
              <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
                Each scan looks back 7 days. Anything you have not acted on stays here until you do.
              </p>
            </div>
            {(() => {
              const highConfidenceCount = pendingTxns.filter(
                (t) => applyMerchantRules(t.merchant || '', (t as any).notes || '', t.category).confidence >= 80
              ).length
              if (highConfidenceCount === 0) return null
              return (
                <Button
                  variant="secondary"
                  onClick={handleApproveAllHighConfidence}
                  className="h-11 gap-1.5 shrink-0 justify-center"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Approve {highConfidenceCount} confident {highConfidenceCount === 1 ? 'match' : 'matches'}
                </Button>
              )
            })()}
          </div>

          {/* Selection bar — only present once something is ticked, so the
              page is unchanged for anyone reviewing one row at a time. It
              sticks below the 64px app header so a long selection can still be
              acted on without scrolling back up. */}
          {selectedTxns.length > 0 && (
            <Card className="sticky top-[72px] z-10 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-brand-500/35 bg-brand-500/[0.06] shadow-[var(--shadow-md)]">
              <p className="text-sm font-semibold text-zinc-50 shrink-0 tnum">
                {selectedTxns.length} selected
              </p>

              <div className="flex-1 min-w-0">
                <label htmlFor="bulk-category" className="sr-only">
                  Set category for selected transactions
                </label>
                <Select
                  id="bulk-category"
                  value=""
                  onChange={(e) => { handleBulkCategory(e.target.value); e.target.value = '' }}
                >
                  <option value="">Set category…</option>
                  {categories.map((cat) => (
                    <option key={cat.name} value={cat.name}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  className="h-11 flex-1 sm:flex-none justify-center gap-1.5 text-[var(--status-danger-text)] border-[var(--status-danger-border)] hover:bg-[var(--status-danger-subtle)] hover:border-[var(--status-danger-text)]/40"
                  onClick={handleBulkReject}
                >
                  <X className="h-4 w-4" aria-hidden="true" /> Reject
                </Button>
                <Button className="h-11 flex-1 sm:flex-none justify-center gap-1.5" onClick={handleBulkApprove}>
                  <Check className="h-4 w-4" aria-hidden="true" /> Approve
                </Button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="h-11 px-3 shrink-0 rounded-lg text-xs font-medium text-zinc-400 cursor-pointer transition-colors
                             hover:bg-surface-2 hover:text-zinc-100
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  Clear
                </button>
              </div>
            </Card>
          )}

          {loading ? (
            /* Skeletons in the shape of the rows that are coming, so nothing
               jumps when they arrive. A centred spinner told the user only
               that something was happening. */
            <ul role="status" aria-label="Loading your review queue" className="space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <Card className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <Skeleton shape="block" className="h-5 w-5 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-40 max-w-full" />
                        <Skeleton className="h-3 w-56 max-w-full" />
                      </div>
                      <div className="shrink-0 space-y-2 flex flex-col items-end">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-3 w-14" />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Skeleton shape="block" className="h-11" />
                      <Skeleton shape="block" className="h-11" />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <Skeleton shape="block" className="h-11 w-28" />
                      <Skeleton shape="block" className="h-11 w-32" />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          ) : pendingTxns.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CheckCircle2 className="h-7 w-7 text-[var(--status-positive-text)]" aria-hidden="true" />}
                title="Nothing to review"
                description="Every transaction Intrack has found is dealt with. Anything the next scan turns up will wait for you here."
              />
            </Card>
          ) : (
            <ul className="space-y-3">
            <AnimatePresence initial={false}>
            {pendingTxns.map((txn) => {
              const localFields = editingFields[txn.id] || {
                category: txn.category,
                description: txn.description || '',
              }
              const isDebit = txn.type === 'debit'
              const cardDetails = formatCardDetails(txn)

              const suggestion = applyMerchantRules(
                txn.merchant || '',
                (txn as any).notes || '',
                txn.category
              )

              // Only the flagged row shows the hint, and only while the row it
              // points at is still on screen. If the partner was already
              // approved, rejected or deleted there is nothing to compare
              // against, so the affordance is simply not rendered.
              const duplicatePartner = txn.possible_duplicate_of
                ? pendingTxns.find((t) => t.id === txn.possible_duplicate_of) ?? null
                : null

              // Presentation of the same 80 / 50 bands the page has always
              // used. Icon plus word, so the band never depends on colour.
              const tone = confidenceTone(suggestion.confidence)
              const ToneIcon = tone.icon
              const identity = resolveTransactionIdentity(txn)
              const isSelected = selectedIds.has(txn.id)
              const paidWith = cardDetails ? cardDetails : formatPaymentSource(txn)
              const isCard =
                (txn as any).payment_mode === 'credit_card' ||
                (txn as any).payment_mode === 'debit_card' ||
                isCardPayment((txn as any).notes)

              return (
                <motion.li
                  key={txn.id}
                  layout={!reduceMotion}
                  variants={rowVariants(reduceMotion)}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={transition(reduceMotion)}
                >
                <Card
                  className={cn(
                    'p-4 sm:p-5 flex flex-col gap-4 transition-colors',
                    isSelected ? 'border-brand-500/40 bg-brand-500/[0.03]' : 'hover:border-border-hover'
                  )}
                >
                  {/* The four facts, in one glance: what it was, how much, and
                      when. The amount sits hard against the right edge of every
                      card, so the figures line up as a column down the list. */}
                  <div className="flex items-start gap-3">
                    <label
                      className="shrink-0 -ml-1.5 -mt-1.5 h-11 w-11 rounded-lg flex items-center justify-center cursor-pointer
                                 transition-colors hover:bg-surface-2
                                 focus-within:ring-2 focus-within:ring-brand-500/40"
                    >
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] rounded border-border-hover accent-[var(--brand-500)] cursor-pointer focus:outline-none"
                        checked={isSelected}
                        onChange={() => toggleSelected(txn.id)}
                        aria-label={`Select ${identity.title} for a bulk action`}
                      />
                    </label>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-50 truncate" title={identity.title}>
                        {identity.title}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                        <span className="tnum">{formatDate(txn.date)}</span>
                        <span aria-hidden="true" className="text-zinc-500">·</span>
                        <span className="tnum">{parseTransactionTime(txn)}</span>
                        <span aria-hidden="true" className="text-zinc-500">·</span>
                        <span className="inline-flex items-center gap-1 min-w-0">
                          {isCard ? (
                            <CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate" title={paidWith}>{paidWith}</span>
                        </span>
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'text-base sm:text-lg font-semibold tracking-tight tnum',
                          isDebit ? 'text-zinc-50' : 'text-[var(--status-positive-text)]'
                        )}
                      >
                        {formatCurrency(Number(txn.amount), txn.currency)}
                      </p>
                      {/* Direction is carried by an arrow and a word, never by
                          the colour of the figure alone. */}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-zinc-400">
                        {isDebit ? (
                          <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        {isDebit ? 'out' : 'in'}
                      </p>
                    </div>
                  </div>

                  {/* Where it came from and how sure Intrack is — supporting
                      detail, deliberately quieter than the four facts above. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400 border-t border-border-subtle pt-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Found in your inbox
                    </span>
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <ToneIcon className={cn('h-3.5 w-3.5 shrink-0', tone.className)} aria-hidden="true" />
                      <span className={tone.className}>
                        {tone.label}
                        {suggestion.confidence > 0 ? ` (${suggestion.confidence}%)` : ''}
                      </span>
                      <span className="truncate" title={suggestion.matchReason}>
                        · {suggestion.matchReason}
                      </span>
                    </span>
                  </div>

                  {/* Possible-duplicate hint — user decides, nothing auto-merges */}
                  {duplicatePartner && (
                    <div className="flex flex-col gap-3 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] p-3.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <CopyCheck className="h-4 w-4 text-[var(--status-warning-text)] shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--status-warning-text)]">
                            This might be a duplicate
                          </p>
                          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">
                            It could be the same payment as{' '}
                            <strong className="font-semibold text-zinc-100">
                              {resolveTransactionIdentity(duplicatePartner).title}
                            </strong>{' '}
                            <strong className="font-semibold text-zinc-100 tnum">
                              {formatCurrency(Number(duplicatePartner.amount), duplicatePartner.currency)}
                            </strong>{' '}
                            on {formatDate(duplicatePartner.date)} — a bank alert and a receipt for one
                            purchase. Merging keeps it here, still waiting for your approval.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:justify-end">
                        <Button
                          variant="secondary"
                          className="h-11 flex-1 sm:flex-none justify-center"
                          onClick={() => handleKeepBothDuplicates(txn)}
                          disabled={duplicateActionId === txn.id}
                        >
                          Keep both
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-11 flex-1 sm:flex-none justify-center"
                          onClick={() => handleMergeDuplicates(txn, duplicatePartner)}
                          loading={duplicateActionId === txn.id}
                          disabled={duplicateActionId === txn.id}
                        >
                          Merge
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Corrections. Whatever is chosen here is what gets saved
                      when the row is approved — never before. */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`cat-select-${txn.id}`}
                        className="block text-xs font-medium text-zinc-300 mb-1.5"
                      >
                        Category
                      </label>
                      <Select
                        id={`cat-select-${txn.id}`}
                        value={localFields.category}
                        onChange={(e) => handleFieldChange(txn.id, 'category', e.target.value)}
                      >
                        {categories.map((cat) => (
                          <option key={cat.name} value={cat.name}>
                            {cat.emoji} {cat.name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label
                        htmlFor={`desc-input-${txn.id}`}
                        className="block text-xs font-medium text-zinc-300 mb-1.5"
                      >
                        Description
                      </label>
                      <Input
                        id={`desc-input-${txn.id}`}
                        value={localFields.description}
                        onChange={(e) => handleFieldChange(txn.id, 'description', e.target.value)}
                        placeholder="e.g. Swiggy lunch"
                      />
                    </div>
                  </div>

                  {/* The two decisions, pushed to opposite ends of the row and
                      given different weight, so the destructive one is never
                      the neighbour of the confirming one under a thumb. Both
                      are reversible for five seconds via the Undo in the toast. */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <Button
                      variant="secondary"
                      className="h-11 justify-center gap-1.5 text-[var(--status-danger-text)] border-[var(--status-danger-border)] hover:bg-[var(--status-danger-subtle)] hover:border-[var(--status-danger-text)]/40"
                      onClick={() => handleRejectWithUndo(txn)}
                      aria-label={`Reject ${identity.title}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" /> Reject
                    </Button>
                    <Button
                      className="h-11 min-w-[9rem] justify-center gap-1.5"
                      onClick={() => handleApproveWithUndo(txn)}
                      aria-label={`Approve ${identity.title}`}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" /> Approve
                    </Button>
                  </div>
                </Card>
                </motion.li>
              )
            })}
            </AnimatePresence>
            </ul>
          )}
        </div>
      </div>

      {/* Auto-Categorization Review Modal */}
      <Modal
        isOpen={showAutoReviewModal && autoCategorizedTxns.length > 0}
        onClose={() => {
          setShowAutoReviewModal(false)
          setAutoCategorizedTxns([])
        }}
        title="Auto-Categorization Review"
        className="sm:max-w-xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-zinc-500 font-medium">
              {autoCategorizedTxns.length} awaiting your confirmation
            </span>
            <Button
              variant="primary"
              onClick={() => {
                setShowAutoReviewModal(false)
                setAutoCategorizedTxns([])
              }}
              className="font-bold text-xs"
            >
              Review Later
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-brand-500/5 border border-brand-500/10 rounded-xl p-3.5 text-xs text-brand-300 leading-relaxed flex items-start gap-2.5">
            <Brain className="h-4 w-4 text-brand-400 shrink-0 mt-0.5" />
            <span>
              <strong>Self-Learning Engine Active:</strong> These transactions were auto-categorized and need your confirmation. Change the category if it's wrong, then confirm each one below.
            </span>
          </div>

          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
            {autoCategorizedTxns.map((txn) => (
              <div
                key={txn.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-surface-2 border border-border-subtle hover:border-zinc-700/50 transition-all gap-3 animate-fade-in"
              >
                {/* Same identity resolution as the review list above — the raw
                    merchant/description pair this replaced printed bank
                    narration verbatim and labelled blanks "Unknown Vendor". */}
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <TransactionIdentity {...resolveTransactionIdentity(txn)} size="sm" className="max-w-[280px]" />
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/30 shrink-0">
                      {formatDate(txn.date)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                  <span className="text-sm font-bold text-[var(--status-positive-text)] font-mono pr-1">
                    {formatCurrency(Number(txn.amount), txn.currency)}
                  </span>

                  <select
                    value={autoCategorySelections[txn.id] || txn.category}
                    disabled={confirmingIds.has(txn.id)}
                    onChange={(e) => handleAutoCategorySelect(txn.id, e.target.value)}
                    className="bg-surface-3 border border-border-subtle text-xs text-zinc-300 rounded-xl px-2.5 h-11 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer font-semibold"
                    aria-label={`Category for ${resolveTransactionIdentity(txn).title}`}
                  >
                    {categories.map((cat) => (
                      <option key={cat.name} value={cat.name}>
                        {cat.emoji} {cat.name}
                      </option>
                    ))}
                  </select>

                  <Button
                    size="sm"
                    onClick={() => handleConfirmCategorization(txn)}
                    loading={confirmingIds.has(txn.id)}
                    disabled={confirmingIds.has(txn.id)}
                    className="text-xs font-bold shrink-0"
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

    </AppLayout>
  )
}
