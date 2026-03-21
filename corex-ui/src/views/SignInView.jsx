import React, { useState, useEffect, useRef } from 'react';
import client, { setSessionAuthKey, setSessionToken } from '../api/client';

/* ── Wave Canvas background ─────────────────────────────── */
function WaveCanvas() {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const waves = [
      { amp: 0.13, freq: 0.018, speed: 0.0007, phase: 0,   alpha: 0.55, width: 1.5 },
      { amp: 0.07, freq: 0.034, speed: 0.0013, phase: 1.2, alpha: 0.35, width: 1.0 },
      { amp: 0.09, freq: 0.011, speed: 0.0005, phase: 2.7, alpha: 0.25, width: 2.0 },
      { amp: 0.04, freq: 0.062, speed: 0.0022, phase: 0.8, alpha: 0.20, width: 0.8 },
      { amp: 0.055,freq: 0.027, speed: 0.0009, phase: 3.5, alpha: 0.30, width: 1.2 },
    ];

    const ticks = Array.from({ length: 40 }, (_, i) => ({
      x: i / 39,
      h: 0.03 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0004 + Math.random() * 0.0006,
    }));

    const draw = (ts) => {
      const t = ts * 0.001;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      /* grid */
      ctx.strokeStyle = 'rgba(148,163,184,0.06)';
      ctx.lineWidth   = 0.5;
      for (let i = 1; i < 8;  i++) { ctx.beginPath(); ctx.moveTo(0, H/8*i); ctx.lineTo(W, H/8*i); ctx.stroke(); }
      for (let i = 1; i < 12; i++) { ctx.beginPath(); ctx.moveTo(W/12*i, 0); ctx.lineTo(W/12*i, H); ctx.stroke(); }

      /* waves */
      waves.forEach((w, wi) => {
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        if (wi % 2 === 0) {
          grad.addColorStop(0,   `rgba(56,189,248,0)`);
          grad.addColorStop(0.4, `rgba(56,189,248,${w.alpha})`);
          grad.addColorStop(0.7, `rgba(6,182,212,${w.alpha * 0.8})`);
          grad.addColorStop(1,   `rgba(6,182,212,0)`);
        } else {
          grad.addColorStop(0,   `rgba(99,102,241,0)`);
          grad.addColorStop(0.5, `rgba(99,102,241,${w.alpha})`);
          grad.addColorStop(1,   `rgba(56,189,248,0)`);
        }
        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth   = w.width;
        ctx.shadowColor = wi === 0 ? '#38bdf8' : '#06b6d4';
        ctx.shadowBlur  = wi === 0 ? 8 : 4;
        for (let px = 0; px <= W; px += 2) {
          const nx = px / W;
          const y = H * 0.5
            + Math.sin(nx * w.freq * W + t * w.speed * W + w.phase) * H * w.amp
            + Math.sin(nx * w.freq * W * 1.7 + t * w.speed * W * 0.6 + w.phase + 1) * H * w.amp * 0.4;
          px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      /* fill under primary wave */
      const fillGrad = ctx.createLinearGradient(0, 0, 0, H);
      fillGrad.addColorStop(0, 'rgba(56,189,248,0.06)');
      fillGrad.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = fillGrad;
      ctx.beginPath();
      const w0 = waves[0];
      for (let px = 0; px <= W; px += 2) {
        const nx = px / W;
        const y = H * 0.5
          + Math.sin(nx * w0.freq * W + t * w0.speed * W + w0.phase) * H * w0.amp
          + Math.sin(nx * w0.freq * W * 1.7 + t * w0.speed * W * 0.6 + w0.phase + 1) * H * w0.amp * 0.4;
        px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

      /* tick bars */
      ticks.forEach((tk) => {
        const x    = tk.x * W;
        const mid  = H * 0.5 + Math.sin(tk.phase + t * tk.speed * W * 0.8) * H * 0.18;
        const halfH = tk.h * H * (0.7 + 0.3 * Math.sin(t * 0.3 + tk.phase));
        const alpha = 0.10 + 0.12 * Math.abs(Math.sin(t * 0.2 + tk.phase));
        ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
        ctx.lineWidth   = 0.8;
        ctx.beginPath(); ctx.moveTo(x, mid - halfH); ctx.lineTo(x, mid + halfH); ctx.stroke();
        const bodyH = halfH * 0.4;
        const up    = Math.sin(t * 0.15 + tk.phase) > 0;
        ctx.fillStyle = up ? `rgba(34,197,94,${alpha * 1.4})` : `rgba(239,68,68,${alpha * 1.4})`;
        ctx.fillRect(x - 1.5, mid - bodyH / 2, 3, bodyH);
      });

      /* scan line */
      const scanX = (t * 0.04 * W) % W;
      const scanGrad = ctx.createLinearGradient(scanX - 60, 0, scanX + 20, 0);
      scanGrad.addColorStop(0, 'rgba(56,189,248,0)');
      scanGrad.addColorStop(0.7, 'rgba(56,189,248,0.12)');
      scanGrad.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 60, 0, 80, H);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.9 }} />;
}

/* ── Shared primitives ───────────────────────────────────── */
function Field({ label, type, value, onChange, placeholder, autoComplete }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(100,116,139,1)', fontFamily: 'var(--auth-mono)' }}>
        {label}
      </label>
      <input
        type={type} autoComplete={autoComplete} value={value} onChange={onChange} placeholder={placeholder}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{
          height: '40px', background: 'rgba(15,23,42,0.6)',
          border: `1px solid ${focused ? '#38bdf8' : 'rgba(148,163,184,0.14)'}`,
          boxShadow: focused ? '0 0 0 3px rgba(56,189,248,0.12)' : 'none',
          borderRadius: '6px', padding: '0 14px',
          color: '#e2e8f0', fontSize: '12px', fontFamily: 'var(--auth-mono)',
          outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s', width: '100%', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function ErrorBanner({ children }) {
  return (
    <div style={{ fontSize: '11px', fontFamily: 'var(--auth-mono)', color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '8px 12px' }}>
      {children}
    </div>
  );
}

function SubmitButton({ busy, label, busyLabel }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button type="submit" disabled={busy}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        height: '42px', width: '100%', border: 'none', borderRadius: '6px', cursor: busy ? 'not-allowed' : 'pointer',
        background: busy ? '#0369a1' : hovered ? '#7dd3fc' : '#38bdf8',
        color: '#020617', fontFamily: 'var(--auth-mono)', fontSize: '11px', fontWeight: 800,
        letterSpacing: '0.18em', textTransform: 'uppercase', opacity: busy ? 0.7 : 1,
        transition: 'background 0.15s, opacity 0.15s',
      }}>
      {busy ? busyLabel : label}
    </button>
  );
}

