# Email Scanner — Product Requirements (owner-specified)

> **Status: canonical.** These are the owner's stated requirements for the Gmail
> scanner, captured 2026-08-12. Where a requirement conflicts with current code, the
> requirement wins and the delta is spelled out below with file:line anchors.
> Companion document: `plans/email-scanner-performance-plan.md` (how to make the
> scanner fast enough to satisfy these). Read both before touching scanner code.
>
> **Revised 2026-08-27 — R5, R6, R7, R8 and D2.** The owner removed automatic
> scanning entirely and added a minimum gap between premium scans. The execution
> plan for that change is `plans/remove-auto-sync.md`. R5 previously read
> "Automatic scan runs once every day"; R7 and R8 previously granted a daily
> automatic scan on top of the manual allowance.

---

## 1. Requirements as stated

| # | Area | Requirement |
|---|---|---|
| R1 | Detection posture | Balanced confidence, but **zero tolerance** for marketing emails, OTPs, and coupon-code/promo images being detected as transactions |
| R2 | Scope | **Everything financial**: bank/card/UPI alerts, vendor receipts, bills, subscription renewals, insurance premiums, salary credits, SIP/investment debits, refunds |
| R3 | Scan window | **Strict rolling 7 days**, always — first scan and every scan thereafter. Never reach further back, even after an outage |
| R4 | Reprocessing | **Never** reconsider an email already considered in an earlier scan |
| R5 | Cadence | **No automatic scanning of any kind.** Every scan is started by the user |
| R6 | Free tier | 1 manual scan per **rolling 24 hours** |
| R7 | Premium / trial | 2 manual scans per rolling 24 hours, and consecutive scans must be **at least 4 hours apart** |
| R8 | Owner | **Unlimited** manual scans, no minimum gap |
| R9 | Approval | **Nothing auto-approves.** Every detected transaction waits in Pending for explicit approval |
| R10 | Duplicates | Bank alert + merchant receipt for the same payment **smart-merge into one** transaction |
| R11 | Currency | Non-INR transactions **captured properly** with their real currency |
| R12 | Attachments | Amount only in a PDF/image → **skip**. No OCR, no manual-entry queue |
| R13 | False-positive regression | Known marketing/OTP/coupon offenders get **locked down with tests** so widening scope to R2 cannot reintroduce them |

---

## 2. Deltas against the current implementation

### D1 — Scan window becomes strict 7 days (R3, R4)

**Today** (`emailScanner.ts:891-914`): first scan is 7 days; every later scan uses
`min(lastSuccessfulScan − 2h, now − 26h)`, floored at `now − 30 days`.

**Required:** every scan, first or not, uses exactly `now − 7 days`. `MAX_LOOKBACK_MS`
collapses to 7 days and the last-scan anchoring logic is deleted. R4 is already
satisfied structurally and needs no new mechanism: `existingMessageIds`
(`emailScanner.ts:1010-1012`) skips any email whose `email_message_id` is already on a
transaction, and `UNIQUE (email_message_id, user_id)` (`schema.sql:491-495`) enforces it
at the database. Overlapping windows are therefore free — re-fetching an already-processed
email costs one cheap set lookup and never a duplicate row or an AI call.

**Accepted risk (owner chose "strict 7 days always" when shown this):** any interruption
longer than 7 days — cron outage, expired or revoked Gmail token, subscription lapse —
makes the transactions in that gap **permanently unreachable**, because the Gmail query
itself will never fetch them again and dedup cannot recover mail that was never fetched.

**This risk now applies to every tier, not just free (revised 2026-08-27).** R5 removed
automatic scanning outright, so *nobody* gets a scan they did not start. Any user — free,
premium or owner — who does not open the app and press Scan at least once every 7 days
permanently loses the transactions in the gap, silently.

The change makes this modestly worse rather than newly true. The daily cron never actually
ran (`google_oauth_tokens` held 0 rows, so it had no token to use), and the in-app
background sync only fired when someone opened the app anyway. The real delta: opening the
app used to be enough, and now opening it is not — the user must also press Scan.

Flag this to the owner again before shipping. The mitigation (stretch the window to cover
a detected gap, capped at 30 days) remains a ~5-line change if they reconsider R3.

### D2 — Scan quotas (R5, R6, R7, R8) — **revised 2026-08-27**

The tiered-quota mechanism described here was built and shipped (migration
`014_scan_mode_quota.sql`). What changed on 2026-08-27 is that **automatic scanning is
removed entirely** and premium gains a **minimum 4-hour gap**.

