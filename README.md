# AURA — frontend

The AURA companion web app. React 19 · Vite 6 · Tailwind 4 · TypeScript.

Authentication is Supabase Auth; everything else comes from the AURA backend
(`AURA-BE`), which owns the database and all business logic. This app never
reaches PostgreSQL, never verifies a JWT, and never calls an AI provider.

```
you --(email + password)--> Supabase Auth --(access token)--> AURA API --> PostgreSQL
```

## Run locally

**Prerequisites:** Node.js 22+, and the AURA backend running on port 3001.

1. `npm install`
2. `cp .env.local.example .env.local`, then fill in the two Supabase values from
   your dashboard (Project Settings → API):
   - `VITE_SUPABASE_URL` — the project **root** URL, `https://<ref>.supabase.co`.
     Not `/rest/v1`; the client appends its own paths.
   - `VITE_SUPABASE_ANON_KEY` — the **anon / publishable** key.
3. `npm run dev` → http://localhost:3000

The backend must allow this origin: `CORS_ORIGIN=http://localhost:3000` in
`AURA-BE/server/.env`.

### What must never go in a `VITE_` variable

Vite inlines every `VITE_` variable into the bundle it serves to the browser, so
"in the frontend" and "published" mean the same thing. The service role key, the
JWT secret, the database URL and every AI provider key stay in
`AURA-BE/server/.env`. `src/lib/config.ts` refuses to start if it is handed a
service role key, a secret key or a personal access token by mistake.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server on :3000 |
| `npm run build` | Production build to `dist/` |
| `npm test` | Vitest — config guards, API client, auth flow |
| `npm run lint` | `tsc --noEmit` |

## How signing in works

`src/auth/AuthProvider.tsx` is the only place that knows whether anyone is signed
in. It subscribes to `supabase.auth.onAuthStateChange` and reacts to
`INITIAL_SESSION` (a restored session after a page refresh), `SIGNED_IN`,
`TOKEN_REFRESHED` and `SIGNED_OUT`.

On a new session it calls `POST /api/auth/session` with the Supabase access
token. The backend verifies that token, creates the AURA user row on first
contact, and returns the AURA identity.

`src/lib/api.ts` attaches `Authorization: Bearer <token>` to every authenticated
request, reading the token from the Supabase client at call time. There is no
second copy of the token anywhere, and nothing is ever pasted in by hand.
