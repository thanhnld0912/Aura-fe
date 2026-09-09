/// <reference types="vite/client" />

/**
 * Only public values. Vite inlines every `VITE_`-prefixed variable into the bundle it
 * ships to the browser, so anything declared here is published — see `lib/config.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
