import { useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/utils'
import { useDialog } from '@/hooks'
import Button from './Button'
import { GLIDE, glide } from './motion'
import { ORIGIN_SCALE, transformOriginFor, type ViewportPoint } from './modalOrigin'

/** Below Tailwind's `sm` a `sheet` modal is a bottom sheet attached to the screen edge. */
function isPhoneSheet(sheet: boolean): boolean {
  if (!sheet || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(min-width: 640px)').matches
}

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Anchors the modal to the bottom of the viewport on mobile (a bottom sheet), centered on larger screens. */
  sheet?: boolean
  /**
   * Viewport point (px) of the button that opened this modal. The panel then
   * grows from that point (scale + fade) and closes back toward it. Without it
   * the panel rises. A phone bottom sheet always rises: it is attached to the
   * screen edge, and scaling would pull it off that edge mid-animation.
   */
  origin?: ViewportPoint
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className,
  sheet = false,
  origin,
}: ModalProps) {
  const reduce = useReducedMotion()
  const fromOrigin = !!origin && !isPhoneSheet(sheet)

  // Escape, scroll lock, focus trap and focus restore all live in useDialog so
  // this modal and AuthModal cannot drift apart. This used to handle only the
  // first two, which left a keyboard user focused on the page behind the
  // dialog, tabbing through content the backdrop was covering.
  const panelRef = useDialog<HTMLDivElement>(isOpen, onClose)

  // Pin the panel's scaling to the opener. Written straight to the element
  // before paint, so the first frame already grows from the right place.
  const originX = fromOrigin && origin ? origin.x : null
  const originY = fromOrigin && origin ? origin.y : null
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!isOpen || !el) return
    el.style.transformOrigin = ''
    if (originX === null || originY === null) return
    const r = el.getBoundingClientRect()
    el.style.transformOrigin = transformOriginFor(
      { x: originX, y: originY },
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      el.offsetWidth,
      el.offsetHeight,
    )
  }, [isOpen, originX, originY, panelRef])

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
            animate={{ opacity: 1, transition: glide(reduce, GLIDE.base) }}
            exit={{ opacity: 0, transition: glide(reduce, GLIDE.fast) }}
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
            initial={reduce ? { opacity: 0 } : fromOrigin ? { opacity: 0, scale: ORIGIN_SCALE } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: glide(reduce, GLIDE.slow) }}
            exit={
              reduce
                ? { opacity: 0 }
                : fromOrigin
                  ? { opacity: 0, scale: ORIGIN_SCALE, transition: glide(reduce, GLIDE.fast) }
                  : { opacity: 0, y: 12, transition: glide(reduce, GLIDE.fast) }
            }
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
