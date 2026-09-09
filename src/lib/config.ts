/**
 * The frontend's configuration, read once and checked before anything uses it.
 *
 * Only three values, and every one of them is public by design: the Supabase project
 * URL, the anon key (guarded by Row Level Security), and the AURA API base URL. No
 * service role key, no JWT secret, no database URL and no AI provider key belongs in
 * a `VITE_` variable — Vite inlines those into the bundle it ships to the browser, so
 * "in the frontend" and "published on the internet" are the same statement.
 *
 * The checks below exist because the failure modes are quiet ones. A service role key
 * pasted where the anon key goes still authenticates, still works in development, and
 * hands every visitor the ability to read every user's rows. Failing at boot with a
 * readable message is the only way that gets noticed.
 */

export interface FrontendConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
}

/** The `role` claim of a Supabase key JWT, or null when it is not one. */
function roleClaimOf(key: string): string | null {
  const payload = key.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims: unknown = JSON.parse(json);
    const role = (claims as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function readConfig(env: Record<string, string | undefined>): FrontendConfig {
  const problems: string[] = [];

  const supabaseUrl = (env['VITE_SUPABASE_URL'] ?? '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (env['VITE_SUPABASE_ANON_KEY'] ?? '').trim();
  const apiBaseUrl = (env['VITE_API_BASE_URL'] ?? 'http://localhost:3001/api')
    .trim()
    .replace(/\/+$/, '');

  if (!supabaseUrl) {
    problems.push('VITE_SUPABASE_URL is missing.');
  } else if (!/^https?:\/\//.test(supabaseUrl)) {
    problems.push('VITE_SUPABASE_URL must be a full URL, starting with https://.');
  } else if (/\/(rest|auth|storage|realtime)\/v\d/.test(supabaseUrl)) {
    // A very easy mistake: the dashboard shows the REST endpoint prominently, and the
    // client builds its own paths, so a URL ending in /rest/v1 produces 404s that look
    // like the project is misconfigured rather than the URL.
    problems.push(
      'VITE_SUPABASE_URL must be the project root (https://<ref>.supabase.co), ' +
        'not a service path such as /rest/v1.',
    );
  }

  if (!supabaseAnonKey) {
    problems.push('VITE_SUPABASE_ANON_KEY is missing.');
  } else if (supabaseAnonKey.startsWith('sbp_')) {
    problems.push(
      'VITE_SUPABASE_ANON_KEY looks like a Personal Access Token (sbp_...). That is a ' +
        'management-API credential for your Supabase account, not a project key.',
    );
  } else if (roleClaimOf(supabaseAnonKey) === 'service_role') {
    problems.push(
      'VITE_SUPABASE_ANON_KEY is a service role key. It bypasses Row Level Security ' +
        'and must never reach a browser. Use the anon / publishable key.',
    );
  } else if (supabaseAnonKey.startsWith('sb_secret_')) {
    problems.push(
      'VITE_SUPABASE_ANON_KEY is a secret key (sb_secret_...). Use the publishable ' +
        'key (sb_publishable_...) instead.',
    );
  }

  if (!/^https?:\/\//.test(apiBaseUrl)) {
    problems.push('VITE_API_BASE_URL must be a full URL, e.g. http://localhost:3001/api.');
  }

  if (problems.length > 0) {
    throw new Error(
      `AURA frontend configuration problem:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'Copy .env.local.example to .env.local and fill it in from your Supabase ' +
        'dashboard (Project Settings -> API).',
    );
  }

  return { supabaseUrl, supabaseAnonKey, apiBaseUrl };
}

let cached: FrontendConfig | undefined;

/**
 * Resolved on first use rather than at import, so a module can be imported by a test
 * without the whole environment having to exist first.
 */
export function getConfig(): FrontendConfig {
  cached ??= readConfig(import.meta.env as unknown as Record<string, string | undefined>);
  return cached;
}
