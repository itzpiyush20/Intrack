// ============================================
// Email Scanner Service V2 — Intrack
// 5-Layer Financial Intelligence Engine
// Priority: Accuracy > Speed > Coverage
// ============================================

import { supabase as defaultSupabase } from './supabase.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { extractBankName, retryWithBackoff, fetchWithTimeout, withTimeout } from '../utils/index.js'
import { getMerchantRulesFromDB, applyMerchantRulesFromRows } from './learningEngine.js'
import { getGoogleToken, clearGoogleToken, tryRefreshGoogleToken } from './googleAuth.js'
import {
  analyzeTransactionEmailWithAI,
  analyzeTransactionEmailBatchWithAI,
  AI_BATCH_SIZE,
  type EmailForAI,
  type AITransactionResult,
} from './aiService.js'
import { stripBoilerplate } from './emailBoilerplate.js'
import { evaluateRegexGates, isBulkMarketingEmail, hasPaymentAssertion } from './emailScanGates.js'
import { isSamePayment, isSuspectedDuplicate, mergePayments, isWeakMerchantLabel, type MergeableTransaction } from './paymentMerge.js'
import { extractAmountMatches, isHomeCurrency, DEFAULT_CURRENCY } from './currency.js'
import { isPremiumProfile } from './subscription.js'

type EmailScanLog = Database['public']['Tables']['email_scan_logs']['Row']
type TransactionInsert = Database['public']['Tables']['transactions']['Insert']

// ============================================================
// OWNER EMAILS — get unlimited scans. All other users are
// capped to 1 scan per 24 hours.
// Set VITE_OWNER_EMAILS as a comma-separated list in your .env file.
// ============================================================
const OWNER_EMAILS = (
  (import.meta.env || {}).VITE_OWNER_EMAILS ||
  (typeof process !== 'undefined' ? process.env.VITE_OWNER_EMAILS : '') ||
  ''
)
  .split(',')
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean)

// ============================================================
// LAYER 1 — TRUSTED SENDER DOMAIN WHITELIST
// Only emails from these domains are treated as financial alerts
// All others receive a -30 confidence penalty
// ============================================================
const TRUSTED_SENDER_DOMAINS = new Set([
  // Indian PSU Banks
  'sbi.co.in', 'onlinesbi.com', 'sbicards.com', 'sbicard.com', 'sbicard.in',
  'pnb.co.in', 'punjabnationalbank.in', 'pnbcard.in',
  'canarabank.com', 'canarabank.in',
  'bankofbaroda.in', 'bankofbaroda.com', 'bobibanking.com', 'bobcards.in',
  'bankofindia.co.in', 'bankofindia.com',
  'unionbankofindia.org', 'unionbankofindia.com', 'unionbank.co.in',
  'indianbank.in', 'indianbank.co.in',
  'centralbankofindia.co.in', 'centralbank.org.in',
  'ucobank.com', 'ucobank.co.in',
  'iobnet.co.in', 'iob.in', 'iob.co.in',
  'idbi.co.in', 'idbibank.co.in', 'idbibank.in', 'idbibank.com',
  'allahababank.in',
  // Indian Private Banks
  'hdfcbank.com', 'hdfcbank.net',
  'icicibank.com', 'icicibank.org', 'icici.com', 'icicibank.net',
  'axisbank.com', 'axisbank.co.in', 'axis.bank.in', 'axisbank.in', 'axisbank.net',
  'kotak.com', 'kotakbank.com', 'kotak.in',
  'yesbank.in', 'yesbank.com',
  'indusind.com', 'indusindbank.com',
  'idfcfirstbank.com', 'idfcfirst.com', 'idfcfirstbank.in',
  'federalbank.co.in', 'federalbank.com',
  'rblbank.com', 'rblbank.in',
  'aubank.in', 'aufinanciers.com',
  'bandhanbank.com',
  'dcbbank.com',
  'sbm.co.in', 'sbmbank.co.in',
  'sib.co.in', 'southindianbank.com',
  'kvb.co.in', 'kvbmail.com',
  'karnatakabank.com', 'karnatakabank.co.in',
  // Credit Card Issuers
  'sbicard.com', 'sbicards.com', 'sbicard.in',
  'citi.com', 'citibank.co.in', 'citibank.com',
  'americanexpress.com', 'aexp.com',
  'hsbc.co.in', 'hsbc.com',
  'standardchartered.com', 'sc.com',
  // Payment Processors / Fintech
  'phonepe.com',
  'paytm.com', 'paytmbank.com',
  'amazonpay.in',
  'googlepay.com', 'google.com',
  'cred.club', 'cred.in',
  'cheq.one', 'cheq.in',
  'razorpay.com',
  'cashfree.com',
  'billdesk.com', 'billdesk.co.in',
  'payu.in', 'payu.com',
  'ccavenue.com',
  'mobikwik.com',
  'freecharge.in',
  'jiomoney.com',
  'nsdl.co.in',
  'npci.org.in',
  'onecard.in', 'getonecard.app',
  'sliceit.com', 'slice.in', 'slice.club',
  'uni.cards', 'unicards.in',
  'scapia.cards', 'scapia.app',
  'jupiter.money',
  'fi.money',
  'super.money',
  'pop.money',
  // Notifications / alerts subdomains (common pattern)
  'alerts.hdfcbank.com', 'alerts.icicibank.com', 'alerts.axisbank.com',
  // IRCTC / Railways
  'irctc.co.in', 'railnet.gov.in',
  // E-commerce payment emails
  'amazonses.com',
  // Juspay / payment gateways
  'juspay.in',
  // Bharatpe
  'bharatpe.com',
])

// ============================================================
// LAYER 2 — SUBJECT LINE FILTERS
// Hard-reject: clearly non-transactional
// Hard-accept: clearly transactional (bypass further soft checks)
// ============================================================
const HARD_REJECT_SUBJECT_PATTERNS = [
  /\b(statement|e-?statement|monthly\s*statement|account\s*statement)\b/i,
  /\b(newsletter|unsubscribe|promotion|promotional|offer|coupon|deal|cashback\s*offer|reward\s*points|limited\s*period|sale)\b/i,
  /\b(welcome|onboarding|activate\s*your|verify\s*your\s*email|confirm\s*your)\b/i,
  /\b(policy\s*update|terms\s*of\s*service|privacy\s*update|security\s*update|agreement\s*update)\b/i,
  /\b(minimum\s*due|payment\s*due|bill\s*generated|overdue|payable\s*by|due\s*date)\b/i,
  /\b(auto-?debit\s*scheduled|standing\s*instruction|pre-?authorized)\b/i,
]

/**
 * Subjects that override the AI's confident "not a transaction" verdict and
 * fall through to the regex ladder instead.
 *
 * Because that discards the strongest signal in the pipeline, every pattern
 * here must assert money moved. A bare `/\bcred\b/i` used to sit in this list
 * and matched any standalone "cred" in a subject — "Your CRED coins expire
 * soon" included. The narrower `/\bcred\b.*(?:bill|payment)\b/i` above covers
 * the real credit-card-bill case; removing the bare one left every test green.
 */
export const HARD_ACCEPT_SUBJECT_PATTERNS = [
  /\b(debited|debit\s*alert|amount\s*debited)\b/i,
  /\b(credited|credit\s*alert|amount\s*credited)\b/i,
  /\b(transaction\s*alert|payment\s*alert|txn\s*alert)\b/i,
  /\b(purchase\s*alert|spend\s*alert|spending\s*alert)\b/i,
  /\b(salary\s*credited|salary\s*received)\b/i,
  /\b(upi\s*transaction|upi\s*payment)\b/i,
  /\b(emi\s*debited|loan\s*emi)\b/i,
  /\b(refund\s*credited|refund\s*processed)\b/i,
  /\bpremium\s*(?:successfully\s+)?(?:collected|paid|received)\b/i,
  /\bpremium\s*payment\s*(?:successful|received|confirmation)\b/i,
  /\bdividend\s*(?:credited|paid)\b/i,
  /\bcredit\s*card\s*bill\s*payment\b/i,
  /\bpayment\s*(?:is|was|has\s+been)?\s*(?:successful|received|confirmed|completed|done|processed)\b/i,
  /\bcard\s*payment\s*(?:is|was|has\s+been)?\s*(?:successful|received|confirmed|completed|towards|processed)\b/i,
  /\bpayment\s*(?:is|was|has\s+been)?\s*(?:received|successful|confirmed|completed|processed)\s*(?:towards|for)?\s*(?:your\s*)?(?:credit\s*)?card\b/i,
  /\bcred\b.*(?:bill|payment)\b/i,
  /\b(?:card|credit\s*card)\s*(?:transaction|spend|charge|alert|notification)\b/i,
  /\btransaction\s*on\s*(?:your\s*)?(?:credit\s*)?card\b/i,
  /\bcharge\s*on\s*(?:your\s*)?(?:credit\s*)?card\b/i,
  /\bspend\s*on\s*(?:your\s*)?(?:card|sbi|hdfc|icici|axis|kotak|onecard|scapia|amex|diners|rupay)\b/i,
  /\bspent\s+(?:on|at)\b/i,
  /\bpayment\s*(?:received|successful|confirmed|completed|done|processed)\b/i,
  /\b(?:credit\s*)?card\s*payment\b/i,
  /\b(?:transaction|txn|debit|credit|payment|spend)\s*(?:alert|notification|update|confirmation)\b/i,
  /\b(?:credit\s*card|card)\s*(?:bill\s*)?(?:payment|paid|received|successful|confirmation)\b/i,
  /\b(?:credit\s*)?card\s*bill\s*(?:is\s*)?paid\b/i,
  /\bpayment\s*(?:is|was|has\s+been)?\s*successful\b/i,
]

// ============================================================
// MERCHANT LEARNING — localStorage fallback (V2 also supports DB)
// ============================================================
const BLOCKLIST_KEYWORDS = new Set([
  'and', 'for', 'the', 'with', 'from', 'was', 'were', 'had', 'has', 'have',
  'bank', 'payment', 'transfer', 'alert', 'ref', 'upi', 'pay', 'account',
  'cash', 'money', 'wallet', 'online', 'card', 'transaction', 'txn', 'credit',
  'debit', 'received', 'sent', 'paid', 'charge', 'bill', 'recharge', 'refund',
  'employer', 'salary', 'cashback', 'customer', 'alert', 'notification',
  'noreply', 'xx', 'x', 'a/c', 'dear', 'customer', 'successful', 'successfully',
  'completed', 'status',
])

export interface MerchantRule {
  category: string
  autoApprove: boolean
}

export function getMerchantWeights(): Record<string, Record<string, number>> {
  try {
    const weights = localStorage.getItem('dhanrakshak_merchant_weights')
    return weights ? JSON.parse(weights) : {}
  } catch {
    return {}
  }
}

export function getMerchantSettings(): Record<string, { autoApprove: boolean }> {
  try {
    const settings = localStorage.getItem('dhanrakshak_merchant_settings')
    return settings ? JSON.parse(settings) : {}
  } catch {
    return {}
  }
}

export function saveMerchantSetting(merchant: string, settings: { autoApprove: boolean }) {
  try {
    const current = getMerchantSettings()
    current[merchant.toLowerCase().trim()] = settings
    localStorage.setItem('dhanrakshak_merchant_settings', JSON.stringify(current))
  } catch (e) {
    console.error('Failed to save merchant setting:', e)
  }
}

