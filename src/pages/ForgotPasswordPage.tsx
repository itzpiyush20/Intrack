// ============================================
// ForgotPasswordPage — request a password reset link by email
//
// Restyle only: the submit path, the service call and the sent/error states are
// exactly as they were. What changed is what the person reads. Supabase's raw
// message ("For security purposes, you can only request this after 47 seconds")
// was being printed verbatim; `readable()` below turns the two failures that
// actually happen into a sentence that says what to do next, and keeps the raw
// text for anything unrecognised rather than swallowing it.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck, AlertCircle, ArrowLeft } from 'lucide-react'
import AuthLayout from '@/layouts/AuthLayout'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'

/**
 * Turn a Supabase auth error into something a person can act on.
 *
 * Presentation only — every branch describes the same failure the service
 * already reported, and an unrecognised message is passed through rather than
 * replaced, so a new failure mode is never silently reworded into a wrong one.
 */
function readable(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate') || m.includes('after') || m.includes('security purposes')) {
    return 'A reset link was requested very recently. Wait a minute, then try again — the first link is still valid.'
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'That does not look like a complete email address. Check it and try again.'
  }
  if (m.includes('fetch') || m.includes('network')) {
    return 'Could not reach Intrack. Check your connection and try again.'
  }
  return message
}

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth()

  useEffect(() => {
    document.title = `Forgot password | ${APP_CONFIG.APP_NAME}`
  }, [])

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await resetPassword(email)

    if (error) {
      setError(error)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="The link opens a page where you set a new password."
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-4">
            <MailCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-positive-text)]"
              aria-hidden="true"
            />
            <p className="text-sm leading-relaxed text-[var(--status-positive-text)]">
              A reset link is on its way to{' '}
              <span className="font-semibold break-all">{email}</span>.
            </p>
          </div>

          <ul className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-400">
            <li>The link works once. If it has expired, request another.</li>
            <li>Nothing arrived? Check spam, then try again in a minute.</li>
          </ul>

          <div className="flex flex-col gap-3">
            <Link to="/?auth=login" className="block w-full">
              <Button variant="secondary" block className="!h-11 justify-center">
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                Back to sign in
              </Button>
            </Link>
            <Button
              variant="ghost"
              block
              className="!h-11 justify-center"
              onClick={() => { setSent(false); setError('') }}
            >
              Use a different email
            </Button>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Tell us the email on your account and we'll send a link to set a new password."
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

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />

        <Button type="submit" block className="!h-11" loading={loading}>
          {loading ? 'Sending link…' : 'Send reset link'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-zinc-400">
        Remembered it?{' '}
        <Link
          to="/?auth=login"
          className="rounded font-medium text-brand-400 underline underline-offset-2 transition-colors hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
