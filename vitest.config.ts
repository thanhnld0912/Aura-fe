import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Kept separate from `vite.config.ts` so the dev server and the build are untouched
 * by test configuration.
 *
 * The `env` block supplies the three public frontend variables. They are fixtures,
 * not credentials: the Supabase URL points at a project that does not exist and the
 * anon key is an unsigned JWT shaped like a real one, so nothing here can reach a
 * live service even by accident.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: {
      VITE_SUPABASE_URL: 'https://testproject.supabase.co',
      VITE_SUPABASE_ANON_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.not-a-real-signature', // gitleaks:allow
      VITE_API_BASE_URL: 'http://localhost:3001/api',
    },
  },
});