/** Multi-stage cleaning pipeline to isolate canonical merchant names */
export function cleanMerchantName(rawMerchant: string): string {
  if (!rawMerchant) return ''
  let cleaned = rawMerchant.toLowerCase().trim()
  // Strip UPI Virtual Payment Addresses
  cleaned = cleaned.replace(/[a-z0-9._-]+@[a-z0-9.-]+/g, '')
  // Remove payment aggregators
  const aggregators = [
    /^(upi|pos|txn|ref|imps|neft|rtgs|payment|transfer|sent|paid|spent|alert|info|narration|remarks)[-/\s*]+/gi,
    /^(gpay|paytm|phonepe|bhim|amazonpay|bharatpe)[-/\s*]+/gi,
    /\b(gpay|paytm|phonepe|bhim|amazonpay|bharatpe)\b/gi,
  ]
  for (const regex of aggregators) cleaned = cleaned.replace(regex, ' ')
  cleaned = cleaned.replace(/\b(outflow|ride|sub|rides|alert|payment|fashion|pos|txn|ref|order|bank|alert|info|narration|terminal|store|merchant|biller|payee|recipient|transfer|bill|recharge|receipt)\b/gi, ' ')
  cleaned = cleaned.replace(/\b(bangalore|mumbai|delhi|new\s+delhi|chennai|pune|hyderabad|kolkata|ahmedabad|bengaluru|in|ind|ltd|pvt|co)\b(?:\s*$)/gi, '')
  cleaned = cleaned.replace(/\b\d{4,15}\b/g, '')
  cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function saveMerchantRule(merchant: string, category: string, autoApprove = true) {
  try {
    const weights = getMerchantWeights()
    const cleanMerchant = cleanMerchantName(merchant).toLowerCase().trim()
    if (!cleanMerchant || cleanMerchant.length <= 2 || BLOCKLIST_KEYWORDS.has(cleanMerchant)) return
    weights[cleanMerchant] = { [category]: 2 }
    const currentSettings = getMerchantSettings()
    if (currentSettings[cleanMerchant] === undefined || currentSettings[cleanMerchant].autoApprove !== autoApprove) {
      saveMerchantSetting(cleanMerchant, { autoApprove })
    }
    localStorage.setItem('dhanrakshak_merchant_weights', JSON.stringify(weights))
  } catch (e) {
    console.error('Failed to save merchant weight:', e)
  }
}

export function deleteMerchantRule(key: string) {
  try {
    const weights = getMerchantWeights()
    delete weights[key]
    localStorage.setItem('dhanrakshak_merchant_weights', JSON.stringify(weights))
    const settings = getMerchantSettings()
    delete settings[key]
    localStorage.setItem('dhanrakshak_merchant_settings', JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to delete merchant rule:', e)
  }
}

export function getMerchantRules(): Record<string, { category: string; autoApprove: boolean }> {
  try {
    const weights = getMerchantWeights()
    const settings = getMerchantSettings()
    const rules: Record<string, { category: string; autoApprove: boolean }> = {}
    for (const [merchant, categoriesMap] of Object.entries(weights)) {
      let bestCategory = 'other'
      let maxCount = 0
      for (const [cat, count] of Object.entries(categoriesMap)) {
        if (count > maxCount) { maxCount = count; bestCategory = cat }
      }
      const autoApprove = settings[merchant]?.autoApprove !== false
      rules[merchant] = { category: bestCategory, autoApprove }
    }
    return rules
  } catch {
    return {}
  }
}

// ============================================================
// CONTEXT KEYWORD CLASSIFIER (fallback categorisation)
// ============================================================
const CONTEXT_KEYWORDS: Record<string, string[]> = {
  'Groceries': ['mart', 'grocery', 'supermarket', 'bigbasket', 'blinkit', 'zepto', 'groceries', 'kirana', 'milk', 'dairy', 'provisions'],
  'Food & Dining': ['zomato', 'swiggy', 'food', 'restaurant', 'cafe', 'canteen', 'dhaba', 'eats', 'pizza', 'burger', 'kitchen', 'bakery', 'dining', 'coffee'],
  'Transport': ['uber', 'ola', 'cab', 'taxi', 'metro', 'irctc', 'railway', 'train', 'flight', 'airline', 'petrol', 'diesel', 'hpcl', 'bpcl', 'iocl', 'cng', 'toll', 'fastag', 'rapido'],
  'Entertainment': ['pvr', 'inox', 'movie', 'cinema', 'bookmyshow', 'theatre', 'gaming', 'pub', 'bar', 'club', 'lounge'],
  'Subscriptions': ['netflix', 'spotify', 'prime', 'hotstar', 'youtube', 'premium', 'apple', 'icloud', 'google one', 'microsoft', 'adobe'],
  'Shopping': ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'mall', 'fashion', 'retail', 'croma', 'reliance digital', 'clothing', 'nykaa', 'bazaar', 'dmart'],
  'Utilities & Bills': ['airtel', 'jio', 'bsnl', 'broadband', 'electricity', 'bescom', 'power', 'water', 'gas', 'indane', 'telecom', 'wifi'],
  'Salary': ['salary', 'payroll', 'employer', 'stipend', 'wages'],
  'Investments': ['mutual fund', 'sip', 'groww', 'zerodha', 'upstox', 'investment', 'etf', 'demat', 'stocks', 'securities'],
  'Health': ['hospital', 'pharmacy', 'medical', 'clinic', 'doctor', 'medicine', 'apollo', 'netmeds', 'medplus', 'insurance'],
  'Education': ['school', 'college', 'university', 'course', 'coaching', 'tuition', 'fee', 'exam'],
  'Travel': ['hotel', 'makemytrip', 'booking', 'goibibo', 'cleartrip', 'easemytrip', 'airbnb', 'oyo'],
}

export interface RuleMatchResult {
  category: string
  approval_status: 'approved' | 'pending'
  confidence: number
  matchReason: string
}

export function applyMerchantRules(merchant: string, snippet: string, defaultCategory: string): RuleMatchResult {
  const weights = getMerchantWeights()
  const cleanMerchantText = cleanMerchantName(merchant).toLowerCase()
  const normalizedSnippet = snippet.toLowerCase()
  const normalizedMerchant = merchant.toLowerCase()

  let bestCategory = defaultCategory
  let maxWeight = 0
  let totalKeyWeight = 0
  let matchedKey = ''

  for (const [key, catMap] of Object.entries(weights)) {
    const keyLower = key.toLowerCase()
    const escapedKey = escapeRegExp(keyLower)
    const hasMatch =
      new RegExp(`\\b${escapedKey}\\b`, 'i').test(cleanMerchantText) ||
      new RegExp(`\\b${escapedKey}\\b`, 'i').test(normalizedSnippet)
    if (hasMatch) {
      let keyBestCat = 'other', keyMaxWeight = 0, keyTotal = 0
      for (const [cat, count] of Object.entries(catMap)) {
        keyTotal += count
        if (count > keyMaxWeight) { keyMaxWeight = count; keyBestCat = cat }
      }
      if (keyMaxWeight > maxWeight) {
        maxWeight = keyMaxWeight
        totalKeyWeight = keyTotal
        bestCategory = keyBestCat
        matchedKey = key
      }
    }
  }

  if (maxWeight > 0) {
    const confidence = Math.round((maxWeight / totalKeyWeight) * 100)
    return {
      category: bestCategory,
      // Never auto-approve — every scanned/matched transaction must land in
      // Pending for explicit human review, regardless of confidence.
      approval_status: 'pending',
      confidence,
      matchReason: `Matched learned rule for '${matchedKey}' (${confidence}% confidence)`,
    }
  }

  for (const [cat, keywords] of Object.entries(CONTEXT_KEYWORDS)) {
    for (const keyword of keywords) {
      const keywordRegex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i')
      if (keywordRegex.test(normalizedMerchant) || keywordRegex.test(normalizedSnippet)) {
        return {
          category: cat,
          approval_status: 'pending',
          confidence: 70,
          matchReason: `Suggested by keyword '${keyword}' (70% confidence)`,
        }
      }
    }
  }

  return {
    category: defaultCategory || 'other',
    approval_status: 'pending',
    confidence: defaultCategory && defaultCategory !== 'other' ? 60 : 0,
    matchReason: defaultCategory && defaultCategory !== 'other'
      ? `Template default for '${cleanMerchantName(merchant) || merchant}' (60% confidence)`
      : 'Unrecognized merchant',
  }
}

// ============================================================
// WELL-KNOWN MERCHANT PATTERNS
// ============================================================
const KNOWN_MERCHANTS: { pattern: RegExp; name: string; category: string; description: string }[] = [
  { pattern: /zomato/i, name: 'Zomato', category: 'Food & Dining', description: 'Zomato Food Order' },
  { pattern: /swiggy/i, name: 'Swiggy', category: 'Food & Dining', description: 'Swiggy Meal Delivery' },
  { pattern: /uber\s*eats/i, name: 'Uber Eats', category: 'Food & Dining', description: 'Uber Eats Order' },
  { pattern: /dunzo/i, name: 'Dunzo', category: 'Food & Dining', description: 'Dunzo Delivery' },
  { pattern: /blinkit|grofers/i, name: 'Blinkit', category: 'Groceries', description: 'Blinkit Quick Delivery' },
  { pattern: /bigbasket/i, name: 'BigBasket', category: 'Groceries', description: 'BigBasket Groceries' },
  { pattern: /zepto/i, name: 'Zepto', category: 'Groceries', description: 'Zepto Quick Commerce' },
  { pattern: /instamart/i, name: 'Swiggy Instamart', category: 'Groceries', description: 'Swiggy Instamart' },
  { pattern: /jiomart/i, name: 'JioMart', category: 'Groceries', description: 'JioMart Grocery' },
  { pattern: /\bola\s*electric\b|olaev/i, name: 'Ola Electric', category: 'Transport', description: 'Ola Electric Scooter' },
  { pattern: /\bola\b/i, name: 'Ola', category: 'Transport', description: 'Ola Cab Ride' },
  { pattern: /\buber\b/i, name: 'Uber', category: 'Transport', description: 'Uber Cab Ride' },
  { pattern: /rapido/i, name: 'Rapido', category: 'Transport', description: 'Rapido Bike Ride' },
  { pattern: /irctc/i, name: 'IRCTC', category: 'Transport', description: 'IRCTC Railway Booking' },
  { pattern: /fastag|\bfastag\b|netc\s*fastag/i, name: 'FASTag', category: 'Transport', description: 'FASTag Toll Payment' },
  { pattern: /makemytrip|mmt\b/i, name: 'MakeMyTrip', category: 'Travel', description: 'MakeMyTrip Booking' },
  { pattern: /goibibo/i, name: 'Goibibo', category: 'Travel', description: 'Goibibo Booking' },
  { pattern: /cleartrip/i, name: 'Cleartrip', category: 'Travel', description: 'Cleartrip Booking' },
  { pattern: /easemytrip/i, name: 'EaseMyTrip', category: 'Travel', description: 'EaseMyTrip Booking' },
  { pattern: /yatra\.com|\byatra\b/i, name: 'Yatra', category: 'Travel', description: 'Yatra Booking' },
  { pattern: /oyo\s*rooms|oyorooms|oyo\b/i, name: 'OYO', category: 'Travel', description: 'OYO Hotel Stay' },
  { pattern: /netflix/i, name: 'Netflix', category: 'Subscriptions', description: 'Netflix Subscription' },
  { pattern: /spotify/i, name: 'Spotify', category: 'Subscriptions', description: 'Spotify Premium' },
  { pattern: /hotstar|disney\+|disneyplus/i, name: 'Disney+ Hotstar', category: 'Subscriptions', description: 'Disney+ Hotstar Subscription' },
  { pattern: /youtube\s*premium/i, name: 'YouTube Premium', category: 'Subscriptions', description: 'YouTube Premium' },
  { pattern: /amazon\s*prime/i, name: 'Amazon Prime', category: 'Subscriptions', description: 'Amazon Prime Subscription' },
  { pattern: /jio\s*cinema|jiocinema/i, name: 'JioCinema', category: 'Subscriptions', description: 'JioCinema Subscription' },
  { pattern: /sonyliv/i, name: 'SonyLIV', category: 'Subscriptions', description: 'SonyLIV Subscription' },
  { pattern: /zee5/i, name: 'ZEE5', category: 'Subscriptions', description: 'ZEE5 Subscription' },
  { pattern: /apple\s*(?:tv|music|icloud|one)/i, name: 'Apple Subscription', category: 'Subscriptions', description: 'Apple Subscription' },
  { pattern: /google\s*one/i, name: 'Google One', category: 'Subscriptions', description: 'Google One Storage' },
  { pattern: /myntra/i, name: 'Myntra', category: 'Shopping', description: 'Myntra Fashion Purchase' },
  { pattern: /amazon/i, name: 'Amazon', category: 'Shopping', description: 'Amazon Checkout' },
  { pattern: /flipkart/i, name: 'Flipkart', category: 'Shopping', description: 'Flipkart Shopping' },
  { pattern: /meesho/i, name: 'Meesho', category: 'Shopping', description: 'Meesho Purchase' },
  { pattern: /ajio/i, name: 'AJIO', category: 'Shopping', description: 'AJIO Fashion Purchase' },
  { pattern: /nykaa/i, name: 'Nykaa', category: 'Shopping', description: 'Nykaa Beauty Purchase' },
  { pattern: /croma/i, name: 'Croma', category: 'Shopping', description: 'Croma Electronics' },
  { pattern: /reliance\s*digital/i, name: 'Reliance Digital', category: 'Shopping', description: 'Reliance Digital Purchase' },
  { pattern: /\bdmart\b|d-?mart/i, name: 'DMart', category: 'Groceries', description: 'DMart Purchase' },
  { pattern: /airtel/i, name: 'Airtel', category: 'Utilities & Bills', description: 'Airtel Telecom / Broadband' },
  { pattern: /\bjio\b/i, name: 'Jio', category: 'Utilities & Bills', description: 'Jio Telecom Recharge' },
  { pattern: /\bvi\b|vodafone|idea/i, name: 'Vi (Vodafone Idea)', category: 'Utilities & Bills', description: 'Vi Telecom Recharge' },
  { pattern: /bsnl/i, name: 'BSNL', category: 'Utilities & Bills', description: 'BSNL Telecom Bill' },
  { pattern: /electricity|bescom|tata\s*power|adani\s*electricity|msedcl|tneb/i, name: 'Electricity Provider', category: 'Utilities & Bills', description: 'Electricity Bill Payment' },
  { pattern: /gas\s*bill|indane|bharat\s*gas|hp\s*gas/i, name: 'Gas Provider', category: 'Utilities & Bills', description: 'Gas Bill Payment' },
  { pattern: /water\s*bill|water\s*supply/i, name: 'Water Supply', category: 'Utilities & Bills', description: 'Water Bill Payment' },
  { pattern: /salary|credited\s*by.*(?:employer|company|corp)/i, name: 'Salary Credit', category: 'Salary', description: 'Monthly Salary Credit' },
  { pattern: /bookmyshow|\bbms\b/i, name: 'BookMyShow', category: 'Entertainment', description: 'BookMyShow Tickets' },
  { pattern: /pvr|inox/i, name: 'PVR INOX', category: 'Entertainment', description: 'PVR INOX Cinema' },
  { pattern: /apollo\s*pharmacy|netmeds|medplus|1mg\b/i, name: 'Pharmacy', category: 'Health', description: 'Pharmacy / Medicine Purchase' },
  { pattern: /apollo\s*(?:hospital|clinic)/i, name: 'Apollo Hospital', category: 'Health', description: 'Apollo Hospital Payment' },
  { pattern: /groww/i, name: 'Groww', category: 'Investments', description: 'Groww Investment' },
  { pattern: /zerodha/i, name: 'Zerodha', category: 'Investments', description: 'Zerodha Trading' },
  { pattern: /upstox/i, name: 'Upstox', category: 'Investments', description: 'Upstox Investment' },
  { pattern: /kuvera/i, name: 'Kuvera', category: 'Investments', description: 'Kuvera Fund Investment' },
  { pattern: /mutual\s*fund|sip\b/i, name: 'Mutual Fund SIP', category: 'Investments', description: 'Mutual Fund SIP Debit' },
  { pattern: /paytm\s*mall|paytm\s*(?:movie|travel)/i, name: 'Paytm Mall', category: 'Shopping', description: 'Paytm Mall Purchase' },
  { pattern: /swiggy\s*genie/i, name: 'Swiggy Genie', category: 'Transport', description: 'Swiggy Genie Delivery' },
  { pattern: /tata\s*cliq|tatacliq/i, name: 'Tata CLiQ', category: 'Shopping', description: 'Tata CLiQ Purchase' },
  { pattern: /lenskart/i, name: 'Lenskart', category: 'Health', description: 'Lenskart Eyewear' },
  { pattern: /\bcred\b|\bcheq\b|(?:credit\s*)?card\s*(?:bill\s*)?payment|payment\s*(?:is|was|has\s+been)?\s*(?:successful|received|confirmed|done|completed|processed)?\s*(?:towards|for)?\s*(?:your\s*)?(?:credit\s*)?card/i, name: 'Credit Card Payment', category: 'Utilities & Bills', description: 'Credit Card Bill Payment' },
  { pattern: /sbi\s*(?:bank\s*)?(?:credit\s*)?card\s*(?:bill\s*)?payment|sbicard/i, name: 'SBI Credit Card Bill', category: 'Utilities & Bills', description: 'SBI Credit Card Bill Payment' },
  { pattern: /hdfc\s*(?:bank\s*)?(?:credit\s*)?card\s*(?:bill\s*)?payment|hdfc\s*cc/i, name: 'HDFC Credit Card Bill', category: 'Utilities & Bills', description: 'HDFC Credit Card Bill Payment' },
  { pattern: /icici\s*(?:bank\s*)?(?:credit\s*)?card\s*(?:bill\s*)?payment|icici\s*cc/i, name: 'ICICI Credit Card Bill', category: 'Utilities & Bills', description: 'ICICI Credit Card Bill Payment' },
  { pattern: /axis\s*(?:bank\s*)?(?:credit\s*)?card\s*(?:bill\s*)?payment|axis\s*cc/i, name: 'Axis Credit Card Bill', category: 'Utilities & Bills', description: 'Axis Credit Card Bill Payment' },
  { pattern: /onecard\s*(?:bill\s*)?payment/i, name: 'OneCard Credit Card Bill', category: 'Utilities & Bills', description: 'OneCard Credit Card Bill Payment' },
  { pattern: /scapia\s*(?:bill\s*)?payment/i, name: 'Scapia Credit Card Bill', category: 'Utilities & Bills', description: 'Scapia Credit Card Bill Payment' },
  { pattern: /classplus|unacademy|byjus|byju/i, name: 'EdTech Platform', category: 'Education', description: 'Online Education' },
]

// ============================================================
// LAYER 4 — EVENT TYPE CLASSIFICATION
// ============================================================
type EventType = 'debit' | 'credit' | 'refund' | 'emi' | 'sip' | 'salary' | 'chargeback' | 'subscription' | 'transfer' | 'insurance' | 'loan_repayment' | 'atm_withdrawal'

export function classifyEventType(text: string, txType: 'debit' | 'credit', category: string): EventType {
  // Bank reference tokens often embed the keyword between underscores
  // (e.g. "PPR030614052540_EMI_05-08-") — `_` is a \w character, so a bare
  // `\bemi\b` never matches there. Normalizing underscores to spaces here
  // (scoped to this classifier only) restores word-boundary matching
  // without touching the general parsing text used elsewhere.
  const t = text.replace(/_/g, ' ').toLowerCase()

  // Credit events
  if (txType === 'credit') {
    if (/\b(salary|payroll|employer|stipend|wages)\b/.test(t)) return 'salary'
    if (/\b(refund|reversed|chargeback|dispute\s*resolved)\b/.test(t)) return 'refund'
    if (/\b(cashback)\b/.test(t)) return 'credit'
    return 'credit'
  }

  // Debit events
  if (/\b(emi|equated\s*monthly|loan\s*emi|emi\s*debit)\b/.test(t)) return 'emi'
  if (/\b(sip|systematic\s*investment|mutual\s*fund\s*sip)\b/.test(t)) return 'sip'
  if (/\b(insurance|premium|life\s*insurance|health\s*insurance|term\s*plan|ulip)\b/.test(t)) return 'insurance'
  if (/\b(loan\s*repayment|loan\s*payment|emi|home\s*loan|personal\s*loan|auto\s*loan)\b/.test(t)) return 'loan_repayment'
  if (/\b(atm\s*withdrawal|atm\s*cash|cash\s*withdrawal|atm\s*debit)\b/.test(t)) return 'atm_withdrawal'
  if (/\b(transfer|neft|rtgs|imps|fund\s*transfer|wire\s*transfer)\b/.test(t)) return 'transfer'
  if (category === 'Subscriptions') return 'subscription'
  return 'debit'
}

// ============================================================
// PAYMENT MODE DETECTION (maps to DB payment_mode column)
// ============================================================
type PaymentMode = 'upi' | 'credit_card' | 'debit_card' | 'neft' | 'rtgs' | 'imps' | 'atm' | 'net_banking' | 'nach' | 'wallet' | 'cheque' | 'unknown'

function detectPaymentMode(text: string): PaymentMode {
  const t = text.toLowerCase()
  if (/\b(?:credit\s*card|cc|sbi\s*card|onecard|scapia|amex|american\s*express|rupay\s*credit|visa\s*credit|mastercard\s*credit|card\s*ending)\b/.test(t)) return 'credit_card'
  if (/\bdebit\s*card\b/.test(t)) return 'debit_card'

  const hasUpiVpa = (() => {
    const matches = t.match(/[\w.-]+@[\w.-]+/g)
    if (!matches) return false
    for (const m of matches) {
      if (/\b(care|support|reply|noreply|alerts|help|info|service|contact|feedback|queries|security)@/.test(m)) continue
      if (/\.(com|in|net|org|edu|gov|co|info|biz|co\.in|org\.in|net\.in)$/.test(m)) continue
      return true
    }
    return false
  })()
  if (/\b(?:upi|vpa)\b/.test(t) || hasUpiVpa) return 'upi'

  if (/\bneft\b/.test(t)) return 'neft'
  if (/\brtgs\b/.test(t)) return 'rtgs'
  if (/\bimps\b/.test(t)) return 'imps'
  if (/\b(nach|auto\s*debit|ecs|mandate)\b/.test(t)) return 'nach'
  if (/\batm\s*withdrawal\b|\bcash\s*withdrawal\b/.test(t)) return 'atm'
  if (/\b(net\s*banking|internet\s*banking|netbanking)\b/.test(t)) return 'net_banking'
  if (/\b(wallet|paytm\s*wallet|phonepe\s*wallet|freecharge|mobikwik)\b/.test(t)) return 'wallet'
  if (/\bcheque\b|\bcheque\s*no\b/.test(t)) return 'cheque'
  return 'unknown'
}

// ============================================================
// CARD LAST-4 EXTRACTION
// ============================================================
function getLastMatchIndex(preText: string, regex: RegExp): number {
  const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g')
  let match
  let lastIndex = -1
  while ((match = globalRegex.exec(preText)) !== null) {
    lastIndex = match.index
  }
  return lastIndex
}

export function extractCardLast4(text: string): string | null {
  // Masking run is a single bounded character class, NOT a nested quantifier.
  // The previous `(?:[xX*]+-?)*` was the classic `(a+)*` shape: on a long run
  // of x/X/* not followed by 4 digits it backtracked exponentially — measured
  // at 5.2 minutes for a 48-character input. This runs inside Stage C, which
  // is not yielded mid-candidate, so one such email froze the entire scan.
  const candidateRegex = /(?:^|\D)[xX*-]{0,40}\s*(\d{4})\b/g
  let match
  const candidates: { digits: string; index: number }[] = []

  while ((match = candidateRegex.exec(text)) !== null) {
    const digits = match[1]
    const idx = match.index + match[0].indexOf(digits)
    candidates.push({ digits, index: idx })
  }

  for (const candidate of candidates) {
    const digits = candidate.digits
    const idx = candidate.index

    const preText = text.substring(Math.max(0, idx - 60), idx)
    const isMasked = /[xX*]+-?\s*$/.test(preText)
    const hasCardPrefix = /\b(card|cc|ending|ends)\b/i.test(preText)

    const val = parseInt(digits, 10)
    if (val >= 2020 && val <= 2035 && !isMasked && !hasCardPrefix) continue

    const cardRegex = /\b(card|cc|credit|debit|visa|mastercard|mc|rupay|amex|diners|sbicard|sbi-card)\b/i
    const accountRegex = /\b(a\/c|account|acct|acc|savings|current|deposit|loan|wallet)\b/i
    const refRegex = /\b(ref\s*(?:no\.?|num(?:ber)?)?|reference\s*(?:no\.?|num(?:ber)?)?|txn\s*id|transaction\s*id|utr|otp|code|pin)\b/i

    const cardLastIdx = getLastMatchIndex(preText, cardRegex)
    const accountLastIdx = getLastMatchIndex(preText, accountRegex)
    const refLastIdx = getLastMatchIndex(preText, refRegex)

    const cardDist = cardLastIdx !== -1 ? preText.length - cardLastIdx : Infinity
    const accountDist = accountLastIdx !== -1 ? preText.length - accountLastIdx : Infinity
    const refDist = refLastIdx !== -1 ? preText.length - refLastIdx : Infinity

    if (accountDist < cardDist) continue
    if (refDist < cardDist) continue

    const endsMatch = preText.match(/\b(ending|ends)\s*(?:in\s*)?$/i)
    const hasEnds = !!endsMatch

    if (!isMasked && cardDist > 40 && !hasEnds) continue

    if (cardDist === Infinity && accountDist !== Infinity) continue
    if (cardDist === Infinity && refDist !== Infinity) continue

    return digits
  }

  return null
}

// ============================================================
// MERCHANT EXTRACTION
// ============================================================
function extractMerchantFromSnippet(snippet: string): { name: string; category: string; description: string } | null {
  for (const km of KNOWN_MERCHANTS) {
    if (km.pattern.test(snippet)) return { name: km.name, category: km.category, description: km.description }
  }
  return null
}

function extractDynamicMerchant(snippet: string): string {
  const patterns = [
    // "debited from your HDFC Bank Credit Card ending 7185 towards ANTHROPIC*
    // CLAUDE SUB" — the merchant follows "towards", which none of the patterns
    // below reach. Without it HDFC alerts fell through to the loose bare-"at"
    // pattern further down and captured "1930 3" out of the cyber-crime
    // helpline sentence ("Call the National Cyber Crime Helpline at 1930").
    /(?:towards|in\s+favou?r\s+of)\s+([A-Za-z][\w\s&.*'-]{1,30}?)(?:\s*(?:\.|,|\s+on\s|\s+Ref|\s+UPI|\s+via|\s+using|\s*$))/i,
    /(?:transferred|sent|paid)\s+(?:Rs\.?\s*|INR\s*|₹\s*)?[0-9,]+(?:\.[0-9]+)?\s+to\s+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+UPI|\s+on|\s+via|\s+using|\s*$))/i,
    /(?:debited|charged)\s+(?:Rs\.?\s*|INR\s*|₹\s*)?[0-9,]+(?:\.[0-9]+)?\s+(?:at|on|for)\s+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+on|\s+via|\s+using|\s*$))/i,
    /(?:merchant|vendor|biller|payee|recipient)[:\s]+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\r|\n|$))/i,
    /(?:info|narration|remarks)[:\s\-]+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+on|\s+via|\s+using|\s*$))/i,
    /(?:credited|received|refunded)\s+.*?\s+from\s+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+on|\s+via|\s+using|\s*$))/i,
    /(?:paid\s+to|transfer(?:red)?\s+to|debited\s+to|txn\s+to|payment\s+to|sent\s+to)\s+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+UPI\s*Ref|\s+on|\s+at|\s+ref|\s+for|\s+via|\s*$))/i,
    /(?:spent\s+at|debited\s+at|purchased\s+at|payment\s+at|charged\s+at|(?:^|\s)at)\s+([A-Za-z0-9][\w\s&.\-]{1,30}?)(?:\s*(?:\.|,|\s+Ref|\s+UPI\s*Ref|\s+on|\s+ref|\s+for|\s+via|\s*$))/i,
    /to\s+([A-Z][A-Z0-9\s&]{2,25}?)(?:\s*\.?\s*(?:Ref|UPI|ref|$))/,
    /VPA[:\s]+([a-z0-9._]+)@/i,
    /Info[:\s]+([A-Za-z0-9][\w\s&.\-]{2,25})/i,
  ]
  for (const pattern of patterns) {
    const match = snippet.match(pattern)
    if (match && match[1]) {
      let merchant = match[1].trim()
        .replace(/\b(ref|on|using|by|upi|refno|xx|account|ref\s*no|UPI\s*Ref)\b.*/i, '')
        // "ANTHROPIC* CLAUDE SUB" — card networks pad the descriptor with '*'.
        .replace(/[*]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (merchant.length < 2) continue
      // A capture with no letters is never a merchant name — it is a phone
      // number, a time, or a reference picked up by one of the looser patterns
      // below. Falling through to the next pattern (and ultimately to the bank
      // name) beats storing "1930 3" as the payee.
      if (!/[A-Za-z]/.test(merchant)) continue
      if (/^(rs|inr|the|and|for|was|ref|upi)$/i.test(merchant)) continue
      return merchant
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    }
  }
  return ''
}

