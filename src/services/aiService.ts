// ============================================
// AI Service — Gemini API Integration
// Generates personalised financial insights
// Falls back to rule-based insights if API key
// is absent or request fails
// ============================================

import { formatCurrency, fetchWithTimeout, toISODateLocal } from '../utils/index.js'
import { supabase } from './supabase.js'
import { SUPPORTED_CURRENCY_CODES } from './currency.js'

const GEMINI_PROXY_URL = '/api/gemini-proxy'

/**
 * Must sit ABOVE the proxy's own 30s AbortController and BELOW the platform's
 * 60s `maxDuration`, so the proxy reports its own clean timeout before this
 * gives up, and the platform never has to kill anything.
 */
const GEMINI_PROXY_TIMEOUT_MS = 35000

/** Calls our server-side Gemini proxy so the API key never reaches the client bundle. */
async function callGeminiProxy(body: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')

  const response = await fetchWithTimeout(
    GEMINI_PROXY_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    },
    GEMINI_PROXY_TIMEOUT_MS
  )

  if (!response.ok) {
    // The proxy sends a `code` for faults an operator has to fix (a retired
    // model id, most importantly). Surface it verbatim instead of collapsing
    // every failure to a bare status — the whole reason the 2.0-flash
    // shutdown went unnoticed for 10 weeks is that its 404 arrived here
    // stripped of any explanation and was then treated as routine.
    const detail = await response.json().catch(() => null) as { error?: string; code?: string } | null
    if (detail?.code === 'MODEL_NOT_FOUND') {
      console.error(`[AI] ${detail.error}`)
      throw new Error(`MODEL_NOT_FOUND: ${detail.error}`)
    }
    throw new Error(`Gemini proxy error: ${response.status}`)
  }
  return response.json()
}

/**
 * Generation settings shared by both scan prompts.
 */
// NO thinkingConfig here, deliberately.
//
// `thinkingConfig: { thinkingBudget: 0 }` was added to stop the model spending
// its whole maxOutputTokens budget reasoning and returning an empty string.
// Reasonable intent, fatal in practice: gemini-3.5-flash-lite rejects a budget
// of 0 outright with 400 INVALID_ARGUMENT. Verified directly against the API —
// budgets of -1 and 128 are accepted, only 0 is refused.
//
// That took AI classification down completely, because `callGeminiWithFallback`
// only walks to the next candidate model on a 404. A 400 is treated as that
// model's real answer, so an invalid argument fails every call with no failover
// and no recovery — the scan just silently drops to the regex ladder.
//
// Omitting the field is safer than guessing a budget: it is model-specific,
// a wrong value is unrecoverable, and the original worry does not materialise —
// measured finishReason is STOP with well-formed JSON at both 500 and 2000
// tokens. If an empty response ever does show up, raise maxOutputTokens rather
// than reintroducing this field.
const SCAN_GENERATION_BASE = {
  temperature: 0.1,
  topP: 0.9,
  responseMimeType: 'application/json',
} as const

export interface FinancialContext {
  month: string
  totalIncome: number
  totalExpenses: number
  savings: number
  savingsRate: number
  needsPct: number
  wantsPct: number
  savingsPct: number
  healthScore: number
  topCategory: string
  topCategoryAmount: number
  topCategoryPct: number
  momTrend: { pct: number; increased: boolean; prevLabel: string } | null
  subscriptionBurn: number
  emergencyMonths: number
  categoryBreakdown: Array<{ category: string; amount: number; percentage: number }>
}

/** Generate AI-powered financial insights via Gemini */
export async function generateAIInsights(ctx: FinancialContext): Promise<{
  insights: string[]
  alerts: string[]
  source: 'gemini' | 'rule-based'
}> {
  try {
    const prompt = buildPrompt(ctx)

    const data = await callGeminiProxy({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.9,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      purpose: 'insights',
    })
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = parseGeminiResponse(text)
    if (parsed.insights.length > 0) {
      return { ...parsed, source: 'gemini' }
    }

    return { ...generateRuleBasedInsights(ctx), source: 'rule-based' }
  } catch (err) {
    console.warn('[AI] Gemini request failed, using rule-based fallback:', err)
    return { ...generateRuleBasedInsights(ctx), source: 'rule-based' }
  }
}

