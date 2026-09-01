// ============================================
// Backup restore — rebuilding a transaction row from a decrypted .drbak file.
//
// Pure and separate from SettingsPage so it can be tested. The bug this exists
// to prevent is silent: the restore used to copy eleven fields out of a row
// that has around thirty, and everything it did not name was dropped. The
// backup file was never at fault — handleBackup writes whole rows — so the
// loss only surfaced after the user had already trusted the file and wiped or
// migrated, which is exactly when it cannot be undone.
//
// Anything added to public.transactions that a user would notice losing must
// be added to buildRestoreRow AND to the field list in the test.
// ============================================

/**
 * A backup value as a non-empty string, or null.
 *
 * Every text column goes through this rather than `value || null`, so a number
 * or an object sitting where a string belongs — a hand-edited or
 * version-skewed file — becomes null instead of being posted to PostgREST as
 * whatever it happened to be.
 */
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** The subset of a transaction the dedup key is built from. */
export interface DedupableTransaction {
  date: string
  amount: number | string
  merchant?: string | null
  description?: string | null
}

/**
 * Identity of a transaction by its VALUES, for spotting a backup row the
 * account already holds.
 *
 * Merchant and description are trimmed and case-folded because the same row
 * re-entered by hand rarely matches byte for byte, and amount goes through
 * Number() because JSON round-trips it as either a number or a string.
 */
export function buildDedupKey(t: DedupableTransaction): string {
  return `${t.date}-${Number(t.amount)}-${(t.merchant || '').trim().toLowerCase()}-${(t.description || '').trim().toLowerCase()}`
}

/**
 * One row as it appears inside a decrypted .drbak file.
 *
 * Every field is optional and `unknown`, which is the honest type: the file is
 * whatever the user hands us, and may have been written by an older version of
 * the app that had fewer columns. Narrowing happens per field in
 * buildRestoreRow, which is the point — an index signature typed `any` would
 * let a malformed value through to PostgREST unexamined.
 */
export type BackupTransaction = Record<string, unknown>

/**
 * Rebuild one transaction row from a decrypted backup, for insertion under
 * `userId`.
 *
 * An explicit allowlist rather than a spread of the parsed object, because the
 * file is user-supplied: a spread would post whatever keys it happens to carry
 * straight to PostgREST.
 *
 * Deliberately NOT copied:
 *   * `id` — these are new rows; reusing a primary key from another database
 *     would collide.
 *   * `user_id` from the file — always the restoring account, never whatever
 *     the file claims.
 *   * `created_at` / `updated_at` — when the row was restored is the honest
 *     answer, and both have database defaults.
 *   * `settled_by_transaction_id` — it references a transaction id that no
 *     longer exists after a restore, so the foreign key would reject it.
 */
export function buildRestoreRow(t: BackupTransaction, userId: string | undefined) {
  return {
    user_id: userId,
    amount: Number(t.amount),
    type: t.type,
    category: t.category,
    description: str(t.description) ?? '',
    notes: str(t.notes),
    date: t.date,
    source: str(t.source) ?? 'manual',
    approval_status: str(t.approval_status) ?? 'approved',
    reference_id: str(t.reference_id),
    merchant: str(t.merchant),
    // Every field below this line was being dropped.
    //
    // `currency` is the one that did real damage without looking wrong: a USD
    // transaction came back as INR, changing the amount's meaning while
    // leaving the number intact. The defaults match the column defaults in
    // supabase/schema.sql, so a backup taken before a column existed still
    // restores cleanly.
    currency: str(t.currency) ?? 'INR',
    payment_mode: str(t.payment_mode),
    card_issuer: str(t.card_issuer),
    card_brand: str(t.card_brand),
    transaction_time: str(t.transaction_time),
    confidence_score: typeof t.confidence_score === 'number' ? t.confidence_score : null,
    email_message_id: str(t.email_message_id),
    event_type: str(t.event_type),
    tags: Array.isArray(t.tags) ? t.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    // The whole lending feature. Without these, money the user had lent out
    // simply stopped being money they had lent out.
    is_returnable: t.is_returnable === true,
    counterparty: str(t.counterparty),
    expected_return_date: str(t.expected_return_date),
    return_status: str(t.return_status),
  }
}

/**
 * Which backup rows are not already present on the account.
 *
 * Two dedup axes, and the second is not redundant. The restore carries
 * `email_message_id` back, and transactions has UNIQUE (email_message_id,
 * user_id) — the constraint that makes concurrent and retried scans safe. A
 * backup row whose id already exists here but whose description was since
 * edited slips past the value-based key, and the insert is a single batch, so
 * that one row would reject every other row with a 23505 the user cannot act
 * on.
 */
export function selectRowsToRestore<T extends DedupableTransaction & { email_message_id?: string | null }>(
  backupRows: T[],
  existingRows: Array<DedupableTransaction & { email_message_id?: string | null }>
): T[] {
  const existingKeys = new Set(existingRows.map(buildDedupKey))
  const existingEmailIds = new Set(
    existingRows.map((t) => t.email_message_id).filter((id): id is string => !!id)
  )

  return backupRows.filter((t) => {
    if (existingKeys.has(buildDedupKey(t))) return false
    if (t.email_message_id && existingEmailIds.has(t.email_message_id)) return false
    return true
  })
}
