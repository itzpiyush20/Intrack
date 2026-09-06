// ============================================
// Statement Importer Service
// 100% Client-Side Bank Statement & CSV Importer
// Privacy-first: Zero server uploads, completely local parsing
// Supports major Indian banks (HDFC, ICICI, SBI, Axis) & generic CSVs
// Invariant: Imported rows ALWAYS land in Pending (approval_status: 'pending')
// ============================================

import { supabase } from './supabase'
import { normalizeMerchant } from './merchantNormalizer'
import { getCards } from './cards'
import type { Card, CardBrand, SourceType, Category } from '@/types'

export type SupportedBank = 'HDFC' | 'ICICI' | 'SBI' | 'AXIS' | 'GENERIC'

export interface ParsedStatementRow {
  id: string
  date: string // YYYY-MM-DD
  rawDate: string
  description: string
  rawDescription: string
  type: 'debit' | 'credit'
  amount: number
  balance?: number | null
  reference_id?: string | null
  merchant?: string | null
  category: string
  payment_mode?: SourceType | null
  card_last4?: string | null
  card_id?: string | null
  card_issuer?: string | null
  card_brand?: CardBrand | null
  selected: boolean
}

export interface ParseStatementOptions {
  userCards?: Card[]
  categories?: Category[]
  fallbackCategory?: string
  defaultCardId?: string | null
}

export interface ParseStatementResult {
  rows: ParsedStatementRow[]
  detectedBank: SupportedBank
  totalDebits: number
  totalCredits: number
  totalRows: number
  skippedRows: number
  error?: string | null
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
}

/**
 * RFC 4180 compliant CSV tokenizer/parser.
 * Handles embedded commas, escaped quotes, newlines in quotes, and varying line endings.
 */
export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let i = 0

  while (i < clean.length) {
    const char = clean[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          currentField += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        currentField += char
        i++
        continue
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
        continue
      } else if (char === ',') {
        currentRow.push(currentField.trim())
        currentField = ''
        i++
        continue
      } else if (char === '\r') {
        if (i + 1 < clean.length && clean[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField.trim())
        currentField = ''
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow)
        }
        currentRow = []
        i++
        continue
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        currentField = ''
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow)
        }
        currentRow = []
        i++
        continue
      } else {
        currentField += char
        i++
        continue
      }
    }
  }

  currentRow.push(currentField.trim())
  if (currentRow.some((f) => f.length > 0)) {
    rows.push(currentRow)
  }

  return rows
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/**
 * Parses Indian bank statement dates into ISO YYYY-MM-DD.
 * Formats supported:
 * - DD/MM/YYYY, DD-MM-YYYY
 * - DD/MM/YY, DD-MM-YY
 * - DD-MMM-YYYY, DD MMM YYYY, DD/MMM/YYYY, DD-MMM-YY (e.g. 05-Jan-2024, 15 Jan 2024)
 * - YYYY-MM-DD
 */
