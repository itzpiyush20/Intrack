// ============================================
// Profile Service — User & Account Configuration
// Handles user profile updates and account data purges
// ============================================

import { supabase } from './supabase'
import { disconnectGmail } from './googleAuth'
import type { Database } from '@/types/database'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

/** Fetch active user profile from profiles table */
export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return { data: data as ProfileRow | null, error }
}

/** Update profile row and auth user metadata synchronously */
/**
 * An avatar URL we are willing to store, or null.
 *
 * Only http(s). The value is rendered straight into an <img src>, and while a
 * `javascript:` URL is inert there, storing one means it is sitting in the
 * profile row ready for any future consumer that is less careful — a link, a
 * redirect, an email template. Rejecting it at the point of storage is the
 * cheap place to do it.
 */
export function cleanAvatarUrl(input: string | undefined): string | null {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

export async function updateProfile(updates: { fullName: string; avatarUrl?: string }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }

  // Trimmed before it is stored, and refused if that leaves nothing. The form
  // marks the field required, but `required` accepts a string of spaces — which
  // then rendered as a blank name and an empty avatar initial everywhere the
  // profile appears.
  const fullName = updates.fullName.trim()
  if (!fullName) {
    return { data: null, error: new Error('Please enter your name.') }
  }
  const avatarUrl = cleanAvatarUrl(updates.avatarUrl)

  // 1. Update public.profiles row
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      avatar_url: avatarUrl,
    })
    .eq('id', user.id)

  if (profileErr) return { data: null, error: profileErr }

  // 2. Update auth metadata so useAuth() context gets instant refresh
  const { error: authErr } = await supabase.auth.updateUser({
    data: {
      full_name: fullName,
      avatar_url: avatarUrl,
    },
  })

  if (authErr) return { data: null, error: authErr }

  const { data: updatedProfile, error: getErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return { data: updatedProfile as ProfileRow | null, error: getErr }
}

/** Cleanly purges all user transactions, budgets, and email scan logs (Dangerous Zone) */
export async function resetAccountData() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: new Error('User not authenticated') }

  // 1. Delete all transactions
  const { error: txnErr } = await supabase
    .from('transactions')
    .delete()
    .eq('user_id', user.id)

  if (txnErr) return txnErr

  // 2. Delete all budgets
  const { error: budgetErr } = await supabase
    .from('budgets')
    .delete()
    .eq('user_id', user.id)

  if (budgetErr) return budgetErr

  // 3. Delete all email scan logs
  const { error: logErr } = await supabase
    .from('email_scan_logs')
    .delete()
    .eq('user_id', user.id)

  return logErr
}

/**
 * Irreversibly deletes the authenticated user's account and all connected records.
 * Uses high-privilege delete_user RPC cascade when available; falls back to an
 * explicit complete table wipe + profiles deletion if the database function is missing.
 *
 * Erasure is NOT implemented here, and must not be. Both branches below end at a
 * deleted public.profiles row — the RPC gets there by deleting auth.users and
 * letting the cascade run, the fallback deletes the row itself — and everything
 * that has to happen on erasure hangs off that one event in the database:
 *
 *   * cascading deletes for transactions, budgets, cards, merchant rules, scan
 *     logs, rejections, insurance, payments, signin logs and the Google token;
 *   * the anonymize_user_authored_records trigger from migration 036, which
 *     scrubs the name and email off the user's feedback and support tickets.
 *     Those two tables use ON DELETE SET NULL, so they keep their rows on
 *     purpose; without that trigger the person's email address would outlive
 *     the account it belonged to.
 *
 * Keeping it in the database is what makes it hold for deletions that never
 * touch this file — the owner removing a row by hand in the Supabase dashboard,
 * or any admin tooling added later. Do not reimplement any of it here; a
 * TypeScript copy would only cover the two paths below and would drift.
 */
export async function deleteAccount(): Promise<{ error: Error | null; success: boolean; method: 'rpc' | 'purge' }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: new Error('User not authenticated'), success: false, method: 'purge' }

  // 0. Revoke the Google grant before the account goes away. Deleting the row
  // alone would leave a live grant sitting in the user's Google account with
  // nothing left here to revoke it from. Best-effort: a revoke failure must
  // never block erasure, which is the user's actual right.
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    const { error: revokeError } = await disconnectGmail(session.access_token)
    if (revokeError) {
      console.warn('deleteAccount: Gmail revoke failed, continuing with deletion:', revokeError)
    }
  }

  // 1. Try to invoke the postgres superuser-level RPC cascade
  try {
    const { error: rpcErr } = await supabase.rpc('delete_user')
    if (!rpcErr) {
      // Deletion succeeded completely! DB triggers handles cleanup cascade.
      return { error: null, success: true, method: 'rpc' }
    }
    console.warn('Supabase delete_user RPC failed, running fallback purge:', rpcErr)
  } catch (e: any) {
    console.warn('Supabase delete_user RPC call triggered error, running fallback purge:', e)
  }

  // 2. Fallback Purge Action
  // Purge all transactions, budgets, and email logs
  const wipeErr = await resetAccountData()
  if (wipeErr) {
    const errorMsg = 'message' in wipeErr 
      ? (wipeErr as any).message 
      : 'error' in wipeErr && (wipeErr as any).error instanceof Error
        ? (wipeErr as any).error.message 
        : 'Failed to purge account logs during fallback wipe.'
    return { error: new Error(errorMsg), success: false, method: 'purge' }
  }

  // Try to delete their public profile row
  const { error: profileErr } = await supabase
    .from('profiles')
    .delete()
    .eq('id', user.id)

  if (profileErr) {
    // Report this as a failure. Returning success here told the user their
    // account was gone while their profile row (and auth login) survived —
    // the one outcome an erasure request must never report as done.
    return {
      error: new Error(
        'Your transaction data was erased, but the account itself could not be deleted. ' +
        'Please contact support so we can complete the deletion.'
      ),
      success: false,
      method: 'purge',
    }
  }

  return { error: null, success: true, method: 'purge' }
}

