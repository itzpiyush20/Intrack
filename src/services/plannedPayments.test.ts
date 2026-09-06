import { describe, it, expect } from 'vitest'
import {
  detectPlannedPayments,
  calculateUpcomingBillsForNext30Days,
  classifyPaymentType,
  resolveCardOrAccount,
  isSubscriptionTabItem,
  isBillRentOrEmiTabItem,
  type PlannedPaymentDetectableTxn,
  type PlannedPayment,
} from './plannedPayments'

// Fixed clock for reliable tests
const NOW = new Date('2026-09-06T12:00:00Z')

const txn = (
  merchant: string,
  date: string,
  amount: number,
  category = 'Subscriptions',
  extra: Partial<PlannedPaymentDetectableTxn> = {}
): PlannedPaymentDetectableTxn => ({
  merchant,
  date,
  amount,
  category,
  type: 'debit',
  ...extra,
})

describe('resolveCardOrAccount', () => {
  it('formats issuer and last4 together', () => {
    expect(resolveCardOrAccount({ card_issuer: 'HDFC', card_last4: '4582' })).toBe('HDFC ••4582')
  })

  it('formats last4 with brand fallback when issuer missing', () => {
    expect(resolveCardOrAccount({ card_last4: '1234', card_brand: 'Visa' })).toBe('Visa ••1234')
  })

  it('formats mode when card info missing', () => {
    expect(resolveCardOrAccount({ payment_mode: 'upi' })).toBe('UPI AutoPay')
    expect(resolveCardOrAccount({ payment_mode: 'nach' })).toBe('NACH Mandate')
    expect(resolveCardOrAccount({ payment_mode: 'net_banking' })).toBe('Net Banking')
  })

  it('returns null when no payment info available', () => {
    expect(resolveCardOrAccount({})).toBeNull()
  })
})

describe('classifyPaymentType', () => {
  it('identifies EMIs from event_type or keywords', () => {
    expect(classifyPaymentType('Loans & EMIs', 'emi')).toBe('emi')
    expect(classifyPaymentType('Other', null, 'HDFC Home Loan EMI')).toBe('emi')
  })

  it('identifies SIPs from event_type or mutual fund keywords', () => {
    expect(classifyPaymentType('Investments', 'sip')).toBe('sip')
    expect(classifyPaymentType('Investments', null, 'Zerodha Coin SIP')).toBe('sip')
  })

  it('identifies utilities from category or keywords', () => {
    expect(classifyPaymentType('Utilities & Bills')).toBe('utility')
    expect(classifyPaymentType('Other', null, 'BESCOM Electricity Bill')).toBe('utility')
  })

  it('identifies rent from category or keywords', () => {
    expect(classifyPaymentType('Rent')).toBe('rent')
    expect(classifyPaymentType('Other', null, 'House Rent to Landlord')).toBe('rent')
  })

  it('identifies insurance from category or keywords', () => {
    expect(classifyPaymentType('Insurance')).toBe('insurance')
    expect(classifyPaymentType('Other', null, 'HDFC ERGO Health Insurance')).toBe('insurance')
  })

  it('identifies credit card bills', () => {
    expect(classifyPaymentType('Credit Card Bill Payment', 'credit_card_bill')).toBe('credit_card_bill')
  })
})

describe('detectPlannedPayments', () => {
  it('detects subscriptions and recurring EMIs/SIPs', () => {
    const rows = [
      txn('Netflix', '2026-08-20', 649, 'Subscriptions', { card_issuer: 'ICICI', card_last4: '9901' }),
      txn('Netflix', '2026-07-21', 649, 'Subscriptions'),
      txn('Home Loan EMI', '2026-08-10', 42000, 'Loan', {
        event_type: 'emi',
        payment_mode: 'nach',
      }),
      txn('Home Loan EMI', '2026-07-10', 42000, 'Loan', {
        event_type: 'emi',
        payment_mode: 'nach',
      }),
      txn('Airtel Broadband', '2026-08-15', 1179, 'Utilities & Bills', {
        payment_mode: 'upi',
      }),
      txn('Airtel Broadband', '2026-07-16', 1179, 'Utilities & Bills', {
        payment_mode: 'upi',
      }),
    ]

    const detected = detectPlannedPayments(rows, { now: NOW })
    expect(detected.length).toBe(3)

    const netflix = detected.find((d) => d.title === 'Netflix')
    expect(netflix).toBeDefined()
    expect(netflix?.payment_type).toBe('subscription')
    expect(netflix?.card_or_account).toBe('ICICI ••9901')
    expect(netflix?.cadence).toBe('monthly')

    const emi = detected.find((d) => d.title === 'Home Loan EMI')
    expect(emi).toBeDefined()
    expect(emi?.payment_type).toBe('emi')
    expect(emi?.card_or_account).toBe('NACH Mandate')

    const airtel = detected.find((d) => d.title === 'Airtel Broadband')
    expect(airtel).toBeDefined()
    expect(airtel?.payment_type).toBe('utility')
    expect(airtel?.card_or_account).toBe('UPI AutoPay')
  })

  it('allows utilities with varying amounts to be detected as monthly', () => {
    const rows = [
      txn('Electricity BESCOM', '2026-08-05', 2450, 'Utilities & Bills'),
      txn('Electricity BESCOM', '2026-07-06', 1890, 'Utilities & Bills'),
    ]

    const detected = detectPlannedPayments(rows, { now: NOW })
    expect(detected.length).toBe(1)
    expect(detected[0].title).toBe('Electricity BESCOM')
    expect(detected[0].cadence).toBe('monthly')
  })

  it('filters out ignored merchants', () => {
    const rows = [
      txn('Gym', '2026-08-10', 2500, 'Subscriptions'),
      txn('Gym', '2026-07-10', 2500, 'Subscriptions'),
    ]

    const detected = detectPlannedPayments(rows, { ignoredKeys: ['gym'], now: NOW })
    expect(detected.length).toBe(0)
  })
})

