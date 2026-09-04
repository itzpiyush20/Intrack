// ============================================
// ProfilePage — Security Profile & Danger Zones
// Manage profile, security reset, and account deletion
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect } from 'react'
import { AppLayout } from '@/layouts'
import { Card, Button, Input, Badge, ConfirmDialog } from '@/components/ui'
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
    document.title = `Security Profile | ${APP_CONFIG.APP_NAME}`
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

  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Security Profile</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Configure your personal finance identity, account credentials, and platform security.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)]">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-12">
          {/* Left panel: Profile details */}
          <div className="md:col-span-7 space-y-6">
            {/* Profile Settings Card */}
            <Card>
              <h2 className="text-base font-bold text-white mb-6">Profile Settings</h2>
              
              <form onSubmit={handleProfileSave} className="space-y-5">
                <div className="flex items-center gap-4">
                  {/* Mock preview avatar circle */}
                  <div className="h-14 w-14 rounded-full bg-surface-2 ring-2 ring-brand-500/50 flex items-center justify-center text-zinc-300 text-lg font-bold shrink-0 overflow-hidden shadow-md">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Preview" className="h-full w-full object-cover" />
                    ) : (
                      fullName.substring(0, 1).toUpperCase() || 'U'
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">Avatar Image</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Previews instantly on URL match</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    Email Address
                  </label>
                  <Input value={user?.email || ''} disabled />
                  <p className="text-xs text-zinc-400 mt-1">Unique login email identifier (disabled)</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    Full Display Name
                  </label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    disabled={profileLoading}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                    Avatar Image URL
                  </label>
                  <Input
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="e.g. https://images.unsplash.com/photo-..."
                    disabled={profileLoading}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                  {profileSuccess ? (
                    <Badge variant="success">✔️ Changes updated successfully</Badge>
                  ) : (
                    <div />
                  )}
                  <Button type="submit" loading={profileLoading} disabled={profileLoading} className="w-full sm:w-auto">
                    Save Profile Changes
                  </Button>
                </div>
              </form>
            </Card>

            {/* Security Reset Card */}
            <Card>
              <h2 className="text-base font-bold text-white mb-4">Credential Safety</h2>
              <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                Trigger a secure password reset link. We will send guidelines directly to <strong className="text-zinc-200">{user?.email}</strong>.
              </p>
              <p className="text-xs text-zinc-500 mb-6 leading-relaxed italic">
                Already logged in and know your current password? Change it directly from
                Settings instead — faster, no email required.
              </p>

              <form onSubmit={handlePasswordReset} className="space-y-4">
                {passwordSuccess && (
                  <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-3 text-xs text-[var(--status-positive-text)] leading-relaxed">
                    📧 Reset link transmitted! Check your inbox (including spam) for verification actions.
                  </div>
                )}
                <Button variant="secondary" type="submit" block loading={passwordLoading} disabled={passwordLoading}>
                  🔑 Reset My Password
                </Button>
              </form>
            </Card>
          </div>

          {/* Right panel: Data Reset zone */}
          <div className="md:col-span-5 space-y-6">
            {!showDangerZone ? (
              <button
                type="button"
                onClick={() => setShowDangerZone(true)}
                aria-expanded={showDangerZone}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[var(--status-danger-border)]/40 bg-[var(--status-danger-subtle)]/5 text-xs font-semibold text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]/15 transition-colors"
              >
                ⚠️ Show danger zone (reset data / delete account)
              </button>
            ) : (
              <>
                {/* Account Data Reset zone */}
                <Card className="border-[var(--status-danger-border)]/50 bg-[var(--status-danger-subtle)]/10">
                  <h2 className="text-base font-bold text-[var(--status-danger-text)] mb-2">Danger Zone: Data Reset</h2>
                  <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                    Permanently deletes all your transaction entries, custom budgets, and inbox
                    scan logs. Your learned merchant rules and saved cards are kept — use Delete
                    Account below to remove everything. This is irreversible!
                  </p>

                  <div className="space-y-4">
                    {resetSuccess && (
                      <div className="rounded-xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] p-3 text-xs text-[var(--status-positive-text)] leading-relaxed">
                        ✨ Wipe complete. Your transactions, budgets and scan logs are gone — reloading…
                      </div>
                    )}
                    <Button
                      variant="danger"
                      block
                      onClick={() => setConfirmWipeOpen(true)}
                      loading={resetLoading}
                      disabled={resetLoading}
                    >
                      Reset Account Data
                    </Button>
                  </div>
                </Card>

                {/* Danger Zone: Permanent Deletion */}
                <Card className="border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)]/20 shadow-lg">
                  <h2 className="text-base font-bold text-[var(--status-danger-text)] flex items-center gap-1.5 mb-2">
                    <span>⚠️</span> Danger Zone: Delete Account
                  </h2>
                  <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
                    Permanently deletes your login, your transactions, budgets, learned rules, saved cards and scan logs. <strong>This cannot be undone.</strong> One thing survives, and only without your name on it: any feedback or support message you sent is kept with your name and email replaced, so a problem you reported does not vanish. The Privacy Policy explains this in full.
                  </p>

                  <form onSubmit={handleDeleteAccount} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                        Confirm Deletion by Typing: <span className="text-zinc-300 font-mono lowercase select-all break-all">{user?.email}</span>
                      </label>
                      <Input
                        type="email"
                        placeholder="Type your email to confirm"
                        value={deleteConfirmEmail}
                        onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                        disabled={deleteLoading}
                        required
                        className="border-[var(--status-danger-border)]/60 focus:border-[var(--status-danger-border)] focus:ring-[var(--status-danger-border)]/20"
                      />
                      {deleteConfirmEmail.trim() !== '' && !deleteConfirmMatches && (
                        <p className="mt-1.5 text-xs text-zinc-500">
                          That doesn't match your account email yet, so the button below stays disabled.
                        </p>
                      )}
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
                      className="bg-[var(--status-danger-solid)] text-static-white hover:opacity-90 active:opacity-80 disabled:opacity-40 transition-all duration-200"
                    >
                      Permanently Delete My Account
                    </Button>
                  </form>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmWipeOpen}
        onClose={() => setConfirmWipeOpen(false)}
        onConfirm={async () => {
          await handleWipeData()
          setConfirmWipeOpen(false)
        }}
        title="Reset account data"
        message="All transactions, budgets, and scan logs will be permanently deleted. This can't be undone."
        confirmLabel="Reset data"
      />
    </AppLayout>
  )
}