export function parseStatementDate(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.trim()

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (isoMatch) {
    const y = Number(isoMatch[1])
    const m = Number(isoMatch[2])
    const d = Number(isoMatch[3])
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  // 2. Month name format: DD-MMM-YYYY or DD MMM YYYY or DD-MMM-YY
  const mmmMatch = cleaned.match(/^(\d{1,2})[\s\-/]+([A-Za-z]+)[\s\-/]+(\d{2,4})/)
  if (mmmMatch) {
    const d = Number(mmmMatch[1])
    const monthKey = mmmMatch[2].toLowerCase()
    const mStr = MONTH_NAME_MAP[monthKey]
    if (mStr) {
      const m = Number(mStr)
      let y = Number(mmmMatch[3])
      if (mmmMatch[3].length === 2) {
        y = y >= 70 ? 1900 + y : 2000 + y
      }
      if (isValidCalendarDate(y, m, d)) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
    }
  }

  // 3. Indian standard DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/)
  if (dmyMatch) {
    const d = Number(dmyMatch[1])
    const m = Number(dmyMatch[2])
    let y = Number(dmyMatch[3])
    if (dmyMatch[3].length === 2) {
      y = y >= 70 ? 1900 + y : 2000 + y
    }
    if (isValidCalendarDate(y, m, d)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  return null
}

/**
 * Cleans currency strings, Indian commas, parentheses, etc. into a positive float.
 */
export function parseStatementAmount(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null) return 0
  if (typeof raw === 'number') return isNaN(raw) ? 0 : Math.abs(raw)

  let str = String(raw).trim()
  if (!str) return 0

  // Strip currency symbols, commas, spaces
  str = str
    .replace(/[₹]/g, '')
    .replace(/(?:inr|rs\.?)/gi, '')
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .trim()

  const num = parseFloat(str)
  return isNaN(num) ? 0 : Math.abs(num)
}

interface ColumnMapping {
  date: number
  description: number
  debit: number
  credit: number
  amount: number
  type: number
  ref: number
  balance: number
}

const DATE_REGEX = /^(?:txn\s*date|tran\s*date|transaction\s*date|value\s*date|posting\s*date|date)$/i
const DESC_REGEX = /^(?:narration|particulars|description|transaction\s*(?:details|remarks|description)|details|remarks|payee)$/i
const DEBIT_REGEX = /^(?:withdrawal(?:\s*(?:amt\.?|amount))?(?:\s*\(.*?\))?|debit(?:\s*(?:amt\.?|amount))?(?:\s*\(.*?\))?|dr\.?|dr\s*amount)$/i
const CREDIT_REGEX = /^(?:deposit(?:\s*(?:amt\.?|amount))?(?:\s*\(.*?\))?|credit(?:\s*(?:amt\.?|amount))?(?:\s*\(.*?\))?|cr\.?|cr\s*amount)$/i
const AMOUNT_REGEX = /^(?:amount|txn\s*amount|transaction\s*amount|amt\.?)(?:\s*\(.*?\))?$/i
const TYPE_REGEX = /^(?:cr\/dr|dr\/cr|type|txn\s*type|transaction\s*type|debit\/credit)$/i
const REF_REGEX = /^(?:chq\.?\/?ref\.?\s*no\.?|cheque\s*(?:number|no\.?)|ref(?:\.?\s*no\.?|\s*number)?|reference(?:\s*id|\s*no\.?)?|chqno|utr(?:\s*no\.?)?|txn\s*id)$/i
const BALANCE_REGEX = /^(?:balance(?:\s*\(.*?\))?|closing\s*balance|bal\.?|available\s*balance)$/i

/**
 * Detects table header row index and column mapping by matching bank header patterns.
 */
function findHeaderRow(rows: string[][]): { headerIndex: number; mapping: ColumnMapping } | null {
  const maxScan = Math.min(rows.length, 35)

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r]
    if (!row || row.length < 2) continue

    let dateIdx = -1
    let descIdx = -1
    let debitIdx = -1
    let creditIdx = -1
    let amountIdx = -1
    let typeIdx = -1
    let refIdx = -1
    let balanceIdx = -1

    for (let c = 0; c < row.length; c++) {
      const cell = row[c].trim().toLowerCase()
      if (!cell) continue

      if (dateIdx === -1 && (DATE_REGEX.test(cell) || cell.includes('date'))) {
        dateIdx = c
      } else if (descIdx === -1 && (DESC_REGEX.test(cell) || cell.includes('narration') || cell.includes('particular') || cell.includes('description'))) {
        descIdx = c
      } else if (debitIdx === -1 && (DEBIT_REGEX.test(cell) || cell.startsWith('withdrawal') || cell.startsWith('debit'))) {
        debitIdx = c
      } else if (creditIdx === -1 && (CREDIT_REGEX.test(cell) || cell.startsWith('deposit') || cell.startsWith('credit'))) {
        creditIdx = c
      } else if (amountIdx === -1 && (AMOUNT_REGEX.test(cell) || cell.startsWith('amount'))) {
        amountIdx = c
      } else if (typeIdx === -1 && TYPE_REGEX.test(cell)) {
        typeIdx = c
      } else if (refIdx === -1 && (REF_REGEX.test(cell) || cell.includes('ref') || cell.includes('chq'))) {
        refIdx = c
      } else if (balanceIdx === -1 && (BALANCE_REGEX.test(cell) || cell.includes('balance'))) {
        balanceIdx = c
      }
    }

    const hasDate = dateIdx !== -1
    const hasDesc = descIdx !== -1
    const hasAmounts = (debitIdx !== -1 || creditIdx !== -1) || amountIdx !== -1

    if (hasDate && hasDesc && hasAmounts) {
      return {
        headerIndex: r,
        mapping: {
          date: dateIdx,
          description: descIdx,
          debit: debitIdx,
          credit: creditIdx,
          amount: amountIdx,
          type: typeIdx,
          ref: refIdx,
          balance: balanceIdx,
        },
      }
    }
  }

  return null
}