function generateDescription(merchant: string, snippet: string, type: 'debit' | 'credit'): string {
  const known = extractMerchantFromSnippet(snippet)
  if (known) return known.description
  if (merchant && merchant.length > 1) {
    const cleanMerchant = merchant.replace(/(?:outflow|ride|sub|rides|alert|payment|fashion|pos|txn|ref|order)/gi, '').trim()
    return type === 'credit' ? `${cleanMerchant || 'Incoming'} Credit` : `${cleanMerchant || 'Payment'} Transaction`
  }
  if (type === 'credit') {
    if (/salary|credited by/i.test(snippet)) return 'Salary Credit'
    if (/refund/i.test(snippet)) return 'Refund Credit'
    if (/cashback/i.test(snippet)) return 'Cashback Credit'
    return 'Incoming Credit'
  }
  if (/emi/i.test(snippet)) return 'EMI Debit'
  if (/insurance/i.test(snippet)) return 'Insurance Premium'
  if (/mutual\s*fund|sip/i.test(snippet)) return 'Investment SIP Debit'
  if (/loan/i.test(snippet)) return 'Loan Repayment'
  if (/atm/i.test(snippet)) return 'ATM Cash Withdrawal'
  return 'Bank Transaction'
}

const GENERIC_MERCHANT_PATTERNS = [
  /auto\s*detected/i, /retail\s*transaction/i, /payment\s*transaction/i,
  /bank\s*transaction/i, /^merchant$/i, /^payment$/i, /^transaction$/i,
]

// ============================================================
// LAYER 5 — CONFIDENCE SCORING ENGINE
// ============================================================
interface ConfidenceSignals {
  trustedSender: boolean
  hardAcceptSubject: boolean
  hasTransactionKeyword: boolean
  hasAmount: boolean
  hasMerchant: boolean
  hasPaymentMode: boolean
  hasReferenceId: boolean
  isLargeAmount: boolean
  debitCreditClear: boolean
}

function computeConfidence(signals: ConfidenceSignals): number {
  let score = 0
  const isEffectivelyTrusted = signals.trustedSender || signals.hardAcceptSubject || signals.hasReferenceId
  if (isEffectivelyTrusted) score += 35
  if (signals.hardAcceptSubject) score += 20
  if (signals.hasTransactionKeyword) score += 20
  if (signals.hasAmount) score += 15
  if (signals.hasMerchant) score += 10
  if (signals.hasPaymentMode) score += 5
  if (signals.hasReferenceId) score += 5
  if (signals.debitCreditClear) score += 5

  if (!isEffectivelyTrusted) {
    score -= 15
  }
  if (signals.isLargeAmount) score -= 5
  return Math.max(0, Math.min(100, score))
}

// ============================================================
// UTILITY — Base64 URL Decoder
// ============================================================
/**
 * `maxChars`, when given, bounds the DECODE itself — not just what a caller
 * does with the result afterward. The byte-copy loop below is O(decoded
 * length): for a marketing email with a multi-MB inline base64 image sitting
 * in its `text/html` part, that loop alone can block the main thread for
 * seconds, and it happens inside a single synchronous call — no per-email
 * yield elsewhere in the scan loop can rescue a stall that occurs mid-decode.
 * A caller that only truncates the decoded string afterward (as this
 * function's callers used to) still pays the full decode cost first, which
 * defeats the truncation's purpose entirely on exactly the pathological
 * emails it exists to protect against.
 *
 * Base64 expands 3 bytes to 4 characters, so `maxChars` decoded characters
 * needs at most `maxChars * 4/3` base64 input characters; the extra slack
 * below is deliberately generous since multi-byte UTF-8 sequences can need
 * more than one byte per decoded character.
 */
function decodeBase64Url(str: string, maxChars?: number): string {
  if (!str) return ''
  // Sliced BEFORE sanitizing, not after — str.replace(...) with a global flag
  // is itself an O(length) scan of the FULL input. Truncating only the
  // *result* of those three replace() passes still pays for scanning the
  // entire multi-MB string first, which defeats the bound on exactly the
  // huge input it exists to protect against.
  let input = str
  if (maxChars && maxChars > 0) {
    const neededBase64Chars = Math.ceil((maxChars * 2) / 3) * 4
    if (input.length > neededBase64Chars) input = input.slice(0, neededBase64Chars)
  }
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const pad = base64.length % 4
  if (pad) {
    if (pad === 1) return ''
    base64 += new Array(5 - pad).join('=')
  }
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/**
 * Ceiling on how much of one email's body is decoded and DOM-parsed.
 *
 * Sized against what actually READS this text, which is far less than it
 * used to be set to (300000):
 *   - the AI prompt        first  1500 chars (AI_BODY_CHAR_LIMIT)
 *   - the regex gates      first  2000 chars (emailContentForParsing)
 *   - bulk-mail markers    first/last 4000 chars each (BULK_SCAN_EDGE)
 *   - boilerplate strip    last  12000 chars (BOILERPLATE_SCAN_TAIL_CHARS)
 *
 * Nothing consumes more than ~16KB, so parsing 300KB meant discarding ~95%
 * of the work — per email, on the main thread, and worst on exactly the
 * image-heavy marketing mail the gates exist to throw away. 60KB keeps a
 * wide margin over every consumer above while cutting the decode+parse cost
 * of a heavy email by ~5x.
 */
const MAX_HTML_PARSE_CHARS = 60000

function stripHtmlTagsFast(html: string): string {
  if (!html) return ''
  let result = ''
  let inTag = false
  let tagBuffer = ''
  let skipContent = false

  for (let i = 0; i < html.length; i++) {
    const char = html[i]
    if (char === '<') {
      inTag = true
      tagBuffer = ''
    } else if (char === '>') {
      inTag = false
      const tagLower = tagBuffer.toLowerCase().trim()
      if (skipContent) {
        if (tagLower === '/style' || tagLower === '/script' || tagLower.startsWith('/style ') || tagLower.startsWith('/script ')) {
          skipContent = false
        }
      } else if (tagLower.startsWith('style') || tagLower.startsWith('script')) {
        skipContent = true
      }
      tagBuffer = ''
      result += ' '
    } else if (inTag) {
      tagBuffer += char
    } else if (!skipContent) {
      result += char
    }
  }
  return result.replace(/\s+/g, ' ')
}

/** Parts in a Gmail payload tree. Reported alongside a slow-email warning
 *  because per-part decode cost is what makes a multipart newsletter expensive. */
function countMailParts(part: any): number {
  if (!part) return 0
  let n = 1
  if (part.parts && Array.isArray(part.parts)) {
    for (const child of part.parts) n += countMailParts(child)
  }
  return n
}

export function extractEmailBody(mail: any): string {
  if (!mail || !mail.payload) return mail?.snippet || ''
  let plainText = ''
  let htmlText = ''

  // MAX_HTML_PARSE_CHARS bounds each PART. It did not bound the total, and a
  // multipart newsletter has many text parts, so the real ceiling was
  // parts × 60000 — unbounded in practice. htmlText was at least sliced before
  // parsing (below), but plainText never was: it flowed at full size into
  // extractAmountMatches and into the returned body. That is how a body
  // documented to cap at 60KB arrived at 96KB, and it grows with part count.
  //
  // Decoding is the per-part cost (atob plus a byte-copy loop), so stopping the
  // traversal once the budget is spent bounds the work at roughly one part
  // rather than N. Nothing downstream reads more than ~16KB anyway — see the
  // MAX_HTML_PARSE_CHARS comment for the consumer breakdown.
  const remaining = () => MAX_HTML_PARSE_CHARS - Math.max(plainText.length, htmlText.length)

  function traverseParts(part: any) {
    if (!part) return
    if (remaining() <= 0) return
    const mimeType = part.mimeType || ''
    const bodyData = part.body?.data || ''
    if (mimeType === 'text/plain' && bodyData) plainText += decodeBase64Url(bodyData, remaining()) + '\n'
    if (mimeType === 'text/html' && bodyData) htmlText += decodeBase64Url(bodyData, remaining()) + '\n'
    if (part.parts && Array.isArray(part.parts)) {
      for (const child of part.parts) {
        if (remaining() <= 0) break
        traverseParts(child)
      }
    }
  }

  traverseParts(mail.payload)

  // Both are now capped on the way out, not just htmlText.
  if (plainText.length > MAX_HTML_PARSE_CHARS) plainText = plainText.slice(0, MAX_HTML_PARSE_CHARS)
  if (htmlText.length > MAX_HTML_PARSE_CHARS) htmlText = htmlText.slice(0, MAX_HTML_PARSE_CHARS)

  // Collapse whitespace runs, exactly as stripHtmlTagsFast already does to the
  // HTML branch. Marketing-grade plain-text parts pad their layout with hundreds
  // of spaces to fake columns: the real CRED bill-payment mail put ₹10,000.00 at
  // character 2204 of its plain part and at 144 once collapsed. Everything
  // downstream reads emailContentForParsing, the first 2000 characters — so the
  // padding alone was enough to hide the amount and reject a genuine ₹10,000
  // payment as no_amount_in_body.
  //
  // It also makes the length comparison below mean what it says. Uncollapsed,
  // the padding made the plain part "longer" than the dense stripped HTML, so
  // the padded copy won the comparison on the strength of its own padding.
  plainText = plainText.replace(/\s+/g, ' ')

  const parsedHtml = htmlText.trim() ? stripHtmlTagsFast(htmlText) : ''

  const plainHasAmount = plainText.trim() ? extractAmountMatches(plainText).length > 0 : false
  const htmlHasAmount = parsedHtml ? extractAmountMatches(parsedHtml).length > 0 : false

  if (plainHasAmount && (!htmlHasAmount || plainText.length >= parsedHtml.length)) return plainText.trim()
  if (htmlHasAmount) return parsedHtml.trim()
  if (plainText.trim() && parsedHtml.trim()) return `${plainText.trim()}\n${parsedHtml.trim()}`
  if (plainText.trim()) return plainText.trim()
  if (parsedHtml.trim()) return parsedHtml.trim()

  return mail.snippet || ''
}

/** Fetch recent scan logs */
export async function getScanLogs() {
  const { data: { user } } = await defaultSupabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }
  const { data, error } = await defaultSupabase
    .from('email_scan_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('scanned_at', { ascending: false })
    .limit(5)
  return { data: data as EmailScanLog[] | null, error }
}

/**
 * The signed-in user's current manual-scan allowance.
 *
 * Exists so the UI can show an accurate countdown without reimplementing tier
 * rules: it resolves the limit and reads the window through the very same
 * helpers `scanRealGmailInbox` uses to decide whether to block. Read-only —
 * unlike the scan path it does not correct a lapsed subscription's status.
 *
 * Returns null when nobody is signed in.
 */
export async function getManualScanQuota(opts?: { db?: SupabaseClient }): Promise<ManualScanQuota | null> {
  const db = opts?.db || defaultSupabase
  const { data: { session } } = await db.auth.getSession()
  const user = session?.user
  if (!user) return null

  const cleanEmail = user.email?.toLowerCase().trim() || ''
  const isOwner = OWNER_EMAILS.length > 0 && OWNER_EMAILS.includes(cleanEmail)

  let isPremium = false
  try {
    const { data: profile } = await db
      .from('profiles')
      .select('subscription_status, subscription_expires_at')
      .eq('id', user.id)
      .single()
    isPremium = isPremiumProfile(profile)
  } catch {
    // Unreadable profile is treated as free tier — the stricter assumption.
  }

  const limit = resolveManualScanLimit(isOwner, isPremium)
  if (limit === Infinity) {
    return { used: 0, limit, remaining: Infinity, nextAvailableAt: null }
  }
  return computeManualQuotaState(await fetchRecentManualScanTimes(db, user.id), limit)
}

// ============================================================
// MAIN ENGINE — Scan Real Gmail Inbox (V2)
// ============================================================
/**
 * An email that survived Stage A's cheap gates and is worth an AI opinion.
 * Carries everything Stage C needs so the body/header work is done exactly once.
 */
interface ScanCandidate {
  mail: any
  mailMessageId: string
  mailDate: string
  bodyText: string
  strippedBodyText: string
  subject: string
  fromValue: string
  senderDomain: string
  isTrustedSender: boolean
  emailContentForParsing: string
  isBulkMail: boolean
}

/** Batches of AI classification in flight at once. */
const AI_BATCH_CONCURRENCY = 4

/** Per-preload ceiling. Short, because these are small indexed reads. */
const PRELOAD_TIMEOUT_MS = 12000

/**
 * Whole-scan ceiling, enforced by the scan itself rather than only by the UI.
 * Above the manual 90s wrapper so the UI reports first in the normal case; this
 * exists to stop an abandoned scan running on invisibly and to make it record
 * the stage it died in.
 */
const SCAN_DEADLINE_MS = 300000

/**
 * The subset of a Supabase list response the scan preloads actually read.
 * Declared once so the fallback literals and the generics agree without
 * repeating an inline shape at every call site.
 */
type PreloadRows = { data: any[] | null; error: unknown }

// ── Manual scan quotas (plans/email-scanner-requirements.md R6/R7/R8) ──
// Owner is unlimited and handled separately. Premium and trial share a limit.
const FREE_MANUAL_SCANS_PER_DAY = 1
const PREMIUM_MANUAL_SCANS_PER_DAY = 2
/** Rolling, not calendar-day — matches the previous cooldown's semantics. */
const MANUAL_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Re-exported so the many existing importers of this module keep working.
 * The definition moved to `subscription.ts` because the serverless cron needs
 * it too and cannot import this file — see that module's header.
 */
export { isPremiumProfile }

/** Owner is unlimited; premium and trial share a limit; everyone else is free-tier. */
export function resolveManualScanLimit(isOwner: boolean, isPremium: boolean): number {
  if (isOwner) return Infinity
  return isPremium ? PREMIUM_MANUAL_SCANS_PER_DAY : FREE_MANUAL_SCANS_PER_DAY
}

// Stage A runs entirely on the main thread. Yield to the event loop every so
// often so React can repaint and — critically — so the scan's own setTimeout
// timeout can still fire. Without this a large scan wedges the tab: the UI
// freezes on its last painted frame and the timeout that is supposed to rescue
// it never runs, because its callback is queued behind the blocking loop.
//
// Yielding is TIME-based, not count-based. A fixed "every 10 emails" yield
// assumes emails cost about the same, and they don't: at ~0.5s for one heavy
// marketing email, 10 of them is a 5-second main-thread block and Chrome shows
// "Page Unresponsive" — which is exactly what kept happening. Checking elapsed
// time instead bounds the block by wall-clock rather than by item count, so the
// worst case is one email's work plus the budget, no matter how the per-email
// cost varies or how many emails there are.
const STAGE_YIELD_BUDGET_MS = 16
const yieldToEventLoop = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  } else {
    setTimeout(resolve, 0)
  }
})

