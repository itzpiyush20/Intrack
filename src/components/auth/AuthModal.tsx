// ============================================
// AuthModal — In-context Authentication Popup
// Handles both Login and Signup processes without page redirects
// ============================================

import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { APP_CONFIG } from '@/constants'
import { useToast } from '@/context'
import { useDialog } from '@/hooks'
import { Button, Input } from '@/components/ui'

export default function AuthModal() {
  const {
    authModalOpen,
    authModalRedirect,
    authModalTab,
    closeAuthModal,
    signIn,
    signUp,
    signInWithGoogle,
    currencySymbol,
  } = useAuth()

  const { showToast } = useToast()
  const navigate = useNavigate()

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
    // Request Gmail scope by default so Gmail is connected immediately upon signing in with Google!
    const { error: oAuthErr } = await signInWithGoogle(destination, true)
    if (oAuthErr) {
      setError(oAuthErr)
    } else {
      closeAuthModal()
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="relative w-full max-w-md bg-surface-1 border border-border-default rounded-2xl shadow-[var(--shadow-lg)] p-6 sm:p-8 my-auto animate-scale-up text-zinc-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
      >
        {/* Close Button */}
        <button
          onClick={closeAuthModal}
          className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-50 rounded-xl hover:bg-surface-2 border-0 bg-transparent transition-colors cursor-pointer text-lg leading-none h-11 w-11 flex items-center justify-center"
          aria-label="Close authentication modal"
        >
          ✕
        </button>

        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-white shadow-[var(--shadow-sm)] border-0" aria-hidden="true">
            <span className="text-xl font-bold">{currencySymbol || '₹'}</span>
          </div>
          <h1 id="auth-modal-title" className="text-2xl font-black tracking-tight text-zinc-50 mb-1 flex items-center justify-center select-none">
            <span className="text-brand-400">In</span><span>track</span>
          </h1>
          <p className="text-xs font-bold tracking-wider text-emerald-400 uppercase text-center">
            Automated Spend Tracker
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-surface-2 rounded-xl p-1 mb-5 border border-border-subtle/50">
          <button
            type="button"
            onClick={() => { setIsSignUp(false); setError(''); setAgreeToTerms(false) }}
            className={`flex-1 py-2.5 text-xs font-semibold rounded-lg border-0 cursor-pointer transition-all ${
              !isSignUp
                ? 'bg-surface-1 text-zinc-50 shadow-md border border-border-subtle/30'
                : 'bg-transparent text-zinc-400 hover:text-zinc-50'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setIsSignUp(true); setError(''); setAgreeToTerms(false) }}
            className={`flex-1 py-2.5 text-xs font-semibold rounded-lg border-0 cursor-pointer transition-all ${
              isSignUp
                ? 'bg-surface-1 text-zinc-50 shadow-md border border-border-subtle/30'
                : 'bg-transparent text-zinc-400 hover:text-zinc-50'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {isSignUp && (
            <Input
              label="Full Name"
              placeholder="Rahul Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          )}

          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {isSignUp && (
            <div className="flex items-start gap-2.5 my-3">
              <input
                type="checkbox"
                id="agree_terms"
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-surface-2 accent-emerald-500 cursor-pointer"
              />
              <label htmlFor="agree_terms" className="text-[11px] text-zinc-400 leading-normal select-none cursor-pointer">
                I agree to the <Link to="/terms" onClick={closeAuthModal} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">Terms of Service</Link>, <Link to="/privacy" onClick={closeAuthModal} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">Privacy Policy</Link>, and <Link to="/refund-policy" onClick={closeAuthModal} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">Refund Policy</Link>, and consent to my bank alert emails being read to extract transactions, including by Google's Gemini as described in the Privacy Policy.
              </label>
            </div>
          )}

          {!isSignUp && (
            <div className="flex justify-end !mt-1">
              <Link
                to="/forgot-password"
                onClick={closeAuthModal}
                className="text-xs text-brand-400 hover:text-brand-300 font-medium transition-colors py-1.5 -my-1.5"
              >
                Forgot password?
              </Link>
            </div>
          )}

          <Button type="submit" block loading={loading} className="w-full py-2.5 text-xs font-bold">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border-subtle/50" />
          <span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">or</span>
          <div className="h-px flex-1 bg-border-subtle/50" />
        </div>

        {/* Google OAuth */}
        <Button
          type="button"
          variant="secondary"
          block
          onClick={handleGoogleAuth}
          className="flex items-center justify-center gap-2.5 text-xs font-semibold !h-11 shadow-sm"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
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

        {/* Calm, glanceable version of what Google sign-in means — shown
            before the user clicks through to Google's consent screen,
            rather than only reassuring after the fact. */}
        <div className="mt-5 p-3.5 rounded-2xl bg-surface-2 border border-border-subtle/50 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <span className="text-sm shrink-0 mt-0.5" aria-hidden="true">📩</span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              <strong className="text-zinc-50">What's read:</strong> only messages a bank-alert search returns. Judging whether one is a real transaction means reading it, so a few newsletters caught by that search get read too — and discarded.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-sm shrink-0 mt-0.5" aria-hidden="true">🔒</span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              <strong className="text-zinc-50">How it's read:</strong> your inbox is read straight from Gmail — we never hold a copy of your mailbox. To classify an alert, its subject and the start of its body pass through our server to Google's Gemini in real time. Nothing is retained afterwards and none of it trains any model.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-sm shrink-0 mt-0.5" aria-hidden="true">✅</span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              <strong className="text-zinc-50">What you get:</strong> transactions tracked automatically, with zero manual entry.
            </p>
          </div>
          <p className="text-xs text-zinc-500 leading-relaxed pt-1 border-t border-border-subtle/40">
            Prefer not to connect Gmail? Sign up with email/password instead — no external permissions requested, and you can link Gmail later from Settings. Since {APP_CONFIG.APP_NAME} is still completing Google's formal app verification, Google may show an "unverified app" screen with a developer key instead of our name — that's expected; click <span className="font-mono text-zinc-400">Advanced → Go to {APP_CONFIG.APP_NAME}</span> to continue safely.
          </p>
        </div>
      </div>
    </div>
  )
}