function buildPrompt(ctx: FinancialContext): string {
  const fmt = (n: number) => formatCurrency(Math.round(n))
  const catList = ctx.categoryBreakdown
    .slice(0, 5)
    .map((c) => `${c.category}: ${fmt(c.amount)} (${c.percentage.toFixed(0)}%)`)
    .join(', ')

  return `You are a senior Chartered Accountant and personal CFO for an Indian professional. Analyse this user's financial data for ${ctx.month} and provide highly personalised, specific, actionable advice.

FINANCIAL DATA:
- Monthly Income: ${fmt(ctx.totalIncome)}
- Total Expenses: ${fmt(ctx.totalExpenses)}
- Net Savings: ${fmt(ctx.savings)} (${ctx.savingsRate.toFixed(0)}% savings rate)
- 50/30/20 Split: Needs ${ctx.needsPct}% | Wants ${ctx.wantsPct}% | Savings ${ctx.savingsPct}%
- Financial Health Score: ${ctx.healthScore}/100
- Top Expense Category: ${ctx.topCategory} — ${fmt(ctx.topCategoryAmount)} (${ctx.topCategoryPct.toFixed(0)}% of expenses)
- Category Breakdown: ${catList}
- Subscription Burn Rate: ${fmt(ctx.subscriptionBurn)}/month
- Emergency Fund Coverage: ${ctx.emergencyMonths} months
${ctx.momTrend ? `- Month-over-Month Expense Change: ${ctx.momTrend.increased ? '+' : '-'}${Math.abs(ctx.momTrend.pct).toFixed(0)}% vs ${ctx.momTrend.prevLabel}` : ''}

INSTRUCTIONS:
1. Generate exactly 3 INSIGHTS (specific, personal, data-driven — not generic advice)
2. Generate ALERTS only for genuine financial risks (0-2 alerts max)
3. Each insight must reference the user's actual numbers
4. Use Indian financial context (SIPs, LIC, FD, GST, ITR, etc.) where relevant
5. Be direct, like a trusted CA speaking to a client — not a chatbot

Respond in this EXACT JSON format (no markdown, pure JSON):
{
  "insights": [
    "First specific insight with actual numbers...",
    "Second insight...",
    "Third insight..."
  ],
  "alerts": [
    "Alert if there is a genuine risk..."
  ]
}`
}

function parseGeminiResponse(text: string): { insights: string[]; alerts: string[] } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')
    const parsed = JSON.parse(jsonMatch[0])
    return {
      insights: Array.isArray(parsed.insights) ? parsed.insights.filter(Boolean) : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.filter(Boolean) : [],
    }
  } catch {
    return { insights: [], alerts: [] }
  }
}

