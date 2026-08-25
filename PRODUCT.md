# Product

## Register

product

## Users

Privacy-conscious individuals in India who want to understand and control their
personal spending without manual data entry. They use Intrack mostly on a
phone, in short check-ins ("where did my money go this month?"), and care that
their financial data never leaves their device. Mixed financial literacy — the
interface must be reassuring, not intimidating.

## Product Purpose

Intrack automatically tracks expenses by parsing bank-alert SMS/email
**locally on the device** (no bank login, no data sold), then organises them into
budgets, subscriptions, and insights. Success = the user trusts it with their
money picture and checks in regularly with zero manual entry. It ships as a web
app and a Capacitor mobile app; payments via Razorpay (INR).

## Brand Personality

Calm, trustworthy, quietly competent — a serious money tool, not a flashy fintech
toy. Three words: **dependable, clear, unobtrusive.** The product should feel like
it respects the user's attention and their privacy. Confidence comes from
restraint and legibility, not decoration.

## Anti-references

- The previous "Glassmorphic Aurora" theme (frosted glass everywhere, tri-colour
  gradient text, neon glow rings, drifting aurora blobs). Rejected — read as
  generic AI output and undermined trust for a finance app.
- Neon/bright-mint fintech green (#3ecf8e) as a saturated everywhere-accent.
- Decorative motion, glow shadows, gradient text, glassmorphism — all banned.
- Crypto/"to the moon" maximalism. Dark-by-default-because-it-looks-cool.

## Design Principles

1. **Trust through restraint.** One calm evergreen accent used sparingly (primary
   actions, key state). Neutrals and whitespace carry the design.
2. **Legibility is non-negotiable.** Money figures and labels must be effortless to
   read; WCAG AA minimum, tabular figures for amounts.
3. **The tool disappears into the task.** Consistent component vocabulary across
   every screen; familiar affordances; no invented controls.
4. **Privacy is the product.** Visual language should reinforce "your data stays
   here" — solid, contained, no flashy spectacle.
5. **Both light and dark are first-class**, system-aware, with an explicit toggle.

## Accessibility & Inclusion

WCAG 2.1 AA across light and dark. Body text ≥4.5:1, large/bold ≥3:1, placeholders
≥4.5:1. Visible focus rings. `prefers-reduced-motion` honoured (motion is minimal
by design). `prefers-contrast: more` strengthens borders. Status never encoded by
colour alone (icons/labels accompany positive/negative/warning).