function SwitchLink({ text, cta, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ textAlign: 'center', paddingTop: '4px' }}>
      <span style={{ fontSize: '11px', color: 'rgba(100,116,139,1)', fontFamily: 'var(--auth-mono)' }}>{text}{' '}</span>
      <button type="button" onClick={onClick}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ fontSize: '11px', fontFamily: 'var(--auth-mono)', fontWeight: 700, color: hovered ? '#7dd3fc' : '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, transition: 'color 0.15s' }}>
        {cta} →
      </button>
    </div>
  );
}

/* ── Sign In ─────────────────────────────────────────────── */
function SignInForm({ onSignedIn, onSwitch }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true); setError('');
    try {
      const res     = await client.post('/auth/signin', { email, password, issueAuthKey: true });
      const token   = res?.payload?.token;
      const user    = res?.payload?.user;
      const authKey = res?.payload?.authKey?.key;
      if (!token) throw new Error('TOKEN_MISSING');
      setSessionToken(token);
      if (authKey) setSessionAuthKey(authKey);
      onSignedIn?.(token, user || null);
    } catch { setError('Authentication failed. Check your credentials.'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Field label="Email"    type="email"    autoComplete="username"         value={email}    onChange={(e) => setEmail(e.target.value)}    placeholder="operator@corex.io" />
      <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <SubmitButton busy={busy} label="Access System" busyLabel="Authenticating…" />
      <SwitchLink text="No account?" cta="Register" onClick={() => onSwitch('up')} />
    </form>
  );
}

