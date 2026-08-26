# Remove automatic Gmail scanning

**Status:** all phases implemented locally, **not yet deployed**. Awaiting the
owner's review of the diff, then a single deploy (see Delivery).
**Decided:** 2026-08-26 by the owner, after a full inventory of what automatic
scanning actually does today.

**Verification at completion:**
- `npx tsc -b` clean; `npm run build` succeeds.
- Tests **505 passing, 32 files**. Reconciles exactly against the 503 baseline:
  −8 (deleted `api/auto-sync-gmail.test.ts`), +4 (gap cases in
  `computeManualQuotaState`), +1 (engine-level gap enforcement), +5 (new
  `src/utils/nextScanTime.test.ts`).
- Lint across every touched file: **427 → 425**, two fewer and **no new** errors
  against the pre-existing baseline.
- Browser pass on the dev server: `/pricing` shows two scans a day and the
  4-hour rule with no automatic-scanning claims; `/refund-policy` no longer
  promises auto-synchronisation; `/support` carries no stale claims; no console
  errors on any of them.

**Not verifiable without a signed-in account with Gmail linked** — flagged
rather than assumed: the next-scan display on Pending and Dashboard, the two
distinct blocked states, and the timer that re-enables the button when the wait
elapses. The arithmetic behind them is unit-tested; the rendering is not.

## Decision

All automatic Gmail scanning is removed. Every scan becomes user-initiated and
counts against a daily allowance:

| Tier | Scans per day, after this change | Minimum gap between scans |
|---|---|---|
| Free | 1 | n/a — see below |
| Premium / trial | 2 | **4 hours** |
| Owner | unlimited | none |

Those manual limits are **unchanged**. What changes is that the free automatic
scan on top of them disappears, and that premium gains a minimum spacing rule.

### The 4-hour gap (added 2026-08-26 by the owner)

Premium users may not run their two daily scans back to back. A scan is refused
until **4 hours after their last successful manual scan**.

**The allowance window stays a rolling 24 hours** — owner decision, 2026-08-27,
taken after comparing it against a midnight reset. Under rolling, a premium user
who scans at 9:00am and 1:00pm gets their next slots at 9:00am and 1:00pm the
following day: genuinely two scans per 24 hours, always. A midnight reset would
have let them scan at 7pm and 11pm, then again at 3am on the new day's
allowance — four scans in eight hours, since the reset and the 4-hour gap do not
know about each other. Rolling also needs no timezone logic for the limit
itself.

Three properties of the existing quota make this fit cleanly:

- The allowance window is a **rolling 24 hours** (`MANUAL_QUOTA_WINDOW_MS`), not
  a calendar day.
- Only **successful, manual** scans count toward it: `fetchRecentManualScanTimes`
  filters `status='success'` and `scan_mode='manual'`. The gap is therefore
  measured from the last *successful* scan — a failed scan costs the user
  nothing and does not start the clock. This is assumed, not separately
  specified; flag it if the intent was to count attempts.
- `computeManualQuotaState` is a pure function that already returns
  `nextAvailableAt`, which is precisely where the gap belongs.

**The rule is premium-only in practice.** Free users get one scan per rolling
24 hours, so a 4-hour minimum can never bind on them. Owner returns early with
`Infinity` and is exempt by construction. Implementing it as "minimum 4 hours
between successful manual scans, owner exempt" therefore satisfies the
requirement without a tier-specific branch.

### What the owner was told before deciding

Automatic scanning exists in **two** independent mechanisms, not one:

1. **The nightly server cron** (`api/auto-sync-gmail.ts`, scheduled `30 21 * * *`
   in `vercel.json`). This has **never run successfully**. It needs a stored
   Google refresh token, and `google_oauth_tokens` holds **0 rows**, because
   `signInWithGoogle` never passes `forceConsent`, so Google never returns a
   refresh token. Verified 2026-08-26.
2. **The in-app background sync** (`DashboardPage.tsx:342`,
   `PendingPage.tsx:432`). This **works**. It runs on mount when the last
   successful scan predates the user's scheduled time, using the live session
   token. `email_scan_logs` shows **16 successful scheduled scans, most recently
   2026-08-26**.

