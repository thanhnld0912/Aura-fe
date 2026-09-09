import React, { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ASSETS } from '../data/initialData';

/**
 * The sign-in screen.
 *
 * Deliberately the same warm surface as the rest of AURA rather than a utilitarian
 * form — it is the first thing anyone sees, and the app's whole tone is gentleness.
 *
 * The password is held in component state for exactly as long as the form is on
 * screen and is handed straight to Supabase. It is never stored, never logged, and
 * never sent to the AURA backend, which has no idea passwords exist.
 */
export const LoginView: React.FC = () => {
  const { signIn, status, problem, retry, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocked = status === 'blocked';

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // A successful sign-in unmounts this view, so there is nothing to reset.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign you in.');
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fff8f3] text-[#1e1b17] font-sans flex flex-col items-center justify-center px-5 py-12 selection:bg-[#ffdbce] selection:text-[#370e00]">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <img alt="AURA" className="h-10 w-auto object-contain mb-4" src={ASSETS.logo} />
          <div className="flex items-center gap-2">
            <h1 className="text-[28px] font-bold tracking-tight">AURA</h1>
            <span className="px-2 py-0.5 rounded-full bg-[#adedd0] text-[#306d56] text-[11px] font-bold lowercase tracking-wide">
              companion
            </span>
          </div>
          <p className="mt-2 text-sm text-[#8a726a] leading-relaxed">
            Welcome back. Let&rsquo;s pick up your rhythm where you left it.
          </p>
        </div>

        {blocked ? (
          <div className="bg-white rounded-3xl shadow-[0_8px_40px_-12px_rgba(45,42,38,0.12)] border border-[#eee7e1] p-6 text-center">
            <span className="material-symbols-outlined text-[#9f4118] text-3xl">cloud_off</span>
            <p className="mt-2 text-sm font-semibold text-[#1e1b17]">
              Signed in, but AURA is not answering
            </p>
            <p className="mt-1.5 text-xs text-[#8a726a] leading-relaxed">{problem}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={retry}
                className="flex-1 py-2.5 rounded-full bg-[#ff8a5b] text-white text-sm font-bold hover:bg-[#f5763f] transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex-1 py-2.5 rounded-full bg-[#faf2ec] text-[#56423b] text-sm font-semibold hover:bg-[#f2e7df] transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="bg-white rounded-3xl shadow-[0_8px_40px_-12px_rgba(45,42,38,0.12)] border border-[#eee7e1] p-6 space-y-4"
            noValidate
          >
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-bold text-[#56423b] tracking-wide"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 rounded-xl bg-[#faf2ec] border border-transparent text-sm text-[#1e1b17] placeholder:text-[#bda99f] focus:outline-none focus:border-[#ffdbce] focus:bg-white transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-bold text-[#56423b] tracking-wide"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl bg-[#faf2ec] border border-transparent text-sm text-[#1e1b17] placeholder:text-[#bda99f] focus:outline-none focus:border-[#ffdbce] focus:bg-white transition-colors"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="text-xs text-[#9f4118] bg-[#ffdbce]/50 rounded-xl px-3 py-2 leading-relaxed"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || status === 'connecting'}
              className="w-full py-3 rounded-full bg-[#ff8a5b] text-white text-sm font-bold shadow-[0_8px_24px_-8px_rgba(255,138,91,0.6)] hover:bg-[#f5763f] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {busy || status === 'connecting' ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-[11px] text-[#bda99f] leading-relaxed">
          AURA signs you in through Supabase Auth. Your password is never sent to, or
          stored by, the AURA server.
        </p>
      </div>
    </div>
  );
};

export default LoginView;
