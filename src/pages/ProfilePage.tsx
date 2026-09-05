// ============================================
// ProfilePage — the account itself: who you are, your password, and the exits
//
// Restyle only. Every handler below — the profile save, the avatar URL check,
// the reset-password trigger, the data wipe and the account deletion — is
// unchanged, including the reload after a wipe and the case-folded email
// confirmation before a delete.
//
// What changed is the shape. This was a 7/5 grid with the destructive actions
// parked in a right-hand column, so on a phone the two danger cards landed
// under the profile form with no separation, and every label was 12px uppercase
// — the same "reads as small print" problem Settings had. It is one column of
// section cards now, body copy at `text-sm`, the shared `Input` carrying its
// own label, and the danger zone kept behind a disclosure that says plainly
// what is inside it.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { AlertCircle, CheckCircle2, KeyRound, ChevronDown, TriangleAlert, Trash2, UserRound } from 'lucide-react'
import { AppLayout } from '@/layouts'
import { Card, Button, Input, ConfirmDialog, panelVariants, transition } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context'
import {
  getProfile,
  updateProfile,
  resetAccountData,
  deleteAccount
} from '@/services'

export default function ProfilePage() {
  const { user, resetPassword, signOut, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false)
  const [showDangerZone, setShowDangerZone] = useState(false)

  // Profile Form States
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '')
  const [avatarUrl, setAvatarUrl] = useState(user?.user_metadata?.avatar_url || '')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)

  // Password reset States
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Reset Account Data States
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  const [error, setError] = useState<string | null>(null)

  // Delete Account States
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    document.title = `Your account | ${APP_CONFIG.APP_NAME}`
    // Load fresh profile details
    getProfile().then(({ data }) => {
      if (data) {
        setFullName(data.full_name || '')
        setAvatarUrl(data.avatar_url || '')
      }
    })
  }, [])

  // Sync with auth metadata if profile fetch returns empty or delays
  useEffect(() => {
    if (user?.user_metadata) {
      if (!fullName && user.user_metadata.full_name) {
        setFullName(user.user_metadata.full_name)
      }
      if (!avatarUrl && user.user_metadata.avatar_url) {
        setAvatarUrl(user.user_metadata.avatar_url)
      }
    }
  }, [user])

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileLoading(true)
    setProfileSuccess(false)
    setError(null)

    try {
      // cleanAvatarUrl in profiles.ts stores NULL for anything that is not an
      // http(s) URL — a data: URI, a bare domain, a typo — and returns no
      // error, so the page used to show "Changes updated successfully" while
      // the avatar had been thrown away. Rejecting it here means the user is
      // told, rather than discovering it on the next reload.
      const trimmedAvatar = avatarUrl.trim()
      if (trimmedAvatar && !/^https?:\/\//i.test(trimmedAvatar)) {
        throw new Error('Avatar image URL must start with http:// or https://')
      }
      const { error } = await updateProfile({
        fullName,
        avatarUrl,
      })
      if (error) throw error
      await refreshProfile()
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    } catch (err: any) {
      console.error('Error saving profile:', err)
      setError(err.message || 'Failed to update profile settings.')
    } finally {
      setProfileLoading(false)
    }
  }

  // The one shared error banner lives at the top of the page. On a phone the
  // layout stacks, so a failure in the danger zone writes its message roughly
  // two screens above where the user is looking — a failed deletion looked
  // like nothing happening at all. Scrolling to it is the smallest honest fix.
  const surfaceError = (message: string) => {
    setError(message)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.email) return

    setPasswordLoading(true)
    setPasswordSuccess(false)
    setError(null)

    try {
      // resetPassword resolves to { error: string | null } — a STRING, not an
      // Error. `throw error` then met `err.message` in the catch, which is
      // undefined on a string, so every failure showed the generic fallback.
      // The message that matters most here is Supabase's 60-second rate limit,
      // which tells the user exactly what to do and was never being shown.
      const { error } = await resetPassword(user.email)
      if (error) throw new Error(error)
      setPasswordSuccess(true)
      setTimeout(() => setPasswordSuccess(false), 5000)
    } catch (err: any) {
      console.error('Error resetting password:', err)
      surfaceError(err.message || 'Failed to trigger password reset.')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleWipeData = async () => {
    setResetLoading(true)
    setResetSuccess(false)
    setError(null)

    try {
      // Returns a bare PostgrestError, or { error: Error } when unauthenticated.
      // Throwing either lost the real cause, for the same reason as above.
      const error = await resetAccountData()
      if (error) {
        const message =
          (error as { message?: string }).message ??
          ((error as { error?: { message?: string } }).error?.message) ??
          'Failed to reset account data.'
        throw new Error(message)
      }

      setResetSuccess(true)

      // Actually reload, rather than only claiming to.
      //
      // The banner said "Refreshing dashboard..." and nothing happened: there
      // is no transactions context to invalidate — every page fetches on mount
      // — so the deleted rows stayed on screen everywhere the user had already
      // been. After a destructive wipe that reads as the delete having failed.
      // A full reload is the honest version of what the message promises, and
      // this is a once-ever action, so the cost of one is irrelevant.
      // Delayed so the confirmation is legible first.
      setTimeout(() => window.location.reload(), 1500)
    } catch (err: any) {
      console.error('Error wiping user data:', err)
      surfaceError(err.message || 'Failed to clear account databases.')
    } finally {
      setResetLoading(false)
    }
  }

  /**
   * Does the typed confirmation match the account's email?
   *
   * Compared trimmed and case-folded, not with ===. The strict form rejected a
   * trailing space picked up from a copy-paste and rejected a capitalised
   * address — neither of which is a different email to any real person — and
   * the only feedback was a permanently greyed-out button with no explanation.
   * The confirmation exists to prove intent, not to test typing accuracy, and a
   * gate that fails silently reads as a broken app rather than as a gate.
   */
  const deleteConfirmMatches =
    !!user?.email &&
    deleteConfirmEmail.trim().toLowerCase() === user.email.trim().toLowerCase()

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!deleteConfirmMatches) return

    setDeleteLoading(true)
    setError(null)

    try {
      const { success, error: deleteErr, method } = await deleteAccount()
      if (!success) {
        throw deleteErr || new Error('An error occurred during account deletion.')
      }

      // No "wiped but errored" branch: deleteAccount only ever reports success
      // with a null error — a partial deletion comes back success:false and is
      // thrown above. The branch that used to be here could not run.
      showToast(
        method === 'rpc'
          ? 'Your account and all data have been deleted. Thank you for using Intrack.'
          : 'Account data deleted. You have been signed out.',
        'success'
      )

      // Give the toast a moment to be seen before signOut redirects away.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await signOut()
    } catch (err: any) {
      console.error('Error deleting account:', err)
      surfaceError(err.message || 'Failed to execute account deletion.')
      setDeleteLoading(false)
    }
  }

  const reduce = useReducedMotion()

  const initial = (fullName.trim()[0] || user?.email?.[0] || 'U').toUpperCase()

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">Your account</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Your name and picture, your password, and the two ways to clear out what Intrack
            holds for you.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-4 text-sm leading-relaxed text-[var(--status-danger-text)]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-6 md:mt-8">
          {/* Profile */}
          <Card>
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-100">
              <UserRound className="h-5 w-5 shrink-0 text-brand-400" aria-hidden="true" />
              <span>Profile</span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
              Your name is what Intrack calls you around the app. Nothing here is shared with
              anyone.
            </p>

            <form onSubmit={handleProfileSave} className="mt-6 flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-default bg-surface-2 text-lg font-semibold text-zinc-300">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initial
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">
                    {fullName.trim() || 'No name set'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">{user?.email}</p>
                </div>
              </div>

              <Input
                id="profile-email"
                label="Email"
                value={user?.email || ''}
                disabled
              />
              <p className="-mt-3 text-xs text-zinc-400">
                This is how you sign in, so it cannot be changed here. Contact support if it
                needs to move.
              </p>

              <Input
                id="profile-name"
                label="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                disabled={profileLoading}
                required
              />

              <Input
                id="profile-avatar"
                label="Picture URL (optional)"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                disabled={profileLoading}
              />
              <p className="-mt-3 text-xs text-zinc-400">
                Must start with http:// or https://. The circle above previews it as you type.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-start">
                <Button
                  type="submit"
                  loading={profileLoading}
                  disabled={profileLoading}
                  className="!h-11 w-full justify-center sm:w-auto"
                >
                  Save changes
                </Button>
                <AnimatePresence initial={false}>
                  {profileSuccess && (
                    <motion.p
                      key="profile-saved"
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                      transition={transition(reduce)}
                      role="status"
                      className="flex items-center gap-2 text-sm font-medium text-[var(--status-positive-text)]"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Saved
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </form>
          </Card>

          {/* Password */}
          <Card>
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-100">
              <KeyRound className="h-5 w-5 shrink-0 text-brand-400" aria-hidden="true" />
              <span>Password</span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
              Forgotten your password? We'll email a reset link to{' '}
              <strong className="font-semibold text-zinc-200">{user?.email}</strong>. If you still
              know it, changing it from Settings is faster — no email involved.
            </p>

            <form onSubmit={handlePasswordReset} className="mt-5 flex flex-col gap-4">
              <AnimatePresence initial={false}>
                {passwordSuccess && (
                  <motion.div
                    key="password-sent"
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={transition(reduce)}
                    role="status"
                    className="flex items-start gap-2.5 rounded-xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-positive-text)]"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Reset link sent. Check your inbox, and your spam folder if it isn't there.</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                variant="secondary"
                type="submit"
                block
                loading={passwordLoading}
                disabled={passwordLoading}
                className="!h-11 justify-center"
              >
                Email me a reset link
              </Button>
            </form>
          </Card>

          {/* Danger zone, behind a disclosure. Two irreversible actions do not
              belong one tap away from "Save changes". */}
          {!showDangerZone ? (
            <button
              type="button"
              onClick={() => setShowDangerZone(true)}
              aria-expanded={false}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-1 text-sm font-medium text-zinc-300 transition-colors hover:border-border-hover hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Delete my data or my account
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <motion.div
              variants={panelVariants(reduce)}
              initial="initial"
              animate="animate"
              transition={transition(reduce)}
              className="flex flex-col gap-6"
            >
              {/* Reset data */}
              <Card className="border-[var(--status-danger-border)]">
                <h2 className="flex items-center gap-2 text-base font-bold text-[var(--status-danger-text)]">
                  <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Erase your transactions</span>
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  Deletes every transaction, budget and scan log on this account. Your learned
                  merchant rules and saved cards stay. Your login stays. This cannot be undone.
                </p>

                <div className="mt-5 flex flex-col gap-4">
                  <AnimatePresence initial={false}>
                    {resetSuccess && (
                      <motion.div
                        key="wipe-done"
                        initial={reduce ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                        transition={transition(reduce)}
                        role="status"
                        className="flex items-start gap-2.5 rounded-xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] p-3.5 text-sm leading-relaxed text-[var(--status-positive-text)]"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>Done. Your transactions, budgets and scan logs are gone — reloading the app…</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <Button
                    variant="danger"
                    block
                    onClick={() => setConfirmWipeOpen(true)}
                    loading={resetLoading}
                    disabled={resetLoading}
                    className="!h-11 justify-center"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Erase my transactions
                  </Button>
                </div>
              </Card>

              {/* Delete account */}
              <Card className="border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)]">
                <h2 className="flex items-center gap-2 text-base font-bold text-[var(--status-danger-text)]">
                  <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Delete your account</span>
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">
                  Deletes your login and everything attached to it — transactions, budgets,
                  learned rules, saved cards and scan logs.{' '}
                  <strong className="font-semibold">This cannot be undone.</strong>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  One thing survives, and only with your name taken off it: any feedback or
                  support message you sent is kept with your name and email replaced, so a
                  problem you reported does not vanish with you. The Privacy Policy sets this
                  out in full.
                </p>

                <form onSubmit={handleDeleteAccount} className="mt-5 flex flex-col gap-4">
                  <div>
                    <Input
                      id="delete-confirm-email"
                      label="Type your email address to confirm"
                      type="email"
                      autoComplete="off"
                      placeholder={user?.email || 'you@example.com'}
                      value={deleteConfirmEmail}
                      onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                      disabled={deleteLoading}
                      required
                      className="border-[var(--status-danger-border)]"
                    />
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                      {deleteConfirmEmail.trim() !== '' && !deleteConfirmMatches
                        ? 'That is not the email on this account yet, so the button below stays disabled.'
                        : <>The address on this account is <span className="select-all break-all font-medium text-zinc-300">{user?.email}</span>.</>}
                    </p>
                  </div>
                  {/*
                    The fill is --status-danger-solid and the label is forced
                    white, together.

                    This used to set the background to --status-danger-text
                    while the `danger` variant sets the TEXT colour to that
                    same variable — so the label was the exact colour of the
                    fill and invisible, in both themes, enabled or disabled.
                    The control rendered as a blank coloured bar and read as
                    broken, on the one screen where someone is exercising
                    their right to erasure.

                    Simply forcing white on the old background was not enough:
                    --status-danger-text is tuned to be READ as text on a dark
                    surface (#f47174), so white on it measures ~2.6:1, under
                    the 4.5:1 floor. --status-danger-solid exists for this —
                    a fill dark enough in both themes to carry white.
                  */}
                  <Button
                    variant="danger"
                    type="submit"
                    block
                    disabled={!deleteConfirmMatches || deleteLoading}
                    loading={deleteLoading}
                    className="!h-11 justify-center bg-[var(--status-danger-solid)] text-static-white transition-all duration-200 hover:opacity-90 active:opacity-80 disabled:opacity-40"
                  >
                    Permanently delete my account
                  </Button>
                </form>
              </Card>
            </motion.div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmWipeOpen}
        onClose={() => setConfirmWipeOpen(false)}
        onConfirm={async () => {
          await handleWipeData()
          setConfirmWipeOpen(false)
        }}
        title="Erase your transactions?"
        message="Every transaction, budget and scan log on this account will be permanently deleted. Your login, saved cards and learned merchant rules stay. This cannot be undone."
        confirmLabel="Erase them"
      />
    </AppLayout>
  )
}
