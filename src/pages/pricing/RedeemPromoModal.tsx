// ============================================
// RedeemPromoModal — Minimalist Invitation & Coupon Redemption
// ============================================

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/services/supabase'
import { useToast } from '@/context'
import { Ticket, X, Sparkles, ArrowRight, Loader2 } from 'lucide-react'

interface RedeemPromoModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (days: number) => void
}

export const RedeemPromoModal: React.FC<RedeemPromoModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { showToast } = useToast()
  const [promoCode, setPromoCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClose = useCallback(() => {
    if (loading) return
    setPromoCode('')
    setError(null)
    onClose()
  }, [loading, onClose])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, loading, handleClose])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const entered = promoCode.trim().toUpperCase()
    if (!entered) {
      setError('Please enter a coupon code.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again.')
      }

      const res = await fetch('/api/redeem-promo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code: entered }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Invalid or expired promo code.')
      }

      const days = data.durationDays || 30
      showToast(`👑 ${days} day${days === 1 ? '' : 's'} of full access unlocked!`, 'success')
      onSuccess(days)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-modal-title"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md rounded-3xl bg-surface-1 border border-sb-hairline p-6 sm:p-8 shadow-2xl z-10 space-y-6"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close promo dialog"
            className="absolute top-5 right-5 p-2 rounded-xl text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer border-0 bg-transparent disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600">
              <Ticket className="w-5 h-5" />
            </div>
            <h2 id="promo-modal-title" className="text-xl font-bold tracking-tight text-sb-ink">
              Redeem Promo Code
            </h2>
            <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
              Have an invitation code or partner voucher? Enter it below to unlock complimentary access.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="promo-code-input" className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
                Coupon Code
              </label>
              <input
                id="promo-code-input"
                type="text"
                autoFocus
                disabled={loading}
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase())
                  if (error) setError(null)
                }}
                placeholder="e.g. INTRACKVIP"
                className="w-full bg-surface-2/70 border border-sb-hairline text-sb-ink text-sm rounded-xl px-4 py-3 placeholder:text-sb-ink-muted/50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-all uppercase font-semibold tracking-wider font-mono disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs font-medium">
                {error}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="sb-btn-secondary px-4 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !promoCode.trim()}
                className="sb-btn-primary px-5 py-2.5 text-xs font-bold border-0 cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Validating…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Apply Code</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="text-[11px] text-center text-sb-ink-muted/80">
            One coupon redemption per account · Instant activation upon confirmation
          </p>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
