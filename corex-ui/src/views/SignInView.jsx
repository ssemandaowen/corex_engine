import React, { useState } from 'react';
import client, { setSessionToken } from '../api/client';

const SignInView = ({ onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await client.post('/auth/signin', { email, password });
      const token = res?.payload?.token;
      const user = res?.payload?.user;
      if (!token) throw new Error('TOKEN_MISSING');
      setSessionToken(token);
      onSignedIn?.(token, user || null);
    } catch (err) {
      setError('Sign-in failed. Check credentials and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#0b0e14] text-slate-200 grid place-items-center p-6">
      <div className="w-full max-w-md border border-slate-800 bg-[#0d1117]/80 rounded-2xl p-6">
        <p className="text-[10px] font-black tracking-[0.35em] text-blue-400 uppercase mb-2">CoreX Access</p>
        <h1 className="text-xl font-black uppercase tracking-wide">Sign In</h1>
        <p className="text-xs text-slate-500 mt-1">Authenticate to access strategy, broker, and MT5 bridge controls.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Email</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-700 bg-black/30 px-3 text-sm outline-none focus:border-blue-500"
              placeholder="admin@corex.local"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-700 bg-black/30 px-3 text-sm outline-none focus:border-blue-500"
              placeholder="Your password"
            />
          </div>
          {error && (
            <div className="text-[11px] text-rose-400 border border-rose-500/30 bg-rose-950/20 rounded px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-10 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-black tracking-widest uppercase"
          >
            {busy ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SignInView;
