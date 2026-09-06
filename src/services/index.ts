export { supabase } from './supabase'
export {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthlySummary,
  getTransactionById,
  getDistinctTags,
  splitTransaction,
} from './transactions'
export {
  getBudgets,
  upsertBudget,
  deleteBudget,
  getPreviousMonthRollovers,
  calculateRollovers,
  calculateCategoryRollover,
  getPreviousMonth,
} from './budgets'
export {
  getCategories,
  createCategory,
  updateCategoryStyle,
  renameCategory,
  deleteCategory,
  getCategoryUsage,
} from './categories'
export {
  getScanLogs,
  scanRealGmailInbox,
  getMerchantRules,
  saveMerchantRule,
  deleteMerchantRule,
  cleanMerchantName,
  getMerchantSettings,
  saveMerchantSetting,
  applyMerchantRules,
  getManualScanQuota,
  formatScanProgress,
  type ManualScanQuota,
  type ScanProgress,
} from './emailScanner'
export {
  getProfile,
  updateProfile,
  resetAccountData,
  deleteAccount,
  cancelSubscription,
  resumeSubscription,
} from './profiles'
export {
  submitFeedback,
} from './feedback'
export {
  getMerchantRulesFromDB,
  fetchMerchantRules,
  saveMerchantRuleToDb,
  migrateLocalStorageRulesToDB,
  applyMerchantRulesFromDB,
} from './learningEngine'
export {
  generateAIInsights,
  generateRuleBasedInsights,
  detectAnomalies,
  generateForecast,
  analyzeTransactionEmailWithAI,
} from './aiService'
export {
  saveGoogleToken,
  getGoogleToken,
  clearGoogleToken,
  isGoogleConnected,
  validateGoogleToken,
  purgeOldTokenKey,
} from './googleAuth'
export type { FinancialContext } from './aiService'

export {
  getCards,
  createCard,
  updateCard,
  setCardArchived,
  getCardUsage,
  deleteCard,
  getCardPeriods,
  setCardOpening,
  getCardUsageCounts,
  getCardMovementsSince,
  sumCardMovements,
  monthKey,
  todayKey,
} from './cards'

export {
  parseCSV,
  parseStatementDate,
  parseStatementAmount,
  parseStatementCSV,
  saveImportedTransactions,
  extractCardInfo,
  detectPaymentMode,
  extractReferenceId,
  type ParsedStatementRow,
  type ParseStatementOptions,
  type ParseStatementResult,
  type SupportedBank,
} from './statementImporter'

export {
  detectPlannedPayments,
  calculateUpcomingBillsForNext30Days,
  resolveCardOrAccount,
  classifyPaymentType,
  isSubscriptionTabItem,
  isBillRentOrEmiTabItem,
  type PlannedPayment,
  type PlannedPaymentDetectableTxn,
  type PaymentCadence,
  type PlannedPaymentType,
  type UpcomingBillsSummary,
  type TimelineDay,
} from './plannedPayments'

export {
  getActiveDebts,
  recordDebtTransaction,
  calculateDebtSummary,
  resolveLoanSource,
  LOAN_SOURCE_LABELS,
  LOAN_SOURCE_DESCRIPTIONS,
  type ActiveDebtSummary,
  type DebtSourceSummary,
  type DebtTransactionItem,
  type LoanSource,
} from './debts'