/**
 * Detects the originating bank based on CSV content and header signatures.
 */
function detectBank(rawText: string, headerRow: string[]): SupportedBank {
  const textSample = rawText.slice(0, 3000).toLowerCase()
  const headerSample = headerRow.join(' ').toLowerCase()

  if (textSample.includes('hdfc bank') || headerSample.includes('chq./ref.no.')) {
    return 'HDFC'
  }
  if (textSample.includes('icici bank') || headerSample.includes('transaction remarks') || headerSample.includes('withdrawal amount (inr )')) {
    return 'ICICI'
  }
  if (textSample.includes('state bank of india') || textSample.includes('sbi') || (headerSample.includes('txn date') && headerSample.includes('ref no./cheque no.'))) {
    return 'SBI'
  }
  if (textSample.includes('axis bank') || (headerSample.includes('tran date') && headerSample.includes('particulars') && headerSample.includes('chqno'))) {
    return 'AXIS'
  }

  return 'GENERIC'
}

/**
 * Extract 4-digit card number and match against user registered cards.
 */
export function extractCardInfo(
  narration: string,
  userCards?: Card[],
  defaultCardId?: string | null
): {
  card_id: string | null
  card_last4: string | null
  card_issuer: string | null
  card_brand: CardBrand | null
} {
  // If user explicitly mapped to a default card
  if (defaultCardId && userCards) {
    const found = userCards.find((c) => c.id === defaultCardId)
    if (found) {
      return {
        card_id: found.id,
        card_last4: found.last4 || null,
        card_issuer: found.issuer || null,
        card_brand: found.brand || null,
      }
    }
  }

  // 1. Try matching registered cards directly in narration
  if (userCards && userCards.length > 0) {
    for (const card of userCards) {
      if (card.last4 && card.last4.length === 4) {
        const last4Pattern = new RegExp(`(?:card|acct|a\\/c|ending|x|\\*|[0-9])*[\\s:.-]*${card.last4}\\b`, 'i')
        if (last4Pattern.test(narration)) {
          return {
            card_id: card.id,
            card_last4: card.last4,
            card_issuer: card.issuer || null,
            card_brand: card.brand || null,
          }
        }
      }
    }
  }

  // 2. Try generic card extraction patterns from narration
  const patterns = [
    /(?:card|ending|acct|a\/c|pos)(?:\s+(?:in|with|no\.?))?[\s:.-]*(?:x{2,}|\*{2,})?([0-9]{4})\b/i,
    /\b(?:x{2,}|\*{2,})([0-9]{4})\b/i,
    /\b([0-9]{4})\s*(?:swiped|pos|txn|tran)\b/i,
  ]

  for (const pat of patterns) {
    const match = narration.match(pat)
    if (match && match[1]) {
      const extractedLast4 = match[1]

      // Check if this matches a registered card
      if (userCards) {
        const matchingCard = userCards.find((c) => c.last4 === extractedLast4)
        if (matchingCard) {
          return {
            card_id: matchingCard.id,
            card_last4: matchingCard.last4 || null,
            card_issuer: matchingCard.issuer || null,
            card_brand: matchingCard.brand || null,
          }
        }
      }

      return {
        card_id: null,
        card_last4: extractedLast4,
        card_issuer: null,
        card_brand: null,
      }
    }
  }

  return {
    card_id: null,
    card_last4: null,
    card_issuer: null,
    card_brand: null,
  }
}