export function generateRuleBasedInsights(ctx: FinancialContext): {
  insights: string[]
  alerts: string[]
} {
  const fmt = (n: number) => formatCurrency(Math.round(n))
  const insights: string[] = []
  const alerts: string[] = []

  if (ctx.savingsRate >= 20) {
    insights.push(
      `Excellent wealth accumulation velocity. Your ${ctx.savingsRate.toFixed(0)}% savings rate (${fmt(ctx.savings)}) this period significantly exceeds the 20% golden benchmark. Redirect this surplus into SIP top-ups or FD laddering to maximise compounding.`
    )
  } else if (ctx.savingsRate >= 10) {
    insights.push(
      `Your savings rate of ${ctx.savingsRate.toFixed(0)}% (${fmt(ctx.savings)}) is on track but has room to grow. Automating a SIP of ${fmt(ctx.totalIncome * 0.05)} more per month would bridge you to the 20% target within 3 months.`
    )
  } else {
    insights.push(
      `Your savings rate of ${Math.max(0, ctx.savingsRate).toFixed(0)}% (${fmt(Math.max(0, ctx.savings))}) is below the recommended 20%. Your discretionary spending is absorbing ${fmt(ctx.totalExpenses - ctx.totalIncome * 0.8)} more than optimal. Immediate budget caps on top categories needed.`
    )
  }

  if (ctx.topCategoryAmount > 0) {
    const potential = fmt(ctx.topCategoryAmount * 0.15)
    insights.push(
      `${ctx.topCategory.charAt(0).toUpperCase() + ctx.topCategory.slice(1)} is your largest expense absorber at ${fmt(ctx.topCategoryAmount)} (${ctx.topCategoryPct.toFixed(0)}% of total spend). A disciplined 15% reduction here would free up ${potential} — enough to fully fund a monthly SIP or build your emergency buffer faster.`
    )
  }

  if (ctx.emergencyMonths < 3) {
    insights.push(
      `Your emergency reserve covers only ${ctx.emergencyMonths} month(s) of expenses — dangerously low. The standard recommendation is 6 months (${fmt(ctx.totalExpenses * 6)}). Prioritise this before increasing discretionary spending.`
    )
  } else if (ctx.subscriptionBurn > ctx.totalIncome * 0.05) {
    insights.push(
      `Your subscription stack is costing ${fmt(ctx.subscriptionBurn)}/month — ${((ctx.subscriptionBurn / ctx.totalIncome) * 100).toFixed(0)}% of your income. Audit each service: cancel those unused for 30+ days and you could reclaim ${fmt(ctx.subscriptionBurn * 0.3)} monthly.`
    )
  } else if (ctx.momTrend) {
    insights.push(
      ctx.momTrend.increased
        ? `Your spending surged ${ctx.momTrend.pct.toFixed(0)}% compared to ${ctx.momTrend.prevLabel}. Identify the spike category and set a hard budget cap immediately to prevent this from becoming a habit.`
        : `Outstanding control — your expenses dropped ${Math.abs(ctx.momTrend.pct).toFixed(0)}% vs ${ctx.momTrend.prevLabel}. This trajectory, sustained for 6 months, would compound your savings by approximately ${fmt(Math.abs((ctx.momTrend.pct / 100) * ctx.totalExpenses) * 6)}.`
    )
  } else {
    insights.push(
      `Your emergency fund of ${ctx.emergencyMonths} month(s) is healthy. Consider channel-shifting the next salary increment directly into a liquid FD to hit 6 months coverage while maintaining daily cash flow.`
    )
  }

  if (ctx.needsPct > 60) {
    alerts.push(
      `Critical: Essential obligations consuming ${ctx.needsPct}% of income (target: <50%). Review fixed costs — negotiate rent, switch utility plans, or restructure EMIs.`
    )
  } else if (ctx.needsPct > 55) {
    alerts.push(
      `Essential expenses at ${ctx.needsPct}% of income — above the 50% safe threshold. This limits your savings headroom significantly.`
    )
  }

  if (ctx.wantsPct > 40) {
    alerts.push(
      `Discretionary spending at ${ctx.wantsPct}% of income (target: ≤30%). Your lifestyle inflation is eroding your compounding potential.`
    )
  }

  if (ctx.savingsPct < 5 && ctx.totalIncome > 0) {
    alerts.push(
      `Savings rate critically low at ${ctx.savingsPct}%. Without intervention, wealth accumulation will stall entirely.`
    )
  }

  return { insights, alerts }
}

