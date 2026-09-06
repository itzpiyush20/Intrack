// ============================================
// StatementImportModal — Client-side bank statement & CSV importer
// Privacy-first: Zero server uploads, completely local parsing.
// All transactions land in Pending (approval_status: 'pending') for review.
// ============================================

import { useState, useRef, useEffect, useMemo, type ChangeEvent, type DragEvent } from 'react'
import { Modal, Button, Badge } from '@/components/ui'
import {
  parseStatementCSV,
  saveImportedTransactions,
  type ParsedStatementRow,
  type ParseStatementResult,
} from '@/services/statementImporter'
import { getCards } from '@/services/cards'
import { useCategories } from '@/context/CategoriesContext'
import { useToast } from '@/context'
import { formatCurrency, formatDate, cn } from '@/utils'
import type { Card } from '@/types'
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Building2,
  CreditCard,
  ArrowDown,
  ArrowUp,
  Shield,
  Clock,
  Trash2,
} from 'lucide-react'

interface StatementImportModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (importedCount: number) => void
}

export default function StatementImportModal({
  isOpen,
  onClose,
  onSuccess,
}: StatementImportModalProps) {
  const { categories, fallbackCategory } = useCategories()
  const { showToast } = useToast()

  const [cards, setCards] = useState<Card[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string>('auto')
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseResult, setParseResult] = useState<ParseStatementResult | null>(null)
  const [rows, setRows] = useState<ParsedStatementRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [importing, setImporting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load user registered cards on modal open
  useEffect(() => {
    if (!isOpen) {
      // Reset state when closed
      setFile(null)
      setParsing(false)
      setParseResult(null)
      setRows([])
      setError(null)
      setIsDragging(false)
      setImporting(false)
      setSelectedCardId('auto')
      return
    }

    let mounted = true
    getCards().then(({ data }) => {
      if (mounted && data) {
        setCards(data.filter((c) => !c.is_archived))
      }
    })

    return () => {
      mounted = false
    }
  }, [isOpen])

  const handleProcessFile = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a .csv bank statement file.')
      return
    }

    setFile(selectedFile)
    setParsing(true)
    setError(null)

    try {
      const text = await selectedFile.text()
      const result = parseStatementCSV(text, {
        userCards: cards,
        categories,
        fallbackCategory: fallbackCategory?.name || 'Other',
        defaultCardId: selectedCardId !== 'auto' && selectedCardId !== 'none' ? selectedCardId : null,
      })

      if (result.error) {
        setError(result.error)
        setParseResult(null)
        setRows([])
      } else {
        setParseResult(result)
        setRows(result.rows)
      }
    } catch (err: any) {
      console.error('Failed to parse statement CSV:', err)
      setError(err.message || 'Failed to read the statement file.')
    } finally {
      setParsing(false)
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleProcessFile(files[0])
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleProcessFile(files[0])
    }
  }

  // Toggle selection for all rows
  const handleToggleSelectAll = (checked: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })))
  }

  // Toggle selection for individual row
  const handleToggleRow = (id: string, checked: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: checked } : r)))
  }

  // Update row category
  const handleRowCategoryChange = (id: string, newCategory: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, category: newCategory } : r)))
  }

  // Update card assignment
  const handleCardMappingChange = (cardId: string) => {
    setSelectedCardId(cardId)
    if (cardId === 'none') {
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          card_id: null,
          card_last4: null,
          card_issuer: null,
          card_brand: null,
        }))
      )
    } else if (cardId !== 'auto') {
      const card = cards.find((c) => c.id === cardId)
      if (card) {
        setRows((prev) =>
          prev.map((r) => ({
            ...r,
            card_id: card.id,
            card_last4: card.last4 || null,
            card_issuer: card.issuer || null,
            card_brand: card.brand || null,
          }))
        )
      }
    } else if (file) {
      // Re-run parsing with auto-detect
      file.text().then((text) => {
        const result = parseStatementCSV(text, {
          userCards: cards,
          categories,
          fallbackCategory: fallbackCategory?.name || 'Other',
        })
        if (!result.error) {
          setRows(result.rows)
        }
      })
    }
  }

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows])
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const someSelected = selectedRows.length > 0 && selectedRows.length < rows.length

  const selectedDebitsTotal = useMemo(
    () => selectedRows.filter((r) => r.type === 'debit').reduce((sum, r) => sum + r.amount, 0),
    [selectedRows]
  )

  const selectedCreditsTotal = useMemo(
    () => selectedRows.filter((r) => r.type === 'credit').reduce((sum, r) => sum + r.amount, 0),
    [selectedRows]
  )

  const handleSubmitImport = async () => {
    if (selectedRows.length === 0) {
      showToast('Please select at least one transaction to import.', 'warning')
      return
    }

    setImporting(true)
    try {
      const explicitCardId = selectedCardId !== 'auto' && selectedCardId !== 'none' ? selectedCardId : undefined
      const result = await saveImportedTransactions(selectedRows, { cardId: explicitCardId })

      if (!result.success || result.error) {
        throw result.error || new Error('Failed to import transactions')
      }

      showToast(`Imported ${result.insertedCount} transactions to Pending Alerts for review.`, 'success')
      onSuccess?.(result.insertedCount)
      onClose()
    } catch (err: any) {
      console.error('Import error:', err)
      showToast(err.message || 'Error saving statement transactions.', 'error')
    } finally {
      setImporting(false)
    }
  }

  const handleResetFile = () => {
    setFile(null)
    setParseResult(null)
    setRows([])
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Bank Statement"
      className="max-w-4xl max-h-[90svh]"
    >
      <div className="flex flex-col h-full overflow-hidden p-6 gap-5">
        {/* Step 1: Dropzone (when no rows parsed yet) */}
        {rows.length === 0 && (
          <div className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'relative flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer',
                isDragging
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-sb-hairline bg-surface-2/40 hover:bg-surface-2/70 hover:border-brand-500/40'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <div className="h-14 w-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-4 text-brand-600">
                {parsing ? (
                  <div className="h-6 w-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Upload className="h-7 w-7" />
                )}
              </div>

              <h3 className="text-base font-bold text-sb-ink">
                {parsing ? 'Parsing statement locally...' : 'Drop your bank statement CSV here'}
              </h3>
              <p className="text-sm text-sb-ink-muted mt-1 max-w-md">
                Drag and drop your statement file here, or click to browse.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sb-ink-secondary bg-surface-1 border border-sb-hairline px-2.5 py-1 rounded-lg">
                  <Building2 className="h-3.5 w-3.5 text-brand-600" /> HDFC
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sb-ink-secondary bg-surface-1 border border-sb-hairline px-2.5 py-1 rounded-lg">
                  <Building2 className="h-3.5 w-3.5 text-brand-600" /> ICICI
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sb-ink-secondary bg-surface-1 border border-sb-hairline px-2.5 py-1 rounded-lg">
                  <Building2 className="h-3.5 w-3.5 text-brand-600" /> SBI
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sb-ink-secondary bg-surface-1 border border-sb-hairline px-2.5 py-1 rounded-lg">
                  <Building2 className="h-3.5 w-3.5 text-brand-600" /> Axis
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sb-ink-secondary bg-surface-1 border border-sb-hairline px-2.5 py-1 rounded-lg">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> Generic Statement CSV
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] text-sm text-[var(--status-danger-text)]">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Privacy Guarantee Banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-brand-500/20 bg-brand-500/5 text-xs text-sb-ink-secondary">
              <Shield className="h-4 w-4 shrink-0 text-brand-600 mt-0.5" />
              <div>
                <span className="font-bold text-sb-ink block">100% Client-Side Privacy Guarantee</span>
                Parsing happens entirely inside your browser. No files or banking data are ever uploaded to any server.
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Preview & Table (when rows exist) */}
        {rows.length > 0 && (
          <div className="flex flex-col h-full min-h-0 space-y-4">
            {/* Header summary bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-surface-2 border border-sb-hairline">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-sb-ink truncate max-w-xs">{file?.name}</h4>
                    <Badge variant="aurora">
                      {parseResult?.detectedBank === 'GENERIC'
                        ? 'Standard Statement'
                        : `${parseResult?.detectedBank} Bank`}
                    </Badge>
                  </div>
                  <p className="text-xs text-sb-ink-muted mt-0.5">
                    {rows.length} transactions found
                    {parseResult && parseResult.skippedRows > 0 && ` (${parseResult.skippedRows} non-transaction rows ignored)`}
                  </p>
                </div>
              </div>

              {/* Card mapping dropdown */}
              <div className="flex items-center gap-2">
                <label htmlFor="card-mapping" className="text-xs font-semibold text-sb-ink-muted whitespace-nowrap">
                  Assign Card:
                </label>
                <select
                  id="card-mapping"
                  value={selectedCardId}
                  onChange={(e) => handleCardMappingChange(e.target.value)}
                  className="text-xs font-semibold bg-surface-1 border border-sb-hairline text-sb-ink rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="auto">Auto-detect from narration</option>
                  <option value="none">None (Bank Account / Cash)</option>
                  {cards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name} ({card.last4 ? `••${card.last4}` : 'Card'})
                    </option>
                  ))}
                </select>

                <Button
                  variant="ghost"
                  onClick={handleResetFile}
                  className="h-8 px-2 text-xs text-sb-ink-muted hover:text-[var(--status-danger-text)]"
                  title="Upload another file"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Invariant Alert: lands in Pending */}
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-800 dark:text-amber-200">
              <Clock className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <span>
                <strong>Human Review Guard:</strong> All imported items land in <strong>Pending Alerts</strong>. Nothing auto-approves.
              </span>
            </div>

            {/* Table Container */}
            <div className="flex-1 min-h-0 overflow-y-auto border border-sb-hairline rounded-xl bg-surface-1 shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-surface-2 border-b border-sb-hairline text-sb-ink-muted font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected
                        }}
                        onChange={(e) => handleToggleSelectAll(e.target.checked)}
                        className="rounded border-sb-hairline text-brand-600 focus:ring-brand-500 cursor-pointer"
                        aria-label="Select all transactions"
                      />
                    </th>
                    <th className="p-3 w-28">Date</th>
                    <th className="p-3">Description</th>
                    <th className="p-3 w-24">Mode</th>
                    <th className="p-3 w-36">Category</th>
                    <th className="p-3 w-20 text-center">Type</th>
                    <th className="p-3 w-28 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sb-hairline">
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'transition-colors duration-150',
                        row.selected ? 'bg-surface-1 hover:bg-surface-2/60' : 'bg-surface-2/30 opacity-60'
                      )}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => handleToggleRow(row.id, e.target.checked)}
                          className="rounded border-sb-hairline text-brand-600 focus:ring-brand-500 cursor-pointer"
                          aria-label={`Select transaction ${row.description}`}
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap font-medium text-sb-ink tabular-nums">
                        {formatDate(row.date)}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-sb-ink truncate">{row.description}</span>
                          {row.reference_id && (
                            <span className="text-[10px] text-sb-ink-muted tabular-nums font-mono">
                              Ref: {row.reference_id}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-[11px]">
                          {row.card_last4 ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-sb-hairline font-mono font-medium text-sb-ink-secondary">
                              <CreditCard className="h-3 w-3 text-brand-600" />
                              ••{row.card_last4}
                            </span>
                          ) : (
                            <span className="text-sb-ink-muted uppercase font-medium">
                              {row.payment_mode || 'bank'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <select
                          value={row.category}
                          onChange={(e) => handleRowCategoryChange(row.id, e.target.value)}
                          className="w-full text-xs bg-surface-2 border border-sb-hairline text-sb-ink rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                        >
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.name}>
                              {cat.emoji} {cat.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                            row.type === 'debit'
                              ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger-text)]'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          )}
                        >
                          {row.type === 'debit' ? (
                            <>
                              <ArrowDown className="h-2.5 w-2.5" /> Dr
                            </>
                          ) : (
                            <>
                              <ArrowUp className="h-2.5 w-2.5" /> Cr
                            </>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap font-bold text-sb-ink tabular-nums">
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-sb-hairline">
              <div className="text-xs text-sb-ink-muted flex items-center gap-3">
                <span>
                  <strong>{selectedRows.length}</strong> of {rows.length} selected
                </span>
                {selectedDebitsTotal > 0 && (
                  <span className="text-sb-ink font-semibold tabular-nums">
                    Debits: {formatCurrency(selectedDebitsTotal)}
                  </span>
                )}
                {selectedCreditsTotal > 0 && (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                    Credits: {formatCurrency(selectedCreditsTotal)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button variant="secondary" onClick={onClose} disabled={importing} className="text-xs">
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitImport}
                  loading={importing}
                  disabled={importing || selectedRows.length === 0}
                  className="text-xs font-semibold gap-1.5"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                  Import {selectedRows.length} to Pending
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
