// ============================================
// UserMenu — Reusable signed-in identity + dropdown
// Single source of truth for the avatar + name + menu
// shown in public-page navbars (Landing, legal pages).
// Calm & Trustworthy styling (sb- tokens, no glass).
// ============================================

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants'
import { cn } from '@/utils'
import { useAuth } from '@/context/AuthContext'

interface UserMenuProps {
  /** Extra classes for the trigger button wrapper. */
  className?: string
}

/**
 * Derive a friendly first name, ignoring common titles (CA, Dr, Mr…).
 * Mirrors the logic used in AppLayout / DashboardPage so the name shown
 * is identical everywhere.
 */
function deriveFirstName(profile: any, user: any): string {
  const nameToParse =
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.first_name ||
    user?.email?.split('@')[0] ||
    'Account'

  const parts = String(nameToParse).trim().split(/\s+/)
  let result = parts[0]
  const cleanWord = (word: string) => word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (parts.length > 1 && ['ca', 'dr', 'mr', 'ms', 'mrs'].includes(cleanWord(parts[0]))) {
    result = parts[1]
  }
  return result
}

export default function UserMenu({ className }: UserMenuProps) {
  const { user, profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  if (!user) return null

  const firstName = deriveFirstName(profile, user)
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
  const initial =
    (profile?.full_name || user?.user_metadata?.full_name || user?.email || 'U')
      .toString()
      .trim()
      .substring(0, 1)
      .toUpperCase()

  const menuLink =
    'flex items-center gap-2 rounded-lg px-3 py-2.5 min-h-11 text-xs font-medium text-sb-ink no-underline transition-colors hover:bg-sb-canvas-soft'

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-11 px-1 text-sb-ink transition-colors cursor-pointer"
        aria-label="User profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="h-7 w-7 rounded-full bg-brand-500/10 flex items-center justify-center text-[11px] font-bold text-brand-500 overflow-hidden border border-brand-500/25 shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <span className="text-xs font-semibold truncate max-w-[90px] hidden sm:inline">{firstName}</span>
        <span className="text-xs opacity-60" aria-hidden="true">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            className="absolute right-0 mt-2 w-48 rounded-xl border border-sb-hairline bg-sb-canvas p-2 shadow-[var(--shadow-md)] z-50 animate-scale-up"
          >
            <Link to={ROUTES.DASHBOARD} onClick={() => setOpen(false)} className={menuLink} role="menuitem">
              📊 Home
            </Link>
            <Link to="/profile" onClick={() => setOpen(false)} className={menuLink} role="menuitem">
              👤 Profile Section
            </Link>
            <Link to="/settings" onClick={() => setOpen(false)} className={menuLink} role="menuitem">
              ⚙️ Settings Section
            </Link>
            <Link to="/pricing" onClick={() => setOpen(false)} className={menuLink} role="menuitem">
              👑 Pricing & Plans
            </Link>
            <Link to="/#install-guide" onClick={() => setOpen(false)} className={menuLink} role="menuitem">
              📱 Install App Guide
            </Link>
            <button
              onClick={() => {
                setOpen(false)
                signOut()
              }}
              role="menuitem"
              className="w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 min-h-11 text-xs font-medium text-[var(--status-danger-text)] border-t border-sb-hairline mt-1.5 pt-1.5 cursor-pointer transition-colors hover:bg-[var(--status-danger-subtle)]"
            >
              🚪 Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