describe('calculateUpcomingBillsForNext30Days', () => {
  it('calculates bills, total amounts, and builds a 30-day timeline', () => {
    const mockPayments: PlannedPayment[] = [
      {
        id: '1',
        title: 'Spotify',
        amount: 119,
        cadence: 'monthly',
        category: 'Subscriptions',
        next_due_date: '2026-09-08', // 2 days from NOW (2026-09-06)
        card_or_account: 'Visa ••1111',
        is_active: true,
        payment_type: 'subscription',
        days_until_due: 2,
        frequency_days: 30,
        times_charged: 3,
        is_auto_detected: true,
      },
      {
        id: '2',
        title: 'Electricity Bill',
        amount: 2100,
        cadence: 'monthly',
        category: 'Utilities & Bills',
        next_due_date: '2026-09-12', // 6 days from NOW
        card_or_account: 'UPI AutoPay',
        is_active: true,
        payment_type: 'utility',
        days_until_due: 6,
        frequency_days: 30,
        times_charged: 2,
        is_auto_detected: true,
      },
      {
        id: '3',
        title: 'Annual Insurance',
        amount: 15000,
        cadence: 'annual',
        category: 'Insurance',
        next_due_date: '2026-11-20', // beyond 30 days
        card_or_account: 'HDFC ••5555',
        is_active: true,
        payment_type: 'insurance',
        days_until_due: 75,
        frequency_days: 365,
        times_charged: 2,
        is_auto_detected: true,
      },
    ]

    const summary = calculateUpcomingBillsForNext30Days(mockPayments, { now: NOW })

    expect(summary.bills.length).toBe(2) // only Spotify & Electricity are in the next 30 days
    expect(summary.totalUpcomingAmount).toBe(2219)
    expect(summary.dueIn7DaysCount).toBe(2)
    expect(summary.timeline.length).toBe(30)

    const sep8Day = summary.timeline.find((t) => t.date === '2026-09-08')
    expect(sep8Day).toBeDefined()
    expect(sep8Day?.bills.length).toBe(1)
    expect(sep8Day?.bills[0].title).toBe('Spotify')

    const sep12Day = summary.timeline.find((t) => t.date === '2026-09-12')
    expect(sep12Day).toBeDefined()
    expect(sep12Day?.bills.length).toBe(1)
    expect(sep12Day?.bills[0].title).toBe('Electricity Bill')
  })
})

describe('tab partition helpers', () => {
  const sub: PlannedPayment = {
    id: 's1',
    title: 'Netflix',
    amount: 649,
    cadence: 'monthly',
    category: 'Subscriptions',
    next_due_date: '2026-09-10',
    card_or_account: null,
    is_active: true,
    payment_type: 'subscription',
    days_until_due: 4,
    frequency_days: 30,
    times_charged: 2,
    is_auto_detected: true,
  }

  const emi: PlannedPayment = {
    id: 'e1',
    title: 'Car Loan EMI',
    amount: 12000,
    cadence: 'monthly',
    category: 'Loan',
    next_due_date: '2026-09-15',
    card_or_account: 'HDFC Bank',
    is_active: true,
    payment_type: 'emi',
    days_until_due: 9,
    frequency_days: 30,
    times_charged: 5,
    is_auto_detected: true,
  }

  it('partitions subscriptions and bills/rent/emis accurately', () => {
    expect(isSubscriptionTabItem(sub)).toBe(true)
    expect(isBillRentOrEmiTabItem(sub)).toBe(false)

    expect(isSubscriptionTabItem(emi)).toBe(false)
    expect(isBillRentOrEmiTabItem(emi)).toBe(true)
  })
})

