// ============================================
// AdminPage — tab shell for the admin section.
//
// Mostly read-only. The exceptions are Coupons (create/enable/delete, through
// /api/admin), Users (grant/end access, same endpoint), and the handled flag on
// Feedback and Support, which is an admin-only RLS policy rather than an
// endpoint. See docs/superpowers/specs/2026-08-15-admin-panel-design.md.
// ============================================

import { useEffect, useState } from 'react'
import { AppLayout } from '@/layouts'
import { ScrollHint } from '@/components/ui'
import OverviewTab from './OverviewTab'
import UsersTab from './UsersTab'
import ScannerTab from './ScannerTab'
import AiUsageTab from './AiUsageTab'
import FeedbackTab from './FeedbackTab'
import SupportTab from './SupportTab'
import CouponsTab from './CouponsTab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'ai', label: 'AI' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'support', label: 'Support' },
  { id: 'coupons', label: 'Coupons' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview')

  useEffect(() => { document.title = 'Admin | Intrack' }, [])

  return (
    <AppLayout>
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Overview, Scanner and AI are read-only. Users and Coupons can change access;
          Feedback and Support can only be marked handled.
        </p>
      </header>

      <ScrollHint wrapperClassName="mb-6 border-b border-border-subtle" className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'whitespace-nowrap border-b-2 border-brand-400 px-4 py-2 text-sm font-semibold text-zinc-100'
                : 'whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200'
            }
          >
            {t.label}
          </button>
        ))}
      </ScrollHint>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'scanner' && <ScannerTab />}
      {tab === 'ai' && <AiUsageTab />}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'support' && <SupportTab />}
      {tab === 'coupons' && <CouponsTab />}
    </main>
    </AppLayout>
  )
}
