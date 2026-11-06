import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { platformAccessApi } from '../../services/api';

export default function PlatformInviteAcceptPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!token) { setError('The invitation token is missing. Ask the platform Owner for a new invitation.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await platformAccessApi.acceptInvitation({ token, password, name: name.trim() || undefined });
      setDone(true);
    } catch (e: any) { setError(e?.message ?? 'Invitation could not be accepted'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--ic-bg)]">
    <div className="w-full max-w-md rounded-2xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-6 space-y-5">
      <div><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Join Infracentra Platform Team</h1>
        <p className="text-sm text-[var(--ic-muted)] mt-1">Activate your internal platform account using the single-use invitation.</p></div>
      {done ? <div className="space-y-3"><p className="text-emerald-400 text-sm">Your platform account is active. You can now sign in.</p>
        <button onClick={()=>navigate('/login')} className="w-full rounded-lg bg-cyan-600 text-white py-2.5">Go to sign in</button></div> :
        <form onSubmit={submit} className="space-y-3">
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Display name (optional)" className="w-full rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] px-3 py-2 text-sm"/>
          <input required minLength={12} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Create password (12+ characters)" className="w-full rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] px-3 py-2 text-sm"/>
          <input required minLength={12} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Confirm password" className="w-full rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] px-3 py-2 text-sm"/>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button disabled={busy || !token} className="w-full rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white py-2.5 disabled:opacity-40">{busy ? 'Activating…' : 'Activate platform account'}</button>
        </form>}
      <p className="text-[11px] text-[var(--ic-muted)]">Invitation tokens expire after 72 hours and can only be used once.</p>
    </div>
  </div>;
}