describe('category-based planned payments evaluation', () => {
  it('correctly identifies planned categories from analytics tags', async () => {
    const { isPlannedCategory } = await import('./plannedPayments')

    expect(isPlannedCategory({ analytics_tags: ['needs', 'subscription'] })).toBe(true)
    expect(isPlannedCategory({ analytics_tags: ['wants', 'planned_payment'] })).toBe(true)
    expect(isPlannedCategory({ analytics_tags: ['needs', 'groceries'] })).toBe(false)
    expect(isPlannedCategory({ analytics_tags: null })).toBe(false)
    expect(isPlannedCategory({})).toBe(false)
  })

  it('evaluates paid vs due categories for a specific month', async () => {
    const { evaluateMonthlyPlannedPayments } = await import('./plannedPayments')

    const categories = [
      { id: 'c1', name: 'Rent', emoji: '🏠', analytics_tags: ['subscription'] },
      { id: 'c2', name: 'Electricity', emoji: '💡', analytics_tags: ['subscription'] },
      { id: 'c3', name: 'Groceries', emoji: '🛒', analytics_tags: ['needs'] },
    ]

    const monthTransactions = [
      {
        id: 't1',
        date: '2026-09-02',
        amount: 25000,
        type: 'debit',
        category: 'Rent',
        description: 'Rent for Sep',
        approval_status: 'approved',
      },
    ]

    const result = evaluateMonthlyPlannedPayments({
      categories,
      monthTransactions,
      year: 2026,
      monthIndex: 8, // September 2026
      referenceDate: new Date('2026-09-06T12:00:00Z'),
    })

    expect(result.totalCount).toBe(2) // Rent and Electricity
    expect(result.clearedCount).toBe(1) // Rent is cleared
    expect(result.clearedAmount).toBe(25000)
    expect(result.dueCount).toBe(1) // Electricity is due

    const rentItem = result.items.find((i) => i.categoryName === 'Rent')
    expect(rentItem).toBeDefined()
    expect(rentItem?.status).toBe('paid')
    expect(rentItem?.amountPaid).toBe(25000)
    expect(rentItem?.paidDate).toBe('2026-09-02')
    expect(rentItem?.matchedTxns.length).toBe(1)

    const elecItem = result.items.find((i) => i.categoryName === 'Electricity')
    expect(elecItem).toBeDefined()
    expect(elecItem?.status).toBe('due')
  })

  it('supports multiple planned payments under the same category with distinct due dates and amounts', async () => {
    const { evaluateMonthlyPlannedPayments } = await import('./plannedPayments')

    const categories = [
      { id: 'c1', name: 'Subscriptions', emoji: '🔄', analytics_tags: ['subscription'] },
    ]

    const userPlannedPayments = [
      {
        id: 'p1',
        name: 'Netflix',
        category: 'Subscriptions',
        dueDay: 5,
        expectedAmount: 649,
      },
      {
        id: 'p2',
        name: 'Spotify',
        category: 'Subscriptions',
        dueDay: 12,
        expectedAmount: 119,
      },
    ]

    const monthTransactions = [
      {
        id: 't_netflix',
        date: '2026-09-05',
        amount: 649,
        type: 'debit',
        category: 'Subscriptions',
        merchant: 'Netflix',
        description: 'Netflix Monthly Plan',
        approval_status: 'approved',
      },
    ]

    const result = evaluateMonthlyPlannedPayments({
      categories,
      monthTransactions,
      year: 2026,
      monthIndex: 8, // September 2026
      referenceDate: new Date('2026-09-06T12:00:00Z'),
      userPlannedPayments,
    })

    expect(result.totalCount).toBe(2)
    expect(result.clearedCount).toBe(1)
    expect(result.clearedAmount).toBe(649)
    expect(result.dueCount).toBe(1)
    expect(result.remainingDueAmount).toBe(119)

    const netflix = result.items.find((i) => i.name === 'Netflix')
    expect(netflix?.status).toBe('paid')
    expect(netflix?.amountPaid).toBe(649)
    expect(netflix?.categoryName).toBe('Subscriptions')

    const spotify = result.items.find((i) => i.name === 'Spotify')
    expect(spotify?.status).toBe('due')
    expect(spotify?.expectedAmount).toBe(119)
    expect(spotify?.dueDay).toBe(12)
    expect(spotify?.categoryName).toBe('Subscriptions')
  })
})