export function detectAnomalies(
  transactions: Array<{ amount: number; category: string; date: string; merchant: string; type: string }>
): Array<{
  category: string
  thisMonth: number
  projectedMonth: number
  isProjection: boolean
  baseline: number
  spike: number
  merchant?: string
}> {
  const anomalies: Array<{
    category: string
    /** Actual spend recorded so far this month. */
    thisMonth: number
    /** Where that lands by month end at the current pace. Equals `thisMonth` on a finished month. */
    projectedMonth: number
    /** True while the month is still running, i.e. `projectedMonth` is an estimate. */
    isProjection: boolean
    baseline: number
    spike: number
    merchant?: string
  }> = []

  const now = new Date()
  const currentMonth = toISODateLocal(now).substring(0, 7)
  const monthlySpend: Record<string, Record<string, number>> = {}

  transactions
    .filter((t) => t.type === 'debit')
    .forEach((t) => {
      const month = t.date.substring(0, 7)
      if (!monthlySpend[month]) monthlySpend[month] = {}
      monthlySpend[month][t.category] = (monthlySpend[month][t.category] || 0) + Number(t.amount)
    })

  const currentSpend = monthlySpend[currentMonth] || {}
  const prevMonths = Object.keys(monthlySpend)
    .filter((m) => m < currentMonth)
    .sort()
    .slice(-3)

  if (prevMonths.length === 0) return anomalies

  // The baselines are whole months, so comparing a half-finished month against
  // them straight is not like-for-like — a real spike stays invisible until late
  // in the month, which defeats the point of an alert. Scale the month in
  // progress up to its month-end pace before comparing.
  //
  // The ramp over the first seven days is the same one getMoMTrend uses: on day
  // 2, dividing by 2 and multiplying by 30 turns a single rent payment into a
  // fifteen-fold "spike", so early in the month the projection is blended back
  // toward the raw figure.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysElapsed = Math.min(Math.max(1, now.getDate()), daysInMonth)
  const isProjection = daysElapsed < daysInMonth
  const rampWeight = Math.min(1, daysElapsed / 7)
  const project = (actual: number) => {
    if (!isProjection) return actual
    const atPace = (actual / daysElapsed) * daysInMonth
    return rampWeight * atPace + (1 - rampWeight) * actual
  }

  for (const [category, amount] of Object.entries(currentSpend)) {
    const prevAmounts = prevMonths.map((m) => monthlySpend[m]?.[category] || 0)
    const baseline = prevAmounts.reduce((a, b) => a + b, 0) / prevMonths.length
    if (baseline === 0) continue
    const projectedMonth = project(amount)
    const spike = ((projectedMonth - baseline) / baseline) * 100
    if (spike > 80 && projectedMonth - baseline > 1000) {
      anomalies.push({ category, thisMonth: amount, projectedMonth, isProjection, baseline, spike })
    }
  }

  return anomalies.sort((a, b) => b.spike - a.spike).slice(0, 3)
}

export function generateForecast(
  transactions: Array<{ amount: number; type: string; date: string; category: string }>
): Array<{
  month: string
  label: string
  forecastIncome: number
  forecastExpenses: number
  forecastSavings: number
  confidence: number
}> {
  const now = new Date()
  const monthlyData: Record<string, { income: number; expenses: number }> = {}

  // COMPLETED months only: the five months before this one.
  //
  // The month we are standing in is partial by definition, and it used to sit
  // in the weighted average carrying the HEAVIEST weight. With a flat
  // 1,00,000/mo income history, one 2,000 purchase on day 1 of a new month
  // dropped next month's forecast income to 44,074 and the three-month
  // forecast to 4,074.
  //
  // The window stops at month -5 rather than reaching back a full six: the
  // caller fetches from six months before *today*, so month -6 would only be
  // partly loaded and would read as an artificially cheap month — the same
  // defect at the other end of the window.
  for (let i = 5; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyData[key] = { income: 0, expenses: 0 }
  }

  transactions.forEach((t) => {
    const month = t.date.substring(0, 7)
    if (!monthlyData[month]) return
    if (t.type === 'credit') monthlyData[month].income += Number(t.amount)
    else monthlyData[month].expenses += Number(t.amount)
  })

  // Chronological by construction above. Recency weight is derived from a
  // month's position in THIS list, not from its index in the filtered list
  // below — indexing the filtered list meant a single month with no activity
  // shifted the weight of every month after it, moving the forecast by ~9%
  // on data that had not changed.
  const orderedKeys = Object.keys(monthlyData)
  const weightFor = (key: string) => 1 + orderedKeys.indexOf(key) * 0.5

  const months = Object.entries(monthlyData).filter(([, d]) => d.income > 0 || d.expenses > 0)
  if (months.length < 2) return []

  const totalWeight = months.reduce((sum, [key]) => sum + weightFor(key), 0)
  const avgIncome = months.reduce((sum, [key, d]) => sum + d.income * weightFor(key), 0) / totalWeight
  const avgExpenses =
    months.reduce((sum, [key, d]) => sum + d.expenses * weightFor(key), 0) / totalWeight

  // Per-month slope is the rise divided by the number of GAPS between the
  // samples, not by the sample count — /3 across three months understated a
  // real 10,000/month climb as 6,667.
  const recentMonths = months.slice(-3)
  const span = recentMonths.length - 1
  const incomeTrend =
    span > 0
      ? (recentMonths[recentMonths.length - 1][1].income - recentMonths[0][1].income) / span
      : 0
  const expenseTrend =
    span > 0
      ? (recentMonths[recentMonths.length - 1][1].expenses - recentMonths[0][1].expenses) / span
      : 0

  const forecast = []
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    const dampening = 1 - i * 0.1
    const forecastIncome = Math.max(0, avgIncome + incomeTrend * i * dampening)
    const forecastExpenses = Math.max(0, avgExpenses + expenseTrend * i * dampening)
    const confidence = Math.max(40, 85 - i * 15)
    forecast.push({
      month,
      label,
      forecastIncome,
      forecastExpenses,
      forecastSavings: forecastIncome - forecastExpenses,
      confidence,
    })
  }

  return forecast
}