/* ── Sign Up ─────────────────────────────────────────────── */
function SignUpForm({ onSwitch }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await client.post('/auth/signup', { email, password });
      setDone(true);
    } catch { setError('Registration failed. Email may already be in use.'); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '16px 0' }}>
      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontSize: '20px' }}>✓</div>
      <p style={{ margin: 0, color: '#e2e8f0', fontSize: '13px', fontWeight: 700, fontFamily: 'var(--auth-mono)' }}>Account created</p>
      <p style={{ margin: 0, color: 'rgba(100,116,139,1)', fontSize: '11px', fontFamily: 'var(--auth-mono)' }}>You can now sign in.</p>
      <button onClick={() => onSwitch('in')} style={{ marginTop: '6px', height: '36px', padding: '0 24px', background: '#38bdf8', border: 'none', borderRadius: '6px', color: '#020617', fontFamily: 'var(--auth-mono)', fontSize: '11px', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}>
        Sign In
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Field label="Email"            type="email"    autoComplete="username"     value={email}    onChange={(e) => setEmail(e.target.value)}    placeholder="operator@corex.io" />
      <Field label="Password"         type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" />
      <Field label="Confirm Password" type="password" autoComplete="new-password" value={confirm}  onChange={(e) => setConfirm(e.target.value)}  placeholder="••••••••••••" />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <SubmitButton busy={busy} label="Create Account" busyLabel="Registering…" />
      <SwitchLink text="Have an account?" cta="Sign In" onClick={() => onSwitch('in')} />
    </form>
  );
}

/* ── Sign Out ────────────────────────────────────────────── */
function SignOutPanel({ user, onSignedOut }) {
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    try { await client.post('/auth/signout'); } catch { /* ignore */ }
    setSessionToken(null); setSessionAuthKey(null);
    onSignedOut?.(); setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', padding: '8px 0' }}>
      <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#38bdf8', fontFamily: 'var(--auth-mono)', fontWeight: 800 }}>
        {String(user?.email || 'U')[0].toUpperCase()}
      </div>
      {user?.email && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '9px', color: 'rgba(100,116,139,1)', fontFamily: 'var(--auth-mono)', letterSpacing: '0.18em', textTransform: 'uppercase' }}>Signed in as</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#e2e8f0', fontFamily: 'var(--auth-mono)', fontWeight: 700 }}>{user.email}</p>
        </div>
      )}
      <button onClick={handleSignOut} disabled={busy}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ height: '40px', width: '100%', background: hovered ? 'rgba(239,68,68,0.08)' : 'none', border: `1px solid ${hovered ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.35)'}`, borderRadius: '6px', cursor: busy ? 'not-allowed' : 'pointer', color: '#f87171', fontFamily: 'var(--auth-mono)', fontSize: '11px', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: busy ? 0.5 : 1, transition: 'background 0.15s, border-color 0.15s' }}>
        {busy ? 'Signing Out…' : 'Sign Out'}
      </button>
    </div>
  );
}

/* ── Ticker strip ────────────────────────────────────────── */
const TICKERS = ['EURUSD +0.12%', 'BTCUSD +2.34%', 'XAUUSD -0.08%', 'NASDAQ +0.67%', 'GBPUSD -0.21%', 'USDJPY +0.44%', 'SP500 +0.31%', 'ETHUSD +1.87%', 'DXY -0.15%', 'CRUDE +0.92%'];