/**
 * An email slower than this gets named in the console with its size and sender.
 *
 * Every prior round of this bug was diagnosed from screenshots of a frozen
 * spinner, which says only that something was slow, never what. This makes a
 * pathological email identify itself.
 */
const SLOW_EMAIL_WARN_MS = 400

/**
 * Whether a sender domain is trusted, matching the domain itself or any
 * subdomain of it.
 *
 * The subdomain check walks the domain's own labels (at most a handful) and
 * looks each suffix up in the Set. The previous form —
 * `[...TRUSTED_SENDER_DOMAINS].some(d => senderDomain.endsWith('.' + d))` —
 * spread the whole ~100-entry Set into a fresh array and built up to 100
 * throwaway strings, for every email in every scan. Same result, without the
 * per-email allocation.
 */
/**
 * `bank.in` is a closed zone: under the RBI's 2025 directive it is operated by
 * IDRBT and issued only to RBI-regulated banks, so a `*.bank.in` sender is a
 * bank by construction and does not need enumerating.
 *
 * This matters because Indian banks have MIGRATED here. The whitelist below
 * lists hdfcbank.com and icicibank.com, but the live mail now arrives from
 * alerts@hdfcbank.bank.in, credit_cards@icici.bank.in, cbssbi.cas@alerts.sbi.bank.in
 * and info@digital.axisbankmail.bank.in — none of which the old list matched
 * (only axis.bank.in had been added, by hand, after one bug report). Every
 * other bank's alerts were therefore scored as untrusted: -15 instead of +35,
 * a 50-point swing that pushed them under the confidence floor.
 *
 * Trust here only contributes to the confidence score — it does not bypass any
 * rejection gate — so admitting a bank's marketing mail alongside its alerts
 * costs nothing: the bulk-mail and offer gates still reject it on content.
 */
function isRegulatedBankDomain(senderDomain: string): boolean {
  return senderDomain === 'bank.in' || senderDomain.endsWith('.bank.in')
}

function isTrustedSenderDomain(senderDomain: string): boolean {
  if (!senderDomain) return false
  if (isRegulatedBankDomain(senderDomain)) return true
  if (TRUSTED_SENDER_DOMAINS.has(senderDomain)) return true
  let rest = senderDomain
  for (let dot = rest.indexOf('.'); dot !== -1; dot = rest.indexOf('.')) {
    rest = rest.slice(dot + 1)
    if (TRUSTED_SENDER_DOMAINS.has(rest)) return true
  }
  return false
}

// Bulk markers live at the very top (preheader) or the very bottom (footer) of
// a marketing email, never buried in the middle. Scanning head and tail keeps
// the detection the full-body scan gave us while bounding the cost of a 200KB
// HTML newsletter — which, multiplied across a large scan, was a real part of
// what made Stage A block for so long.
const BULK_SCAN_EDGE = 4000
function bulkScanText(body: string): string {
  if (!body || body.length <= BULK_SCAN_EDGE * 2) return body
  return `${body.slice(0, BULK_SCAN_EDGE)}\n${body.slice(-BULK_SCAN_EDGE)}`
}

/** Transactions written per flush. Small enough that a dying scan loses little. */
const INSERT_CHUNK_SIZE = 10

/**
 * Prefix marking a scan-log note as "the AI was down, output is degraded".
 * The UI matches on it to style the note as a warning, so keep the two in step.
 */
export const AI_UNAVAILABLE_NOTE = 'AI classification was unavailable for this scan.'

/**
 * Insert a chunk of transactions, isolating the batch from a single
 * conflicting row. Extracted so the incremental flushes and the final flush
 * share one implementation.
 *
 * The 23505 fallback is load-bearing for concurrent and retried scans — do not
 * simplify it away.
 */
async function insertTransactionsChunk(db: SupabaseClient, rows: TransactionInsert[]): Promise<any[]> {
  if (rows.length === 0) return []

  const { data: batchInserted, error: batchError } = await db.from('transactions').insert(rows).select()
  if (!batchError) return batchInserted || []

  // 23505 = Postgres unique_violation. transactions_email_message_id_user_id_key
  // (schema.sql:493-495) exists precisely to stop two concurrent scans from
  // double-inserting the same email — but a batch insert throws on the WHOLE
  // batch if even one row trips it, discarding every unrelated legitimate
  // transaction alongside it. Fall back to inserting row-by-row so only the
  // actually-conflicting row (already inserted by the other scan) is skipped.
  if (batchError.code === '23505') {
    const inserted: any[] = []
    for (const txn of rows) {
      const { data: rowData, error: rowError } = await db.from('transactions').insert(txn).select()
      if (rowError) {
        if (rowError.code === '23505') continue // already inserted by a concurrent scan — not a fault
        throw rowError // any other error on an individual row still fails loud
      }
      if (rowData) inserted.push(...rowData)
    }
    return inserted
  }

  throw batchError // non-conflict error — unchanged fail-loud behavior
}

/** A stored transaction considered as a merge partner for a newly parsed one. */
type StoredMergeCandidate = MergeableTransaction & {
  id: string
  approval_status?: string | null
  category_confirmed_at?: string | null
  merged_email_message_ids?: string[] | null
}

/** Narrow a parsed insert to the fields payment matching actually reads. */
function toMergeable(t: TransactionInsert): MergeableTransaction {
  return {
    amount: t.amount,
    currency: t.currency ?? null,
    type: t.type,
    date: t.date,
    merchant: t.merchant ?? null,
    description: t.description ?? null,
    reference_id: t.reference_id ?? null,
    payment_mode: t.payment_mode ?? null,
    card_issuer: t.card_issuer ?? null,
    card_brand: t.card_brand ?? null,
    transaction_time: t.transaction_time ?? null,
    confidence_score: t.confidence_score ?? null,
    email_message_id: t.email_message_id ?? null,
  }
}

/** Progress signal emitted during a scan so the UI can show real state. */
export interface ScanProgress {
  phase: 'listing' | 'fetching' | 'preparing' | 'filtering' | 'analyzing' | 'saving'
  current: number
  total: number
  /** Milliseconds since the scan began. Surfaced so a stall is legible. */
  elapsedMs?: number
}

/**
 * Human-readable one-liner for a progress event, shared by both scan buttons
 * so they describe the same scan the same way.
 */
export function formatScanProgress(p: ScanProgress): string {
  const seen = Math.min(p.current, p.total)
  // Elapsed time is appended to every phase on purpose: without it a slow
  // stage and a wedged one look identical in a screenshot, which cost several
  // rounds of misdiagnosis on this scanner.
  const elapsed = p.elapsedMs && p.elapsedMs >= 3000 ? ` (${Math.round(p.elapsedMs / 1000)}s)` : ''
  return `${describePhase(p, seen)}${elapsed}`
}

function describePhase(p: ScanProgress, seen: number): string {
  switch (p.phase) {
    case 'listing':
      return p.total === 0
        ? 'No new emails to check…'
        : `Found ${p.total} email${p.total === 1 ? '' : 's'} to check…`
    case 'fetching':
      return `Reading email ${seen} of ${p.total}…`
    case 'preparing':
      return 'Preparing…'
    case 'filtering':
      return `Sorting email ${seen} of ${p.total}…`
    case 'analyzing':
      return `Analyzing email ${seen} of ${p.total}…`
    case 'saving':
      return 'Saving transactions…'
  }
}

/** Successful manual scans inside the rolling window, newest first. */
async function fetchRecentManualScanTimes(db: SupabaseClient, userId: string): Promise<string[]> {
  const windowStart = new Date(Date.now() - MANUAL_QUOTA_WINDOW_MS).toISOString()
  const { data } = await db
    .from('email_scan_logs')
    .select('scanned_at')
    .eq('user_id', userId)
    .eq('status', 'success')
    // Scheduled scans are excluded on purpose: the daily automatic scan must
    // not consume a user's manual allowance (R7). Rows predating this column
    // have scan_mode NULL and so don't count either, which fails open for one
    // rolling window after deploy rather than locking anyone out.
    .eq('scan_mode', 'manual')
    .gte('scanned_at', windowStart)
    .order('scanned_at', { ascending: false })
  return (data ?? []).map((r: { scanned_at: string }) => r.scanned_at)
}

export interface ManualScanQuota {
  used: number
  limit: number
  remaining: number
  /** When the next manual scan becomes possible, or null if one is available now. */
  nextAvailableAt: Date | null
}

/**
 * Pure quota arithmetic, shared by the engine's blocking decision and the UI's
 * countdown so the two can never disagree — a countdown that says "22 hours"
 * while the engine would happily run a scan is exactly the kind of thing that
 * makes the scanner look broken.
 *
 * `scannedAtDesc` is the timestamps of successful MANUAL scans inside the
 * rolling window, newest first.
 */
export function computeManualQuotaState(
  scannedAtDesc: string[],
  limit: number,
  now: number = Date.now()
): ManualScanQuota {
  const used = scannedAtDesc.length
  if (limit === Infinity) {
    return { used, limit, remaining: Infinity, nextAvailableAt: null }
  }
  const remaining = Math.max(0, limit - used)
  if (remaining > 0) {
    return { used, limit, remaining, nextAvailableAt: null }
  }
  // Rolling window: the next slot opens when the Nth-newest scan ages out, not
  // when the most recent one does. Newest-first ordering makes that index
  // (limit - 1) — once it leaves the window only newer ones remain, which is
  // under the limit.
  const blocking = scannedAtDesc[limit - 1]
  const nextAvailableAt = new Date(new Date(blocking).getTime() + MANUAL_QUOTA_WINDOW_MS)
  return {
    used,
    limit,
    remaining: 0,
    nextAvailableAt: nextAvailableAt.getTime() > now ? nextAvailableAt : null,
  }
}

/**
 * Runs Stage B: classify every candidate, batched and with bounded concurrency.
 * Returns a map of Gmail message id → verdict, where a missing/null entry means
 * "no AI opinion" and Stage C falls through to the regex ladder.
 *
 * Never throws. `analyzeTransactionEmailBatchWithAI` already degrades a failed
 * batch to single calls internally; the extra guard here covers an injected
 * batch function (tests, cron) that doesn't.
 */
async function classifyCandidatesWithAI(
  candidates: ScanCandidate[],
  askAIBatch: NonNullable<ScanGmailOptions['askAIBatch']>,
  askAI: NonNullable<ScanGmailOptions['askAI']>,
  categoryNames: string[],
  emitProgress: (p: ScanProgress) => void = () => {}
): Promise<Map<string, AITransactionResult | null>> {
  const verdicts = new Map<string, AITransactionResult | null>()
  if (candidates.length === 0) return verdicts

  const chunks: ScanCandidate[][] = []
  for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) {
    chunks.push(candidates.slice(i, i + AI_BATCH_SIZE))
  }

  for (let i = 0; i < chunks.length; i += AI_BATCH_CONCURRENCY) {
    const inFlight = chunks.slice(i, i + AI_BATCH_CONCURRENCY)
    const settled = await Promise.all(
      inFlight.map(async (chunk) => {
        const emails: EmailForAI[] = chunk.map((c, idx) => ({
          index: idx,
          subject: c.subject,
          body: c.strippedBodyText,
          emailDate: c.mailDate,
        }))
        try {
          return { chunk, byIndex: await askAIBatch(emails, categoryNames) }
        } catch (err) {
          // An injected batch fn that throws — degrade to single calls rather
          // than dropping the whole chunk onto the regex ladder.
          console.warn('[emailScanner] AI batch failed, falling back to single calls:', err)
          const byIndex = new Map<number, AITransactionResult | null>()
          for (let idx = 0; idx < chunk.length; idx++) {
            try {
              byIndex.set(idx, await askAI(chunk[idx].subject, chunk[idx].strippedBodyText, chunk[idx].mailDate, categoryNames))
            } catch {
              byIndex.set(idx, null)
            }
          }
          return { chunk, byIndex }
        }
      })
    )

    for (const { chunk, byIndex } of settled) {
      chunk.forEach((c, idx) => verdicts.set(c.mailMessageId, byIndex.get(idx) ?? null))
    }
    emitProgress({ phase: 'analyzing', current: verdicts.size, total: candidates.length })
  }

  return verdicts
}