**Required, after the revision:**

| Tier | Automatic scan | Manual scans | Minimum gap |
|---|---|---|---|
| Free | **None** | 1 per rolling 24h | n/a — the 24h rule is always longer |
| Premium / trial | **None** | 2 per rolling 24h | **4 hours** |
| Owner | **None** | Unlimited | none |

Trial is treated as premium throughout (it already is, in `isEligible`).

**The window is a rolling 24 hours, not a calendar day.** The owner chose this on
2026-08-27 over a midnight reset, having been shown that a midnight reset combined with
the 4-hour gap would let a premium user take four scans in eight hours (two before
midnight, two after). Rolling also keeps the limit itself free of any timezone logic.

**What stays as built:**

- `email_scan_logs.scan_mode` and the quota counting path. `fetchRecentManualScanTimes`
  already filters `status = 'success' AND scan_mode = 'manual'` over the trailing 24
  hours, and `computeManualQuotaState` is a pure function returning
  `{ used, limit, remaining, nextAvailableAt }`.
- `resolveManualScanLimit`: owner `Infinity`, premium/trial `2`, free `1` — unchanged.
- The 16 historical `scan_mode = 'scheduled'` rows. They are real history and the quota
  maths must keep ignoring them; the value simply stops being written.

**What must change:**

- **The 4-hour gap** belongs in `computeManualQuotaState`, which today returns
  `nextAvailableAt: null` whenever `remaining > 0`. It must instead return the last scan
  plus 4 hours when that is still in the future. Owner (`limit === Infinity`) returns
  early and is exempt by construction.
- **When both rules bind, `nextAvailableAt` is the later of the two, never the earlier.**
  Returning the gap time while the 24-hour allowance is exhausted would hand a premium
  user a third scan.
- **Two distinct blocked states.** "Daily Scan Limit Reached"
  (`PendingPage.tsx:1171`) is wrong when the user still has an unused scan and is only
  waiting out the gap. One message means "out of scans"; the other means "come back at
  3:45 PM".
- **The next-scan time is shown as a clock time**, on both PendingPage and DashboardPage,
  in the viewer's own timezone via `toLocaleTimeString()` with no `timeZone` option, and
  carrying the day when the target is not today.

### D3 — Widen fetch to "everything financial" (R2)

The Gmail query (`emailScanner.ts:887-889`) is the hard ceiling on coverage: an email
matching none of its keywords is **never fetched**, so no gate, AI, or dedup improvement
can recover it. Extend `RECEIPT_KEYWORDS` with the R2 vocabulary — premium, policy,
renewal, EMI, SIP, mutual fund, dividend, interest, salary, credited, refund, autopay,
mandate, e-mandate, NACH.

Widening the *fetch* is low-risk because every gate still runs downstream; widening what
the *AI accepts* is the risky half, and R1/R13 constrain it. Keep the prompt's existing
rejection of statements, summaries and account overviews — those are not transactions
even under R2.

### D4 — Zero-tolerance false positives (R1, R13)

Owner reports this "happened before, seems better" — so it is a **regression-prevention**
requirement, not a live bug hunt. Before widening anything under D3, add a fixture-based
test suite (extend `emailScanGates.test.ts` and `aiService.test.ts`) covering: promotional
and sale emails, OTP and verification codes, coupon-code emails whose body is essentially
one image with little text, cashback *offers* as distinct from cashback *credits*, and
pre-approved loan and credit-limit offers. These must assert rejection both before and
after the D3 widening. The `List-Unsubscribe` bulk-mail gate
(`emailScanGates.ts:103-114`) is the primary defence for image-only promos, since they
carry almost no parseable text.

### D5 — Smart-merge duplicate payments (R10)

New capability; nothing like it exists. Dedup today is exact-match only, on
`email_message_id` and `reference_id` (`emailScanner.ts:1010-1015`, `1089`), which cannot
associate a bank alert with a merchant receipt for the same payment — different message
ids, and the receipt usually has no UPI reference.

Required behaviour: treat two transactions as the same payment when the amount matches
exactly, the dates are within ±1 day (bank and merchant frequently differ by a day), and
the merchants correspond — use `normalizeMerchant` / `getMerchantKey`
(`src/services/merchantNormalizer.ts`) rather than raw string comparison. Merge into one
row, preferring the **richer** source: the record carrying a `reference_id`, payment mode,
card issuer, and higher `confidence_score`. Must run in both directions — against
transactions already stored, and between two emails inside the same scan batch.