function TickerStrip() {
  return (
    <>
      <style>{`@keyframes tickerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '26px', borderTop: '1px solid rgba(148,163,184,0.07)', background: 'rgba(2,6,23,0.65)', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: '40px', animation: 'tickerScroll 26s linear infinite', whiteSpace: 'nowrap', paddingLeft: '100%' }}>
          {[...TICKERS, ...TICKERS].map((item, i) => (
            <span key={i} style={{ fontSize: '10px', fontFamily: 'var(--auth-mono)', fontWeight: 700, letterSpacing: '0.08em', color: item.includes('+') ? 'rgba(74,222,128,0.65)' : 'rgba(248,113,113,0.65)' }}>
              {item}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── Main ────────────────────────────────────────────────── */
const AuthView = ({ mode: modeProp = 'in', user: userProp = null, onSignedIn, onSignedOut }) => {
  const [mode, setMode] = useState(modeProp);

  const META = {
    in:  { title: 'Sign In',        sub: 'Authenticate to access strategy, broker, and MT5 bridge controls.' },
    up:  { title: 'Create Account', sub: 'Register a new operator account for CoreX platform access.'        },
    out: { title: 'Session',        sub: 'Your active operator session.'                                     },
  };

  return (
    <>
      <style>{`
        :root { --auth-mono: 'JetBrains Mono','Fira Code','Cascadia Code',ui-monospace,monospace; }
        @keyframes panelIn { from { opacity:0; transform:translateY(10px) scale(0.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes pulseRing { 0%,100% { opacity:.4; transform:scale(1); } 50% { opacity:.9; transform:scale(1.08); } }
      `}</style>

      <div style={{ position: 'relative', height: '100vh', width: '100vw', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: 'var(--auth-mono)' }}>
        <WaveCanvas />

        {/* vignette */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 25%, rgba(2,6,23,0.8) 100%)' }} />

        {/* top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '44px', borderBottom: '1px solid rgba(148,163,184,0.09)', background: 'rgba(2,6,23,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ position: 'relative', width: '8px', height: '8px' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#38bdf8', animation: 'pulseRing 2.2s ease-in-out infinite' }} />
              <div style={{ position: 'absolute', inset: '2px', borderRadius: '50%', background: '#38bdf8' }} />
            </div>
            <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.22em', color: '#38bdf8', textTransform: 'uppercase' }}>CoreX Terminal</span>
          </div>
          <span style={{ fontSize: '9px', color: 'rgba(100,116,139,1)', letterSpacing: '0.15em' }}>MARKET ENGINE v2.0</span>
        </div>

        {/* card */}
        <div key={mode} style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '400px', margin: '0 16px', background: 'rgba(8,15,35,0.82)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '12px', padding: '28px', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', animation: 'panelIn 0.3s cubic-bezier(0.16,1,0.3,1) both', boxSizing: 'border-box' }}>

          {/* card header */}
          <div style={{ marginBottom: '22px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '9px', fontWeight: 800, letterSpacing: '0.28em', color: '#38bdf8', textTransform: 'uppercase' }}>CoreX Access Control</p>
            <h1 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 800, letterSpacing: '0.05em', color: '#e2e8f0', textTransform: 'uppercase' }}>{META[mode].title}</h1>
            <p style={{ margin: 0, fontSize: '11px', lineHeight: '1.6', color: 'rgba(100,116,139,1)' }}>{META[mode].sub}</p>
          </div>

          <div style={{ height: '1px', background: 'rgba(148,163,184,0.1)', marginBottom: '20px' }} />

          {mode === 'in'  && <SignInForm   onSignedIn={onSignedIn} onSwitch={setMode} />}
          {mode === 'up'  && <SignUpForm   onSwitch={setMode} />}
          {mode === 'out' && <SignOutPanel user={userProp} onSignedOut={onSignedOut} />}

          {/* corner accents */}
          <div style={{ position: 'absolute', top: 0, right: 0, width: '56px', height: '56px', borderTop: '1px solid rgba(56,189,248,0.2)', borderRight: '1px solid rgba(56,189,248,0.2)', borderRadius: '0 12px 0 0', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: '38px', height: '38px', borderBottom: '1px solid rgba(56,189,248,0.1)', borderLeft: '1px solid rgba(56,189,248,0.1)', borderRadius: '0 0 0 12px', pointerEvents: 'none' }} />
        </div>

        <TickerStrip />
      </div>
    </>
  );
};

export default AuthView;