export type CardBrand = 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners'

export interface AITransactionResult {
  is_transaction: boolean
  transaction_type: 'debit' | 'credit' | null
  amount: number | null
  /** ISO 4217 code. Absent or null means the app's home currency. */
  currency?: string | null
  merchant: string | null
  category: string | null
  description: string | null
  payment_mode:
    | 'upi'
    | 'credit_card'
    | 'debit_card'
    | 'net_banking'
    | 'wallet'
    | 'neft'
    | 'imps'
    | 'rtgs'
    | 'atm'
    | 'nach'
    | 'cheque'
    | 'unknown'
    | null
  card_issuer: string | null    // Bank name e.g. "HDFC", "SBI" — internal use only
  card_brand: CardBrand | null  // Card network e.g. "Visa", "Mastercard" — shown to user
  transaction_time: string | null // HH:MM format
  reference_id: string | null
  date: string | null
  confidence_score: number
}

/** Max characters of body text sent to the model, per email. */
const AI_BODY_CHAR_LIMIT = 1500

function buildCategoryListText(categoryNames?: string[]): string {
  return categoryNames && categoryNames.length > 0
    ? categoryNames.map((c) => `'${c}'`).join(', ')
    : `'Food & Dining', 'Groceries', 'Transport', 'Utilities & Bills', 'Shopping', 'Entertainment', 'Subscriptions', 'Salary', 'Travel', 'Health', 'Investments', 'Other'`
}

/**
 * The classification rules, shared verbatim by the single-email and batch
 * prompts so the two can never drift apart.
 *
 * Do not edit this text without a requirement that explicitly calls for it —
 * it encodes hard-won classification fixes, and `aiService.test.ts` pins
 * individual rules precisely so an accidental deletion fails the build.
 */
const STRICT_RULES_BLOCK = `STRICT RULES — set is_transaction to FALSE for ALL of:
- OTPs, login alerts, verification codes, security alerts
- Payment reminders (UPCOMING bills not yet paid), bill generation notices, due dates for future payments, upcoming scheduled debits
- Declined, failed, cancelled, or reversed transactions
- Promotional emails, cashback OFFERS (not credits), discount codes, coupons
- Subscription or product marketing showing pricing tiers, percentage discounts ("save 41%"), struck-through "was" prices, or "Subscribe Now"/"Upgrade Now"/"Choose your plan" calls to action — an advertisement for a purchase the reader has NOT made is not a receipt, and its prices are not transaction amounts
- Reward point NOTIFICATIONS (not actual money)
- Festival/sale announcements, limited-period offers
- Credit limit increase offers, pre-approved loan offers
- Balance update alerts, account balance notifications
- Auto-debit SCHEDULED notices (money not yet moved)
- Any email where money movement is in FUTURE tense ("will be debited", "scheduled for")
- Order confirmation / booking confirmation emails where actual charge is not yet confirmed
- Marketing for savings products, investment products, wallet top-up offers, or cashback promotions. This covers ADVERTISEMENTS only — an actual SIP debit, mutual-fund purchase, dividend credit, interest credit or insurance premium payment IS a completed transaction and must be captured
- Statements, summaries, or account overviews (with NO specific completed transaction reported)

ONLY set is_transaction to TRUE when money has ALREADY moved (past tense):
- Debited, credited, paid, transferred, withdrawn, charged, received (when bank is informing customer of credit/payment received), deposited, settled
- Completed Credit Card expenses and charges (e.g. "spent on card", "charged to card", "debited from credit card", "transaction alert for card")
- Completed Credit Card bill payments (e.g. "payment received towards credit card", "credit card bill payment successful", "payment of Rs X processed for card")`