export interface ScanGmailOptions {
  /** Supabase client to use for all DB reads/writes during this scan. Defaults to the browser singleton. */
  db?: SupabaseClient
  /** User id/email to scan for. When provided (with accessToken), the browser session lookup is skipped entirely — this is the server-side/cron path. */
  userId?: string
  userEmail?: string
  /** Google API access token to use directly, bypassing localStorage/session lookup. */
  accessToken?: string
  /** Lookback window in milliseconds for searching Gmail. Defaults to 7 days. */
  scanWindowMs?: number
  /**
   * Single-email AI analyzer. Defaults to the proxy-based
   * `analyzeTransactionEmailWithAI`. Still used as the per-email fallback when
   * a batch call fails, so it remains the safety net even though the batch
   * path below does the bulk of the work.
   */
  askAI?: (subject: string, body: string, emailDate: string, categoryNames?: string[]) => ReturnType<typeof analyzeTransactionEmailWithAI>
  /**
   * Batched AI analyzer — classifies up to AI_BATCH_SIZE emails per call.
   * Defaults to the proxy-based `analyzeTransactionEmailBatchWithAI`. The cron
   * path injects a variant backed by its direct Gemini client so it gets the
   * same reduction in calls.
   */
  askAIBatch?: (emails: EmailForAI[], categoryNames?: string[]) => Promise<Map<number, AITransactionResult | null>>
  /**
   * Whether this scan was triggered by the user or by the daily cron. Recorded
   * on the scan log, and decides whether the manual quota applies — scheduled
   * scans are exempt, so a user's automatic scan never spends their manual
   * allowance. Defaults to 'manual'.
   */
  scanMode?: 'manual' | 'scheduled'
  /**
   * Progress reporter, so the UI can show real state instead of an
   * indeterminate spinner. Invoked on the listing, fetching, analyzing and
   * saving phases. Exceptions thrown here are swallowed — a broken progress
   * indicator must never fail a scan.
   */
  onProgress?: (progress: ScanProgress) => void
}

/**
 * The browser scan currently running, if any, plus the progress callbacks of
 * everyone waiting on it.
 *
 * Three entry points start a scan and none of them knew about the others:
 * DashboardPage's mount sync, PendingPage's mount sync, and the manual button.
 * Navigating Dashboard → Pending → "Sync Now" therefore ran three full scans
 * at once over the same inbox. On a real 7-day window (~200 messages for this
 * inbox) that triples the Gmail detail fetches competing for the browser's ~6
 * connections per origin, triples the Gemini calls — pushing straight through
 * the proxy's 60/min IP limit, whose 429s are invisible and silently drop every
 * affected email to the regex ladder — and leaves the tab unresponsive. Which
 * is what "the scanner does not respond" looks like from the outside.
 *
 * Later callers join the running scan instead of starting another. Their
 * progress callbacks are attached to it, so a manual click during a background
 * sync still shows live progress rather than a dead spinner.
 *
 * Server-side (cron) callers are exempt: one invocation legitimately scans many
 * users, and they pass `userId` explicitly.
 */
let inFlightBrowserScan: ReturnType<typeof runGmailScan> | null = null
const inFlightProgressListeners = new Set<(p: ScanProgress) => void>()

export async function scanRealGmailInbox(opts?: ScanGmailOptions) {
  const isServerSide = !!opts?.userId
  if (!isServerSide) {
    if (inFlightBrowserScan) {
      const listener = opts?.onProgress
      if (listener) inFlightProgressListeners.add(listener)
      try {
        return await inFlightBrowserScan
      } finally {
        if (listener) inFlightProgressListeners.delete(listener)
      }
    }
    const run = runGmailScan(opts)
    inFlightBrowserScan = run
    try {
      return await run
    } finally {
      inFlightBrowserScan = null
      inFlightProgressListeners.clear()
    }
  }
  return runGmailScan(opts)
}

