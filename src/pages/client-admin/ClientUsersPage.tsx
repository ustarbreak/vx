import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usersDirectoryApi, type BackendUserRow, ApiError } from '../../services/api';
import { Users, CheckCircle2, XCircle, RefreshCw, ShieldAlert } from 'lucide-react';

export default function ClientUsersPage() {
  const { organization } = useAuth();
  const [users, setUsers] = useState<BackendUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      // Backend scopes non-platform roles to current_user.org_id; do not pass
      // a tenant ID supplied by the browser for client-admin requests.
      const rows = await usersDirectoryApi.list({ limit: 100 });
      setUsers(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to load tenant users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!organization) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">User Management</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Users returned by the backend for {organization.name}. Access is limited to your organization.</p>
        </div>
        <button onClick={() => void load(true)} disabled={loading || refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm text-[var(--ic-text)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 flex gap-3">
        <ShieldAlert className="w-5 h-5 text-cyan-400 shrink-0" />
        <p className="text-sm text-[var(--ic-muted)]">This screen is read-only. The current backend permits user creation and deletion to Platform Admin only; client-side invitation and role changes are not exposed as successful actions.</p>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}
      {loading ? <div className="p-10 text-center text-sm text-[var(--ic-muted)]">Loading organization users…</div>
        : users.length === 0 ? <div className="rounded-xl border border-[var(--ic-border)] p-10 text-center text-sm text-[var(--ic-muted)]"><Users className="w-8 h-8 mx-auto mb-2 opacity-50" />No users were returned for this organization.</div>
        : <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-[var(--ic-border)]">
              {['User','Role','Status','MFA','Last login','Created'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">{h}</th>)}
            </tr></thead>
            <tbody>{users.map(u => <tr key={u.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
              <td className="px-4 py-3"><p className="text-sm font-medium text-[var(--ic-heading)]">{u.name}</p><p className="text-xs text-[var(--ic-muted)]">{u.email}</p></td>
              <td className="px-4 py-3 text-xs text-[var(--ic-text)]">{u.role.replaceAll('_',' ')}</td>
              <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 text-xs ${u.status === 'active' ? 'text-emerald-400' : 'text-rose-400'}`}>{u.status === 'active' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{u.status}</span></td>
              <td className="px-4 py-3 text-xs text-[var(--ic-text)]">{u.mfa_enabled ? 'Enabled' : 'Disabled'}</td>
              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
              <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{new Date(u.created_at).toLocaleDateString()}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
  );
}