/**
 * The extraction contract. `dateInstruction` differs between the single and
 * batch prompts (one email date vs "that email's own Date"), so it is a
 * parameter rather than baked in.
 */
function buildExtractionSpec(categoryListText: string, dateInstruction: string): string {
  return `If TRUE, extract:
- transaction_type: 'debit' (money out) or 'credit' (money in)
- amount: exact transaction amount as a number, in whatever currency the email states. Do NOT use balance or limit amounts.
- currency: ISO 4217 code for that amount — 'INR' for Rs/₹/Rupees, 'USD' for $, 'EUR' for €, 'GBP' for £, and so on. Use 'INR' when the email states no currency at all. NEVER convert the amount between currencies; report the number exactly as written alongside its own currency code.
- merchant: clean merchant/vendor name (e.g. 'Swiggy', 'Amazon', 'Airtel'). Strip suffixes like 'Ltd', 'Pvt', 'Private Limited'.
- category: one of ${categoryListText}
  - 'Transport' = day-to-day local commute: cabs/auto (Uber, Ola, Rapido), metro, bus, fuel/petrol/diesel, tolls (FASTag), parking, train tickets (IRCTC) for regular travel
  - 'Travel' = trip bookings and stays: flight tickets, hotels/OYO, travel agents (MakeMyTrip, Goibibo, Cleartrip, Yatra, EaseMyTrip), Airbnb, vacation packages
  - Do NOT default ambiguous mobility spend to 'Travel' — only use 'Travel' for flights, hotels, or trip-booking platforms; everyday transit and fuel are always 'Transport'
  - The exact category names above always take priority — these are conceptual hints only; if the user's category list uses different names, match to the closest one from the list instead.
- description: short clear description (e.g. 'Swiggy food order', 'Airtel bill payment')
- payment_mode: one of 'upi', 'credit_card', 'debit_card', 'net_banking', 'wallet', 'neft', 'imps', 'rtgs', 'atm', 'nach', 'cheque', 'unknown'
- card_issuer: issuing bank name only if clearly stated (e.g. 'HDFC', 'SBI', 'ICICI', 'Axis'). null if not found. Do NOT include account numbers or card numbers.
- card_brand: card network only if explicitly mentioned — one of 'Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners'. null if not found.
- transaction_time: time of transaction in HH:MM (24h) format if mentioned. null if not found.
- reference_id: UPI transaction ID or NEFT UTR number for deduplication. null if not found.
- date: transaction date in YYYY-MM-DD. ${dateInstruction}
- confidence_score: 0-100. Use 90+ only for clear bank-sent transaction alerts. Use 60-89 for likely transactions. Use 0-59 for uncertain cases (these will be reviewed or rejected).`
}

/** Shape of a positive result, shown to the model as the output contract. */
const POSITIVE_EXAMPLE = `{
  "is_transaction": true,
  "transaction_type": "debit",
  "amount": 450.00,
  "currency": "INR",
  "merchant": "Swiggy",
  "category": "Food & Dining",
  "description": "Swiggy food order",
  "payment_mode": "upi",
  "card_issuer": null,
  "card_brand": null,
  "transaction_time": "20:32",
  "reference_id": "123456789012",
  "date": "YYYY-MM-DD",
  "confidence_score": 95
}`

/** Shape of a negative result. */
const NEGATIVE_EXAMPLE = `{
  "is_transaction": false,
  "transaction_type": null,
  "amount": null,
  "currency": null,
  "merchant": null,
  "category": null,
  "description": null,
  "payment_mode": null,
  "card_issuer": null,
  "card_brand": null,
  "transaction_time": null,
  "reference_id": null,
  "date": null,
  "confidence_score": 0
}`

/**
 * Neutralise the body fence inside attacker-controlled text.
 *
 * Email subject and body are attacker-controlled — anyone can send the user
 * mail. Both are interpolated into the prompt inside a `"""` fence, so a body
 * that contains `"""` can close the fence early and have whatever follows read
 * as instructions rather than as data to classify.
 *
 * Only the fence sequence is touched. The text still has to survive the STRICT
 * RULES, which are unchanged.
 */
