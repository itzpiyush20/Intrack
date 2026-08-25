# Lint debt — phased cleanup

Baseline measured 2026-08-26: **591 problems (577 errors, 14 warnings)**.

`CLAUDE.md` says not to treat these as regressions. That means don't *panic* about
them; it does not mean don't fix them. Nothing in this plan is urgent — none of it
is a user-facing bug — so every phase is optional and independently shippable.

## The number that decides the order

| | count |
|---|---|
| Total | 591 |
| **Inside the change-protected email scanner** | **413 (70%)** |
| Freely fixable | 178 |

And 495 of the 591 are a single rule, `@typescript-eslint/no-explicit-any` — 395
of those in scanner files, 308 in `emailScanner.test.ts` alone.

So the honest summary is: **70% of this codebase's lint debt is inside the one
subsystem that requires explicit double confirmation before it is touched, and
most of it is `any` in its test fixtures.** Any plan that ignores that is really
a plan to either stall at 70% or to quietly edit the scanner.

Scanner scope, per `CLAUDE.md` and the owner's standing instruction:
`emailScanner*`, `aiService*`, `emailScanGates*`, `emailBoilerplate*`,
`learningEngine*`, `paymentMerge*`, `currency*`, `api/gemini-proxy*`,
`api/auto-sync-gmail*`, `PendingPage.tsx`, `src/services/__fixtures__/*`.

## Rules

- Every phase ends with `npx tsc -b`, `npm test`, `npm run build`, and a lint
  re-count proving the delta went the intended direction and nothing else moved.
- Run tests **alone**, not chained after lint or build — scanner tests assert on
  `Date.now()` and flake under CPU contention.
- Phases 1–3 must not change behaviour at all. Phases 4–6 can, and each needs a
  browser pass.
- No phase may touch a scanner file until Phase 6, which is gated.

---

### Phase 1 — Zero-risk mechanical, non-scanner (33 problems)

`no-unused-vars` (12), `no-empty` (7), `react-hooks/purity` (7), `no-useless-escape`
(2), `no-useless-assignment` (2), `prefer-const` (0 outside scanner), plus
`react-refresh/only-export-components` (7) — the last means moving non-component
exports into sibling modules, which is mechanical but touches import sites.

Deleting an unused variable cannot change behaviour. An empty `catch {}` gets a
comment explaining why the error is genuinely ignorable, not a swallowed log.

### Phase 2 — `no-explicit-any` outside the scanner (100)

Replace `any` with real types. Where a true shape is unknown, use `unknown` plus a
narrowing check rather than widening back to `any`. This is the phase most likely
to surface a latent bug, because `any` is currently suppressing real type errors —
treat any new `tsc` failure as a **finding to report**, not an obstacle to silence.

### Phase 3 — `react-hooks/exhaustive-deps` outside the scanner (13)

Warnings, not errors. Each is a decision: add the dep, or wrap in `useCallback`/
`useMemo`, or document why the omission is deliberate. Adding a dep can introduce
an extra render or a refetch loop, so each one gets checked in the browser.

### Phase 4 — `react-hooks/set-state-in-effect` outside the scanner (28)

**Highest behavioural risk in the plan.** These are real React anti-patterns that
cause cascading renders, but the fix — deriving state during render, or lifting it —
changes when state settles. Concentrated in `AuthContext`, `DashboardPage`,
`InsightsPage`, `SettingsPage`, `AppLayout`. `AuthContext` in particular gates
subscription and admin state, so a mistake here is a paying user seeing the wrong
entitlement.

Do these **a few files at a time, each its own commit**, never as one sweep.

### Phase 5 — Decide the `any` policy before touching the scanner

Before Phase 6, decide with the owner whether scanner **test** files are worth
typing at all. 308 of the 495 `any`s are in `emailScanner.test.ts`, where they are
mostly mock Gmail payloads. Options: type them properly, extract shared fixture
types, or add a scoped eslint override for `*.test.ts` and close the item honestly
rather than pretending 300 casts are debt worth paying.

A scoped override is a legitimate outcome here, not a cop-out — but it must be a
deliberate, recorded decision, not a silent rule disable.

### Phase 6 — Scanner files (413) — **GATED**

Requires explicit double confirmation from the owner before any edit, per the
standing rule. Even though these are type-only changes, the scanner's failures are
silent: every layer degrades gracefully, so a broken scanner still reports success.

Order within the phase: test files first (no production risk), then
`emailScanner.ts` (31), then the rest. Never batch scanner changes with unrelated
work.

---

## Expected end state

Phases 1–4 take 591 → **413**, all remaining inside the gated scanner scope.
Phase 5 decides whether the real floor is ~100 or ~400. Phase 6 is the only path
below that, and only with sign-off.