/**
 * Detect payment mode (upi, neft, imps, etc.) from bank narration.
 */
export function detectPaymentMode(narration: string, hasCard: boolean): SourceType {
  const norm = narration.toLowerCase()

  if (norm.includes('upi') || norm.includes('vpa') || norm.includes('@ok') || norm.includes('phonepe') || norm.includes('paytm') || norm.includes('gpay')) {
    return 'upi'
  }
  if (norm.includes('neft')) {
    return 'neft'
  }
  if (norm.includes('rtgs')) {
    return 'rtgs'
  }
  if (norm.includes('imps')) {
    return 'imps'
  }
  if (norm.includes('atm') || norm.includes('cash wdl') || norm.includes('nfs*')) {
    return 'atm'
  }
  if (hasCard || norm.includes('pos ') || norm.includes('ecom') || norm.includes('swipe')) {
    return hasCard ? 'credit_card' : 'debit_card'
  }
  if (norm.includes('netbanking') || norm.includes('net banking') || norm.includes('inb') || norm.includes('ibank')) {
    return 'net_banking'
  }
  if (norm.includes('nach') || norm.includes('ach ') || norm.includes('ecs')) {
    return 'nach'
  }
  if (norm.includes('chq') || norm.includes('cheque') || norm.includes('clg')) {
    return 'cheque'
  }

  return 'unknown'
}

/**
 * Extract reference ID (UPI 12-digit UTR, IMPS ref, or cheque number)
 */
export function extractReferenceId(narration: string, rawRef?: string): string | null {
  if (rawRef && rawRef.trim()) {
    const cleaned = rawRef.trim().replace(/^'+|'+$/g, '') // remove leading/trailing apostrophes sometimes added in Excel CSV
    if (cleaned && cleaned !== '0' && cleaned !== '000000' && !/^(?:-+|\/+|n\/?a|null|nil)$/i.test(cleaned)) {
      return cleaned
    }
  }

  // Extract 12-digit UPI UTR from narration (e.g. UPI/123456789012 or UPI-123456789012)
  const upiMatch = narration.match(/upi[/-](?:dr[/-]|cr[/-])?([0-9]{12})/i)
  if (upiMatch && upiMatch[1]) {
    return upiMatch[1]
  }

  // Extract IMPS reference
  const impsMatch = narration.match(/imps[/-](?:p2a[/-])?([0-9]{12})/i)
  if (impsMatch && impsMatch[1]) {
    return impsMatch[1]
  }

  return null
}

const SUMMARY_OR_SKIP_ROW_REGEX = /^(?:end of statement|opening balance|closing balance|brought forward|b\/f|c\/f|total\s*(?:debits?|credits?|balance)?|\*{3,})/i

/**
 * Parses statement CSV text client-side.
 * Returns parsed transaction rows with auto-detected merchant, category, card, and payment mode.
 */