**Connected prompt change:** the AI prompt currently rejects merchant "We received your
payment" receipts (`aiService.ts:400`) with a parenthetical that argues the opposite of
the rule it states. That rule reads as a crude anti-double-count guard. Once real merging
exists it becomes actively harmful — it discards the only record of any payment the bank
never alerted on — so **remove it as part of this change, not before.**

### D6 — Multi-currency (R11)

Today amount extraction matches only `Rs`, `INR`, `₹`, `Rupees`
(`emailScanner.ts:1173-1174`), and the transactions table has no currency column. **This
is a correctness bug, not just a coverage gap:** a `$50` charge that reaches the AI path
can be extracted as `50` and stored indistinguishably from ₹50 — a wrong number in the
ledger, worse than a missing one.

Required work: migration `supabase/014_transaction_currency.sql` adding
`currency TEXT NOT NULL DEFAULT 'INR'` to `transactions`; amount regexes taught `$`, `€`,
`£`, `USD`, `EUR`, `GBP`, `AED`; a `currency` field added to `AITransactionResult` and the
prompt's JSON contract; and display updated — `formatCurrency`, `formatCurrencyCompact`
and `getGlobalCurrencySymbol` in `src/utils/index.ts:6-33` all hardcode INR and need a
currency argument. Aggregates (totals, budgets, analytics) must not sum mixed currencies
naively; simplest correct approach is to keep non-INR out of INR totals and show them
separately rather than inventing an exchange rate.

### D7 — Attachment-only receipts are skipped (R12)

No OCR, no PDF parsing, no manual-entry queue. `extractEmailBody`
(`emailScanner.ts:666-693`) stays as-is.

**One deliberate interpretation:** the "no amount found" path (`emailScanner.ts:1185`) is
currently a bare `continue` with no rejection log. Add a `logRejection(..., 'no_amount_in_body', ...)`
call there. This changes nothing the user sees or has to act on — it satisfies "skip
silently" — but it makes these misses visible in the `email_scan_rejections` audit trail,
so the cost of R12 can be measured later rather than guessed at.

### D8 — Everything stays pending (R9)

No change; this **confirms** an existing invariant. `applyMerchantRulesFromDB` never
returns `approved` (`learningEngine.ts:179-186`) and `learningEngine.test.ts` asserts it.
Treat as a hard guardrail: no future performance or coverage work may introduce
auto-approval.

---

### D1a — Open risk: the financial-year rollover gate (found while implementing D1)

Separate from the silent drop in section 3, and **not yet addressed.**

`emailScanner.ts` refuses to scan at all once the calendar passes the active
year's end: `if (today > activeYearEnd) return { error: 'Financial Year N has
ended. Please start the new financial year in settings...' }`. Clearing it
requires a manual click in Settings.

Under the old 30-day ceiling that was survivable. With a strict 7-day window it
is not: from 1 January, scanning is blocked until the user notices the message
and rolls over, and everything older than 7 days at that moment is gone for
good. A user who returns from a holiday on 10 January loses the entire period.

Options, for the owner to choose: roll the year over automatically on
1 January; keep the gate but let the scan run and attribute transactions by
their own date; or leave it and accept an annual cliff. Deliberately left alone
for now because the gate is an intentional product decision with UI built
around it.

## 3. Pre-existing bug that R3 makes certain

The active-financial-year filter (`emailScanner.ts:1043-1044`) silently drops any email
dated outside the active year, via two bare `continue`s with no rejection log.

With a strict 7-day window (D1), this becomes a **guaranteed annual loss**: a scan run on
3 January covers 27 December to 3 January, and once `activeYear` rolls over, every
transaction dated in late December is discarded — with no audit trail, and with no
possibility of recovery because the window will never reach back that far again.

Fix alongside D1: allow the scan window to span the year boundary, attribute each
transaction to the year its date falls in, and log any genuine year-scope rejection
instead of dropping it silently.

---

## 4. Implementation order

Dependencies matter more than size here.

1. ~~**D4** (false-positive regression tests)~~ — **DONE.** Added the
   `offer_or_pre_approval` gate (pre-approved loan offers were slipping past every
   other defence), 30 regression tests, and prompt-rule pinning. Also repaired the
   test baseline: missing `.env` was making four test files fail at import, which had
   been masking two already-expired fixtures.