Mechanism 2 deliberately runs as `scan_mode: 'scheduled'` so it does *not* spend
the manual allowance. That was a deliberate fix: users were being told they had
hit their limit by a scan they never asked for and never saw.

Practical effect of this change, stated plainly:

- Free users go from **2 effective scans/day** (1 automatic + 1 manual) to **1**.
- Premium goes from **3** to **2**.
- Nothing scans on a user's behalf; they must press Sync.

The owner confirmed this is intended.

## Consequences the owner accepted

- **A paid feature is being withdrawn.** `PricingPage.tsx:36` sells "Two manual
  scans a day, on top of the automatic one", and line 333 warns about
  interrupting "automatic email tracking". One customer paid Rs 365 for a year
  on 2026-08-15 under that description. Decision: **update the copy, no
  outreach.**
- **Users will re-authorise Gmail more often.** Google's access token lasts one
  hour and the refresh path is being retired, so a returning user gets a
  "Connect Gmail" bounce before scanning. This is already today's behaviour —
  the refresh call always returns 410 — so the change does not make it worse.
  Silent re-auth (`prompt=none`) is the proper fix and is **deferred until after
  Google verification**, by owner decision.

## Scope

### Remove

- `api/auto-sync-gmail.ts` and `api/auto-sync-gmail.test.ts`
- The `/api/auto-sync-gmail` entry in `vercel.json` crons. **Leave
  `/api/cleanup-scan-rejections` (`0 3 * * *`) alone** — unrelated.
- The in-app background sync in `DashboardPage.tsx` (~302-350,
  `checkScheduledTasks`) and `PendingPage.tsx` (~420-440).
  - 🔴 **The inactivity banner must survive this deletion.** `setShowInactivityBanner(true)`
    lives *inside* `checkScheduledTasks` (`DashboardPage.tsx:321`), so deleting the
    function wholesale also deletes the only warning that a user has not scanned
    recently. With automatic scanning gone and R3 fixed at a strict 7-day window, that
    banner is the sole safety net against silent, permanent data loss. Owner decision
    2026-08-27: **keep 7 days, keep the banner.** Extract the last-scan lookup and the
    banner trigger, drop only the auto-scan half.
- `getLastScheduledRefreshTime` (`emailScanner.ts:2874`) and its re-export in
  `services/index.ts:31`, once both callers are gone.
- The Settings "Scan Schedule" UI (`SettingsPage.tsx` ~969-990) and the
  `dailyScanTime` state feeding it.
- `daily_scan_time` plumbing in `AuthContext.tsx` (lines 178, 189, 205, 268,
  279, 295, 387, 390, 424, 459) and the `intrack_daily_scan_time_<uid>`
  localStorage key.
- `access_type: 'offline'` and the `forceConsent` parameter in
  `AuthContext.signInWithGoogle` (~481-505), plus its pass-through at
  `PendingPage.tsx:892`. **Stop asking Google for offline access** — it is no
  longer used, and asking for less eases the pending verification review.
- The now-unreachable client calls to `saveGoogleRefreshTokenServerSide`
  (`AuthContext.tsx:592`, `657`) and the localStorage-to-server migration helper
  in `googleAuth.ts`.
- The "Upgrade Account to Keep Auto-Sync Active" banner, `AppLayout.tsx:913`.

### Keep, deliberately

- **`google_oauth_tokens` and the two token endpoints**
  (`save-google-refresh-token`, `refresh-google-token`). Owner decision: the
  table is empty, so dropping it buys nothing and costs a destructive migration
  against production. **No new migration is needed for this work**; the next
  migration number stays `040_`.
- **The `scan_mode` column and the entire quota mechanism.** Only the
  `'scheduled'` value falls out of use. `resolveManualScanLimit` and
  `getManualScanQuota` keep their current limits (`Infinity` / 2 / 1).
- **Historical scheduled rows** in `email_scan_logs` (16) and the admin
  ScannerTab columns that display them (`ScannerTab.tsx:10,153,157,177,189`).
  They are real history; the counter simply stops increasing.