export function parseStatementCSV(
  csvContent: string,
  options?: ParseStatementOptions
): ParseStatementResult {
  if (!csvContent || !csvContent.trim()) {
    return {
      rows: [],
      detectedBank: 'GENERIC',
      totalDebits: 0,
      totalCredits: 0,
      totalRows: 0,
      skippedRows: 0,
      error: 'CSV file is empty.',
    }
  }

  const rawRows = parseCSV(csvContent)
  if (rawRows.length < 2) {
    return {
      rows: [],
      detectedBank: 'GENERIC',
      totalDebits: 0,
      totalCredits: 0,
      totalRows: 0,
      skippedRows: 0,
      error: 'CSV does not contain enough data.',
    }
  }

  const headerInfo = findHeaderRow(rawRows)
  if (!headerInfo) {
    return {
      rows: [],
      detectedBank: 'GENERIC',
      totalDebits: 0,
      totalCredits: 0,
      totalRows: 0,
      skippedRows: 0,
      error: 'Could not find a valid table header row with Date, Description, and Amount columns.',
    }
  }

  const { headerIndex, mapping } = headerInfo
  const detectedBank = detectBank(csvContent, rawRows[headerIndex])

  const parsedRows: ParsedStatementRow[] = []
  let totalDebits = 0
  let totalCredits = 0
  let skippedCount = 0

  const userCategories = options?.categories || []
  const fallbackCat = options?.fallbackCategory || 'Other'

  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (!row || row.length === 0 || row.every((c) => !c.trim())) {
      continue
    }

    const rawDate = row[mapping.date] || ''
    const rawDesc = row[mapping.description] || ''

    // Skip summary / total / end of statement rows
    if (SUMMARY_OR_SKIP_ROW_REGEX.test(rawDesc.trim()) || SUMMARY_OR_SKIP_ROW_REGEX.test(rawDate.trim())) {
      skippedCount++
      continue
    }

    const parsedDate = parseStatementDate(rawDate)
    if (!parsedDate) {
      skippedCount++
      continue
    }

    // Determine type and amount
    let type: 'debit' | 'credit' = 'debit'
    let amount = 0

    if (mapping.debit !== -1 || mapping.credit !== -1) {
      let debitVal = mapping.debit !== -1 ? parseStatementAmount(row[mapping.debit]) : 0
      let creditVal = mapping.credit !== -1 ? parseStatementAmount(row[mapping.credit]) : 0

      // If both are 0 and row has more columns, align from the right relative to balance
      if (debitVal === 0 && creditVal === 0 && mapping.balance !== -1 && row.length > mapping.balance) {
        const balIdx = row.length - 1
        const crIdx = balIdx - 1
        const drIdx = balIdx - 2
        if (drIdx >= 0) debitVal = parseStatementAmount(row[drIdx])
        if (crIdx >= 0 && debitVal === 0) creditVal = parseStatementAmount(row[crIdx])
      }

      if (debitVal > 0) {
        type = 'debit'
        amount = debitVal
      } else if (creditVal > 0) {
        type = 'credit'
        amount = creditVal
      } else {
        // Both 0 or empty — skip
        skippedCount++
        continue
      }
    } else if (mapping.amount !== -1) {
      const parsedAmt = parseStatementAmount(row[mapping.amount])
      if (parsedAmt <= 0) {
        skippedCount++
        continue
      }
      amount = parsedAmt

      // Check type column if present
      if (mapping.type !== -1) {
        const typeStr = (row[mapping.type] || '').trim().toLowerCase()
        if (typeStr.startsWith('cr') || typeStr.startsWith('credit') || typeStr.startsWith('dep')) {
          type = 'credit'
        } else {
          type = 'debit'
        }
      } else {
        // Check if raw amount had negative sign or description has credit clues
        const rawAmtStr = row[mapping.amount] || ''
        if (rawAmtStr.includes('-') || rawAmtStr.includes('(')) {
          type = 'debit'
        } else if (/\b(cr|credit|salary|refund|interest|dividend)\b/i.test(rawDesc)) {
          type = 'credit'
        } else {
          type = 'debit'
        }
      }
    } else {
      skippedCount++
      continue
    }

    // Extract balance if present
    const balance = mapping.balance !== -1 ? parseStatementAmount(row[mapping.balance]) : null

    // Extract reference ID
    const rawRef = mapping.ref !== -1 ? row[mapping.ref] : undefined
    const reference_id = extractReferenceId(rawDesc, rawRef)

    // Extract card details
    const cardInfo = extractCardInfo(rawDesc, options?.userCards, options?.defaultCardId)

    // Detect payment mode
    const payment_mode = detectPaymentMode(rawDesc, !!cardInfo.card_last4 || !!cardInfo.card_id)

    // Normalize merchant and category
    const norm = normalizeMerchant(rawDesc)
    let assignedCategory = fallbackCat

    if (type === 'credit') {
      if (/salary/i.test(rawDesc)) {
        const match = userCategories.find((c) => /salary/i.test(c.name))
        assignedCategory = match ? match.name : 'Salary'
      } else if (/interest|dividend/i.test(rawDesc)) {
        const match = userCategories.find((c) => /investment/i.test(c.name))
        assignedCategory = match ? match.name : 'Investment'
      } else if (/refund/i.test(rawDesc)) {
        const match = userCategories.find((c) => /refund/i.test(c.name))
        assignedCategory = match ? match.name : 'Income'
      } else {
        const match = userCategories.find((c) => c.type === 'income')
        assignedCategory = match ? match.name : 'Income'
      }
    } else {
      if (norm.isKnown && norm.category) {
        const match = userCategories.find((c) => c.name.toLowerCase() === norm.category.toLowerCase())
        assignedCategory = match ? match.name : norm.category
      } else if (userCategories.length > 0) {
        // Check if fallback category exists in user categories
        const match = userCategories.find((c) => c.name.toLowerCase() === fallbackCat.toLowerCase())
        assignedCategory = match ? match.name : fallbackCat
      }
    }

    if (type === 'debit') {
      totalDebits += amount
    } else {
      totalCredits += amount
    }

    parsedRows.push({
      id: `parsed-${i}-${Date.now()}`,
      date: parsedDate,
      rawDate,
      description: norm.canonical || rawDesc.trim(),
      rawDescription: rawDesc.trim(),
      type,
      amount,
      balance,
      reference_id,
      merchant: norm.canonical || null,
      category: assignedCategory,
      payment_mode,
      card_last4: cardInfo.card_last4,
      card_id: cardInfo.card_id,
      card_issuer: cardInfo.card_issuer,
      card_brand: cardInfo.card_brand,
      selected: true,
    })
  }

  return {
    rows: parsedRows,
    detectedBank,
    totalDebits,
    totalCredits,
    totalRows: parsedRows.length,
    skippedRows: skippedCount,
    error: parsedRows.length === 0 ? 'No transactions could be parsed from this file.' : null,
  }
}

