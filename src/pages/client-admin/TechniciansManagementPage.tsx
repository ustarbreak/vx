import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, RefreshCw, ShieldCheck, UserCog, UserCheck, UserX, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';
import { useAuth } from '../../context/AuthContext';

type Member = {
  id: number | string;
  email: string;
  name: string;
  role: string;
  status: string;
  mfa_enabled: boolean;
  last_login: string | null;
  created_at: string | null;
  org_id: number | null;
};

type Invitation = {
  id: number | string;
  email: string;
  role: string;
  status: string;
  error?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
};

const INVITABLE_ROLES = [
  { value: 'technician', label: 'Technician' },
  { value: 'analyst', label: 'SOC Analyst' },
  { value: 'client_user', label: 'Client User' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Unexpected request error';
}

export default function TechniciansManagementPage() {
  const { user } = useAuth();
  const demo = isDemoMode();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('technician');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await api.get<Member[]>('/users/?limit=200');
      setMembers(Array.isArray(rows) ? rows : []);
      if (demo) {
        // Demo Mode intentionally has no invitation-mail transport.
        setInvitations([]);
      } else {
        const pending = await api.get<Invitation[]>('/invitations');
        setInvitations(Array.isArray(pending) ? pending : []);
      }
    } catch (e) {
      setError(errorMessage(e));
      setMembers([]);
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => { void load(); }, [load]);

  const invite = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setWorking('invite');
    setError('');
    setNotice('');
    try {
      if (demo) {
        const local: Invitation = {
          id: 'demo-' + Date.now(), email: normalized, role, status: 'simulated',
          created_at: new Date().toISOString(),
        };
        setInvitations(prev => [local, ...prev]);
        setNotice('Demo invitation simulated locally. No email was sent and no account was created.');
      } else {
        const result = await api.post<{ id: number; email: string; status: string; note?: string; delivery_error?: string | null }>(
          '/invitations', { email: normalized, role },
        );
        setInvitations(prev => [{
          id: result.id, email: result.email, role, status: result.status,
          error: result.delivery_error, created_at: new Date().toISOString(),
        }, ...prev.filter(item => item.email !== normalized)]);
        setNotice(result.note || 'Invitation created.');
      }
      setEmail('');
      setShowInvite(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const updateMember = async (member: Member, patch: { role?: string; status?: string }) => {
    setWorking(String(member.id));
    setError('');
    setNotice('');
    try {
      if (demo) {
        setMembers(prev => prev.map(row => row.id === member.id ? { ...row, ...patch } : row));
        setNotice('Demo member updated locally. No live account was changed.');
      } else {
        const updated = await api.patch<Member>('/users/' + member.id, patch);
        setMembers(prev => prev.map(row => row.id === member.id ? updated : row));
        setNotice('Member changes saved.');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const resend = async (inv: Invitation) => {
    if (demo) {
      setNotice('Demo Mode has no email transport. No invitation email was sent.');
      return;
    }
    setWorking('invite-' + inv.id);
    setError('');
    setNotice('');
    try {
      const result = await api.post<{ ok: boolean; status: string; error?: string | null }>(
        '/invitations/' + inv.id + '/resend',
      );
      setInvitations(prev => prev.map(row => row.id === inv.id
        ? { ...row, status: result.status, error: result.error }
        : row));
      setNotice(result.ok ? 'Invitation email sent.' : (result.error || 'Invitation remains pending.'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  const visible = members.filter(member => {
    const q = filter.toLowerCase();
    return q === 'all' || member.role === q;
  });
  const active = members.filter(member => member.status === 'active').length;
  const inactive = members.filter(member => member.status !== 'active').length;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <UserCog className="w-6 h-6 text-cyan-400" /> Team & Technicians
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">
            Tenant-scoped team directory, invitations, roles and account status.
            {demo ? ' Demo Mode actions are local simulations.' : ' Live Mode changes are saved by the backend.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="p-2 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-[var(--ic-heading)]">
            <RefreshCw className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          </button>
          <button onClick={() => { setError(''); setShowInvite(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold">
            <Plus className="w-4 h-4" /> Invite member
          </button>
        </div>
      </header>

      {demo && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        Demo Mode: member changes are simulated in this browser session. Invitations do not send email or create real accounts.
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
      </div>}
      {notice && <div role="status" className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm text-cyan-300">{notice}</div>}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <p className="text-xs text-[var(--ic-muted)]">Tenant members</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{members.length}</p>
        </div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <p className="text-xs text-[var(--ic-muted)]">Active accounts</p>
          <p className="text-2xl font-bold text-emerald-400">{active}</p>
        </div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <p className="text-xs text-[var(--ic-muted)]">Inactive / disabled</p>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{inactive}</p>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-[var(--ic-border)]">
          <h2 className="font-semibold text-[var(--ic-heading)]">Organization directory</h2>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]">
            <option value="all">All roles</option>
            <option value="client_admin">Client admins</option>
            <option value="technician">Technicians</option>
            <option value="analyst">SOC analysts</option>
            <option value="client_user">Client users</option>
          </select>
        </div>
        {loading ? <p className="p-8 text-sm text-[var(--ic-muted)]">Loading tenant members…</p> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-[var(--ic-muted)] uppercase">
                <tr className="border-b border-[var(--ic-border)]">
                  <th className="text-left p-3">Member</th><th className="text-left p-3">Role</th>
                  <th className="text-left p-3">Status</th><th className="text-left p-3">MFA</th>
                  <th className="text-left p-3">Last login</th><th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(member => {
                  const editable = member.email !== user?.email && member.role !== 'client_admin';
                  return <tr key={member.id} className="border-b border-[var(--ic-border)] last:border-0">
                    <td className="p-3">
                      <p className="font-medium text-[var(--ic-heading)]">{member.name || 'Unnamed member'}</p>
                      <p className="text-xs text-[var(--ic-muted)]">{member.email}</p>
                    </td>
                    <td className="p-3">
                      <select aria-label={'Role for ' + member.email} value={member.role}
                        disabled={!editable || working === String(member.id)}
                        onChange={e => void updateMember(member, { role: e.target.value })}
                        className="rounded-md border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-2 py-1 text-xs text-[var(--ic-heading)] disabled:opacity-60">
                        {member.role === 'client_admin' && <option value="client_admin">Client Admin</option>}
                        {INVITABLE_ROLES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </td>
                    <td className="p-3">
                      <span className={'inline-flex items-center gap-1 text-xs ' + (member.status === 'active' ? 'text-emerald-400' : 'text-amber-400')}>
                        {member.status === 'active' ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                        {member.status}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-[var(--ic-muted)]">
                      <span className="inline-flex items-center gap-1">{member.mfa_enabled ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : null}{member.mfa_enabled ? 'Enabled' : 'Not enabled'}</span>
                    </td>
                    <td className="p-3 text-xs text-[var(--ic-muted)]">{member.last_login ? new Date(member.last_login).toLocaleString() : 'Not recorded'}</td>
                    <td className="p-3">
                      {editable ? <button disabled={working === String(member.id)}
                        onClick={() => void updateMember(member, { status: member.status === 'active' ? 'inactive' : 'active' })}
                        className="rounded-md border border-[var(--ic-border)] px-2 py-1 text-xs text-[var(--ic-text)] disabled:opacity-50">
                        {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button> : <span className="text-xs text-[var(--ic-muted)]">Protected</span>}
                    </td>
                  </tr>;
                })}
                {!visible.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-[var(--ic-muted)]">No members match this filter.</td></tr>}
              </tbody>
            </table>
          </div>}
      </section>

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
        <div className="p-4 border-b border-[var(--ic-border)]">
          <h2 className="font-semibold text-[var(--ic-heading)] flex items-center gap-2"><Mail className="w-4 h-4 text-cyan-400" /> Invitations</h2>
          <p className="text-xs text-[var(--ic-muted)] mt-1">Delivery status comes from the invitation service; queued does not mean email delivered.</p>
        </div>
        {demo ? <p className="p-4 text-xs text-[var(--ic-muted)]">No real invitation records are available in Demo Mode.</p> :
          <div className="divide-y divide-[var(--ic-border)]">
            {invitations.map(inv => <div key={inv.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm text-[var(--ic-heading)]">{inv.email}</p>
                <p className="text-xs text-[var(--ic-muted)]">{inv.role} · {inv.status}{inv.error ? ' · ' + inv.error : ''}</p></div>
              {['pending', 'sent'].includes(inv.status) && <button onClick={() => void resend(inv)} disabled={working === 'invite-' + inv.id}
                className="rounded-md border border-[var(--ic-border)] px-3 py-1.5 text-xs text-[var(--ic-text)] disabled:opacity-50">Resend</button>}
            </div>)}
            {!invitations.length && <p className="p-6 text-center text-sm text-[var(--ic-muted)]">No invitations recorded.</p>}
          </div>}
      </section>

      {showInvite && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowInvite(false)}>
        <div className="w-full max-w-md rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-4" onClick={e => e.stopPropagation()}>
          <div><h2 className="text-lg font-semibold text-[var(--ic-heading)]">Invite a team member</h2>
            <p className="text-xs text-[var(--ic-muted)] mt-1">The invitation grants only the selected tenant role.</p></div>
          <label className="block text-xs text-[var(--ic-muted)]">Email address
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="person@company.com"
              className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]" />
          </label>
          <label className="block text-xs text-[var(--ic-muted)]">Role
            <select value={role} onChange={e => setRole(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-3 py-2 text-sm text-[var(--ic-heading)]">
              {INVITABLE_ROLES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowInvite(false)} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-text)]">Cancel</button>
            <button onClick={() => void invite()} disabled={working === 'invite' || !email.trim()}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {working === 'invite' ? 'Sending…' : 'Create invitation'}
            </button>
          </div>
        </div>
      </div>}
    </div>
  );
}
