import { useState } from 'react';
import { Radar, Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
    } catch {
      setError('Invalid credentials — check email and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Radar className="w-5 h-5" />
          </div>
          <div>
            <div className="text-lg font-extrabold tracking-tight text-slate-950 leading-none">GhostOps</div>
            <div className="text-[10px] text-slate-400 mt-1 tracking-[0.12em] uppercase">Incident command</div>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-4 shadow-xl shadow-slate-200/50">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <LockKeyhole className="w-4 h-4 text-indigo-500" /> Sign in
            </div>
            <p className="text-xs text-slate-500 mt-1">Access the autonomous operations console.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="username"
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:bg-white"
            />
          </div>

          {error ? (
            <div className={cn('text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2')}>{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors',
              busy ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500',
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Sessions are sealed with a signed httpOnly cookie.
        </p>
      </div>
    </div>
  );
}