// ============================================
// AuthModal — sign in / create account, in place
//
// Restyle only. Every call, guard and state transition below is unchanged:
// signIn, signUp, signInWithGoogle, the terms gate, the 6-character check, the
// toast copy and the redirect all behave exactly as before.
//
// Why this is not the shared `Modal`, despite matching it pixel for pixel:
// `Modal` routes the backdrop, the ✕ and Escape through one `onClose`, and this
// dialog deliberately treats them differently — a backdrop click with a
// half-filled signup in it is ignored, because it used to throw away a typed
// name, email and password with no warning and no undo (see
// `handleBackdropClick`). Adopting `Modal` would delete that protection, so the
// panel stays local and mirrors `Modal`'s markup, sizing and sheet behaviour
// instead. If `Modal` ever grows a "guard dismissal" hook, this should move onto
// it.
//
// The visible changes: body copy is `text-sm` (the whole dialog was 12px), the
// tab switcher has one indicator that travels rather than two that blink, the
// error banner uses the status tokens and says what to do about the failure
// instead of printing Supabase's sentence, and the panel is a bottom sheet on a
// phone.
// ============================================

import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { X, AlertCircle, IdCard, Inbox, Check } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { APP_CONFIG } from '@/constants'
import { useToast } from '@/context'
import { useDialog } from '@/hooks'
import { cn } from '@/utils'
import { Button, Input, INDICATOR_SPRING, transition } from '@/components/ui'

/**
 * What a sign-in or sign-up failure should say to the person who hit it.
 *
 * Presentation only: each branch renames a failure the service already
 * reported, and anything unrecognised is passed through untouched so a new
 * failure mode is never reworded into the wrong advice. "Invalid login
 * credentials" is the one that matters — it is the message a real customer
 * meets most often, and on its own it does not tell them a reset link exists.
 */
function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid credentials')) {
    return 'That email and password don’t match an Intrack account. Check both — or reset your password below.'
  }
  if (m.includes('email not confirmed') || m.includes('not confirmed')) {
    return 'This account still needs confirming. Open the verification link in your inbox, then sign in.'
  }
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'An account already exists for that email. Switch to Sign in, or reset the password if you’ve forgotten it.'
  }
  if (m.includes('rate') || m.includes('security purposes') || m.includes('too many')) {
    return 'Too many attempts in a row. Wait a minute, then try again.'
  }
  if (m.includes('fetch') || m.includes('network')) {
    return 'Could not reach Intrack. Check your connection and try again.'
  }
  return message
}