2. ~~**Performance Phase 1**~~ — **DONE.** Batched AI classification (5 per call, 2 in
   flight), merchant rules fetched once per scan, cron on the batch path, proxy IP
   limiter 20→60/min.
3. ~~**D1 + section 3**~~ — **DONE.** Strict rolling 7-day window on every scan;
   prior-year mail kept when the window straddles 1 January; year-scope rejections now
   logged instead of dropped silently. See **D1a** above for the remaining open risk.
4. ~~**D2** (tier quotas via `scan_mode`)~~ — **DONE**, then **partly superseded on
   2026-08-27**: the quota mechanism below still stands, but automatic scanning was
   removed (R5) and a 4-hour gap added for premium (R7). The `'scheduled'` mode stops
   being written; historical rows keep it. See the revised D2 above.
   Migration `014_scan_mode_quota.sql`
   (idempotent column + index, no backfill); every scan log now records its mode; the
   24h cooldown is replaced by a counted allowance that ignores scheduled scans.
   `getManualScanQuota()` exposes the same computation to the UI, so PendingPage's
   countdown is driven by the real allowance instead of "last scan + 24h" — which would
   otherwise have told premium users to wait 22 hours while a scan was actually
   available.
5. ~~**D3** (widen fetch to everything financial)~~ — **DONE.** Added a narrow
   FINANCIAL_KEYWORDS group (refund, premium, dividend, folio, nach, autopay) covering
   the cases where money moved but no existing verb appears; deliberately excluded
   bill/statement/due (reminders, already rejected) and interest (stems to
   "interested"). Narrowed the prompt's savings/investment rule, which was broad enough
   to reject genuine SIP debits. Found and fixed a false-negative class on the way:
   insurance and subscription confirmations state the next due date, which tripped the
   reminder gate and rejected the whole class.
6. ~~**D5** (smart merge)~~ — **DONE.** Matching logic lives in
   `src/services/paymentMerge.ts` (conservative by design: a missed merge costs a
   dismiss-tap, a wrong merge destroys a transaction). Wired into the scan for both
   directions — two emails in one scan, and a new email against a stored transaction —
   with migration `015_merged_email_message_ids.sql` recording absorbed ids so a merged
   email is never resurrected by a later scan in the window. Stored rows the user has
   already approved or re-categorised are never rewritten. The prompt rule discarding
   merchant "we received your payment" receipts is removed, as planned.
7. ~~**D6** (multi-currency)~~ — **DONE.** Migration `016_transaction_currency.sql`;
   detection and formatting in `src/services/currency.ts`; AI contract carries a
   currency code with an explicit instruction never to convert. `formatCurrency` gained
   an optional currency argument, so all ~100 existing call sites are unchanged, and the
   per-transaction renders the scanner feeds now pass it. Headline totals and historical
   analytics are INR-only, with foreign spend reported separately on the Dashboard
   rather than folded in or silently dropped. Also fixed an interaction with D5:
   `isSamePayment` ignored currency, so $50 and ₹50 merged into one.

   **Not converted between currencies, by design** — that needs a live rate source and a
   rate-on-what-date policy, and would make historical totals drift as rates move.

   **Known remaining surface:** Budgets, Analytics and Subscriptions still aggregate
   without a currency filter. They are INR-correct today because non-INR rows are rare
   and newly possible; revisit if foreign spend becomes common.
8. ~~**D7** (rejection logging for missing amounts)~~ — **DONE.** Two paths that were
   bare `continue`s now log: `no_amount_in_body` (the R12 attachment-only case) and
   `only_balance_or_reward_amounts`. Nothing the user must act on — it just makes the
   cost of skipping PDFs measurable instead of invisible.
9. ~~**Performance Phase 2** (progress + incremental inserts)~~ — **DONE**, moved ahead of
   D3 at the owner's direction: incremental flushing is what stops a larger post-D3 scan
   from losing everything if it dies partway.

---

## 4a. Field-verified recall failures (2026-08-13)

Everything in section 4 was DONE and the whole suite was green, yet most
transactions were still not being detected. The gap was that no test used real
current mail. Running the scanner's own Gmail query against the live inbox
(201 threads in the 7-day window) and replaying the actual bodies through the
engine found five defects, each reproduced before being fixed. All are now
pinned by `emailScanner.liveAlerts.test.ts`, which runs **with the AI disabled**
— the regex ladder has to stand on its own, because a 429 or an exhausted daily
quota is routine and that is exactly when it runs.

