## Summary of Changes

<!-- Describe what this PR does and why -->

## Verification Checklist

- [ ] `npm run build` passes cleanly (`tsc -b && vite build`)
- [ ] `npm test` passes cleanly
- [ ] Invariant respected: Scanned transactions land in Pending (no auto-approval)
- [ ] Any database schema changes have a numbered migration in `supabase/` and safety-net in `schema.sql`
- [ ] No secrets / API keys committed
