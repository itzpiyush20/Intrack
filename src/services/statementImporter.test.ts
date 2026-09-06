import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseCSV,
  parseStatementDate,
  parseStatementAmount,
  extractCardInfo,
  detectPaymentMode,
  extractReferenceId,
  parseStatementCSV,
  saveImportedTransactions,
} from './statementImporter'
import { supabase } from './supabase'
import type { Card } from '@/types'

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}))

describe('statementImporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseCSV', () => {
    it('parses standard comma-separated lines', () => {
      const csv = 'Date,Description,Amount\n2024-01-01,Coffee,150.00\n2024-01-02,Tea,50.00'
      const result = parseCSV(csv)
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(['Date', 'Description', 'Amount'])
      expect(result[1]).toEqual(['2024-01-01', 'Coffee', '150.00'])
      expect(result[2]).toEqual(['2024-01-02', 'Tea', '50.00'])
    })

    it('handles quoted fields with commas and escaped quotes', () => {
      const csv = 'Date,Description,Amount\n01/01/2024,"Swiggy, Bangalore",450.00\n02/01/2024,"He said ""Hello, World""",100.00'
      const result = parseCSV(csv)
      expect(result[1]).toEqual(['01/01/2024', 'Swiggy, Bangalore', '450.00'])
      expect(result[2]).toEqual(['02/01/2024', 'He said "Hello, World"', '100.00'])
    })

    it('strips UTF-8 BOM if present', () => {
      const csv = '\uFEFFDate,Amount\n2024-01-01,100'
      const result = parseCSV(csv)
      expect(result[0][0]).toBe('Date')
    })

    it('handles CRLF line endings', () => {
      const csv = 'Date,Amount\r\n2024-01-01,100\r\n2024-01-02,200\r\n'
      const result = parseCSV(csv)
      expect(result).toHaveLength(3)
    })
  })

  describe('parseStatementDate', () => {
    it('parses Indian DD/MM/YYYY dates', () => {
      expect(parseStatementDate('25/12/2023')).toBe('2023-12-25')
      expect(parseStatementDate('05/01/2024')).toBe('2024-01-05')
    })

    it('parses DD-MM-YYYY dates', () => {
      expect(parseStatementDate('15-08-2024')).toBe('2024-08-15')
    })

    it('parses 2-digit years DD/MM/YY', () => {
      expect(parseStatementDate('01/04/24')).toBe('2024-04-01')
      expect(parseStatementDate('15-08-99')).toBe('1999-08-15')
    })

    it('parses month name formats (SBI style: DD-Mon-YYYY or DD Mon YYYY)', () => {
      expect(parseStatementDate('15-Jan-2024')).toBe('2024-01-15')
      expect(parseStatementDate('1 Jan 2024')).toBe('2024-01-01')
      expect(parseStatementDate('05-DEC-23')).toBe('2023-12-05')
      expect(parseStatementDate('28 Feb 2024')).toBe('2024-02-28')
    })

    it('parses ISO YYYY-MM-DD dates', () => {
      expect(parseStatementDate('2024-06-30')).toBe('2024-06-30')
    })

    it('returns null for invalid strings', () => {
      expect(parseStatementDate('')).toBeNull()
      expect(parseStatementDate('Not a date')).toBeNull()
      expect(parseStatementDate('32/01/2024')).toBeNull()
      expect(parseStatementDate('29/02/2023')).toBeNull() // not a leap year
    })
  })

  describe('parseStatementAmount', () => {
    it('parses standard number strings', () => {
      expect(parseStatementAmount('1500.00')).toBe(1500)
      expect(parseStatementAmount('45.50')).toBe(45.5)
    })

    it('handles Indian comma formatting', () => {
      expect(parseStatementAmount('1,50,000.00')).toBe(150000)
      expect(parseStatementAmount('12,34,567.89')).toBe(1234567.89)
    })

    it('strips currency signs and words (₹, INR, Rs., Rs)', () => {
      expect(parseStatementAmount('₹ 450.00')).toBe(450)
      expect(parseStatementAmount('INR 1,200.50')).toBe(1200.5)
      expect(parseStatementAmount('Rs. 500')).toBe(500)
      expect(parseStatementAmount('Rs 250')).toBe(250)
    })

    it('handles parentheses', () => {
      expect(parseStatementAmount('(450.00)')).toBe(450)
    })

    it('returns 0 for empty or invalid values', () => {
      expect(parseStatementAmount('')).toBe(0)
      expect(parseStatementAmount(null)).toBe(0)
      expect(parseStatementAmount(undefined)).toBe(0)
      expect(parseStatementAmount('abc')).toBe(0)
    })
  })

  describe('extractCardInfo', () => {
    const mockCards: Card[] = [
      {
        id: 'card-1',
        user_id: 'user-1',
        name: 'HDFC Regalia',
        issuer: 'HDFC Bank',
        last4: '4321',
        brand: 'Visa',
        is_archived: false,
        sort_order: 1,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'card-2',
        user_id: 'user-1',
        name: 'SBI Cashback',
        issuer: 'SBI',
        last4: '9876',
        brand: 'Mastercard',
        is_archived: false,
        sort_order: 2,
        created_at: '',
        updated_at: '',
      },
    ]

    it('matches registered card when last4 appears in narration', () => {
      const narration = 'POS 4321 SWIGGY BANGALORE IN'
      const result = extractCardInfo(narration, mockCards)
      expect(result.card_id).toBe('card-1')
      expect(result.card_last4).toBe('4321')
      expect(result.card_issuer).toBe('HDFC Bank')
      expect(result.card_brand).toBe('Visa')
    })

    it('matches registered card with masked format (XX9876)', () => {
      const narration = 'AMAZON PAY INDIA CARD XX9876'
      const result = extractCardInfo(narration, mockCards)
      expect(result.card_id).toBe('card-2')
      expect(result.card_last4).toBe('9876')
      expect(result.card_issuer).toBe('SBI')
    })

    it('extracts last 4 digits even if card is not in user cards', () => {
      const narration = 'UBER RIDES CARD ENDING IN 5555'
      const result = extractCardInfo(narration, mockCards)
      expect(result.card_id).toBeNull()
      expect(result.card_last4).toBe('5555')
    })

    it('uses defaultCardId when provided', () => {
      const narration = 'GENERIC PURCHASE'
      const result = extractCardInfo(narration, mockCards, 'card-2')
      expect(result.card_id).toBe('card-2')
      expect(result.card_last4).toBe('9876')
    })
  })

  describe('detectPaymentMode', () => {
    it('detects UPI from narrations', () => {
      expect(detectPaymentMode('UPI-SWIGGY-123456789012@okaxis-PAYMENT', false)).toBe('upi')
      expect(detectPaymentMode('UPI/DR/123456789012/Zomato/paytm', false)).toBe('upi')
    })

    it('detects NEFT, RTGS, IMPS', () => {
      expect(detectPaymentMode('NEFT CR-HDFC0001234-ACME CORP', false)).toBe('neft')
      expect(detectPaymentMode('RTGS CR-0012345678', false)).toBe('rtgs')
      expect(detectPaymentMode('IMPS/P2A/123456789012/TRANSFER', false)).toBe('imps')
    })

    it('detects ATM withdrawals', () => {
      expect(detectPaymentMode('ATM CASH WDL HDFC BANK KORAMANGALA', false)).toBe('atm')
    })

    it('detects credit card vs debit card', () => {
      expect(detectPaymentMode('POS 123456 SWIGGY', true)).toBe('credit_card')
      expect(detectPaymentMode('POS 123456 SWIGGY', false)).toBe('debit_card')
    })

    it('detects net banking and cheque', () => {
      expect(detectPaymentMode('INB BILLDESK ELECTRICITY', false)).toBe('net_banking')
      expect(detectPaymentMode('CHQ PAID TO JOHN DOE', false)).toBe('cheque')
    })
  })

  describe('extractReferenceId', () => {
    it('extracts UPI 12-digit UTR from narration', () => {
      expect(extractReferenceId('UPI/123456789012/PAYMENT TO SWIGGY')).toBe('123456789012')
      expect(extractReferenceId('UPI-401234567890-ZOMATO')).toBe('401234567890')
    })

    it('prefers explicit reference column if present', () => {
      expect(extractReferenceId('UPI/123456789012/SWIGGY', '999888777')).toBe('999888777')
    })
  })

  describe('Bank statement parsing', () => {
    it('parses HDFC bank account statement CSV with metadata preamble', () => {
      const hdfcCSV = `
HDFC BANK LIMITED
Account Branch : BANGALORE - KORAMANGALA
Statement Period : 01/01/2024 to 31/01/2024

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/01/24,UPI-SWIGGY-123456789012-PAYMENT,000012345678,01/01/24,450.00,,120500.50
05/01/24,SALARY CR-TECH CORP JAN 24,000098765432,05/01/24,,125000.00,245500.50
*** End of statement ***
`
      const result = parseStatementCSV(hdfcCSV)
      expect(result.error).toBeNull()
      expect(result.detectedBank).toBe('HDFC')
      expect(result.rows).toHaveLength(2)

      const [r1, r2] = result.rows
      expect(r1.date).toBe('2024-01-01')
      expect(r1.type).toBe('debit')
      expect(r1.amount).toBe(450)
      expect(r1.payment_mode).toBe('upi')
      expect(r1.reference_id).toBe('000012345678')
      expect(r1.merchant).toBe('Swiggy')
      expect(r1.category).toBe('Food & Dining')

      expect(r2.date).toBe('2024-01-05')
      expect(r2.type).toBe('credit')
      expect(r2.amount).toBe(125000)
      expect(r2.category).toBe('Salary')
      expect(result.totalDebits).toBe(450)
      expect(result.totalCredits).toBe(125000)
    })

    it('parses HDFC credit card statement CSV', () => {
      const hdfcCardCSV = `
Date,Transaction Description,Amount,Cr/Dr
10/02/2024,AMAZON INDIA BANGALORE,2499.00,Dr
12/02/2024,CASHBACK REWARD,150.00,Cr
`
      const result = parseStatementCSV(hdfcCardCSV)
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].type).toBe('debit')
      expect(result.rows[0].amount).toBe(2499)
      expect(result.rows[0].merchant).toBe('Amazon')
      expect(result.rows[1].type).toBe('credit')
      expect(result.rows[1].amount).toBe(150)
    })

    it('parses ICICI bank statement CSV', () => {
      const iciciCSV = `
ICICI Bank Account Statement
Transaction Date,Value Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
02/03/2024,02/03/2024,-,UPI/DR/401234567890/Zomato,580.00,,50000.00
15/03/2024,15/03/2024,-,INTEREST PAID,,,420.00,50420.00
`
      const result = parseStatementCSV(iciciCSV)
      expect(result.detectedBank).toBe('ICICI')
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].type).toBe('debit')
      expect(result.rows[0].amount).toBe(580)
      expect(result.rows[0].merchant).toBe('Zomato')
      expect(result.rows[0].reference_id).toBe('401234567890')
      expect(result.rows[1].type).toBe('credit')
      expect(result.rows[1].amount).toBe(420)
      expect(result.rows[1].category).toBe('Investment')
    })

    it('parses SBI bank statement CSV with DD-Mon-YYYY dates', () => {
      const sbiCSV = `
State Bank of India Statement
Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
15-Jan-2024,15-Jan-2024,NETFLIX MUMBAI IN,TRANSFER-12345,649.00,,45000.00
20-Jan-2024,20-Jan-2024,DIVIDEND CR TATA MOTORS,DIV-98765,,1500.00,46500.00
`
      const result = parseStatementCSV(sbiCSV)
      expect(result.detectedBank).toBe('SBI')
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].date).toBe('2024-01-15')
      expect(result.rows[0].amount).toBe(649)
      expect(result.rows[0].type).toBe('debit')
      expect(result.rows[0].category).toBe('Subscriptions')
      expect(result.rows[1].date).toBe('2024-01-20')
      expect(result.rows[1].amount).toBe(1500)
      expect(result.rows[1].type).toBe('credit')
    })

    it('parses Axis bank statement CSV', () => {
      const axisCSV = `
Axis Bank Limited
Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL
05-02-2024,-,POS 123456 BLINKIT BANGALORE,340.00,,25000.00,001
10-02-2024,-,NEFT CR-REFUND FROM MYNTRA,,899.00,25899.00,001
`
      const result = parseStatementCSV(axisCSV)
      expect(result.detectedBank).toBe('AXIS')
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].type).toBe('debit')
      expect(result.rows[0].amount).toBe(340)
      expect(result.rows[0].merchant).toBe('Blinkit')
      expect(result.rows[1].type).toBe('credit')
      expect(result.rows[1].amount).toBe(899)
    })

    it('parses generic statement CSV', () => {
      const genericCSV = `
Date,Description,Debit,Credit,Balance
2024-04-01,Groceries Supermarket,1250.00,,10000.00
2024-04-02,Client Payment,,15000.00,25000.00
`
      const result = parseStatementCSV(genericCSV)
      expect(result.detectedBank).toBe('GENERIC')
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].amount).toBe(1250)
      expect(result.rows[1].amount).toBe(15000)
    })
  })

  describe('saveImportedTransactions - Invariant Testing', () => {
    it('always sets approval_status to "pending" and source to "manual" (NEVER approved)', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: { id: 'user-123' } as any },
        error: null,
      })
      vi.mocked(supabase.from).mockReturnValue({
        insert: mockInsert,
      } as any)

      const parsedRows = [
        {
          id: '1',
          date: '2024-01-01',
          rawDate: '01/01/2024',
          description: 'Swiggy',
          rawDescription: 'UPI/Swiggy',
          type: 'debit' as const,
          amount: 450,
          category: 'Food & Dining',
          selected: true,
        },
        {
          id: '2',
          date: '2024-01-02',
          rawDate: '02/01/2024',
          description: 'Salary',
          rawDescription: 'Salary Credit',
          type: 'credit' as const,
          amount: 100000,
          category: 'Salary',
          selected: true,
        },
      ]

      const result = await saveImportedTransactions(parsedRows)
      expect(result.success).toBe(true)
      expect(result.insertedCount).toBe(2)

      expect(mockInsert).toHaveBeenCalledTimes(1)
      const insertedRecords = mockInsert.mock.calls[0][0]

      expect(insertedRecords).toHaveLength(2)
      for (const record of insertedRecords) {
        expect(record.approval_status).toBe('pending')
        expect(record.source).toBe('manual')
        expect(record.approval_status).not.toBe('approved')
        expect(record.currency).toBe('INR')
        expect(record.tags).toContain('statement_import')
      }
    })

    it('returns error if user is not authenticated', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: new Error('User not authenticated') as any,
      })

      const result = await saveImportedTransactions([
        {
          id: '1',
          date: '2024-01-01',
          rawDate: '01/01/2024',
          description: 'Swiggy',
          rawDescription: 'UPI/Swiggy',
          type: 'debit',
          amount: 450,
          category: 'Food & Dining',
          selected: true,
        },
      ])

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('User not authenticated')
    })
  })
})
