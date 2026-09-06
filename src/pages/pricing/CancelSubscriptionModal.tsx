// ============================================
// CancelSubscriptionModal — Self-Serve Cancellation Dialog
// Provides full transparency: explains zero auto-renew risk,
// confirms access is retained until expiry, and collects feedback.
// ============================================

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { formatDate, cn } from '@/utils'
import {
  AlertTriangle,
  X,
  ShieldCheck,
  Calendar,
  HelpCircle,
  CheckCircle2
} from 'lucide-react'

interface CancelSubscriptionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string, feedback: string) => Promise<void>
  isProcessing: boolean
  expiresAt: string | null
  daysLeft: number
  planName: string
}

const CANCEL_REASONS = [
  'Too expensive / not in budget right now',
  'Not using the app frequently enough',
  'Missing a bank, card, or specific feature',
  'Taking a temporary break, will return later',
  'Other reason',
]

export const CancelSubscriptionModal: React.FC<CancelSubscriptionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isProcessing,
  expiresAt,
  daysLeft,
  planName,
}) => {
  const [selectedReason, setSelectedReason] = useState(CANCEL_REASONS[0])
  const [feedbackText, setFeedbackText] = useState('')

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isProcessing) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isProcessing, onClose])

  if (!isOpen) return null

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    await onConfirm(selectedReason, feedbackText.trim())
  }

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (!isProcessing) onClose()
          }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-lg rounded-3xl bg-surface-1 border border-sb-hairline p-6 sm:p-8 shadow-2xl z-10 space-y-6 max-h-[90vh] overflow-y-auto"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close cancel subscription dialog"
            className="absolute top-5 right-5 p-2 rounded-xl text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer border-0 bg-transparent"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header */}
          <div className="flex items-start gap-3.5 pr-8">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 id="cancel-modal-title" className="text-xl font-bold text-sb-ink tracking-tight">
                Cancel {planName}?
              </h2>
              <p className="text-xs text-sb-ink-secondary leading-relaxed">
                Before you proceed, here is exactly what cancellation means for your {planName} access:
              </p>
            </div>
          </div>

          {/* 3 Reassurance Callouts */}
          <div className="space-y-2.5 rounded-2xl bg-surface-2/60 border border-sb-hairline p-4 text-xs">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sb-ink">Zero Auto-Renew Risk: </span>
                <span className="text-sb-ink-secondary">
                  Intrack never sets up auto-debit mandates on your card or UPI. Your card will never be billed automatically.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Calendar className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sb-ink">Full Access Until Term End: </span>
                <span className="text-sb-ink-secondary">
                  Your prepaid access remains 100% active until{' '}
                  <span className="font-semibold text-sb-ink">
                    {expiresAt ? formatDate(expiresAt) : 'the end of your period'}
                  </span>
                  {daysLeft > 0 ? ` (${daysLeft} days remaining)` : ''}. You do not lose any days you already paid for.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <HelpCircle className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sb-ink">7-Day Refund Policy: </span>
                <span className="text-sb-ink-secondary">
                  If you made this purchase within the last 7 days, you can request a 100% full refund via{' '}
                  <Link to="/support" className="text-brand-600 underline font-semibold" onClick={onClose}>
                    Support
                  </Link>
                  .
                </span>
              </div>
            </div>
          </div>

          {/* Feedback Form */}
          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted block">
                Please let us know why you are cancelling:
              </label>
              <div className="space-y-1.5">
                {CANCEL_REASONS.map((reason) => {
                  const isSelected = selectedReason === reason
                  return (
                    <label
                      key={reason}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all',
                        isSelected
                          ? 'border-brand-500 bg-brand-500/5 font-semibold text-sb-ink shadow-xs'
                          : 'border-sb-hairline bg-surface-1 text-sb-ink-secondary hover:bg-surface-2'
                      )}
                    >
                      <input
                        type="radio"
                        name="cancelReason"
                        value={reason}
                        checked={isSelected}
                        onChange={() => setSelectedReason(reason)}
                        className="h-3.5 w-3.5 text-brand-600 border-sb-hairline focus:ring-brand-500/30"
                      />
                      <span>{reason}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cancel-feedback-textarea" className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted block">
                Anything else we could do better? (Optional)
              </label>
              <textarea
                id="cancel-feedback-textarea"
                rows={2}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Share any thoughts or requested features…"
                className="w-full bg-surface-2 border border-sb-hairline text-sb-ink text-xs rounded-xl p-3 placeholder:text-sb-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 transition-all resize-none"
              />
            </div>

            {/* Actions */}
            <div className="pt-2 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="sb-btn-primary w-full sm:w-auto py-2.5 px-5 text-xs font-bold cursor-pointer border-0 shadow-sm"
              >
                Keep My Subscription
              </button>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full sm:w-auto py-2.5 px-4 text-xs font-semibold rounded-xl border border-rose-500/30 text-rose-600 hover:bg-rose-500/10 cursor-pointer transition-all bg-transparent disabled:opacity-50"
              >
                {isProcessing ? 'Cancelling…' : 'Confirm Cancellation'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