/**
 * Inserts parsed rows into Supabase `transactions` table.
 * STRICT INVARIANT: All rows are inserted with `approval_status: 'pending'` and `source: 'manual'`.
 * Nothing auto-approves. Everything lands in Pending for human review.
 */
export async function saveImportedTransactions(
  rows: ParsedStatementRow[],
  options?: {
    cardId?: string | null
  }
): Promise<{ success: boolean; insertedCount: number; error: Error | null }> {
  if (!rows || rows.length === 0) {
    return { success: true, insertedCount: 0, error: null }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, insertedCount: 0, error: new Error('User not authenticated') }
  }

  const records = rows.map((row) => ({
    user_id: user.id,
    amount: row.amount,
    currency: 'INR',
    type: row.type,
    category: row.category || 'Other',
    description: row.description || 'Imported Transaction',
    date: row.date,
    source: 'manual' as const,
    approval_status: 'pending' as const, // Strict invariant: always pending
    merchant: row.merchant || null,
    reference_id: row.reference_id || null,
    payment_mode: row.payment_mode || null,
    card_id: (options?.cardId !== undefined ? options.cardId : row.card_id) || null,
    card_last4: row.card_last4 || null,
    card_issuer: row.card_issuer || null,
    card_brand: row.card_brand || null,
    tags: ['statement_import'],
    notes: row.rawDescription && row.rawDescription !== row.description ? row.rawDescription : null,
  }))

  const CHUNK_SIZE = 50
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase.from('transactions').insert(chunk)
    if (error) {
      console.error('Failed to insert statement transactions chunk:', error)
      return { success: false, insertedCount: i, error: new Error(error.message) }
    }
  }

  return { success: true, insertedCount: records.length, error: null }
}
