// ============================================
// Supabase Database Types
// Mirrors the schema.sql structure for type-safe queries
// ============================================

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          email_notifications_enabled: boolean
          budget_alerts_enabled: boolean
          weekly_report_enabled: boolean
          subscription_reminders_enabled: boolean
          currency: 'INR' | 'USD' | null
          active_financial_year: number | null
          promo_code: string | null
          subscription_status: string | null
          subscription_expires_at: string | null
          subscription_plan_type: string | null
          is_admin: boolean
          ai_calls_count: number
          ai_scan_calls_count: number
          daily_scan_time: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          email_notifications_enabled?: boolean
          budget_alerts_enabled?: boolean
          weekly_report_enabled?: boolean
          subscription_reminders_enabled?: boolean
          currency?: 'INR' | 'USD' | null
          active_financial_year?: number | null
          promo_code?: string | null
          subscription_status?: string | null
          subscription_expires_at?: string | null
          subscription_plan_type?: string | null
          is_admin?: boolean
          ai_calls_count?: number
          ai_scan_calls_count?: number
          daily_scan_time?: string | null
        }
        Update: {
          full_name?: string | null
          avatar_url?: string | null
          email_notifications_enabled?: boolean
          budget_alerts_enabled?: boolean
          weekly_report_enabled?: boolean
          subscription_reminders_enabled?: boolean
          currency?: 'INR' | 'USD' | null
          active_financial_year?: number | null
          promo_code?: string | null
          subscription_status?: string | null
          subscription_expires_at?: string | null
          subscription_plan_type?: string | null
          is_admin?: boolean
          ai_calls_count?: number
          ai_scan_calls_count?: number
          daily_scan_time?: string | null
        }
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          amount: number
          currency: string
          type: 'debit' | 'credit'
          category: string
          description: string
          notes: string | null
          date: string
          source: 'manual' | 'email'
          approval_status: 'pending' | 'approved' | 'rejected'
          reference_id: string | null
          merchant: string | null
          // V2 columns
          payment_mode: 'upi' | 'credit_card' | 'debit_card' | 'neft' | 'rtgs' | 'imps' | 'atm' | 'net_banking' | 'nach' | 'wallet' | 'cheque' | 'unknown' | null
          card_last4: string | null
          card_issuer: string | null
          card_brand: 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners' | null
          transaction_time: string | null
          confidence_score: number | null
          event_type: 'debit' | 'credit' | 'refund' | 'emi' | 'sip' | 'salary' | 'chargeback' | 'subscription' | 'transfer' | 'insurance' | 'loan_repayment' | 'atm_withdrawal' | null
          email_message_id: string | null
          merged_email_message_ids: string[] | null
          possible_duplicate_of: string | null
          tags: string[] | null
          is_returnable: boolean
          counterparty: string | null
          expected_return_date: string | null
          return_status: 'pending' | 'received' | null
          settled_by_transaction_id: string | null
          category_confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          amount: number
          /** ISO 4217. Omit to accept the database default of 'INR'. */
          currency?: string
          type: 'debit' | 'credit'
          category: string
          description: string
          notes?: string | null
          date: string
          source?: 'manual' | 'email'
          approval_status?: 'pending' | 'approved' | 'rejected'
          reference_id?: string | null
          merchant?: string | null
          // V2 columns
          payment_mode?: 'upi' | 'credit_card' | 'debit_card' | 'neft' | 'rtgs' | 'imps' | 'atm' | 'net_banking' | 'nach' | 'wallet' | 'cheque' | 'unknown' | null
          card_last4?: string | null
          card_issuer?: string | null
          card_brand?: 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners' | null
          transaction_time?: string | null
          confidence_score?: number | null
          event_type?: 'debit' | 'credit' | 'refund' | 'emi' | 'sip' | 'salary' | 'chargeback' | 'subscription' | 'transfer' | 'insurance' | 'loan_repayment' | 'atm_withdrawal' | null
          email_message_id?: string | null
          merged_email_message_ids?: string[] | null
          possible_duplicate_of?: string | null
          tags?: string[] | null
          is_returnable?: boolean
          counterparty?: string | null
          expected_return_date?: string | null
          return_status?: 'pending' | 'received' | null
          settled_by_transaction_id?: string | null
          category_confirmed_at?: string | null
        }
        Update: {
          amount?: number
          currency?: string
          type?: 'debit' | 'credit'
          category?: string
          description?: string
          notes?: string | null
          date?: string
          approval_status?: 'pending' | 'approved' | 'rejected'
          merchant?: string | null
          payment_mode?: string | null
          card_last4?: string | null
          card_issuer?: string | null
          card_brand?: 'Visa' | 'Mastercard' | 'RuPay' | 'American Express' | 'Diners' | null
          transaction_time?: string | null
          confidence_score?: number | null
          event_type?: string | null
          reference_id?: string | null
          merged_email_message_ids?: string[] | null
          possible_duplicate_of?: string | null
          tags?: string[] | null
          is_returnable?: boolean
          counterparty?: string | null
          expected_return_date?: string | null
          return_status?: 'pending' | 'received' | null
          settled_by_transaction_id?: string | null
          category_confirmed_at?: string | null
        }
      }
      budgets: {
        Row: {
          id: string
          user_id: string
          category: string
          amount: number
          month: string
          /** Set when the user deliberately deleted this budget (migration 043). */
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          category: string
          amount: number
          month: string
        }
        Update: {
          amount?: number
          category?: string
        }
      }
      insurance_policies: {
        Row: {
          id: string
          user_id: string
          policy_name: string
          policy_type: 'life' | 'health'
          premium_amount: number
          frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
          next_due_date: string
          remarks: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          policy_name: string
          policy_type: 'life' | 'health'
          premium_amount: number
          frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
          next_due_date: string
          remarks?: string | null
        }
        Update: {
          policy_name?: string
          policy_type?: 'life' | 'health'
          premium_amount?: number
          frequency?: 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
          next_due_date?: string
          remarks?: string | null
        }
      }
      email_scan_logs: {
        Row: {
          id: string
          user_id: string
          scanned_at: string
          emails_processed: number
          transactions_found: number
          status: 'success' | 'failed' | 'partial'
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          emails_processed?: number
          transactions_found?: number
          status?: 'success' | 'failed' | 'partial'
          error_message?: string | null
        }
        Update: {
          emails_processed?: number
          transactions_found?: number
          status?: 'success' | 'failed' | 'partial'
          error_message?: string | null
        }
      }
      email_scan_rejections: {
        Row: {
          id: string
          user_id: string
          scan_log_id: string | null
          sender_domain: string | null
          subject: string | null
          gate: string
          matched_snippet: string | null
          rejected_at: string
        }
        Insert: {
          user_id: string
          scan_log_id?: string | null
          sender_domain?: string | null
          subject?: string | null
          gate: string
          matched_snippet?: string | null
        }
        Update: {
          gate?: string
        }
      }
      merchant_rules: {
        Row: {
          id: string
          user_id: string
          merchant_key: string
          preferred_category: string
          auto_approve: boolean
          confidence: number
          times_confirmed: number
          rule_type: string
          last_updated: string
          created_at: string
        }
        Insert: {
          user_id: string
          merchant_key: string
          preferred_category: string
          auto_approve?: boolean
          confidence?: number
          times_confirmed?: number
          rule_type?: string
        }
        Update: {
          preferred_category?: string
          auto_approve?: boolean
          confidence?: number
          times_confirmed?: number
          rule_type?: string
          last_updated?: string
        }
      }
      cards: {
        Row: {
          id: string
          user_id: string
          last4: string
          issuer: string
          card_type: 'credit' | 'debit'
          card_name: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          last4: string
          issuer: string
          card_type: 'credit' | 'debit'
          card_name?: string | null
          is_primary?: boolean
        }
        Update: {
          card_name?: string | null
          is_primary?: boolean
        }
      }
      categories: {
        Row: {
          id: string
          user_id: string
          name: string
          emoji: string
          color: string
          type: 'income' | 'expense'
          budget_eligible: boolean
          is_default: boolean
          is_permanent: boolean
          sort_order: number
          analytics_tags: string[]
          created_at: string
        }
        Insert: {
          user_id: string
          name: string
          emoji: string
          color: string
          type: 'income' | 'expense'
          budget_eligible?: boolean
          is_default?: boolean
          is_permanent?: boolean
          sort_order?: number
          analytics_tags?: string[]
        }
        Update: {
          name?: string
          emoji?: string
          color?: string
          type?: 'income' | 'expense'
          budget_eligible?: boolean
          is_default?: boolean
          is_permanent?: boolean
          sort_order?: number
          analytics_tags?: string[]
        }
      }
    }
    Functions: {
      admin_overview_stats: {
        Args: Record<string, never>
        Returns: {
          total_accounts: number
          signups_7d: number
          signups_30d: number
          paying_monthly: number
          paying_annual: number
          expiring_7d: number
          signins_7d: number
          signins_30d: number
          transactions_7d: number
          transactions_30d: number
          transactions_pending: number
        }[]
      }
      admin_growth_series: {
        Args: { days: number }
        Returns: { day: string; signups: number; signins: number }[]
      }
      admin_user_list: {
        Args: { search: string; lim: number; off: number }
        Returns: {
          id: string
          email: string
          subscription_status: string | null
          subscription_plan_type: string | null
          subscription_expires_at: string | null
          created_at: string
          last_signin_at: string | null
          scans_30d: number
          total_count: number
        }[]
      }
      admin_scanner_stats: {
        Args: { days: number }
        Returns: {
          day: string
          manual_scans: number
          scheduled_scans: number
          succeeded: number
          partial: number
          failed: number
          emails_processed: number
          transactions_found: number
        }[]
      }
      admin_scan_failures: {
        Args: { lim: number }
        Returns: { scanned_at: string; email: string; error_message: string | null; scan_mode: string | null }[]
      }
      admin_rejection_gates: {
        Args: { days: number }
        Returns: { gate: string; rejections: number }[]
      }
      admin_charges_needing_review: {
        Args: { lim?: number }
        Returns: {
          id: string
          email: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          plan_type: string
          amount_inr: number
          created_at: string
        }[]
      }
      admin_ai_usage: {
        Args: Record<string, never>
        Returns: { email: string; ai_calls_count: number; ai_scan_calls_count: number }[]
      }
      admin_feedback_summary: {
        Args: Record<string, never>
        Returns: { total: number; average_rating: number; bug: number; feature_request: number; ui_ux: number; other: number }[]
      }
      admin_feedback_list: {
        Args: { lim: number; off: number }
        Returns: {
          id: string
          email: string
          rating: number
          category: string
          message: string
          created_at: string
          handled_at: string | null
          total_count: number
        }[]
      }
      admin_user_scan_history: {
        Args: { target: string; lim: number }
        Returns: {
          scanned_at: string
          scan_mode: string | null
          status: string
          emails_processed: number
          transactions_found: number
          error_message: string | null
        }[]
      }
      admin_gate_senders: {
        Args: { target_gate: string; days: number; lim: number }
        Returns: {
          sender_domain: string
          rejections: number
          last_seen: string
        }[]
      }
    }
  }
}