- **`profiles.daily_scan_time` in `schema.sql:22` and `types/database.ts`.**
  The column is declared there but **has never existed in production** — the
  same schema drift `CLAUDE.md` warns about, which is why writing to it used to
  fail with `42703` on every profile load. Removing it from `schema.sql` would
  imply a paired `DROP COLUMN` migration, which is destructive and which the
  owner ruled out. It is simply unused now. The client no longer reads or writes
  it, and the `intrack_daily_scan_time_<uid>` localStorage keys left on existing
  devices are inert.

### Add

- **A minimum-gap constant and its enforcement**, in `emailScanner.ts` beside
  `MANUAL_QUOTA_WINDOW_MS`: `MANUAL_SCAN_MIN_GAP_MS = 4 * 60 * 60 * 1000`.
- **`computeManualQuotaState` gains the gap.** Today, when `remaining > 0` it
  returns `nextAvailableAt: null`, meaning "scan now". It must instead return
  `newest + 4h` when the most recent scan is younger than the gap, while
  `remaining` stays above zero. Owner (`limit === Infinity`) returns early and is
  untouched.
- ✅ **The UI already keys off the right thing** — verified, not assumed.
  `PendingPage.tsx:302` reads `quota?.nextAvailableAt?.getTime() ?? null`, and
  the Scan button at `:973` is disabled on `!!scanCooldownMessage`, which is
  derived from that value. So a non-null `nextAvailableAt` blocks the button
  whether it came from the 24-hour allowance or the new 4-hour gap. No gating
  change is needed. (An earlier draft of this plan warned the UI might gate on
  `remaining === 0`; that was wrong.)
- **A distinct user-facing message.** `PendingPage.tsx:1171` hardcodes "Daily
  Scan Limit Reached", which is wrong when the user still has a scan left and is
  merely waiting out the gap. The two states must read differently — one is
  "you are out of scans", the other is "come back at 3:45 PM".
- **Server-side enforcement must match.** If the scan entry point re-checks the
  allowance independently of the UI, the gap belongs there too — a rule enforced
  only in the browser is not enforced.

### Display: next scan time (owner decision, 2026-08-27)

The block under the **Scan Bank Alerts** button (`PendingPage.tsx:1034-1049`)
currently shows a live countdown, "Next Scan In 03:12:45", built by
`msToCountdown`. The owner wants **clock time only**.

- Render the absolute local time, e.g. **"Next scan at 3:45 PM"**, and drop the
  ticking countdown from this card.
- **Timezone adapts automatically** by using `toLocaleTimeString()` with **no**
  `timeZone` option — the browser resolves the viewer's own zone. There is no
  hardcoded timezone anywhere in `src/` today (checked), and none may be added.
- ⚠️ **Include the day when it is not today.** The 24-hour allowance routinely
  puts the next scan on the following calendar day, where a bare "at 9:00 AM"
  is ambiguous. Show "tomorrow at 9:00 AM", or a short date, whenever the target
  is not the current local day.
- ⚠️ **Removing the countdown removes the thing that re-enabled the button.**
  The interval at `PendingPage.tsx:~308-320` clears `scanCooldownMessage` when
  the remaining time hits zero. With a static clock time there is no tick, so a
  user sitting on the page past their next-scan time would stay blocked until
  reload. Keep a timer that clears the state at the target moment even though
  no countdown is painted, or re-check the quota on window focus.
- The same treatment applies to the second countdown usage at
  `PendingPage.tsx:1173-1175`.
- **Show it on the Dashboard too** — owner decision, 2026-08-27. Note this is
  *new* UI there, not an edit to existing UI: the Dashboard's scan-related block
  is the background-sync indicator that phase 3 deletes. Reuse the same quota
  hook and the same formatting helper as Pending rather than duplicating the
  logic, so the two screens cannot drift apart.

### Rewrite

- **`plans/email-scanner-requirements.md` is canonical and currently contradicts
  this decision.** R5 ("Automatic scan runs once every day"), R6, R7, R8 and the
  D2 section (lines ~19-22, 56-84, 222-225) must be rewritten for manual-only
  scanning. Per `CLAUDE.md`, where code and this document disagree the document
  wins — so it changes *with* the code, not after.