async function runGmailScan(opts?: ScanGmailOptions) {
  const supabase = opts?.db || defaultSupabase
  const isServerSide = !!opts?.userId
  // Generated up front so every per-email rejection logged during this scan
  // can reference the scan_log row before that row itself is inserted
  // (which only happens after the whole scan completes, below).
  const scanMode: 'manual' | 'scheduled' = opts?.scanMode ?? 'manual'
  const scanLogId: string = crypto.randomUUID
    ? crypto.randomUUID()
    : `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const askAI = opts?.askAI ||
    ((subject: string, body: string, emailDate: string, categoryNames?: string[]) =>
      analyzeTransactionEmailWithAI(subject, body, emailDate, undefined, categoryNames))
  // When a caller supplies only `askAI` (every existing test, and any older
  // caller), synthesise a batch fn from it so behaviour is unchanged for them:
  // same one-call-per-email semantics, just routed through the staged pipeline.
  const askAIBatch = opts?.askAIBatch ||
    (opts?.askAI
      ? async (emails: EmailForAI[], categoryNames?: string[]) => {
          const out = new Map<number, AITransactionResult | null>()
          for (const e of emails) {
            try {
              out.set(e.index, await askAI(e.subject, e.body, e.emailDate, categoryNames))
            } catch {
              out.set(e.index, null)
            }
          }
          return out
        }
      : (emails: EmailForAI[], categoryNames?: string[]) =>
          analyzeTransactionEmailBatchWithAI(emails, undefined, categoryNames))

  let user: { id: string; email?: string } | undefined
  let providerToken: string | null = null

  if (opts?.userId && opts?.accessToken) {
    // Server-side path (cron): identity and token are supplied directly, no browser session exists.
    user = { id: opts.userId, email: opts.userEmail }
    providerToken = opts.accessToken
  } else {
    const { data: { session } } = await supabase.auth.getSession()
    user = session?.user

    providerToken = getGoogleToken()

    if (!user) return { data: null, error: new Error('User not authenticated') }

    // If access token is expired, silently refresh it before giving up
    if (!providerToken && session?.access_token) {
      providerToken = await tryRefreshGoogleToken(session.access_token)
    }
  }

  if (!user) return { data: null, error: new Error('User not authenticated') }

  if (!providerToken) {
    return {
      data: null,
      error: new Error('Gmail Inbox not connected. Please click "Connect Gmail Inbox" on the Pending Alerts page to authorise Gmail scanning.'),
    }
  }

  // Declared outside the try so the catch can report how much survived an
  // interrupted scan — with incremental flushing, "it failed" no longer means
  // "nothing was saved".
  const insertedTxns: any[] = []

  const scanStartedAt = Date.now()

  /**
   * The stage the scan is currently in. Recorded on the scan log when a scan
   * fails, so a stall names its own location instead of having to be inferred
   * from a screenshot of a frozen spinner.
   */
  let currentStage = 'starting'

  /**
   * Self-imposed deadline, checked at every stage boundary.
   *
   * The UI already wraps this call in a timeout, but that only abandons the
   * promise — the scan itself keeps running, invisibly, and writes no log. This
   * makes the scan terminate itself and record WHERE it ran out of time, which
   * is the difference between a diagnosable failure and a mystery.
   */
  const checkpoint = (stage: string) => {
    currentStage = stage
    const elapsed = Date.now() - scanStartedAt
    if (elapsed > SCAN_DEADLINE_MS) {
      throw new Error(`Scan exceeded ${Math.round(SCAN_DEADLINE_MS / 1000)}s during "${stage}"`)
    }
  }

  /** Never let a UI callback's failure break a scan. */
  const emitProgress = (p: ScanProgress) => {
    const event = { ...p, elapsedMs: Date.now() - scanStartedAt }
    try {
      opts?.onProgress?.(event)
    } catch (e) {
      console.warn('[emailScanner] onProgress callback threw:', e)
    }
    // Callers that joined this scan while it was already running (see
    // inFlightBrowserScan) get the same events, so their spinner is live too.
    for (const listener of inFlightProgressListeners) {
      if (listener === opts?.onProgress) continue
      try {
        listener(event)
      } catch (e) {
        console.warn('[emailScanner] joined onProgress callback threw:', e)
      }
    }
  }

  /**
   * Rejections are buffered in memory instead of written immediately.
   *
   * `logRejection` used to fire an insert the moment a gate rejected an
   * email — but the parent `email_scan_logs` row (same `scanLogId`) isn't
   * inserted until the scan finishes, so `email_scan_rejections`' foreign
   * key made EVERY one of those inserts fail with a 409 for the entire
   * duration of every scan. On an inbox where most mail is non-transactional
   * (the common case), that's dozens of failed round trips competing with
   * everything else for the browser's ~6-connections-per-origin budget —
   * which is what was actually stalling Stage A, not CPU work. Buffering and
   * writing once, after the parent row exists, fixes the FK violation and
   * collapses N failing requests into one that succeeds.
   */
  const rejectionBuffer: { gate: string; senderDomain: string; subject: string; matchedSnippet: string; emailMessageId?: string }[] = []
  const bufferRejection = (gate: string, senderDomain: string, subject: string, matchedSnippet: string, emailMessageId?: string) => {
    rejectionBuffer.push({ gate, senderDomain, subject, matchedSnippet, emailMessageId })
  }
  /** Writes every buffered rejection, chunked so one oversized batch can't lose them all. */
  const flushRejections = async () => {
    if (rejectionBuffer.length === 0) return
    const rows = rejectionBuffer.map((r) => ({
      user_id: user!.id,
      scan_log_id: scanLogId,
      sender_domain: r.senderDomain || null,
      subject: r.subject ? r.subject.substring(0, 500) : null,
      gate: r.gate,
      matched_snippet: r.matchedSnippet ? r.matchedSnippet.substring(0, 200) : null,
      email_message_id: r.emailMessageId || null,
    }))
    const REJECTION_FLUSH_CHUNK = 500
    for (let i = 0; i < rows.length; i += REJECTION_FLUSH_CHUNK) {
      const chunk = rows.slice(i, i + REJECTION_FLUSH_CHUNK)
      const { error } = await supabase.from('email_scan_rejections').insert(chunk)
      if (!error) continue
      // 42703 = undefined_column. `email_message_id` arrives with migration
      // 017, which is NOT in the 014-016 deploy bundle — so on a database where
      // 017 has not been applied yet, EVERY rejection insert fails and the
      // audit trail the user debugs recall gaps with is silently empty. Retry
      // without the column rather than losing the rows.
      if ((error as { code?: string }).code === '42703') {
        const withoutMessageId = chunk.map((row) => {
          const copy: Record<string, unknown> = { ...row }
          delete copy.email_message_id
          return copy
        })
        const { error: retryError } = await supabase
          .from('email_scan_rejections')
          .insert(withoutMessageId)
        if (retryError) console.warn('[emailScanner] Failed to flush rejection batch:', retryError.message)
        continue
      }
      console.warn('[emailScanner] Failed to flush rejection batch:', error.message)
    }
  }

  try {
    const cleanEmail = user.email?.toLowerCase().trim() || ''
    const isOwner = OWNER_EMAILS.length > 0 && OWNER_EMAILS.includes(cleanEmail)

    // Premium/trial entitlement, which sets the manual-scan limit below.
    let isPremium = false
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_status, subscription_expires_at')
        .eq('id', user.id)
        .single()

      isPremium = isPremiumProfile(profile)

      // A subscription that claims to be active/trial but has passed its end
      // date gets its stored status corrected. Fire-and-forget: the scan must
      // not wait on, or fail because of, a bookkeeping write.
      const claimsEntitlement =
        profile?.subscription_status === 'active' || profile?.subscription_status === 'trial'
      if (!isPremium && claimsEntitlement) {
        supabase
          .from('profiles')
          .update({ subscription_status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(({ error }: { error: any }) => {
            if (error) console.warn('Failed to update expired status in email scanner:', error.message)
          })
      }
    } catch (e) {
      console.warn('Failed to query profile for premium bypass:', e)
    }

    // ── Manual scan quota (R6/R7/R8) ─────────────────────────────────
    //   free            1 manual scan per day, no automatic scan
    //   premium/trial   daily automatic scan + 2 manual scans per day
    //   owner           daily automatic scan + unlimited manual scans
    //
    // Only MANUAL scans are counted, so a user's automatic daily scan never
    // consumes their manual allowance — R7 says the manual scans are "in
    // addition to" the automatic one. Scheduled scans skip this block entirely;
    // the cron gates eligibility on its own (owner/premium/trial), which is
    // what implements "no automatic scan" for free users.
    const scanLimit = resolveManualScanLimit(isOwner, isPremium)

    // A browser-initiated scan may only call itself 'scheduled' if the user is
    // actually entitled to an automatic scan. Both pages run a background sync
    // on mount and label it 'scheduled' to keep it off the manual allowance —
    // correct for premium and owner, but for a free user R6 says there is no
    // automatic scan at all, so that label turned into a standing exemption
    // from the quota the tier is defined by. Enforced here rather than in the
    // pages because there are three call sites and only this one is reachable
    // by all of them. The cron path (userId supplied) does its own eligibility
    // check against the same tiers and is left alone.
    if (scanMode === 'scheduled' && !isServerSide && !isOwner && !isPremium) {
      return {
        data: null,
        error: new Error('Automatic scanning is a premium feature. Use Sync Now for your daily manual scan.'),
      }
    }

    if (scanMode === 'manual' && scanLimit !== Infinity) {
      const timestamps = await fetchRecentManualScanTimes(supabase, user.id)
      const quota = computeManualQuotaState(timestamps, scanLimit)

      if (quota.remaining === 0 && quota.nextAvailableAt) {
        const hoursLeft = Math.max(1, Math.ceil((quota.nextAvailableAt.getTime() - Date.now()) / (60 * 60 * 1000)))
        const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`
        // "Next scan available" is load-bearing: PendingPage keys its cooldown
        // banner off that phrase.
        const suffix = isPremium
          ? ' Your automatic daily scan still runs.'
          : ' All transactions from your last scan are already captured.'
        return {
          data: null,
          error: new Error(
            `Daily scan limit reached (${plural(scanLimit, 'manual scan')} per day). ` +
            `Next scan available in ${plural(hoursLeft, 'hour')}.${suffix}`
          ),
        }
      }
    }

    const { data: registeredCards } = await supabase.from('cards').select('last4, issuer').eq('user_id', user.id)

    const cardMap: Record<string, string> = {}
    if (registeredCards) {
      registeredCards.forEach((c: any) => {
        if (c.last4 && c.issuer) cardMap[c.last4] = c.issuer
      })
    }

    // Two OR-ed groups: the original bank-alert-style keywords, plus generic
    // receipt-shaped language that direct-vendor emails use instead (a trip
    // receipt or food-delivery order confirmation rarely says "debited" or
    // "paid" — it says "receipt", "order", "trip", "total"). Together these
    // widen the fetch net without fetching every email in the window.
    const BANK_ALERT_KEYWORDS = '(debited OR debit OR credited OR credit OR spent OR paid OR payment OR txn OR transaction OR transfer OR received OR withdrawn OR charged OR card OR cred OR neft OR imps OR rtgs OR netbanking OR upi OR emi OR sip OR salary)'
    const RECEIPT_KEYWORDS = '(receipt OR invoice OR order OR booking OR trip OR fare OR ride OR subscription OR renewal OR total)'
    // R2 ("everything financial"). Deliberately narrow: these are the cases
    // where money HAS moved but the email uses none of the verbs above.
    //   refund    — "your refund has been processed"
    //   premium   — "premium successfully collected" (insurance)
    //   dividend / folio — investment payouts and statements carrying no verb
    //   nach / autopay   — auto-debit confirmations that write "debit", not
    //                      "debited", so they rely on Gmail stemming otherwise
    //
    // Explicitly NOT added, having checked what they would actually buy:
    //   bill, statement, due — these are reminders, which the AI and the
    //     regex ladder both reject. A bill that was genuinely PAID already
    //     matches on "payment"/"paid", so adding them buys nothing but junk.
    //   interest — Gmail stems it to "interested", which floods the net with
    //     marketing. Real interest credits match on "credited" already.
    // "premium" as a bare word is a marketing magnet ("premium membership", "go
    // premium") and drove a 6.7x jump in matched mail on the first real scan.
    // Phrases keep the insurance coverage without the newsletters; an insurance
    // premium that was actually PAID also still matches on paid/received/debited.
    const FINANCIAL_KEYWORDS = '(refund OR dividend OR folio OR nach OR autopay OR "premium paid" OR "premium collected" OR "premium received" OR "premium payment")'
    const EMAIL_KEYWORDS = `(${BANK_ALERT_KEYWORDS} OR ${RECEIPT_KEYWORDS} OR ${FINANCIAL_KEYWORDS})`

    // ── Scan window — strict rolling 7 days ──────────────────────────
    // EVERY scan looks back exactly 7 days, first scan or not
    // (plans/email-scanner-requirements.md, R3). This replaces the previous
    // scheme of anchoring to the last successful scan with a 26-hour floor and
    // a 30-day ceiling.
    //
    // Overlapping an earlier scan's window costs nothing. R4 ("never
    // reconsider what was already considered") is enforced downstream by the
    // existingMessageIds set and, at the database, by
    // UNIQUE (email_message_id, user_id) — so an already-processed email is
    // skipped by a set lookup long before it can reach an AI call, and cannot
    // produce a duplicate row even if two scans race.
    //
    // TRADE-OFF, chosen deliberately by the owner over stretching the window
    // to cover detected gaps: any interruption longer than 7 days — cron
    // outage, expired or revoked Gmail token, lapsed subscription — puts the
    // mail in that gap permanently beyond reach, because the Gmail query will
    // never request it again and dedup cannot recover what was never fetched.
    // Free users are most exposed, having no automatic scan at all.
    const SCAN_WINDOW_MS = opts?.scanWindowMs ?? (7 * 24 * 60 * 60 * 1000)
    const startLimitTime = Date.now() - SCAN_WINDOW_MS
    let q = ''
    // Use Unix epoch (seconds) for precise filtering — Gmail supports this format
    const sinceSeconds = Math.floor(startLimitTime / 1000)
    q = `after:${sinceSeconds} ${EMAIL_KEYWORDS}`

    let messages: { id: string; threadId: string }[] = []
    let nextPageToken = ''

    // Page size only — NOT a cap on total messages processed. The rolling
    // 7-day scan window computed above defines completeness; a message-count
    // cap here would silently truncate the oldest matches whenever a window
    // has more mail than the cap, which is exactly when completeness matters
    // most (a first scan, or a busy week).
    do {
      const pageSize = isOwner ? 200 : 100
      // Spam and Trash are deliberately NOT searched (owner decision,
      // 2026-08-13). `includeSpamTrash=true` pulled the scan into the two
      // folders that are almost entirely marketing — the exact class R1 gives
      // zero tolerance to — and made every scan pay to fetch and parse them.
      // Trash was the indefensible half: an email the user deliberately
      // deleted should never come back as a transaction.
      //
      // Accepted trade-off, flagged to the owner when this was decided: a
      // genuine bank alert that Gmail misfiles into Spam is now unreachable,
      // and under the strict rolling 7-day window (R3) it becomes
      // permanently unreachable once it ages out.
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${pageSize}&q=${encodeURIComponent(q)}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`
      // Retried on the same terms as the per-message fetches below, which have
      // had this since the start. Without it, ONE transient network failure on
      // this very first call — a dropped connection, an ERR_QUIC_PROTOCOL_ERROR,
      // a 429 — ends the entire scan at "stage: starting" with nothing done,
      // even though the identical failure on any later message is shrugged off.
      const listRes = await retryWithBackoff(async () => {
        const r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${providerToken}` } }, 20000)
        // Auth failures are terminal; retrying cannot fix a dead token.
        if (r.status === 401 || r.status === 403) return r
        if (r.status === 429 || r.status >= 500) {
          throw new Error(`Transient Gmail list failure: ${r.status}`)
        }
        return r
      }, 2, 500)

      if (listRes.status === 401 || listRes.status === 403) {
        clearGoogleToken()
        throw new Error('TOKEN_EXPIRED')
      }
      if (!listRes.ok) throw new Error(`Gmail API List failed: ${listRes.statusText}`)

      const listData = await listRes.json() as any
      if (listData.messages) messages = messages.concat(listData.messages)
      nextPageToken = listData.nextPageToken || ''
    } while (nextPageToken)

    // Deduplicate messages by id to avoid duplicate key errors within the same scan batch
    const uniqueMessagesMap = new Map<string, { id: string; threadId: string }>()
    for (const m of messages) {
      if (m && m.id) uniqueMessagesMap.set(m.id, m)
    }
    const uniqueMessages = Array.from(uniqueMessagesMap.values())
    checkpoint('listing emails')
    emitProgress({ phase: 'listing', current: uniqueMessages.length, total: uniqueMessages.length })

    if (uniqueMessages.length === 0) {
      const { data: log } = await supabase
        .from('email_scan_logs')
        .insert({ id: scanLogId, user_id: user.id, emails_processed: 0, transactions_found: 0, status: 'success', scan_mode: scanMode })
        .select().single()
      return { data: { transactions: [], log: log as EmailScanLog, autoApprovedCount: 0 }, error: null }
    }

    // Scoped to the scan window plus a margin, rather than every transaction
    // the user has ever had. Nothing older can collide: the Gmail query cannot
    // reach past the window, so neither a message id nor a reference id from
    // outside it can appear in this scan. The margin covers the ±1 day
    // tolerance that payment merging allows.
    // Announced before the queries below, not after. The Supabase client has no
    // default timeout, so an unbounded query here is a place the scan can stop
    // dead — and until this marker existed the UI still read "Reading email N
    // of N", making a stall here look identical to a stall in the fetch loop.
    checkpoint('preparing (loading existing transactions, categories, merchant rules)')
    emitProgress({ phase: 'preparing', current: 0, total: 0 })

    // All three preloads are independent, so they run together rather than in
    // series — and crucially NONE of them may kill the scan. Each degrades
    // safely on its own:
    //
    //   transactions   → empty dedup set. Already-imported emails get
    //                    reprocessed, but UNIQUE (email_message_id, user_id)
    //                    still rejects the insert and the 23505 row-by-row
    //                    fallback skips them, so no duplicate can reach the
    //                    ledger. The cost is wasted AI calls, not bad data.
    //   categories     → empty list, which the validation below already treats
    //                    as "accept what the classifier chose".
    //   merchant rules → empty list, falling through to the localStorage
    //                    heuristics exactly as a DB outage always has.
    //
    // Losing dedup for a single scan beats the scan dying in "Preparing…" with
    // nothing to show for it — which is what a stalled query here did, since
    // the Supabase client has no timeout of its own.
    //
    // Promise.resolve() because a Supabase query builder is thenable but not a
    // real Promise — it has no .finally, which withTimeout needs.
    const preloadOrDefault = async <T,>(work: PromiseLike<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await withTimeout(Promise.resolve(work), PRELOAD_TIMEOUT_MS, label)
      } catch (e) {
        console.warn(`[emailScanner] ${label} failed, continuing without it:`, e)
        return fallback
      }
    }

    const dedupFrom = new Date(startLimitTime - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Rejected mail is remembered again, and this time the result is actually
    // read. The original preload was dropped in b5bd178 because 77e14e2 had
    // stopped reading it — leaving every scan to re-download and re-parse every
    // email it had already decided against. Measured on a real inbox: 166
    // messages in the window, 46 skipped, so 120 re-fetched every single scan,
    // almost all of them marketing mail already rejected once.
    //
    // Bounded three ways, which is what made the old unbounded version costly:
    // scoped to this scan's window, selecting one column, and served by
    // idx_email_scan_rejections_user_msg from migration 017.
    //
    // Trade-off, deliberate: an email rejected once is not reconsidered while it
    // remains in the window, so a merchant rule added today does not retroactively
    // rescue mail rejected yesterday. That is the price of not re-parsing the
    // whole week on every scan, and the rolling window means anything genuinely
    // new is still seen.
    const rejectedFrom = new Date(startLimitTime).toISOString()
    const [existingTxnsRes, rejectedRes, userCategoriesRes, merchantRules] = await Promise.all([
      preloadOrDefault<PreloadRows>(
        supabase
          .from('transactions')
          .select('id, amount, currency, type, date, merchant, description, reference_id, payment_mode, card_issuer, card_brand, transaction_time, confidence_score, approval_status, category_confirmed_at, email_message_id, merged_email_message_ids, possible_duplicate_of')
          .eq('user_id', user.id)
          .gte('date', dedupFrom),
        { data: [], error: null },
        'Loading existing transactions'
      ),
      preloadOrDefault<PreloadRows>(
        // Nulls are filtered in JS below rather than with .not(), keeping this
        // to the same select/eq/gte shape as the transactions preload.
        // Rows written before migration 017 carry no email_message_id and
        // simply do not participate in dedup, which self-heals as they age out.
        supabase
          .from('email_scan_rejections')
          .select('email_message_id')
          .eq('user_id', user.id)
          .gte('rejected_at', rejectedFrom),
        { data: [], error: null },
        'Loading previously rejected mail'
      ),
      preloadOrDefault<PreloadRows>(
        supabase.from('categories').select('name, is_permanent').eq('user_id', user.id),
        { data: [], error: null },
        'Loading categories'
      ),
      preloadOrDefault(getMerchantRulesFromDB(user.id, supabase), [], 'Loading merchant rules'),
    ])

    const existingTxns = existingTxnsRes.data
    if (existingTxnsRes.error) {
      console.error('[emailScanner] Failed to load existing transactions for dedup:', existingTxnsRes.error)
    }

    // Absorbed ids count as seen. Without this a merged-away email would be
    // re-classified and re-inserted on every scan for the rest of the window,
    // recreating the duplicate the merge removed.
    const existingMessageIds = new Set<string>()
    for (const t of existingTxns ?? []) {
      if (t.email_message_id) existingMessageIds.add(t.email_message_id)
      for (const merged of (t as any).merged_email_message_ids ?? []) {
        if (merged) existingMessageIds.add(merged)
      }
    }
    const existingRefIds = new Set<string>(
      (existingTxns ?? []).map((t: any) => t.reference_id).filter((r: any): r is string => !!r)
    )

    // Stored transactions a newly parsed one might turn out to duplicate.
    // Grows as this scan flushes, so a payment split across two emails is
    // caught whether its partner is pre-existing or was written moments ago.
    const mergeCandidates: StoredMergeCandidate[] = [
      ...((existingTxns ?? []) as unknown as StoredMergeCandidate[]),
    ]

    // ── Drop already-processed mail BEFORE paying to download it ──────
    // R4 ("never reconsider an email already considered") was previously
    // honoured only in Stage A — i.e. AFTER every message body had already
    // been fetched from Gmail and decoded. With the strict rolling 7-day
    // window (R3), that meant each scan re-downloaded and re-parsed the whole
    // previous week: ~160 messages fetched to process the handful that were
    // actually new. The dedup set is known here, so the cheapest possible
    // thing is to not ask Gmail for those messages at all.
    //
    // Stage A keeps its own identical check: this set is a snapshot, and a
    // concurrent scan can insert a row between here and there.
    // Rejected mail counts as "already considered" (R4) just as much as mail
    // that became a transaction. Kept as its own set so the log can say which
    // kind of skip it was, and so a failed rejection preload degrades to
    // re-scanning rather than to dropping transactions.
    const rejectedMessageIds = new Set<string>()
    for (const r of (rejectedRes.data ?? []) as Array<{ email_message_id?: string | null }>) {
      if (r.email_message_id) rejectedMessageIds.add(r.email_message_id)
    }
    if (rejectedRes.error) {
      console.error('[emailScanner] Failed to load rejected mail for dedup:', rejectedRes.error)
    }

    const newMessages = uniqueMessages.filter(
      (m) => !existingMessageIds.has(m.id) && !rejectedMessageIds.has(m.id)
    )
    const alreadyKnownCount = uniqueMessages.length - newMessages.length
    if (alreadyKnownCount > 0) {
      const rejectedSkips = uniqueMessages.filter(
        (m) => !existingMessageIds.has(m.id) && rejectedMessageIds.has(m.id)
      ).length
      console.info(
        `[emailScanner] skipping ${alreadyKnownCount} of ${uniqueMessages.length} messages already processed ` +
        `(${alreadyKnownCount - rejectedSkips} became transactions, ${rejectedSkips} were rejected earlier)`
      )
    }

    if (newMessages.length === 0) {
      const { data: log } = await supabase
        .from('email_scan_logs')
        .insert({ id: scanLogId, user_id: user.id, emails_processed: 0, transactions_found: 0, status: 'success', scan_mode: scanMode })
        .select().single()
      await flushRejections()
      return { data: { transactions: [], log: log as EmailScanLog, autoApprovedCount: 0, mergedDuplicateCount: 0 }, error: null }
    }

    const batchSize = 15
    const validDetails: any[] = []
    for (let i = 0; i < newMessages.length; i += batchSize) {
      const batch = newMessages.slice(i, i + batchSize)
      let tokenExpiredDuringBatch = false
      const batchResults = await Promise.all(
        batch.map(async (m: { id: string }) => {
          try {
            const res = await retryWithBackoff(async () => {
              const r = await fetchWithTimeout(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`,
                { headers: { Authorization: `Bearer ${providerToken}` } },
                20000
              )
              // 401/403 are auth failures, not transient — surface immediately,
              // don't burn retries on a token that isn't coming back this batch.
              if (r.status === 401 || r.status === 403) return r
              // 429/5xx are transient — throwing here is what makes
              // retryWithBackoff retry; anything else (2xx, 4xx other than
              // 401/403) returns normally and is handled below.
              if (r.status === 429 || r.status >= 500) {
                throw new Error(`Transient Gmail fetch failure: ${r.status}`)
              }
              return r
            }, 2, 500)

            if (res.status === 401 || res.status === 403) {
              tokenExpiredDuringBatch = true
              return null
            }
            if (!res.ok) return null
            return await res.json()
          } catch {
            bufferRejection('fetch_failed', '', '', `messageId=${m.id}`)
            return null
          }
        })
      )
      if (tokenExpiredDuringBatch) {
        clearGoogleToken()
        throw new Error('TOKEN_EXPIRED')
      }
      validDetails.push(...batchResults.filter(Boolean))
      checkpoint(`fetching email ${validDetails.length} of ${newMessages.length}`)
      emitProgress({ phase: 'fetching', current: validDetails.length, total: newMessages.length })
    }

    // Fetch the user's real categories once per scan (not once per email) — used to
    // (1) feed the AI prompt the user's actual category names instead of the old
    // hardcoded/legacy list, and (2) validate merchant-rule/AI category suggestions
    // against what actually exists, falling back to the permanent category if not.
    const userCategories = userCategoriesRes.data
    const categoryNames = (userCategories || []).map((c: any) => c.name)
    const fallbackCategoryName = (userCategories || []).find((c: any) => c.is_permanent)?.name || 'Other'

    // Fetched ONCE per scan, not once per email. applyMerchantRulesFromDB used
    // to re-read this entire table for every email in the loop below — on a
    // 50-email scan that was 50 full table reads for data that cannot change
    // mid-scan.

    // Everything parsed this scan, for the counts on the scan log.
    const transactionsToInsert: TransactionInsert[] = []
    // Parsed but not yet written. Drained by flushPending().
    let pendingFlush: TransactionInsert[] = []

    const flushPending = async () => {
      if (pendingFlush.length === 0) return
      const rows = pendingFlush
      pendingFlush = []
      emitProgress({ phase: 'saving', current: insertedTxns.length, total: transactionsToInsert.length })
      const written = await insertTransactionsChunk(supabase, rows)
      insertedTxns.push(...written)
      // Now visible to later merges in this same scan.
      mergeCandidates.push(...(written as unknown as StoredMergeCandidate[]))
    }

    /**
     * Fold a newly parsed transaction into an existing one when they describe
     * the same payment (R10) — a bank alert and the merchant's own receipt.
     * Returns true when it was absorbed and must not be inserted separately.
     *
     * Only a matching reference id absorbs. A pair that merely looks alike is
     * inserted as its own row carrying `possible_duplicate_of`, so the user
     * decides in Pending rather than one of the two vanishing silently.
     */
    const absorbIntoExistingPayment = async (candidate: TransactionInsert): Promise<boolean> => {
      // 1. Against this scan's unwritten buffer — merge in place, no DB work.
      const bufferedIndex = pendingFlush.findIndex((p) => isSamePayment(p, candidate))
      if (bufferedIndex >= 0) {
        const existing = pendingFlush[bufferedIndex]
        const merged = mergePayments(existing, candidate)
        const absorbedId =
          merged.email_message_id === existing.email_message_id
            ? candidate.email_message_id
            : existing.email_message_id
        merged.merged_email_message_ids = [
          ...(existing.merged_email_message_ids ?? []),
          ...(candidate.merged_email_message_ids ?? []),
          absorbedId,
        ].filter((id): id is string => !!id)
        pendingFlush[bufferedIndex] = merged
        return true
      }

      // 2. Against transactions already stored (pre-existing, or flushed
      //    earlier in this scan).
      const stored = mergeCandidates.find((c) => isSamePayment(c, candidate))
      if (!stored) {
        // Looks like a duplicate but nothing proves it. Keep BOTH rows and let
        // the user decide — a missed merge costs one tap, a wrong merge
        // destroys a transaction invisibly.
        //
        // A suspect still sitting in the unwritten buffer has no id to point
        // at yet (TransactionInsert rows let Postgres generate theirs, and
        // pre-generating one would risk a foreign-key failure in the 23505
        // row-by-row insert fallback, where the referenced row can legitimately
        // be skipped). So flush first: that writes the buffer, pushes the
        // written rows — ids and all — into mergeCandidates, and reduces this
        // to the already-stored case below. Only reached when a suspect exists,
        // so the extra round-trip is rare.
        if (pendingFlush.some((p) => isSuspectedDuplicate(p, candidate))) {
          await flushPending()
        }
        const storedSuspect = mergeCandidates.find((c) => isSuspectedDuplicate(c, candidate))
        if (storedSuspect) {
          candidate.possible_duplicate_of = storedSuspect.id
        }
        return false
      }

      const patch: Record<string, unknown> = {
        merged_email_message_ids: [
          ...(stored.merged_email_message_ids ?? []),
          candidate.email_message_id,
        ].filter(Boolean),
      }

      // Enrich ONLY a row the user has not acted on yet, and only by filling
      // gaps — never overwriting a populated field. A transaction they have
      // already approved or re-categorised must not be rewritten underneath
      // them just because a second email turned up.
      const untouched = stored.approval_status === 'pending' && !stored.category_confirmed_at
      if (untouched) {
        const merged = mergePayments(stored, toMergeable(candidate))
        if (!stored.reference_id && merged.reference_id) patch.reference_id = merged.reference_id
        if ((!stored.payment_mode || stored.payment_mode === 'unknown') && merged.payment_mode) {
          patch.payment_mode = merged.payment_mode
        }
        if (!stored.card_issuer && merged.card_issuer) patch.card_issuer = merged.card_issuer
        if (!stored.card_brand && merged.card_brand) patch.card_brand = merged.card_brand
        if (!stored.transaction_time && merged.transaction_time) patch.transaction_time = merged.transaction_time
        if (isWeakMerchantLabel(stored.merchant) && !isWeakMerchantLabel(merged.merchant)) {
          patch.merchant = merged.merchant
          if (merged.description) patch.description = merged.description
        }
        if (merged.confidence_score && merged.confidence_score > (stored.confidence_score ?? 0)) {
          patch.confidence_score = merged.confidence_score
        }
      }

      const { error: patchError } = await supabase.from('transactions').update(patch).eq('id', stored.id)
      if (patchError) {
        // Losing the enrichment is survivable; losing the transaction is not.
        // Report it as absorbed anyway so a duplicate is not inserted.
        console.warn('[emailScanner] Failed to merge into existing transaction:', patchError.message)
      } else {
        Object.assign(stored, patch)
      }
      return true
    }

    // Renamed from skippedConfidence: these emails are no longer skipped —
    // they're inserted as pending transactions with their low score
    // preserved, so the name should say what actually happens to them now.
    let lowConfidencePendingCount = 0
    const lowConfidenceEmailsDetails: string[] = []
    /** Emails folded into an existing transaction instead of becoming a new one. */
    let mergedDuplicateCount = 0

    // ── Stage A — cheap per-email gates ──────────────────────────────
    // Everything here is synchronous string work and set lookups. Gate order
    // is unchanged and load-bearing: dedup → date window → bulk-marketing.
    // Junk MUST be rejected here, before Stage B spends an AI call and a slice
    // of the user's daily quota on it.
    const candidates: ScanCandidate[] = []

    // Immediately, so the label changes the moment this stage begins rather
    // than only at the first yield — otherwise a stall in the first few emails
    // is indistinguishable from a stall in the previous stage.
    checkpoint('sorting emails')
    emitProgress({ phase: 'filtering', current: 0, total: validDetails.length })

    let stageAProcessed = 0
    let stageASliceStartedAt = Date.now()
    for (const mail of validDetails) {
      stageAProcessed++
      // Time-based, not every-Nth — see STAGE_YIELD_BUDGET_MS. Checked BEFORE
      // the work so the budget bounds the block that is about to happen.
      if (Date.now() - stageASliceStartedAt >= STAGE_YIELD_BUDGET_MS) {
        checkpoint(`sorting email ${stageAProcessed} of ${validDetails.length}`)
        emitProgress({ phase: 'filtering', current: stageAProcessed, total: validDetails.length })
        await yieldToEventLoop()
        stageASliceStartedAt = Date.now()
      }
      const emailStartedAt = Date.now()

      const mailMessageId: string = mail.id || ''

      if (mailMessageId && existingMessageIds.has(mailMessageId)) continue

      // Headers first: they are cheap, and later gates need the subject and
      // sender to write a useful rejection log. extractEmailBody()
      // (base64 decode + DOM parse) is the expensive part of this stage and is
      // deferred until after every cheap gate has had its say.
      const headers = mail.payload?.headers || []
      const subjectHeader = headers.find((h: any) => h.name?.toLowerCase() === 'subject')
      const subject = subjectHeader?.value || ''
      const fromHeader = headers.find((h: any) => h.name?.toLowerCase() === 'from')
      const fromValue: string = fromHeader?.value || ''
      const senderDomainMatch = fromValue.match(/@([\w.-]+)>?/i)
      const senderDomain = senderDomainMatch ? senderDomainMatch[1].toLowerCase() : ''
      const isTrustedSender = isTrustedSenderDomain(senderDomain)

      // Date window. A missing internalDate used to fall back to Date.now(),
      // which always passes the check below regardless of how old the mail
      // actually is — a malformed API response could slip an out-of-window
      // email through. Reject and log it instead of failing open. This sits
      // after the header reads only so the rejection can name the sender and
      // subject; header parsing is cheap string work and gates nothing.
      if (!mail.internalDate) {
        bufferRejection('no_internal_date', senderDomain, subject, '')
        continue
      }
      const mailTime = Number(mail.internalDate)
      if (mailTime < startLimitTime) continue
      const mailDate = new Date(mailTime).toISOString().split('T')[0]

      const extractStartedAt = Date.now()
      const bodyText = extractEmailBody(mail)
      const extractMs = Date.now() - extractStartedAt
      // Strip security/legal footer boilerplate before ANY gate or the AI
      // prompt sees this text — footers were colliding with rejection
      // keywords (e.g. "has not been initiated by you") and silently
      // dropping genuine transaction emails.
      const stripStartedAt = Date.now()
      const strippedBodyText = stripBoilerplate(bodyText)
      const stripMs = Date.now() - stripStartedAt
      // These two lines are the entire expensive part of Stage A (base64
      // decode + DOM parse, then the boilerplate regexes); every gate around
      // them is cheap string work. Timing here therefore attributes a slow
      // email to the operation actually responsible, and names the message so
      // a pathological one can be found in Gmail instead of inferred from a
      // screenshot of a frozen spinner.
      const bodyCostMs = Date.now() - emailStartedAt
      if (bodyCostMs >= SLOW_EMAIL_WARN_MS) {
        // Naming the phase, not just the total. The previous version reported
        // "37410ms to read body" and nothing else, which left decode, HTML
        // strip and boilerplate strip all equally suspect — each had to be
        // benchmarked separately to be cleared. A stall should say which phase
        // it was so the next one is diagnosable rather than re-derived.
        const partCount = countMailParts(mail.payload)
        console.warn(
          `[emailScanner] slow email: ${bodyCostMs}ms total ` +
          `(decode+extract ${extractMs}ms, boilerplate ${stripMs}ms, ${partCount} parts) — ` +
          `${Math.round(bodyText.length / 1024)}KB from ${senderDomain || 'unknown sender'} — "${subject.substring(0, 80)}"`
        )
      }
      const fullText = `${subject} ${strippedBodyText} ${mail.snippet || ''}`
      const emailContentForParsing = fullText.substring(0, 2000)

      // Bulk marketing with no payment language anywhere is an advertisement,
      // not a receipt. Rejected BEFORE the AI call so newsletters never consume
      // the daily AI scan quota — a newsletter-heavy inbox would otherwise
      // exhaust it on junk and force genuine receipts onto the regex fallback.
      // Applies uniformly regardless of sender trust: banks send cashback/upsell
      // marketing from the same domains as their real transaction alerts, and it
      // carries the same List-Unsubscribe signal any other bulk mail does — a
      // trusted-sender exemption here would let that marketing straight through.
      // Genuine receipts still bypass this gate (they carry no bulk markers).
      // `bodyText` is passed unstripped and untruncated on purpose — opt-out
      // text lives in footers, past where the other gates stop reading.
      const isBulkMail = isBulkMarketingEmail(mail.payload?.headers || [], bulkScanText(bodyText))
      if (isBulkMail && !hasPaymentAssertion(emailContentForParsing)) {
        bufferRejection('bulk_mail_no_payment_evidence', senderDomain, subject, subject.substring(0, 120))
        continue
      }

      candidates.push({
        mail,
        mailMessageId,
        mailDate,
        bodyText,
        strippedBodyText,
        subject,
        fromValue,
        senderDomain,
        isTrustedSender,
        emailContentForParsing,
        isBulkMail,
      })
    }

    // ── Stage B — batched AI classification ──────────────────────────
    // One Gemini call per AI_BATCH_SIZE emails instead of one per email, with
    // a small number of batches in flight at once. This is what takes a
    // 50-email scan from ~100-160s of serial round trips down to ~15-25s.
    checkpoint(`analyzing ${candidates.length} emails`)
    emitProgress({ phase: 'analyzing', current: 0, total: candidates.length })
    const aiVerdicts = await classifyCandidatesWithAI(candidates, askAIBatch, askAI, categoryNames, emitProgress)

    // ── AI health ────────────────────────────────────────────────────
    // A null verdict means "the AI had no opinion on this email", and every
    // layer below is built to shrug that off and fall through to the regex
    // ladder. That per-email tolerance is deliberate and stays (guardrail 3) —
    // but it also made a TOTAL outage indistinguishable from a quiet day.
    //
    // It is not hypothetical: Google retired gemini-2.0-flash on 1 June 2026,
    // every call 404'd from then on, and the scanner reported perfect success
    // for ten weeks while classifying every single email with regex alone. The
    // only visible symptom was that the output quietly got worse.
    //
    // A healthy classifier essentially never abstains on ALL of them. So that
    // exact condition is recorded on the scan log, where the user can see it.
    const aiNoVerdictCount = candidates.filter((c) => !aiVerdicts.get(c.mailMessageId)).length
    const aiUnavailable = candidates.length > 0 && aiNoVerdictCount === candidates.length
    if (aiUnavailable) {
      console.error(
        `[emailScanner] AI classification returned no verdict for any of ${candidates.length} emails — ` +
        `falling back to regex matching for the whole scan. Check the GEMINI_MODEL configuration and /api/gemini-proxy logs.`
      )
    }

    /**
     * Notes worth showing the user on an otherwise successful scan. Kept in
     * one place because the scan log is written from several exits.
     */
    const buildScanNote = (): string | null => {
      const notes: string[] = []
      if (aiUnavailable) {
        notes.push(
          `${AI_UNAVAILABLE_NOTE} All ${candidates.length} email(s) were categorised by fallback matching, ` +
          `which is less accurate. Transactions were still captured.`
        )
      }
      if (lowConfidencePendingCount > 0) {
        notes.push(
          `${lowConfidencePendingCount} email(s) added as pending (low confidence). ` +
          `Samples: ${lowConfidenceEmailsDetails.join('; ')}`
        )
      }
      return notes.length > 0 ? notes.join(' ') : null
    }

    // ── Stage C — per-email interpretation ───────────────────────────
    // Unchanged logic: take the AI verdict (or its absence) and run the same
    // AI-result handling and regex ladder as before. Everything here is cheap
    // and stays sequential so accumulation order is deterministic.
    let stageCProcessed = 0
    let stageCSliceStartedAt = Date.now()
    for (const candidate of candidates) {
      // Same macrotask yield as Stage A, and needed for the same reason. The
      // `await absorbIntoExistingPayment(...)` below looks like it yields, but
      // on the common path (no merge partner found) it resolves synchronously,
      // which only queues a MICROtask — and browsers paint between macrotasks,
      // not microtasks. Without this, Stage C blocks exactly as Stage A did,
      // while doing the heavier work of the full regex ladder per email.
      stageCProcessed++
      if (Date.now() - stageCSliceStartedAt >= STAGE_YIELD_BUDGET_MS) {
        checkpoint(`interpreting email ${stageCProcessed} of ${candidates.length}`)
        emitProgress({ phase: 'analyzing', current: stageCProcessed, total: candidates.length })
        await yieldToEventLoop()
        stageCSliceStartedAt = Date.now()
      }

      // `mail` and `strippedBodyText` are deliberately not destructured here:
      // both are consumed in Stage A (header/body extraction) and Stage B (the
      // AI prompt), and nothing in Stage C reads them.
      const {
        mailMessageId, mailDate, bodyText,
        subject, fromValue, senderDomain, isTrustedSender,
        emailContentForParsing, isBulkMail,
      } = candidate

      const isHardAccepted = HARD_ACCEPT_SUBJECT_PATTERNS.some(p => p.test(subject))

      let parsedTxn: TransactionInsert | null = null
      let aiConfidentReject = false

      {
        {
          const aiResult = aiVerdicts.get(mailMessageId) ?? null
          if (aiResult) {
            if (aiResult.is_transaction && aiResult.amount && aiResult.amount > 0) {
              if (aiResult.reference_id && existingRefIds.has(aiResult.reference_id)) {
                // Logged rather than dropped silently: a reference-id collision
                // is the one rejection a user is most likely to dispute ("my
                // transaction is missing"), and the audit trail is the only
                // tool for answering that.
                bufferRejection('duplicate_reference_id', senderDomain, subject, `ref=${aiResult.reference_id}`, mailMessageId)
                continue
              }

              const resolvedMerchant = aiResult.merchant || 'Other'
              let ruleResult
              try {
                ruleResult = applyMerchantRulesFromRows(merchantRules, resolvedMerchant, bodyText, aiResult.category || fallbackCategoryName)
              } catch {
                ruleResult = { category: aiResult.category || fallbackCategoryName, approval_status: 'pending', confidence: aiResult.confidence_score }
              }

              // The prompt tells the model to score 0-59 for "uncertain cases
              // (these will be reviewed or rejected)", but this call site never
              // read the score. Honour that contract: still insert (never
              // silently drop), but pin it to pending explicitly here rather
              // than relying on applyMerchantRulesFromDB's invariant.
              const aiLowConfidence =
                typeof aiResult.confidence_score === 'number' && aiResult.confidence_score < 60
              if (aiLowConfidence) {
                bufferRejection('ai_low_confidence', senderDomain, subject, `confidence=${aiResult.confidence_score}`)
              }
              const approval_status = aiLowConfidence ? 'pending' : ruleResult.approval_status

              const resolvedCategory = (categoryNames.length > 0 && !categoryNames.includes(ruleResult.category))
                ? fallbackCategoryName
                : ruleResult.category

              parsedTxn = {
                user_id: user.id,
                amount: aiResult.amount,
                // The model reports a bare number for any currency, so an
                // unstated currency must fall back explicitly rather than
                // being left undefined and defaulted by the database.
                currency: aiResult.currency || DEFAULT_CURRENCY,
                type: aiResult.transaction_type || 'debit',
                category: resolvedCategory,
                merchant: resolvedMerchant,
                description: aiResult.description || `${resolvedMerchant} Transaction`,
                date: aiResult.date || mailDate,
                source: 'email',
                approval_status: approval_status as 'approved' | 'pending' | 'rejected',
                category_confirmed_at: approval_status === 'approved' ? null : undefined,
                reference_id: aiResult.reference_id,
                payment_mode: (aiResult.payment_mode || 'unknown') as any,
                card_issuer: aiResult.card_issuer,
                card_brand: aiResult.card_brand,
                transaction_time: aiResult.transaction_time,
                confidence_score: aiResult.confidence_score,
                event_type: aiResult.transaction_type || 'debit',
                email_message_id: mailMessageId || null,
              }
            } else {
              // AI returned a result but classified this as a non-transaction (or
              // couldn't extract an amount) — don't drop the email outright, since
              // the AI misclassifies oddly-formatted bank alerts. Let it fall
              // through to the regex heuristic engine below as a second opinion,
              // unless the AI explicitly and confidently said this isn't a
              // transaction at all (is_transaction === false), which we still trust.
              aiConfidentReject = aiResult.is_transaction === false
            }
          }
        }
      }

      if (aiConfidentReject && !parsedTxn && !isHardAccepted) {
        bufferRejection('ai_confident_reject', senderDomain, subject, '')
        continue
      }

      if (!parsedTxn) {
        const isHardRejected = !isHardAccepted && HARD_REJECT_SUBJECT_PATTERNS.some(p => p.test(subject))
        if (isHardRejected) {
          bufferRejection('hard_reject_subject', senderDomain, subject, subject)
          continue
        }

        const gateResult = evaluateRegexGates(subject, emailContentForParsing, isHardAccepted)
        if (gateResult.rejected) {
          bufferRejection(gateResult.gate!, senderDomain, subject, gateResult.snippet || '')
          continue
        }

        // Currency-aware (R11). Previously this only recognised rupee markers,
        // so a foreign charge either found no amount at all or — on the AI
        // path — was stored as a bare number and rendered as rupees.
        const amountMatches = extractAmountMatches(emailContentForParsing)

        if (amountMatches.length === 0) {
          // R12: bills and premiums whose amount lives only in a PDF or an
          // image are skipped, not OCR'd. Logging the skip changes nothing the
          // user has to act on, but it puts the cost of that decision in the
          // rejection audit trail so it can be measured later instead of
          // guessed at. This path used to be a bare `continue` — the one
          // rejection point in the file that left no trace.
          bufferRejection('no_amount_in_body', senderDomain, subject, subject.substring(0, 120))
          continue
        }

        const filteredAmounts = amountMatches.filter(m => {
          const preStart = Math.max(0, m.index - 80)
          const precedingText = emailContentForParsing.substring(preStart, m.index).toLowerCase()
          const postEnd = Math.min(emailContentForParsing.length, m.index + m.text.length + 50)
          const succeedingText = emailContentForParsing.substring(m.index + m.text.length, postEnd).toLowerCase()
          const contextWindow = `${precedingText} ${m.text.toLowerCase()} ${succeedingText}`
          const isPaymentOrPaidAmount = /\b(?:payment\s*(?:is|was|has\s+been)?\s*(?:of|received|successful|done|completed|towards|credited|processed|confirmed)?|paid|received|debited|spent|credited)\b/i.test(contextWindow)

          if (isPaymentOrPaidAmount) {
            return !(/avail(?:able)?\s+limit|credit\s+limit|reward\s+points/i.test(precedingText) ||
              /avail(?:able)?\s+limit|reward\s+points/i.test(succeedingText))
          }

          return !(/bal(?:ance)?|avail(?:able)?|limit|outstanding|ledger|total\s+due|minimum\s+due|reward|cashback\s+of|earn|bonus/i.test(precedingText) ||
            /bal(?:ance)?|avail(?:able)?|limit|outstanding|ledger|reward|bonus/i.test(succeedingText))
        })

        if (filteredAmounts.length === 0) {
          // Amounts were present but every one sat next to balance/limit/reward
          // wording, so none of them represents money that moved. Distinct from
          // no_amount_in_body, and worth telling apart in the audit trail.
          bufferRejection('only_balance_or_reward_amounts', senderDomain, subject, subject.substring(0, 120))
          continue
        }

        // `payment(?!s\b)` excludes the plural "Payments" section header
        // (a false match that used to win the amount-proximity tie-break
        // against real amounts in receipt-shaped emails) while still
        // matching genuine singular uses like "payment of Rs.500" or
        // "Payment received".
        const txKeywordsRe = /debited|spent|paid|withdrawn|txn|charged|payment(?!s\b)|credited|received|added|refund|transfer|neft|imps|rtgs/i
        let amount = filteredAmounts[0].value
        let resolvedMatch = filteredAmounts[0]

        if (filteredAmounts.length > 1) {
          let minDistance = Infinity
          filteredAmounts.forEach((m) => {
            const ctx = emailContentForParsing.substring(Math.max(0, m.index - 80), Math.min(emailContentForParsing.length, m.index + m.text.length + 80))
            const kw = ctx.match(txKeywordsRe)
            if (kw && kw.index !== undefined) {
              const distance = Math.abs(kw.index - (m.index - Math.max(0, m.index - 80)))
              if (distance < minDistance) { minDistance = distance; amount = m.value; resolvedMatch = m }
            }
          })
        }

        if (isNaN(amount) || amount <= 0) {
          bufferRejection('unusable_amount', senderDomain, subject, `amount=${amount}`, mailMessageId)
          continue
        }

        // Take the currency from the amount that actually won, so a foreign
        // charge is never quietly filed as rupees.
        const currency = resolvedMatch.currency

        const winStart = Math.max(0, resolvedMatch.index - 120)
        const winEnd = Math.min(emailContentForParsing.length, resolvedMatch.index + resolvedMatch.text.length + 120)
        const windowContent = emailContentForParsing.substring(winStart, winEnd).toLowerCase()
        const lowerContent = emailContentForParsing.toLowerCase()

        // Second form of the pre-AI gate, now that an amount exists. Catches
        // bulk mail that mentions payments somewhere in an article but whose
        // *amount* is editorial — a share price or an advertised list price.
        if (isBulkMail && !hasPaymentAssertion(windowContent)) {
          bufferRejection('bulk_mail_no_payment_near_amount', senderDomain, subject, `amount=${amount}`)
          continue
        }

        const debitWords = [
          'debited', 'debited for', 'spent', 'paid', 'paid to', 'withdrawn', 'charged',
          'payment to', 'sent to', 'transfer to', 'purchased at', 'debit',
          'order placed', 'checkout', 'billed', 'invoice', 'bill payment', 'payment received',
          'card payment', 'payment towards', 'payment for', 'payment of', 'towards card', 'towards credit card',
          'payment was successful', 'payment is successful', 'payment successful', 'bill payment successful',
          'credit card bill payment', 'credit card payment', 'card bill payment'
        ]
        const creditWords = ['credited', 'credited to', 'received', 'received from', 'added', 'refund', 'refunded', 'cashback', 'deposited', 'salary', 'credit', 'reversed']

        const FALSE_CREDIT_RECEIVED = /received\s+(?:your\s+)?(?:order|payment)|order\s+received|payment\s+received|we\s+(?:have\s+)?received\s+your|received\s+at/i
        // Mirrors FALSE_CREDIT_RECEIVED: "invoice" in debitWords is meant to
        // catch genuine invoice/bill language ("Invoice #1234 generated,
        // amount debited"), but boilerplate disclaimers like "is not a tax
        // invoice" (e.g. ride-receipt fine print) false-match it as a debit
        // signal. This guard only suppresses that negated phrasing — a bare
        // "invoice" mention still scores normally.
        const FALSE_DEBIT_INVOICE = /not\s+an?\s+(?:tax\s+)?invoice/i

        let debitScore = 0, creditScore = 0
        debitWords.forEach(w => {
          if (w === 'invoice' && FALSE_DEBIT_INVOICE.test(windowContent)) return
          if (windowContent.includes(w)) debitScore += 10
        })
        creditWords.forEach(w => {
          if (w === 'received' && FALSE_CREDIT_RECEIVED.test(windowContent)) return
          if (windowContent.includes(w)) creditScore += 10
        })

        if (debitScore === 0 && creditScore === 0) {
          debitWords.forEach(w => {
            if (w === 'invoice' && FALSE_DEBIT_INVOICE.test(lowerContent)) return
            if (lowerContent.includes(w)) debitScore += 5
          })
          creditWords.forEach(w => {
            if (w === 'received' && FALSE_CREDIT_RECEIVED.test(lowerContent)) return
            if (lowerContent.includes(w)) creditScore += 5
          })
        }

        // No debit/credit keyword anywhere near the amount — this used to be a
        // silent `continue` with no logRejection call, the one rejection point
        // in this file that left no trace. A receipt-shaped email (Uber trip,
        // Zomato order) legitimately has no such keyword, so instead of
        // dropping it, fall through: txType below naturally resolves to
        // 'debit' (creditScore is not > debitScore when both are 0) and
        // debitCreditClear is naturally false (|0-0| < 10), which correctly
        // marks the direction as inferred, not keyword-confirmed. The email
        // still has to clear every gate above and the confidence check below.
        const hadNoDirectionSignal = debitScore === 0 && creditScore === 0
        if (hadNoDirectionSignal) {
          bufferRejection('no_debit_credit_signal', senderDomain, subject, `amount=${amount}`)
        }

        let txType: 'debit' | 'credit' = creditScore > debitScore ? 'credit' : 'debit'
        const debitCreditClear = Math.abs(debitScore - creditScore) >= 10

        if (amount < 10 && txType === 'credit') {
          if (!/salary|refund|reversed/i.test(emailContentForParsing)) {
            bufferRejection('trivial_credit_amount', senderDomain, subject, `amount=${amount}`, mailMessageId)
            continue
          }
        }
        if (amount < 1) {
          bufferRejection('amount_below_one', senderDomain, subject, `amount=${amount}`, mailMessageId)
          continue
        }

        const paymentMode = detectPaymentMode(emailContentForParsing)
        const cardLast4 = extractCardLast4(emailContentForParsing)
        let cardIssuer = extractBankName(emailContentForParsing) || null
        if (!cardIssuer && cardLast4 && cardMap[cardLast4]) {
          cardIssuer = cardMap[cardLast4]
        }

        // Anchored to the subject and the amount's neighbourhood, never the
        // whole body: a real merchant sits next to its amount ("Rs.250 debited
        // at OLA CABS") or in the subject ("Your trip with Uber"), whereas a
        // brand mentioned in an article tens of KB away is not the merchant.
        // Scanning fullText is how a news story about Ola Electric became an
        // "Ola Cab Ride" transaction.
        const knownMerchant = extractMerchantFromSnippet(`${subject} ${windowContent}`)
        // Same reasoning as knownMerchant above, applied to the dynamic
        // patterns: read the amount's own neighbourhood first (case preserved —
        // two of the patterns key off capitals), and only widen to the whole
        // parsed body when that finds nothing. Scanning the full body first is
        // how a bank's helpline and fraud-reporting footer, which sits far from
        // the amount, got mistaken for the payee.
        const windowRaw = emailContentForParsing.substring(winStart, winEnd)
        const dynamicMerchant =
          extractDynamicMerchant(windowRaw) || extractDynamicMerchant(emailContentForParsing)
        const subjectMerchant = subject ? extractDynamicMerchant(subject) : ''

        let merchant = ''
        let category = fallbackCategoryName
        let description = ''

        if (knownMerchant) {
          merchant = knownMerchant.name; category = knownMerchant.category; description = knownMerchant.description
        } else if (dynamicMerchant) {
          merchant = dynamicMerchant
        } else if (subjectMerchant) {
          merchant = subjectMerchant
        }

        if (txType === 'credit' && knownMerchant && knownMerchant.name !== 'Salary Credit') {
          const hasRefundOrReversal = /refund|reversed|cashback|refunded|returned|chargeback/i.test(emailContentForParsing)
          if (!hasRefundOrReversal) {
            txType = 'debit'
          }
        }

        if (!merchant) {
          if (subject) {
            const subjectKnown = extractMerchantFromSnippet(subject)
            if (subjectKnown) { merchant = subjectKnown.name; category = subjectKnown.category; description = subjectKnown.description }
          }
          if (!merchant && fromValue) {
            const displayNameMatch = fromValue.match(/^([^<]+)</)
            if (displayNameMatch) {
              const senderName = displayNameMatch[1].trim()
              if (senderName.length > 2 && !/alert|noreply|no-reply|notification|update|info|support|bank/i.test(senderName)) {
                merchant = senderName
                  .replace(/\b(bank|alerts?|notifications?|noreply)\b/gi, '').trim()
                  .split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
              }
            }
          }
        }

        const isGenericMerchant = !merchant || merchant.length < 2 || GENERIC_MERCHANT_PATTERNS.some(p => p.test(merchant))
        if (isGenericMerchant) {
          const bankName = cardIssuer || extractBankName(emailContentForParsing)
          if (bankName) {
            merchant = bankName.toLowerCase().includes('bank') ? bankName : `${bankName} Bank`
          } else {
            merchant = txType === 'credit' ? 'Incoming Credit' : 'Bank Transaction'
          }
        }
        if (!description) description = generateDescription(merchant, emailContentForParsing, txType)

        const refMatch = emailContentForParsing.match(
          /(?:UPI\s*(?:Ref(?:\.?\s*No\.?)?|Txn\s*ID|Transaction\s*ID)[:\s]*([0-9]{10,20}))|(?:(?:Ref(?:\.?\s*No\.?)?|RefNo|Transaction\s*(?:ID|Ref))[:\s]*([0-9]{6,20}))/i
        )
        const reference_id = refMatch ? (refMatch[1] || refMatch[2]) : null

        if (reference_id && existingRefIds.has(reference_id)) {
          bufferRejection('duplicate_reference_id', senderDomain, subject, `ref=${reference_id}`, mailMessageId)
          continue
        }

        let ruleResult: RuleMatchResult
        try {
          ruleResult = applyMerchantRulesFromRows(merchantRules, merchant, emailContentForParsing, category)
        } catch {
          ruleResult = applyMerchantRules(merchant, emailContentForParsing, category)
        }

        const finalApprovalStatus = ruleResult.approval_status

        const finalCategory = (categoryNames.length > 0 && !categoryNames.includes(ruleResult.category))
          ? fallbackCategoryName
          : ruleResult.category
        const approval_status = finalApprovalStatus
        const eventType = classifyEventType(emailContentForParsing, txType, finalCategory)

        const confidence = computeConfidence({
          trustedSender: isTrustedSender,
          hardAcceptSubject: isHardAccepted,
          hasTransactionKeyword: (debitScore + creditScore) >= 20,
          hasAmount: true,
          hasMerchant: !isGenericMerchant,
          hasPaymentMode: paymentMode !== 'unknown',
          hasReferenceId: !!reference_id,
          // A rupee threshold — meaningless against USD or EUR magnitudes.
          isLargeAmount: isHomeCurrency(currency) && amount > 100000,
          debitCreditClear,
        })

        // Below-threshold confidence used to drop the email outright. It now
        // still gets logged (so the audit trail in email_scan_rejections is
        // unchanged), but inserts as a pending transaction instead of being
        // discarded — approval_status is already guaranteed 'pending' here
        // (applyMerchantRulesFromDB/applyMerchantRules never return
        // 'approved'), so a low-confidence guess costs the user one
        // dismiss-tap on the Pending page rather than a permanently missing
        // transaction.
        if (confidence < 65) {
          lowConfidencePendingCount++
          if (lowConfidenceEmailsDetails.length < 5) {
            lowConfidenceEmailsDetails.push(`${senderDomain || 'unknown'}|"${subject.substring(0, 30)}"|Conf:${confidence}`)
          }
          bufferRejection('confidence_below_65', senderDomain, subject, `confidence=${confidence}`)
        }

        parsedTxn = {
          user_id: user.id,
          amount,
          currency,
          type: txType,
          category: finalCategory,
          merchant,
          description,
          date: mailDate,
          source: 'email',
          approval_status,
          category_confirmed_at: approval_status === 'approved' ? null : undefined,
          reference_id,
          payment_mode: paymentMode,
          card_issuer: cardIssuer,
          confidence_score: confidence,
          event_type: eventType,
          email_message_id: mailMessageId || null,
        }
      }

      if (parsedTxn) {
        // R10: a bank alert and the merchant's receipt for one payment become
        // one transaction, not two.
        if (await absorbIntoExistingPayment(parsedTxn)) {
          mergedDuplicateCount++
          continue
        }

        transactionsToInsert.push(parsedTxn)
        pendingFlush.push(parsedTxn)
        // Write as we go. Previously nothing was saved until the whole loop
        // finished, so a scan that timed out at email 40 of 50 saved NOTHING
        // and the retry re-paid the AI cost for every one of them. Flushing in
        // chunks means an interrupted scan keeps what it already found, and
        // the retry skips those by dedup.
        if (pendingFlush.length >= INSERT_CHUNK_SIZE) await flushPending()
      }
    }

    await flushPending()

    if (transactionsToInsert.length === 0) {
      const { data: log } = await supabase
        .from('email_scan_logs')
        .insert({
          id: scanLogId,
          user_id: user.id,
          emails_processed: validDetails.length,
          transactions_found: 0,
          status: 'success',
          scan_mode: scanMode,
          error_message: buildScanNote(),
        })
        .select().single()
      // Only valid once the row above exists — the FK this satisfies is the
      // whole reason rejections are buffered instead of written as they occur.
      await flushRejections()
      // mergedDuplicateCount can be non-zero here: every email may have been
      // folded into a transaction an earlier scan already stored, which is a
      // successful outcome, not an empty scan.
      return {
        data: { transactions: [], log: log as EmailScanLog, autoApprovedCount: 0, mergedDuplicateCount },
        error: null,
      }
    }

    // Rows are already written — Stage C flushed them in chunks as it went.

    try {
      // Cards sync disabled
    } catch (cardErr) {
      console.warn('Card upsert failed (disabled):', cardErr)
    }

    const { data: scanLog, error: logError } = await supabase
      .from('email_scan_logs')
      .insert({
        id: scanLogId,
        user_id: user.id,
        emails_processed: validDetails.length,
        transactions_found: transactionsToInsert.length,
        status: 'success',
        scan_mode: scanMode,
        error_message: buildScanNote(),
      })
      .select().single()

    if (logError) throw logError
    await flushRejections()

    const autoApprovedCount = transactionsToInsert.filter((t) => t.approval_status === 'approved').length

    return {
      data: {
        transactions: insertedTxns,
        log: scanLog as EmailScanLog,
        autoApprovedCount,
        lowConfidencePendingCount,
        mergedDuplicateCount,
      },
      error: null,
    }
  } catch (err: any) {
    console.error('Error scanning Gmail:', err)

    let errorMessage: string
    if (err.message === 'TOKEN_EXPIRED') {
      errorMessage = 'Your Gmail connection expired. Please click "Connect Gmail Inbox" on the Pending Alerts page to get a fresh token and try again.'
    } else if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
      errorMessage = 'Could not reach Google APIs. Check your internet connection or disable any ad-blockers / Brave shields that may be blocking Google requests.'
    } else {
      errorMessage = err.message || 'Gmail scan failed. Please try again.'
    }

    // Name the stage. Without this a failed scan log says only that something
    // went wrong, and the stage has to be guessed from a screenshot.
    errorMessage += ` (stage: ${currentStage})`

    // Incremental flushing means a failure no longer implies nothing was
    // saved. Say so, otherwise the user re-runs assuming they lost everything.
    if (insertedTxns.length > 0) {
      const n = insertedTxns.length
      errorMessage += ` ${n} transaction${n === 1 ? '' : 's'} found before the error ${n === 1 ? 'was' : 'were'} already saved.`
    }

    if (!opts?.userId) {
      await supabase.from('email_scan_logs').insert({
        id: scanLogId,
        user_id: user.id,
        emails_processed: 0,
        transactions_found: 0,
        status: 'failed',
        scan_mode: scanMode,
        error_message: errorMessage,
      })
      await flushRejections()
    }
    return { data: null, error: new Error(errorMessage) }
  }
}

/**
 * Calculate the next scheduled refresh time (always 6:00 AM today or tomorrow)
 */
export function getNextRefreshTime(dailyScanTime = '06:00'): Date {
  const [hour, minute] = dailyScanTime.split(':').map(Number)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour || 6, minute || 0, 0, 0)
  if (now.getTime() >= next.getTime()) next.setDate(next.getDate() + 1)
  return next
}

/**
 * Calculate the last scheduled refresh time (always target scan time today or yesterday)
 */
export function getLastScheduledRefreshTime(dailyScanTime = '06:00'): Date {
  const [hour, minute] = dailyScanTime.split(':').map(Number)
  const now = new Date()
  const todayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour || 6, minute || 0, 0, 0)
  if (now.getTime() >= todayTarget.getTime()) return todayTarget
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), hour || 6, minute || 0, 0, 0)
}