export default function AuthModal() {
  const {
    authModalOpen,
    authModalRedirect,
    authModalTab,
    closeAuthModal,
    signIn,
    signUp,
    signInWithGoogle,
  } = useAuth()

  const { showToast } = useToast()
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const [isSignUp, setIsSignUp] = useState(authModalTab === 'signup')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [agreeToTerms, setAgreeToTerms] = useState(false)

  // Keep switcher tab in sync when the modal is opened
  useEffect(() => {
    if (authModalOpen) {
      setIsSignUp(authModalTab === 'signup')
    }
  }, [authModalOpen, authModalTab])

  // Escape, focus trap, scroll lock, focus restore. Declared before the early
  // return below so hook order stays stable across open and closed renders.
  const panelRef = useDialog<HTMLDivElement>(authModalOpen, closeAuthModal)

  // Clicking the backdrop used to discard a half-filled signup — name, email
  // and password gone, with no warning and no undo. Anything typed makes the
  // dismissal deliberate: use the ✕ or Escape.
  const hasUnsavedInput = Boolean(fullName || email || password)
  const handleBackdropClick = () => {
    if (hasUnsavedInput) return
    closeAuthModal()
  }

  if (!authModalOpen) return null

  const handleRedirect = () => {
    closeAuthModal()
    if (authModalRedirect) {
      navigate(authModalRedirect)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (isSignUp) {
      if (!agreeToTerms) {
        setError('You must agree to the Terms of Service & Privacy Policy to create an account.')
        setLoading(false)
        return
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        setLoading(false)
        return
      }
      const { error: signUpErr } = await signUp(email, password, fullName)
      if (signUpErr) {
        setError(signUpErr)
        setLoading(false)
      } else {
        showToast('✉️ Verification email sent! Please check your inbox.', 'success')
        closeAuthModal()
        setLoading(false)
      }
    } else {
      const { error: signInErr } = await signIn(email, password)
      if (signInErr) {
        setError(signInErr)
        setLoading(false)
      } else {
        showToast('👋 Welcome back!', 'success')
        handleRedirect()
        setLoading(false)
      }
    }
  }

  const handleGoogleAuth = async () => {
    const destination = authModalRedirect || '/dashboard'
    // Sign-in asks Google for name and email only — never gmail.readonly.
    //
    // Bundling the inbox scope into login meant every Google signer, including
    // someone who only ever types expenses in by hand, was shown a restricted
    // scope request and the unverified-app warning before they had seen the
    // product. Google's own guidance is to request a scope at the moment it is
    // needed, and asking for a restricted one at first sign-in is a standard
    // rejection reason in their verification review.
    //
    // Gmail is requested later, in context, from the Connect Gmail Inbox
    // button on the Pending Alerts page (`handleReconnectGoogle` there passes
    // requestGmailScope = true). Basic scopes show a plain consent screen with
    // no warning attached.
    const { error: oAuthErr } = await signInWithGoogle(destination, false)
    if (oAuthErr) {
      setError(oAuthErr)
    } else {
      closeAuthModal()
    }
  }

  const tabs = [
    { id: 'signin', label: 'Sign in', active: !isSignUp, select: () => { setIsSignUp(false); setError(''); setAgreeToTerms(false) } },
    { id: 'signup', label: 'Create account', active: isSignUp, select: () => { setIsSignUp(true); setError(''); setAgreeToTerms(false) } },
  ]

  return (
    <div
      className="fixed inset-0 z-modal flex justify-center overflow-hidden items-end sm:items-start p-0 sm:p-4 sm:pt-10"
      onClick={handleBackdropClick}
    >
      {/* Same backdrop as the shared Modal, so a dialog opened from the
          marketing page and one opened inside the app are the same object. */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      <motion.div
        ref={panelRef}
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition(reduce)}
        className={cn(
          'relative w-full max-w-md bg-surface-1 border border-sb-hairline shadow-[0_20px_60px_-15px_rgba(14,122,93,0.18)]',
          'flex flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl',
          'max-h-[92svh] sm:max-h-[88svh]'
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
      >
        {/* Subtle Ambient Emerald Top Arc */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(14,122,93,0.12),transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sb-hairline px-5 py-4 sm:px-6 relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
            </span>
            <h2 id="auth-modal-title" className="text-base font-bold tracking-tight text-sb-ink">
              {isSignUp ? `Create your ${APP_CONFIG.APP_NAME} account` : `Sign in to ${APP_CONFIG.APP_NAME}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeAuthModal}
            className="flex h-9 w-9 shrink-0 -mr-1 cursor-pointer items-center justify-center rounded-xl border border-sb-hairline bg-surface-2/60 text-sb-ink-muted transition-colors hover:bg-surface-2 hover:text-sb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 relative z-10">
          {/* Tab switcher — traveling indicator */}
          <div
            role="tablist"
            aria-label="Sign in or create an account"
            className="flex gap-1 rounded-2xl border border-sb-hairline bg-surface-2/60 p-1 shadow-inner"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.active}
                onClick={t.select}
                className={cn(
                  'relative flex h-10 flex-1 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent',
                  'text-xs sm:text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                  t.active ? 'text-brand-700 font-bold' : 'text-sb-ink-muted hover:text-sb-ink'
                )}
              >
                {t.active && (
                  <motion.span
                    layoutId="auth-tab-indicator"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xl border border-brand-500/30 bg-surface-1 shadow-sm"
                    transition={reduce ? { duration: 0 } : INDICATOR_SPRING}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-danger-text)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{readable(error)}</span>
              </div>
            )}

            {isSignUp && (
              <Input
                label="Full name"
                autoComplete="name"
                placeholder="Rahul Sharma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            )}

            <Input
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder={isSignUp ? 'At least 6 characters' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {!isSignUp && (
              <div className="-mt-1 flex justify-end">
                <Link
                  to="/forgot-password"
                  onClick={closeAuthModal}
                  className="rounded py-1.5 text-xs sm:text-sm font-semibold text-brand-600 underline underline-offset-4 transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            {isSignUp && (
              <div className="flex items-start gap-2.5">
                <label
                  htmlFor="agree_terms"
                  className="-m-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"
                >
                  <input
                    type="checkbox"
                    id="agree_terms"
                    checked={agreeToTerms}
                    onChange={(e) => setAgreeToTerms(e.target.checked)}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded border-sb-hairline bg-surface-1 accent-[var(--brand-600)]"
                  />
                </label>
                <label
                  htmlFor="agree_terms"
                  className="cursor-pointer select-none text-xs sm:text-sm leading-relaxed text-sb-ink-secondary"
                >
                  I agree to the{' '}
                  <Link to="/terms" onClick={closeAuthModal} className="font-semibold text-brand-600 underline underline-offset-2 transition-colors hover:text-brand-700">Terms of Service</Link>,{' '}
                  <Link to="/privacy" onClick={closeAuthModal} className="font-semibold text-brand-600 underline underline-offset-2 transition-colors hover:text-brand-700">Privacy Policy</Link>{' '}and{' '}
                  <Link to="/refund-policy" onClick={closeAuthModal} className="font-semibold text-brand-600 underline underline-offset-2 transition-colors hover:text-brand-700">Refund Policy</Link>, and consent to my bank alert emails being read to extract transactions, including by Google’s Gemini as described in the Privacy Policy.
                </label>
              </div>
            )}

            <Button type="submit" block size="md" loading={loading} className="!h-11 shadow-sm font-semibold">
              {isSignUp ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          {/* Divider */}
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-sb-hairline" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider text-sb-ink-muted">or</span>
            <span className="h-px flex-1 bg-sb-hairline" aria-hidden="true" />
          </div>

          {/* Google OAuth */}
          <Button
            type="button"
            variant="secondary"
            block
            size="md"
            onClick={handleGoogleAuth}
            className="justify-center gap-2.5 !h-11 border-sb-hairline bg-surface-1 font-semibold text-sb-ink hover:bg-surface-2 transition-all"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>

          {/* What signing in with Google actually asks for */}
          <div className="mt-5 rounded-2xl border border-sb-hairline bg-surface-2/60 p-4">
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-2.5">
                <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                <p className="text-xs sm:text-sm leading-relaxed text-sb-ink-secondary">
                  <span className="font-semibold text-sb-ink">Google is asked for your name and email.</span>{' '}
                  That is the whole request — this button does not ask for access to your inbox.
                </p>
              </li>
              <li className="flex items-start gap-2.5">
                <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                <p className="text-xs sm:text-sm leading-relaxed text-sb-ink-secondary">
                  <span className="font-semibold text-sb-ink">Inbox scanning is separate.</span>{' '}
                  If you want {APP_CONFIG.APP_NAME} to pull transactions out of your bank alert
                  emails, you connect Gmail later from the Pending Alerts page — read-only, and
                  explained in full there before you decide.
                </p>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                <p className="text-xs sm:text-sm leading-relaxed text-sb-ink-secondary">
                  <span className="font-semibold text-sb-ink">Never connect it and nothing breaks.</span>{' '}
                  Every part of {APP_CONFIG.APP_NAME} works with expenses you enter yourself.
                </p>
              </li>
            </ul>
            <p className="mt-3 border-t border-sb-hairline pt-3 text-xs leading-relaxed text-sb-ink-muted">
              How your data is handled is set out in our{' '}
              <Link to="/privacy" onClick={closeAuthModal} className="font-semibold text-brand-600 underline underline-offset-2 transition-colors hover:text-brand-700">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
