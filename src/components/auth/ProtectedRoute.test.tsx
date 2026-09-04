// @vitest-environment jsdom
// ============================================
// ProtectedRoute — what a lapsed account is shown
//
// The environment is set per-file on purpose. Every other suite in this repo
// runs on node, and flipping vitest.config.ts to jsdom globally would change
// the environment under 560 tests that never asked for a DOM.
//
// What this guards: a lapsed account must be SHOWN something, not bounced.
// The gate used to answer with `<Navigate to="/pricing">`, which said nothing
// about why the person landed there or what happened to their data. If a later
// change reinstates a redirect, the second test here goes red.
// ============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── Auth, mocked ────────────────────────────────────────────
// ProtectedRoute reads '@/context/AuthContext'; AccessEnded reads the barrel
// '@/context'. Both resolve to the same hook in production, so both are mocked
// to the same controllable value here.
type AuthShape = {
  user: unknown
  loading: boolean
  isSubscriptionActive: boolean
  profile: Record<string, unknown> | null
  signOut: () => void
}

let auth: AuthShape

vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/context', () => ({ useAuth: () => auth }))

// AccessEnded counts the user's transactions purely for reassurance. The screen
// is required to render correctly without it, so the mock returns a rejection —
// the harshest case — rather than a happy path that would hide a missing guard.
vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: null, error: new Error('unavailable') }),
      }),
    }),
  },
}))

import ProtectedRoute from './ProtectedRoute'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>landing</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>dashboard content</div>} />
          <Route path="/settings" element={<div>settings content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  // Auto-cleanup only happens when vitest runs with `globals: true`, which this
  // project does not. Without it every render stacks in the same document and
  // screen queries match elements left over from the previous test.
  afterEach(cleanup)

  beforeEach(() => {
    auth = {
      user: { id: 'u1' },
      loading: false,
      isSubscriptionActive: true,
      profile: { id: 'u1', subscription_status: 'active', subscription_plan_type: 'monthly' },
      signOut: () => {},
    }
  })

  it('lets an entitled account through to the page', async () => {
    renderAt('/dashboard')
    expect(await screen.findByText('dashboard content')).toBeDefined()
  })

  it('shows a lapsed account the access-ended screen instead of redirecting', async () => {
    auth.isSubscriptionActive = false
    auth.profile = { id: 'u1', subscription_status: 'expired', subscription_plan_type: 'monthly' }
    renderAt('/dashboard')

    // The screen, not the page and not a bounce to the landing route.
    expect(await screen.findByText(/Your plan has ended/i)).toBeDefined()
    expect(screen.queryByText('dashboard content')).toBeNull()
    expect(screen.queryByText('landing')).toBeNull()

    // The reassurance that a bare redirect could never give.
    expect(screen.getByText(/Nothing has been deleted/i)).toBeDefined()
  })

  it('names the trial when that is what ran out', async () => {
    auth.isSubscriptionActive = false
    auth.profile = { id: 'u1', subscription_status: 'trial', subscription_plan_type: 'trial' }
    renderAt('/dashboard')
    expect(await screen.findByText(/7-day trial has ended/i)).toBeDefined()
  })

  it('still renders when the transaction count cannot be read', async () => {
    auth.isSubscriptionActive = false
    auth.profile = { id: 'u1', subscription_status: 'expired', subscription_plan_type: 'monthly' }
    renderAt('/dashboard')
    // The count query rejects in this suite; the generic wording must survive it.
    expect(await screen.findByText(/Everything you logged is still here/i)).toBeDefined()
  })

  it('leaves the exempted routes reachable while lapsed', async () => {
    auth.isSubscriptionActive = false
    auth.profile = { id: 'u1', subscription_status: 'expired', subscription_plan_type: 'monthly' }
    renderAt('/settings')
    // Export lives in Settings, and the access-ended screen links to it — so a
    // lapsed user being unable to reach it would strand their own data.
    expect(await screen.findByText('settings content')).toBeDefined()
  })

  it('sends a signed-out visitor to log in, not to the access-ended screen', async () => {
    auth.user = null
    auth.isSubscriptionActive = false
    auth.profile = null
    renderAt('/dashboard')
    expect(await screen.findByText('landing')).toBeDefined()
    expect(screen.queryByText(/has ended/i)).toBeNull()
  })
})
