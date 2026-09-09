import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';

/**
 * The one Supabase client in the application.
 *
 * One instance matters more than it looks: each client keeps its own session in
 * memory and its own refresh timer, so a second client would race the first to
 * refresh the same token, and whichever lost would be holding a session that had
 * already been rotated away.
 *
 * AURA uses Supabase for **authentication only**. The backend owns every row of
 * domain data and is the only thing that talks to PostgreSQL; the frontend never
 * queries a table through this client. What it wants from Supabase is the access
 * token, which it then presents to the AURA API.
 */

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // The session lives in localStorage under a key the library manages, and it
        // refreshes itself. AURA deliberately keeps no copy of the token of its own:
        // a second copy is a second thing to expire, invalidate and forget on logout.
        persistSession: true,
        autoRefreshToken: true,
        // Supabase returns from an email confirmation or OAuth redirect with the
        // session in the URL fragment.
        detectSessionInUrl: true,
        storageKey: 'aura.auth.token',
      },
    });
  }
  return client;
}

/**
 * The current access token, refreshed if it has expired.
 *
 * `getSession()` is the supported way to ask: it returns the stored session and
 * renews it first when it is past its expiry, which is why nothing in AURA needs to
 * track token lifetimes itself.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