| # | Symptom | Cause |
|---|---|---|
| F1 | Every HDFC credit-card alert dropped as `no_amount_in_body` | `Rs. 2247.97` — a space after the dot — matched no amount pattern. The trailing `\b` in `\b(?:Rs\.?)\b` cannot hold between `.` and ` `, so the engine fell back to a bare `Rs` and the following `\s*` met a `.`. `Rs.500` and `Rs 500` both worked, which is why it was never noticed |
| F2 | Every ICICI credit-card alert rejected as `otp_or_security_code` | ICICI closes every alert with "Never share your OTP, URN, CVV or passwords". `stripBoilerplate` knew "please do not share" but not "never share", and ICICI writes "has been used for a transaction of INR X" — never debited/paid/charged — so the gate's payment-evidence escape hatch stayed shut. This is the highest-volume alert in a card user's inbox |
| F3 | Bank alerts filed under Transport | "(Toll Free)" in the helpline footer matched the Transport context keyword `toll`. A UPI transfer to a person and a Claude subscription charge both became Transport |
| F4 | Merchant stored as `1930 3` | The loose bare-`at` merchant pattern scanned the whole body and captured the cyber-crime helpline number. Merchant extraction now reads the amount's own neighbourhood first, and rejects a candidate with no letters in it |
| F5 | Bank alerts scored as untrusted senders | Indian banks migrated to the RBI-restricted `bank.in` zone. Live mail arrives from `alerts@hdfcbank.bank.in`, `credit_cards@icici.bank.in`, `alerts.sbi.bank.in`, `digital.axisbankmail.bank.in`; only `axis.bank.in` had ever been added, by hand. The rest took −15 instead of +35 — a 50-point swing across the confidence floor. `*.bank.in` is now trusted as a zone, which is sound because only RBI-regulated banks can hold one |

Three further defects were structural rather than per-email:

- **S1 — three concurrent scans.** DashboardPage's mount sync, PendingPage's
  mount sync and the manual button each started a full scan, unaware of the
  others. Dashboard → Pending → "Sync Now" ran three passes over the same ~200
  messages at once: Gmail fetches contending for the browser's ~6 connections
  per origin, and enough Gemini calls to cross the proxy's 60/min IP limit —
  whose 429s are invisible and silently drop every affected email to the regex
  ladder that F1–F5 were breaking. A later caller now joins the running scan
  and receives its progress events. **This is the main reason a scan appeared
  not to respond**, and it also explains why the regex-ladder bugs above were
  reachable at all.
- **S2 — the background sync spent the manual allowance.** DashboardPage called
  `scanRealGmailInbox()` with no `scanMode`, which defaults to `'manual'`. An
  unprompted sync on mount consumed the free tier's one daily scan, and the
  user was then told the limit was reached by a scan they never ran.
- **S3 — `scheduled` was an unenforced label.** Both pages tag their background
  sync `'scheduled'` to keep it off the manual quota, but nothing checked
  entitlement, so free users got an automatic daily scan (contradicting R6)
  that no quota counted. Now enforced in the engine, not per page.

### Still open after this pass

1. ~~**`includeSpamTrash=true`**~~ — **DECIDED 2026-08-13: removed.** Owner chose
   to exclude both Spam and Trash. Accepted trade-off, stated at the time: a
   bank alert Gmail misfiles into Spam is now unreachable, and under R3's strict
   7-day window it becomes permanently unreachable once it ages out.
2. **Migration `017`** is not in `DEPLOY_014_TO_016.sql`. If it has not been
   applied, every rejection insert used to fail silently and the audit trail —
   the only tool for diagnosing a recall gap — was empty. The flush now retries
   without the column on `42703`, so this no longer blocks anything, but `017`
   should still be applied.
3. ~~**Performance Phase 3**~~ — **`maxDuration` DONE** (§4b below). The
   **non-atomic quota counter remains open**: the proxy still does a
   read-then-write that loses increments under concurrency. Deliberately not
   fixed in the same pass — the fix needs a new migration, and making the one
   currently-broken path depend on an unapplied migration is exactly the trap
   `017` fell into. It fails *open* (under-counts, so users get more calls than
   the 500/day limit), so it is a cost issue, not a correctness one.
4. **D1a** (financial-year rollover gate) remains as described above.

---

## 4b. The scanner's AI had been dead for ten weeks (2026-08-13)

Everything in sections 4 and 4a was done and green, and the scanner was still
"slow and not giving the desired output". The cause was not in any of the logic
those sections cover.

