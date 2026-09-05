// ============================================
// ResetPasswordPage — set a new password from a recovery link
//
// Restyle only. The recovery-session check, the validation rules and the
// supabase.auth.updateUser call are untouched; what changed is what the person
// sees while the session is checked, what a failure says, and the fact that the
// three states (checking / invalid link / form) now look like the same product.
//
// The old loading state was a bare spinner on a hardcoded `bg-zinc-950` — a
// dark rectangle in a light-only app, drawn before anything else could tell the
// user what was happening. It is a skeleton of the form that is about to
// arrive instead.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react'
import AuthLayout from '@/layouts/AuthLayout'
import { Button, Input, Skeleton } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { supabase } from '@/services'

/**
 * Supabase's update-password errors, said in words that name the fix.
 *
 * Presentation only. Anything unrecognised is passed through unchanged — a
 * failure this list has not met should still reach the user rather than being
 * flattened into a wrong guess.
 */
function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('should be different') || m.includes('same as the old')) {
    return 'That is the password you already had. Choose a different one.'
  }
  if (m.includes('at least') || m.includes('too short') || m.includes('length')) {
    return 'That password is too short. Use at least 6 characters.'
  }
  if (m.includes('expired') || m.includes('invalid') || m.includes('session')) {
    return 'This reset link has expired. Request a new one and try again.'
  }
  if (m.includes('fetch') || m.includes('network')) {
    return 'Could not reach Intrack. Check your connection and try again.'
  }
  return message
}

export default function ResetPasswordPage() {
  const { user, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    document.title = `Set a new password | ${APP_CONFIG.APP_NAME}`
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateErr) {
        setError(updateErr.message)
      } else {
        setSuccess(true)
        showToast('🔑 Password reset successfully! Redirecting you...', 'success')
        setTimeout(() => {
          navigate('/dashboard')
        }, 2000)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Held space while auth initialises: the shape of the form that is coming,
  // not a spinner over an empty page.
  if (authLoading) {
    return (
      <AuthLayout title="Set a new password" subtitle="Checking your reset link…">
        <div role="status" aria-label="Checking your reset link" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton shape="block" className="h-11 w-full" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton shape="block" className="h-11 w-full" />
          </div>
          <Skeleton shape="block" className="h-10 w-full" />
        </div>
      </AuthLayout>
    )
  }

  // Supabase signs the user in temporarily under the recovery flow, so no user
  // means they did not arrive from a valid recovery link.
  if (!user) {
    return (
      <AuthLayout
        title="This reset link no longer works"
        subtitle="Links expire, and each one can only be used once."
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] p-4">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-warning-text)]"
              aria-hidden="true"
            />
            <p className="text-sm leading-relaxed text-[var(--status-warning-text)]">
              Your password has not been changed. Request a fresh link and open it from the
              same device — the newest email is always the one that works.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link to="/forgot-password" className="block w-full">
              <Button block className="!h-11 justify-center">Send me a new link</Button>
            </Link>
            <Link to="/?auth=login" className="block w-full">
              <Button variant="ghost" block className="!h-11 justify-center">
                Back to sign in
              </Button>
            </Link>
          </div>
        </div>
      </AuthLayout>
    )
  }

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword

  return (
    <AuthLayout
      title="Set a new password"
      subtitle={user.email ? `You are resetting the password for ${user.email}.` : undefined}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-danger-text)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{readable(error)}</span>
          </div>
        )}

        {success && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-positive-text)]"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Password changed. Taking you to your dashboard…</span>
          </div>
        )}

        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={loading || success}
          autoFocus
        />

        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Type it once more"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={loading || success}
          error={mismatch ? 'The two passwords do not match yet.' : undefined}
        />

        <Button type="submit" block className="!h-11" loading={loading} disabled={loading || success}>
          {success ? 'Password changed' : loading ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