export function fenceUntrustedText(text: string): string {
  return text.replace(/"{3,}/g, '"·"·"')
}

/**
 * Above this, the model is hallucinating rather than reading. Generous on
 * purpose — property and vehicle payments are legitimately large — but a
 * fabricated or injected figure is typically orders of magnitude past it.
 */
const MAX_PLAUSIBLE_AMOUNT = 100_000_000

/**
 * True when the parsed value has the minimum shape of a usable AI verdict.
 *
 * `is_transaction` alone used to be the whole check, so an `amount` of any type
 * and a `currency` of any string reached the database. A rejected verdict
 * becomes `null`, which already means "no AI answer — use the regex ladder", so
 * this tightening degrades rather than drops.
 */
function isUsableResult(value: unknown): value is AITransactionResult {
  if (!value || typeof value !== 'object') return false
  const v = value as AITransactionResult
  if (typeof v.is_transaction !== 'boolean') return false
  // A non-transaction verdict carries no fields worth checking.
  if (!v.is_transaction) return true
  if (v.amount !== undefined && v.amount !== null) {
    if (typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return false
    if (v.amount <= 0 || v.amount > MAX_PLAUSIBLE_AMOUNT) return false
  }
  if (v.currency != null && !SUPPORTED_CURRENCY_CODES.has(v.currency)) return false
  return true
}

/**
 * Use Gemini AI to verify if an email represents a completed transaction
 * and extract structured metadata.
 */
export async function analyzeTransactionEmailWithAI(
  subject: string,
  body: string,
  emailDate: string,
  callGemini: (body: Record<string, unknown>) => Promise<any> = callGeminiProxy,
  categoryNames?: string[]
): Promise<AITransactionResult | null> {
  try {
    const categoryListText = buildCategoryListText(categoryNames)

    const prompt = `
Analyze the following bank/payment email to determine if it describes a COMPLETED financial transaction.

Subject: "${fenceUntrustedText(subject)}"
Date: "${emailDate}"
Body:
"""
${fenceUntrustedText(body.substring(0, AI_BODY_CHAR_LIMIT))}
"""

${STRICT_RULES_BLOCK}

${buildExtractionSpec(categoryListText, `Use email date "${emailDate}" if not specified.`)}

Return ONLY JSON, no markdown:
${POSITIVE_EXAMPLE}
If NOT a completed transaction:
${NEGATIVE_EXAMPLE}
`

    const data = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { ...SCAN_GENERATION_BASE, maxOutputTokens: 500 },
      purpose: 'scan',
    })
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const result: AITransactionResult = JSON.parse(jsonMatch[0])

    if (isUsableResult(result)) {
      return result
    }
    return null
  } catch (e) {
    console.warn('[AI] Gemini email parsing failed:', e)
    return null
  }
}

/**
 * The model replied, but its output could not be read as the expected JSON
 * array. Distinguished from a transport/service failure because only THIS
 * case is worth retrying as individual, smaller prompts — see the catch block
 * in `analyzeTransactionEmailBatchWithAI`.
 */
class ContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentError'
  }
}

/** One email queued for batch classification. `index` is caller-assigned and echoed back. */
export interface EmailForAI {
  index: number
  subject: string
  body: string
  emailDate: string
}

/** Emails per Gemini call. Above ~5 the model starts truncating later entries. */
export const AI_BATCH_SIZE = 5

/**
 * Classify several emails in ONE Gemini call.
 *
 * The scanner previously spent one round trip per email, sequentially, which
 * put a 50-email scan at 100-160s and made timeouts routine. Batching cuts
 * both wall-clock time and the user's daily AI quota by ~5x.
 *
 * Returns a Map keyed by the caller's `index`. A `null` value means "no AI
 * verdict for this email" — exactly what a failed single-email call has always
 * meant — and the caller falls through to the regex ladder. This function
 * never throws: a failed batch degrades to per-email calls, and if those fail
 * too, every entry maps to null.
 */
