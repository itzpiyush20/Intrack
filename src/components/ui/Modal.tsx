import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/utils'
import { useDialog } from '@/hooks'
import Button from './Button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Anchors the modal to the bottom of the viewport on mobile (a bottom sheet), centered on larger screens. */
  sheet?: boolean
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className,
  sheet = false,
}: ModalProps) {

  // Escape, scroll lock, focus trap and focus restore all live in useDialog so
  // this modal and AuthModal cannot drift apart. This used to handle only the
  // first two, which left a keyboard user focused on the page behind the
  // dialog, tabbing through content the backdrop was covering.
  const panelRef = useDialog<HTMLDivElement>(isOpen, onClose)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className={cn(
          "fixed inset-0 z-modal flex justify-center overflow-hidden",
          sheet ? "items-end sm:items-start p-0 sm:p-4 sm:pt-10" : "items-start p-4 pt-10"
        )}>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Content */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { type: 'spring', damping: 25, stiffness: 350 }
            }}
            exit={{
              opacity: 0,
              y: 20,
              transition: { duration: 0.2 }
            }}
            className={cn(
              "relative w-full max-w-lg bg-surface-1 border border-sb-hairline shadow-2xl flex flex-col max-h-[75svh] overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent",
              sheet ? "rounded-t-3xl sm:rounded-2xl max-h-[92svh] sm:max-h-[75svh]" : "rounded-2xl",
              className
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-sb-hairline shrink-0">
              <h3 className="text-base font-bold text-sb-ink">{title}</h3>
              <Button
                variant="ghost"
                onClick={onClose}
                className="h-9 w-9 !p-0 rounded-lg flex items-center justify-center text-sb-ink-muted hover:text-sb-ink hover:bg-surface-2"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 overflow-y-auto flex-1 text-sm text-sb-ink-secondary leading-relaxed">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-sb-hairline bg-surface-2/40 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
