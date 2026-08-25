// ============================================
// Intrack — Core Type Definitions
// ============================================

export type TransactionType = 'debit' | 'credit'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

/** Payment source / mode */
export type SourceType =
  | 'upi'
  | 'credit_card'
  | 'debit_card'
  | 'net_banking'
  | 'neft'
  | 'rtgs'
  | 'imps'
  | 'wallet'
  | 'atm'
  | 'nach'
  | 'cheque'
  | 'unknown'

/** Credit card network brand */
export type CardBrand = 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners'

/**
 * Category identity is now the user-defined display name (dynamic, per-user).
 * Kept as a type alias so existing annotations keep compiling.
 */
export type ExpenseCategory = string

export type CategoryType = 'income' | 'expense'

/**
 * Analytics classification tags — a category can carry any combination.
 * Drives the 50/30/20 breakdown, income total, investments/emergency-fund
 * calc, and subscription-burn/credit-card-bill tracking on the Insights
 * page, without hardcoding display names there.
 */
export type AnalyticsTag = 'needs' | 'wants' | 'savings' | 'income' | 'subscription' | 'credit_card_bill'

/** A user-defined category row */
export interface Category {
  id: string
  user_id: string
  name: string
  emoji: string
  color: string
  type: CategoryType
  budget_eligible: boolean
  is_default: boolean
  is_permanent: boolean
  sort_order: number
  analytics_tags: AnalyticsTag[]
  created_at: string
}

/** A single expense/income transaction */
export interface Transaction {
  id: string
  user_id: string
  amount: number
  type: TransactionType
  category: ExpenseCategory
  description: string
  date: string                      // ISO date string YYYY-MM-DD
  transaction_time?: string         // HH:MM format, extracted from email
  source: 'manual' | 'email'
  approval_status: ApprovalStatus
  reference_id?: string             // UPI ref / bank txn ID (dedup only)
  merchant?: string
  payment_mode?: SourceType
  card_issuer?: string              // Bank name e.g. "HDFC", "SBI"
  card_brand?: CardBrand            // Card network e.g. "Visa", "Mastercard"
  confidence_score?: number
  email_message_id?: string         // Gmail message ID (dedup only, not displayed)
  event_type?: string
  created_at: string
  updated_at: string
}

export interface Budget {
  id: string
  user_id: string
  category: ExpenseCategory
  amount: number
  month: string
  created_at: string
  updated_at: string
}

export interface EmailScanLog {
  id: string
  user_id: string
  scanned_at: string
  emails_processed: number
  transactions_found: number
  status: 'success' | 'failed' | 'partial'
  error_message?: string
  gmail_history_id?: string
  next_scan_time?: string
  scan_mode?: 'manual' | 'scheduled'
}

export interface UserProfile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  created_at: string
}

export interface MonthlySummary {
  total_income: number
  total_expenses: number
  savings: number
  category_breakdown: CategoryBreakdown[]
  daily_trend: DailyTrend[]
}

export interface CategoryBreakdown {
  category: ExpenseCategory
  amount: number
  percentage: number
  count: number
}

export interface DailyTrend {
  date: string
  income: number
  expenses: number
}