export async function analyzeTransactionEmailBatchWithAI(
  emails: EmailForAI[],
  callGemini: (body: Record<string, unknown>) => Promise<any> = callGeminiProxy,
  categoryNames?: string[]
): Promise<Map<number, AITransactionResult | null>> {
  const results = new Map<number, AITransactionResult | null>()
  if (emails.length === 0) return results
  for (const e of emails) results.set(e.index, null)

  // Positions in THIS prompt are always 0..n-1. The model echoes those back,
  // and we translate to the caller's indices ourselves rather than trusting it
  // to reproduce arbitrary numbers.
  const emailBlocks = emails
    .map((e, i) => `EMAIL ${i}:
Subject: "${fenceUntrustedText(e.subject)}"
Date: "${e.emailDate}"
Body:
"""
${fenceUntrustedText(e.body.substring(0, AI_BODY_CHAR_LIMIT))}
"""`)
    .join('\n\n')

  const prompt = `
Analyze EACH of the following ${emails.length} bank/payment emails to determine if it describes a COMPLETED financial transaction.
Judge every email INDEPENDENTLY — one email's verdict must never influence another's.

${emailBlocks}

${STRICT_RULES_BLOCK}

${buildExtractionSpec(buildCategoryListText(categoryNames), `Use that email's own Date value if not specified.`)}

Return ONLY a JSON array, no markdown, containing EXACTLY ${emails.length} objects — one per email, for every index from 0 to ${emails.length - 1}.
Each object carries its "email_index" plus the same fields as this example:
${POSITIVE_EXAMPLE}
An email that is NOT a completed transaction uses:
${NEGATIVE_EXAMPLE}

Example of the array shape for 2 emails:
[{"email_index": 0, "is_transaction": true, "amount": 450.00, "merchant": "Swiggy", "confidence_score": 95}, {"email_index": 1, "is_transaction": false, "amount": null, "confidence_score": 0}]
`

  try {
    const data = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        ...SCAN_GENERATION_BASE,
        // Scales with batch size — 500 was sized for a single result.
        maxOutputTokens: 2000,
      },
      purpose: 'scan',
    })

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (!arrayMatch) throw new ContentError('batch response contained no JSON array')

    // A truncated or malformed array is a content fault, not a transport one —
    // JSON.parse's own SyntaxError must not be mistaken for the service being
    // down, or these emails would skip the single-call retry that fixes them.
    let parsed: unknown
    try {
      parsed = JSON.parse(arrayMatch[0])
    } catch (parseErr) {
      const detail = parseErr instanceof Error ? parseErr.message : String(parseErr)
      throw new ContentError(`batch response was not valid JSON: ${detail}`)
    }
    if (!Array.isArray(parsed)) throw new ContentError('batch response was not an array')

    for (const entry of parsed) {
      const promptIndex = entry?.email_index
      if (typeof promptIndex !== 'number' || promptIndex < 0 || promptIndex >= emails.length) continue
      if (!isUsableResult(entry)) continue
      // Drop the routing field so callers get a clean AITransactionResult.
      const result: AITransactionResult & { email_index?: number } = { ...entry }
      delete result.email_index
      results.set(emails[promptIndex].index, result)
    }

    return results
  } catch (e: any) {
    console.warn('[AI] Batch classification failed:', e)

    // Retry the emails individually ONLY when the batch itself was the
    // problem — the model answered, but with something this code could not
    // parse (truncation, prose around the JSON, a malformed array). Splitting
    // such a batch genuinely helps: each email gets a smaller, simpler prompt.
    //
    // Every other failure is the transport or the service: a dead model, an
    // auth failure, a rate limit, a function timeout, the network. Re-asking
    // the SAME broken endpoint five more times cannot succeed. It used to,
    // though — the old guard only excluded 404/503/401, so a 429 or a 504 (the
    // Vercel function timeout, routine before `maxDuration` was set) turned
    // one failed call into five sequential ones. With four batches in flight
    // that is 20 doomed serial round trips per wave: five times the latency,
    // five times the rate-limit burn, and each new 429 provoking yet another
    // fan-out. It made a brief hiccup look like a hung scanner.
    if (!(e instanceof ContentError)) {
      return results
    }

    for (const email of emails) {
      try {
        const single = await analyzeTransactionEmailWithAI(
          email.subject,
          email.body,
          email.emailDate,
          callGemini,
          categoryNames
        )
        results.set(email.index, single)
      } catch {
        results.set(email.index, null)
      }
    }
    return results
  }
}
