import React from 'react';
import { useAuth } from '../../../src/context/AuthContext';
import { demoUsers } from '../../../src/data/mockData';
import { Users, Plus, CheckCircle2, XCircle } from 'lucide-react';

export default function ClientUsersPage() {
  const { organization } = useAuth();
  if (!organization) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  const orgUsers = demoUsers.filter(u => u.orgId === organization.id);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">User Management</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Manage users and roles for {organization.name}</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] text-sm font-medium">
          <Plus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">MFA</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {orgUsers.map(u => (
              <tr key={u.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center text-xs font-bold">
                      {u.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--ic-heading)]">{u.name}</p>
                      <p className="text-xs text-[var(--ic-muted)]">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    u.role === 'client_admin' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${u.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
                    {u.status === 'active' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${u.mfaEnabled ? 'text-cyber-green' : 'text-cyber-red'}`}>
                    {u.mfaEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-[var(--ic-muted)]">{new Date(u.lastLogin).toLocaleString()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
