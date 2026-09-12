import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks. Before this, supabase, framer-motion,
        // sentry and React shared one 538 kB chunk with app code, so every
        // deploy changed its hash and every phone re-downloaded all of it —
        // and a tab left open across a deploy lost it entirely. Libraries
        // change only when package.json does, so these hashes survive deploys.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 30 },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
            { name: 'vendor-motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 20 },
            { name: 'vendor-sentry', test: /node_modules[\\/]@sentry(-internal)?[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
})
