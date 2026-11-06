import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, Loader2, RefreshCw, Shield, UserCog, UserPlus, Users, X } from 'lucide-react';
import { ApiError, platformAccessApi, platformStaffApi, type PlatformPermissionAssignmentDto, type PlatformPermissionDto, type PlatformStaffDto, type PlatformStaffRole } from '../../services/api';

const roleLabel: Record<Exclude<PlatformStaffRole, 'platform_admin'>, string> = {
  platform_expert: 'Leader / Platform Expert',
  platform_analyst: 'Analyst',
  platform_user: 'User',
};
const roleTone: Record<string, string> = {
  platform_expert: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  platform_analyst: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  platform_user: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
};

export default function PlatformTeamPage() {
  const [staff, setStaff] = useState<PlatformStaffDto[]>([]);
  const [catalog, setCatalog] = useState<PlatformPermissionDto[]>([]);
  const [assignments, setAssignments] = useState<PlatformPermissionAssignmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'platform_expert' as Exclude<PlatformStaffRole, 'platform_admin'> });
  const [grant, setGrant] = useState({ permission_key: '', effect: 'allow' as 'allow' | 'deny', scope_type: 'global' as 'global' | 'tenant' | 'partner', scope_id: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [users, access, rows] = await Promise.all([
        platformAccessApi.staff(), platformAccessApi.me(), platformAccessApi.assignments(),
      ]);
      setStaff(users); setCatalog(access.permission_catalog); setAssignments(rows);
      setGrant(g => ({ ...g, permission_key: g.permission_key || access.permission_catalog[0]?.key || '' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setStaff([]); setAssignments([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedStaff = staff.find(s => s.id === selected) ?? null;
  const selectedAssignments = useMemo(() => assignments.filter(a => a.user_id === selected && !a.revoked_at), [assignments, selected]);
  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.status === 'active').length,
    inactive: staff.filter(s => s.status !== 'active').length,
    leaders: staff.filter(s => s.role === 'platform_expert').length,
  }), [staff]);

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      await platformAccessApi.createStaff(form);
      setSuccess('Platform staff account created. Share the initial password through your approved secure channel.');
      setForm({ name: '', email: '', password: '', role: 'platform_expert' });
      setShowCreate(false); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const changeRole = async (user: PlatformStaffDto, role: Exclude<PlatformStaffRole, 'platform_admin'>) => {
    setBusy(true); setError(''); setSuccess('');
    try { await platformAccessApi.updateRole(user.id, role); setSuccess(`Role updated for ${user.email}; their existing sessions were revoked.`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const changeStatus = async (user: PlatformStaffDto) => {
    const next = user.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(`${next === 'inactive' ? 'Suspend' : 'Reactivate'} ${user.email}? Existing sessions will be revoked.`)) return;
    setBusy(true); setError(''); setSuccess('');
    try { await platformStaffApi.updateStatus(user.id, next); setSuccess(`${user.email} is now ${next}; existing sessions were revoked.`); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const createGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const scopeId = grant.scope_type === 'global' ? null : Number(grant.scope_id);
    if (grant.scope_type !== 'global' && (!Number.isInteger(scopeId) || !scopeId || scopeId <= 0)) {
      setError('Enter a valid positive tenant or partner ID for scoped permissions.'); return;
    }
    setBusy(true); setError(''); setSuccess('');
    try {
      await platformAccessApi.createAssignment({
        user_id: selected, permission_key: grant.permission_key, effect: grant.effect,
        scope_type: grant.scope_type, scope_id: scopeId,
      });
      setSuccess('Permission assignment saved and audited.'); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const revokeGrant = async (id: number) => {
    setBusy(true); setError(''); setSuccess('');
    try { await platformAccessApi.revokeAssignment(id); setSuccess('Permission assignment revoked.'); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><UserCog className="w-6 h-6 text-cyan-400" /><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Platform Team & Access</h1></div>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Create platform staff, control roles, suspend accounts and grant scoped capabilities.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => setShowCreate(v => !v)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"><UserPlus className="w-4 h-4" /> Create staff</button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      {success && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-400 flex gap-2"><Check className="w-4 h-4 shrink-0" />{success}</div>}

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          ['Total platform staff', stats.total, Users],
          ['Active accounts', stats.active, Activity],
          ['Suspended accounts', stats.inactive, Shield],
          ['Platform leaders', stats.leaders, UserCog],
        ].map(([label, value, Icon]: any) => <div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--ic-muted)]"><span>{label}</span><Icon className="w-4 h-4 text-cyan-400" /></div>
          <p className="text-2xl font-bold text-[var(--ic-heading)] mt-2 tabular-nums">{value}</p>
        </div>)}
      </section>

      {showCreate && <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5">
        <div className="flex items-center justify-between mb-4"><h2 className="font-semibold text-[var(--ic-heading)]">Create platform account</h2><button onClick={() => setShowCreate(false)} aria-label="Close"><X className="w-4 h-4" /></button></div>
        <form onSubmit={createStaff} className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--ic-muted)]">Full name<input required maxLength={160} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Work email<input required type="email" maxLength={254} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Initial password<input required type="password" minLength={10} maxLength={256} autoComplete="new-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Role<select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as typeof f.role }))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="platform_expert">Leader / Platform Expert</option><option value="platform_analyst">Analyst</option><option value="platform_user">User</option></select></label>
          <div className="md:col-span-2 xl:col-span-4 flex justify-end"><button disabled={busy} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy ? 'Creating…' : 'Create account'}</button></div>
        </form>
        <p className="text-xs text-amber-400 mt-3">This creates an active account with an owner-supplied initial password. Email-based activation invitations are a separate workflow and are not represented as sent by this form.</p>
      </section>}

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
        <div className="p-4 border-b border-[var(--ic-border)]"><h2 className="font-semibold text-[var(--ic-heading)]">Staff directory</h2><p className="text-xs text-[var(--ic-muted)] mt-1">Platform-wide identities only. Tenant and partner users are managed in their own directories.</p></div>
        {loading ? <div className="p-8 text-sm text-[var(--ic-muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading staff…</div> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-[var(--ic-muted)] bg-[var(--ic-surface-2)]"><tr><th className="text-left p-3">Staff member</th><th className="text-left p-3">Role</th><th className="text-left p-3">Status</th><th className="text-left p-3">Last sign-in</th><th className="text-right p-3">Actions</th></tr></thead><tbody>
            {staff.map(user => <tr key={user.id} className="border-t border-[var(--ic-border)]">
              <td className="p-3"><p className="font-medium text-[var(--ic-heading)]">{user.name}</p><p className="text-xs text-[var(--ic-muted)]">{user.email}</p></td>
              <td className="p-3"><select value={user.role} disabled={busy} onChange={e => void changeRole(user, e.target.value as Exclude<PlatformStaffRole, 'platform_admin'>)} className={`rounded-lg border px-2 py-1 text-xs ${roleTone[user.role] ?? ''}`}><option value="platform_expert">Leader / Expert</option><option value="platform_analyst">Analyst</option><option value="platform_user">User</option></select></td>
              <td className="p-3"><span className={`rounded-full border px-2 py-1 text-xs ${user.status === 'active' ? 'text-emerald-400 border-emerald-500/30' : 'text-amber-400 border-amber-500/30'}`}>{user.status}</span></td>
              <td className="p-3 text-xs text-[var(--ic-muted)]">{user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</td>
              <td className="p-3 text-right whitespace-nowrap"><button disabled={busy} onClick={() => setSelected(user.id)} className="rounded-lg border border-[var(--ic-border)] px-2 py-1 text-xs mr-2">Permissions</button><button disabled={busy} onClick={() => void changeStatus(user)} className="rounded-lg border border-[var(--ic-border)] px-2 py-1 text-xs">{user.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td>
            </tr>)}
            {!staff.length && <tr><td colSpan={5} className="p-8 text-center text-sm text-[var(--ic-muted)]">No platform staff accounts found.</td></tr>}
          </tbody></table></div>}
      </section>

      {selectedStaff && <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-4">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[var(--ic-heading)]">Access policy · {selectedStaff.name}</h2><p className="text-xs text-[var(--ic-muted)]">{selectedStaff.email} · {roleLabel[selectedStaff.role as keyof typeof roleLabel] ?? selectedStaff.role}</p></div><button onClick={() => setSelected(null)} aria-label="Close permissions"><X className="w-4 h-4" /></button></div>
        <form onSubmit={createGrant} className="grid md:grid-cols-2 xl:grid-cols-5 gap-2">
          <select required value={grant.permission_key} onChange={e => setGrant(g => ({ ...g, permission_key: e.target.value }))} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-xs text-[var(--ic-heading)]">{catalog.map(p => <option key={p.key} value={p.key}>{p.key} — {p.description}</option>)}</select>
          <select value={grant.effect} onChange={e => setGrant(g => ({ ...g, effect: e.target.value as typeof g.effect }))} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-xs text-[var(--ic-heading)]"><option value="allow">Allow</option><option value="deny">Deny</option></select>
          <select value={grant.scope_type} onChange={e => setGrant(g => ({ ...g, scope_type: e.target.value as typeof g.scope_type }))} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-xs text-[var(--ic-heading)]"><option value="global">Global</option><option value="tenant">Tenant</option><option value="partner">Partner / MSSP</option></select>
          {grant.scope_type !== 'global' && <input required type="number" min="1" placeholder="Scope ID" value={grant.scope_id} onChange={e => setGrant(g => ({ ...g, scope_id: e.target.value }))} className="rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-xs text-[var(--ic-heading)]" />}
          <button disabled={busy} className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950">Add permission</button>
        </form>
        <div className="space-y-2">{selectedAssignments.map(a => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--ic-surface-2)] p-3"><div><p className="text-xs font-medium text-[var(--ic-heading)]">{a.effect.toUpperCase()} · {a.permission_key}</p><p className="text-[11px] text-[var(--ic-muted)]">{a.scope_type}{a.scope_id ? ` #${a.scope_id}` : ' · all resources'}</p></div><button disabled={busy} onClick={() => void revokeGrant(a.id)} className="text-xs text-rose-400">Revoke</button></div>)}
          {!selectedAssignments.length && <p className="text-xs text-[var(--ic-muted)]">No custom grants or denies. Role defaults apply.</p>}</div>
      </section>}
    </main>
  );
}
