// ============================================
// ResetPasswordPage — Set a new account password
// ============================================

import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import AuthLayout from '@/layouts/AuthLayout'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import { supabase } from '@/services'

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
    document.title = 'Reset Password | Intrack'
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

  // Show a loading screen while auth initializes
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <span className="text-xs text-zinc-500 font-medium">Checking session…</span>
        </div>
      </div>
    )
  }

  // Verify the user is authenticated (Supabase logs the user in temporarily under recovery flow)
  // If not logged in, they didn't arrive from a valid recovery hash link.
  if (!user) {
    return (
      <AuthLayout
        title="Invalid Link"
        subtitle="Password reset session is invalid or expired"
      >
        <div className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <span className="text-3xl text-red-500">⚠️</span>
          </div>
          <p className="text-sm text-zinc-400">
            Your reset link is invalid, expired, or has already been used. Please request a new password reset link.
          </p>
          <div className="pt-2 flex flex-col gap-3">
            <Link
              to="/forgot-password"
              className="sb-btn-primary py-3.5 px-4 text-xs font-bold rounded-xl no-underline inline-block text-white"
            >
              Request New Link
            </Link>
            <Link
              to="/?auth=login"
              className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold transition-colors py-2 inline-block"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Set New Password"
      subtitle="Enter your new secure password below"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400">
            🎉 Password updated successfully! Accessing dashboard...
          </div>
        )}

        <Input
          label="New Password"
          type="password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={loading || success}
        />

        <Input
          label="Confirm New Password"
          type="password"
          placeholder="Repeat your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={loading || success}
        />

        <Button type="submit" block loading={loading} disabled={loading || success}>
          Update Password & Login
        </Button>
      </form>
    </AuthLayout>
  )
}