**Production Vercel logs showed every single `/api/gemini-proxy` call returning
404.** Google shut `gemini-2.0-flash` down on **1 June 2026**. The model id was
a string literal in two API handlers, so from that date
`generativelanguage.googleapis.com` answered every request with 404 NOT_FOUND.

The 404 then travelled a path built entirely out of graceful degradation:

| Layer | Behaviour | Effect |
|---|---|---|
| `gemini-proxy.ts` | forwarded Gemini's status verbatim | a dead model became indistinguishable, in the Vercel request log, from the route not existing |
| `analyzeTransactionEmailBatchWithAI` | `isFatalProxyError` matched `404` → all verdicts `null` | no retry, no error |
| `scanRealGmailInbox` | `null` verdict ⇒ use the regex ladder (guardrail 3) | correct per-email rule |
| scan log | `status: 'success'` | **nothing anywhere said the AI was gone** |

So for ~10 weeks every email was classified by regex alone, and the app
reported clean successes. R1/R2 accuracy, merchant naming and categorisation
were all running on the fallback that sections 4/4a had been hardening —
which is why that hardening kept looking necessary.

**Fixes**

| # | Fix |
|---|---|
| G1 | `api/_lib/geminiModel.ts` — one definition of the model id, imported by both handlers, overridable via the `GEMINI_MODEL` env var. Default is now `gemini-3.5-flash-lite` (owner's choice). A future retirement is a dashboard change, not a pull request |
| G2 | The proxy no longer forwards upstream status blindly: a Gemini 404 becomes a `502` with `code: 'MODEL_NOT_FOUND'` and a loud `console.error` naming the model and the env var; 429 still passes through as 429 |
| G3 | **A scan that gets no AI verdict for *any* email now records it on the scan log**, and PendingPage renders notes on successful scans (it previously rendered them only on failures, so this class of note was written and never shown). Guardrail 3 is untouched — the scan still succeeds and still keeps every transaction |
| G4 | `thinkingConfig: { thinkingBudget: 0 }` on both scan prompts. Every Gemini model from 2.5 on reasons by default and bills thinking against `maxOutputTokens`, so a 500/2000-token classification call can spend its whole budget thinking and return an empty string — reproducing this exact silent failure on a *live* model |

### The other half: why it was slow

`analyzeTransactionEmailBatchWithAI` retried a failed batch as N sequential
single calls, excluding only 404/503/401. So a **429 or a 504 fanned one failed
call out into five doomed serial ones** — five times the latency and five times
the rate-limit burn, with each new 429 provoking the next fan-out. At
concurrency 4 that is 20 pointless serial round trips per wave.

504s were routine, because **neither serverless function declared
`maxDuration`**: Vercel's 10s default was *shorter* than the proxy's own 20s
AbortController and the client's 25s wait, so the platform always won the race
and killed the function mid-call.

- Per-email retry is now attempted **only** for content faults (the model
  answered with unparseable JSON — splitting the batch genuinely helps).
  Transport and service failures return immediately.
- `maxDuration = 60` on both functions, and the timeout ladder is now strictly
  nested: **platform 60s > client 35s > proxy abort 30s**, so a slow call yields
  a clean attributable 504 from our own code.

### Also in this pass

- Five silent `continue`s in Stage C now log rejections
  (`duplicate_reference_id` ×2, `unusable_amount`, `trivial_credit_amount`,
  `amount_below_one`), continuing D7's principle that no rejection is invisible.
- DashboardPage's scheduled-task check ran again on every date-filter change,
  re-attempting a background scan each time; it is now once per visit.

---

## 5. Standing guardrails

1. Never auto-approve (R9 / D8) — tests assert it.
2. Gate ordering is load-bearing: dedup → date window → bulk-marketing → AI → regex.
   Junk must be rejected **before** it costs an AI call.
3. AI failure always degrades to the regex ladder, never to a dropped email. A 429 or
   quota rejection must never surface to the user as a scan failure.
4. `logRejection` stays fire-and-forget; never awaited in the per-email loop.
5. The `23505` row-by-row insert fallback (`emailScanner.ts:1454-1475`) is what makes
   concurrent and retried scans safe. Reuse it; do not rewrite it.
6. Don't edit the AI prompt's STRICT RULES text except where D5 explicitly requires it —
   it encodes hard-won fixes (commits `8b4b42e`, `8457394`, `bdeca15`).
7. Every change: `npx tsc -b && npm test && npm run build` green before commit.
