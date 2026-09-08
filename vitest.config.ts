import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.vercel/**', '**/.claude/**'],
    // Placeholder credentials so `src/services/supabase.ts` can construct its
    // client at import time. Every test that touches the database injects its
    // own mock client (via the `db` option on scanRealGmailInbox, or vi.mock),
    // so these values are never used to reach a real Supabase instance — they
    // only stop the module-load guard from throwing in a fresh clone that has
    // no .env file.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
