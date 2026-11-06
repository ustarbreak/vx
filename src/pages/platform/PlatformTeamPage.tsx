import React, { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, UserPlus, MailPlus, ShieldCheck, UserCog } from 'lucide-react';
import { platformAccessApi, PlatformStaffDto, PlatformPermissionDto, PlatformPermissionAssignmentDto, PlatformStaffRole } from '../../services/api';

const ROLE_LABEL: Record<string, string> = {
  platform_admin: 'Owner',
  platform_expert: 'Platform Lead / Expert',
  platform_analyst: 'Platform Analyst',
  platform_user: 'Platform User',
};

export default function PlatformTeamPage() {
  const [staff, setStaff] = useState<PlatformStaffDto[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<PlatformPermissionDto[]>([]);
  const [assignments, setAssignments] = useState<PlatformPermissionAssignmentDto[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'create' | 'invite'>('invite');
  const [form, setForm] = useState({ email: '', name: '', role: 'platform_analyst' as PlatformStaffRole, password: '' });
  const [grant, setGrant] = useState({ permission_key: 'platform.dashboard.read', effect: 'allow' as 'allow'|'deny',
    scope_type: 'global' as 'global'|'tenant'|'partner', scope_id: '' });
  const [activationUrl, setActivationUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [team, invites, access, grants] = await Promise.all([
        platformAccessApi.staff(), platformAccessApi.invitations(),
        platformAccessApi.me(), platformAccessApi.assignments(),
      ]);
      setStaff(team); setInvitations(invites); setCatalog(access.permission_catalog); setAssignments(grants);
      if (selected == null && team.length) setSelected(team[0].id);
    } catch (e: any) { setError(e?.message ?? 'Unable to load platform team controls'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const selectedStaff = staff.find(x => x.id === selected) ?? null;
  const selectedGrants = useMemo(() => assignments.filter(x => x.user_id === selected && !x.revoked_at), [assignments, selected]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setNotice(null); setActivationUrl('');
    try {
      if (mode === 'create') {
        await platformAccessApi.createStaff({ email: form.email, name: form.name, role: form.role as Exclude<PlatformStaffRole,'platform_admin'>, password: form.password });
        setNotice('Platform staff account created. The user can sign in with the temporary password you supplied.');
      } else {
        const result = await platformAccessApi.inviteStaff({ email: form.email, name: form.name, role: form.role as Exclude<PlatformStaffRole,'platform_admin'> });
        setActivationUrl(result.activation_url);
        setNotice('Single-use invitation created. Share the activation link securely; it expires in 72 hours.');
      }
      setForm({ email: '', name: '', role: 'platform_analyst', password: '' });
      await load();
    } catch (e: any) { setError(e?.message ?? 'Unable to create platform staff account'); }
    finally { setBusy(false); }
  };

  const addGrant = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selected) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await platformAccessApi.createAssignment({
        user_id: selected, permission_key: grant.permission_key, effect: grant.effect,
        scope_type: grant.scope_type, scope_id: grant.scope_type === 'global' ? null : Number(grant.scope_id),
      });
      setNotice('Permission assignment saved. The staff member session is revoked and must sign in again.');
      await load();
    } catch (e: any) { setError(e?.message ?? 'Permission assignment failed'); }
    finally { setBusy(false); }
  };

  const revokeGrant = async (id: number) => {
    setBusy(true); setError(null);
    try { await platformAccessApi.revokeAssignment(id); setNotice('Permission assignment revoked.'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Could not revoke permission'); }
    finally { setBusy(false); }
  };

  const changeRole = async (id: number, role: PlatformStaffRole) => {
    if (role === 'platform_admin') return;
    setBusy(true); setError(null);
    try { await platformAccessApi.updateRole(id, role); setNotice('Role updated; previous session revoked.'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Role update failed'); }
    finally { setBusy(false); }
  };

  const changeStatus = async (id: number, status: 'active'|'inactive') => {
    setBusy(true); setError(null);
    try { await platformAccessApi.updateStatus(id, status); setNotice('Staff status updated; active sessions revoked.'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Status update failed'); }
    finally { setBusy(false); }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access unavailable; copy the link manually.'); }
  };

  const revokeInvite = async (id: number) => {
    setBusy(true);
    try { await platformAccessApi.revokeInvitation(id); setNotice('Invitation revoked.'); await load(); }
    catch (e: any) { setError(e?.message ?? 'Invitation revoke failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><UserCog className="w-6 h-6 text-cyan-400"/> Platform Team & Access</h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Owner-controlled staff lifecycle, role profiles, scoped permissions and invitation security.</p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm"><RefreshCw className="inline w-4 h-4 mr-2"/>Refresh</button>
      </header>
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 p-3 text-sm">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 p-3 text-sm">{notice}</div>}
      {activationUrl && <div className="rounded-xl border border-cyan-500/30 p-4 space-y-2">
        <div className="text-sm font-semibold">Platform activation link</div>
        <div className="flex gap-2"><input readOnly value={activationUrl} className="min-w-0 flex-1 bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-xs"/>
          <button onClick={() => copy(activationUrl)} className="px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm"><Copy className="w-4 h-4"/></button></div>
        <p className="text-xs text-[var(--ic-muted)]">The raw token is shown once and is not recoverable from the database.</p>
      </div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <section className="xl:col-span-2 rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
          <div className="p-4 border-b border-[var(--ic-border)] flex items-center justify-between">
            <div><h2 className="font-semibold text-[var(--ic-heading)]">Internal platform staff</h2><p className="text-xs text-[var(--ic-muted)]">{staff.length} accounts · owner is immutable</p></div>
            <ShieldCheck className="w-5 h-5 text-cyan-400"/>
          </div>
          {loading ? <p className="p-5 text-sm text-[var(--ic-muted)]">Loading team…</p> : <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
              <th className="text-left p-3">Member</th><th className="text-left p-3">Role</th><th className="text-left p-3">Status</th><th className="text-left p-3">Controls</th>
            </tr></thead><tbody>{staff.map(person => <tr key={person.id} className="border-b border-[var(--ic-border)]/60">
              <td className="p-3"><div className="font-medium text-[var(--ic-heading)]">{person.name}</div><div className="text-xs text-[var(--ic-muted)]">{person.email}</div></td>
              <td className="p-3"><select value={person.role} disabled={busy || person.role === 'platform_admin'} onChange={e => changeRole(person.id,e.target.value as PlatformStaffRole)} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-md p-1.5 text-xs">
                {(['platform_admin','platform_expert','platform_analyst','platform_user'] as PlatformStaffRole[]).map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
              </select></td>
              <td className="p-3"><span className={person.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}>{person.status}</span></td>
              <td className="p-3 flex gap-2"><button onClick={() => setSelected(person.id)} className="text-xs px-2 py-1 rounded border border-[var(--ic-border)]">Permissions</button>
                {person.role !== 'platform_admin' && <button disabled={busy} onClick={() => changeStatus(person.id,person.status === 'active' ? 'inactive' : 'active')} className="text-xs px-2 py-1 rounded border border-[var(--ic-border)]">{person.status === 'active' ? 'Deactivate' : 'Activate'}</button>}
              </td>
            </tr>)}</tbody></table>
          </div>}
        </section>

        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 space-y-3">
          <h2 className="font-semibold text-[var(--ic-heading)]">Add platform staff</h2>
          <div className="flex rounded-lg border border-[var(--ic-border)] p-1">
            <button onClick={() => setMode('invite')} className={mode === 'invite' ? 'flex-1 rounded-md bg-cyan-500/15 text-cyan-300 py-2 text-xs' : 'flex-1 py-2 text-xs text-[var(--ic-muted)]'}><MailPlus className="inline w-3.5 h-3.5 mr-1"/>Invite</button>
            <button onClick={() => setMode('create')} className={mode === 'create' ? 'flex-1 rounded-md bg-cyan-500/15 text-cyan-300 py-2 text-xs' : 'flex-1 py-2 text-xs text-[var(--ic-muted)]'}><UserPlus className="inline w-3.5 h-3.5 mr-1"/>Create directly</button>
          </div>
          <form onSubmit={submit} className="space-y-2">
            <input required type="text" placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm"/>
            <input required type="email" placeholder="Work email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm"/>
            <select value={form.role} onChange={e=>setForm({...form,role:e.target.value as PlatformStaffRole})} className="w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm">
              <option value="platform_expert">Platform Lead / Expert</option><option value="platform_analyst">Platform Analyst</option><option value="platform_user">Platform User</option>
            </select>
            {mode === 'create' && <input required minLength={10} type="password" placeholder="Temporary password (10+ characters)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm"/>}
            <button disabled={busy} className="w-full rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white py-2.5 text-sm font-semibold">{busy ? 'Saving…' : mode === 'invite' ? 'Create invitation link' : 'Create account'}</button>
          </form>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 space-y-4">
          <div><h2 className="font-semibold text-[var(--ic-heading)]">Permission profile & scoped grants</h2><p className="text-xs text-[var(--ic-muted)]">Role defaults are narrow. Explicit deny overrides allow. Changes revoke the member session.</p></div>
          <select value={selected ?? ''} onChange={e=>setSelected(Number(e.target.value))} className="w-full bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-2 text-sm">
            {staff.filter(x=>x.role!=='platform_admin').map(x=><option key={x.id} value={x.id}>{x.name} — {ROLE_LABEL[x.role]}</option>)}
          </select>
          {selectedStaff && <div className="text-xs text-[var(--ic-muted)]">{selectedStaff.email} · {selectedGrants.length} active overrides</div>}
          <form onSubmit={addGrant} className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select value={grant.permission_key} onChange={e=>setGrant({...grant,permission_key:e.target.value})} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-2 text-xs md:col-span-2">
              {catalog.map(x=><option key={x.key} value={x.key}>{x.key} — {x.description}</option>)}
            </select>
            <select value={grant.effect} onChange={e=>setGrant({...grant,effect:e.target.value as 'allow'|'deny'})} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-2 text-xs"><option value="allow">Allow</option><option value="deny">Deny</option></select>
            <select value={grant.scope_type} onChange={e=>setGrant({...grant,scope_type:e.target.value as any,scope_id:''})} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-2 text-xs"><option value="global">Global</option><option value="tenant">Tenant ID</option><option value="partner">Partner ID</option></select>
            {grant.scope_type !== 'global' && <input required type="number" min="1" placeholder="Scope ID" value={grant.scope_id} onChange={e=>setGrant({...grant,scope_id:e.target.value})} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg p-2 text-xs"/>}
            <button disabled={busy || !selected} className="rounded-lg bg-indigo-600 text-white text-xs py-2 disabled:opacity-40">Apply permission</button>
          </form>
          <div className="space-y-2 max-h-72 overflow-auto">
            {selectedGrants.map(x=><div key={x.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--ic-surface-2)]">
              <div className="min-w-0"><div className="text-xs font-medium truncate">{x.permission_key}</div><div className="text-[10px] text-[var(--ic-muted)]">{x.effect} · {x.scope_type}{x.scope_id ? ':'+x.scope_id : ''}</div></div>
              <button disabled={busy} onClick={()=>revokeGrant(x.id)} className="text-rose-400 text-xs">Revoke</button>
            </div>)}
            {!selectedGrants.length && <p className="text-xs text-[var(--ic-muted)]">No explicit overrides for this member.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 space-y-3">
          <h2 className="font-semibold text-[var(--ic-heading)]">Pending & accepted invitations</h2>
          {invitations.map(inv=><div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--ic-surface-2)]">
            <div className="min-w-0"><div className="text-sm font-medium truncate">{inv.email}</div><div className="text-xs text-[var(--ic-muted)]">{ROLE_LABEL[inv.role] ?? inv.role} · {inv.status} · expires {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}</div></div>
            {inv.status === 'pending' && <button disabled={busy} onClick={()=>revokeInvite(inv.id)} className="text-xs text-rose-400">Revoke</button>}
          </div>)}
          {!invitations.length && <p className="text-xs text-[var(--ic-muted)]">No invitations recorded.</p>}
        </section>
      </div>
    </div>
  );
}