- **Pricing and FAQ copy:** `PricingPage.tsx:36` and `:333`;
  `constants/index.ts:129` ("automatic background scanning pauses until you
  upgrade") and `:104` if it implies unattended scanning.
- **`SettingsPage.tsx:982`** — "Automatic overnight scanning runs at a fixed
  time regardless" becomes untrue and goes with the UI.

## Phases

1. **Requirements doc first.** Rewrite R5-R8 and D2 so the canonical spec matches
   the decision. Nothing else starts until this is agreed.
2. **Kill the dead cron.** Delete `api/auto-sync-gmail.ts`, its test, and the
   `vercel.json` entry. Zero user-visible effect — it has never run.
3. **Remove the in-app background sync.** DashboardPage, PendingPage,
   `getLastScheduledRefreshTime`. This is the phase users actually feel.
4. **Remove the schedule setting.** SettingsPage UI, AuthContext
   `daily_scan_time` plumbing, the localStorage key, the AppLayout banner.
5. **Stop requesting offline access.** `signInWithGoogle`, `forceConsent`, the
   dead refresh-token client calls.
6. **Add the 4-hour gap.** `MANUAL_SCAN_MIN_GAP_MS` and the
   `computeManualQuotaState` change. This is a pure function with existing unit
   tests, so it is testable without a browser — do it test-first.
7. **Next-scan display.** Clock time in the user's own timezone, day shown when
   not today, and the button re-enables itself at the target moment.
8. **Copy.** Pricing, FAQ, any remaining "automatic" claims.
9. **Verify.** `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`, then a
   real browser pass: sign in, confirm nothing scans unprompted on Dashboard or
   Pending, confirm Sync Now still works, and confirm both blocked states read
   correctly — "out of scans" versus "waiting out the gap".

## Invariants that must survive

From `CLAUDE.md`, unchanged by this work:

1. Nothing auto-approves — every scanned transaction still lands in Pending.
2. Gate ordering stays dedup, date window, bulk-marketing, AI, regex.
3. AI failure still degrades to the regex ladder, never a dropped email.
4. Rejection logging stays fire-and-forget (`bufferRejection` / `flushRejections`).
5. The `23505` row-by-row insert fallback is untouched.
6. The AI prompt's STRICT RULES text is not edited.

## Test impact

- `api/auto-sync-gmail.test.ts` — deleted with its subject.
- `src/services/emailScanner.test.ts` — cases at 1225, 1233-1239 and 1260-1264
  assert `scan_mode: 'scheduled'` behaviour and the "does not spend the manual
  allowance" rule. With no caller passing `'scheduled'`, decide per case: delete,
  or keep as a guard that the quota maths still ignores scheduled rows (the
  historical ones remain in the table). Prefer keeping the quota assertions.
- Baseline at `1de5107` is **503 tests across 32 files, all passing**. Any drop
  in the count must be explained by the deletions listed here, never by silent
  breakage.
- **New tests required for the 4-hour gap.** `computeManualQuotaState` is pure
  and takes an injectable `now`, so these are cheap and deterministic:
  - premium, one scan 1 hour ago → blocked, `nextAvailableAt` is that scan + 4h
  - premium, one scan 5 hours ago → allowed, one scan still remaining
  - premium, two scans inside the window → blocked by the 24-hour rule, and
    `nextAvailableAt` is the *second-newest* scan + 24h, not the newest + 4h
    (whichever is later must win)
  - free, one scan 5 hours ago → still blocked by the 24-hour rule; the gap must
    not shorten the wait
  - owner → never blocked, `nextAvailableAt` stays null
- **Note the ordering trap:** when both rules apply, `nextAvailableAt` must be
  the later of the two, never the earlier. Returning the gap time while the
  allowance is exhausted would let a user scan a third time.

## Settled: the free tier drops to 1

Free users get 2 effective scans a day today (1 automatic + 1 manual) and will
get 1. The owner confirmed on 2026-08-27 that **the reduction is intended** —
free stays at `FREE_MANUAL_SCANS_PER_DAY = 1`, matching R6 as written.

## Delivery

**One deploy at the end** — owner decision, 2026-08-27. Every phase is completed
locally first. Only after `npm run lint`, `npx tsc -b`, `npm test` and
`npm run build` all pass, and the change has been exercised in a real browser
against the dev server, is the full diff shown for approval and deployed. This
avoids the state where pricing still advertises automatic scanning that has
already stopped working.
