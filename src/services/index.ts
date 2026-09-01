export { supabase } from './supabase'
export {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getMonthlySummary,
  getTransactionById,
} from './transactions'
export {
  getBudgets,
  upsertBudget,
  deleteBudget,
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
