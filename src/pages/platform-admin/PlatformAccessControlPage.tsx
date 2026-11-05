import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock3, KeyRound, Loader2, RefreshCw,
  ShieldCheck, UserPlus, Users, XCircle,
} from 'lucide-react';
import {
  platformAccessApi, type PlatformPermissionDto, type PlatformPermissionAssignmentDto,
  type PlatformStaffDto, type PlatformStaffRole,
} from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

type AccessMe = {
  user_id: number;
  role: PlatformStaffRole;
  owner: boolean;
  permissions: PlatformPermissionDto[];
  permission_catalog: PlatformPermissionDto[];
  assignments: PlatformPermissionAssignmentDto[];
};

const roleLabels: Record<PlatformStaffRole, string> = {
  platform_admin: 'Owner',
  platform_expert: 'Platform Expert',
  platform_analyst: 'Platform Analyst',
  platform_user: 'Platform User',
};

const initialStaff = { email: '', name: '', password: '', role: 'platform_analyst' as const };

export default function PlatformAccessControlPage() {
  const [me, setMe] = useState<AccessMe | null>(null);
  const [staff, setStaff] = useState<PlatformStaffDto[]>([]);
  const [assignments, setAssignments] = useState<PlatformPermissionAssignmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [staffForm, setStaffForm] = useState(initialStaff);
  const [grant, setGrant] = useState({
    user_id: '', permission_key: '', effect: 'allow' as 'allow' | 'deny',
    scope_type: 'global' as 'global' | 'tenant' | 'partner', scope_id: '', expires_at: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [access, users, grants] = await Promise.all([
        platformAccessApi.me(), platformAccessApi.staff(), platformAccessApi.assignments(),
      ]);
      setMe(access);
      setStaff(users);
      setAssignments(grants);
      setGrant(current => ({
        ...current,
        user_id: current.user_id || String(users.find(u => u.role !== 'platform_admin')?.id ?? ''),
        permission_key: current.permission_key || access.permission_catalog[0]?.key || '',
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger les données de contrôle d’accès.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const createStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAccessApi.createStaff(staffForm);
      setStaffForm(initialStaff);
      setNotice('Le compte de l’équipe plateforme a été créé.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de création du compte.');
    } finally { setBusy(false); }
  };

  const updateRole = async (userId: number, role: Exclude<PlatformStaffRole, 'platform_admin'>) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAccessApi.updateRole(userId, role);
      setNotice('Rôle mis à jour. Les sessions existantes de cet utilisateur sont invalidées.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de mise à jour du rôle.');
    } finally { setBusy(false); }
  };

  const createGrant = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAccessApi.createAssignment({
        user_id: Number(grant.user_id),
        permission_key: grant.permission_key,
        effect: grant.effect,
        scope_type: grant.scope_type,
        scope_id: grant.scope_type === 'global' ? null : Number(grant.scope_id),
        expires_at: grant.expires_at ? new Date(grant.expires_at).toISOString() : null,
      });
      setNotice('La règle d’accès a été enregistrée et auditée.');
      setGrant(current => ({ ...current, expires_at: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de création de la règle.');
    } finally { setBusy(false); }
  };

  const revoke = async (id: number) => {
    if (!window.confirm('Révoquer cette règle d’accès ? Les sessions de l’utilisateur concerné seront invalidées.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformAccessApi.revokeAssignment(id);
      setNotice('Règle révoquée.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de révocation.');
    } finally { setBusy(false); }
  };

  if (isDemoMode()) {
    return <div className="p-6 max-w-4xl mx-auto">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <AlertTriangle className="w-6 h-6 text-amber-400 mb-2" />
        <h1 className="text-xl font-semibold text-[var(--ic-heading)]">Contrôle d’accès plateforme</h1>
        <p className="text-sm text-[var(--ic-muted)] mt-2">Cette fonction de sécurité nécessite une session réelle et le backend actif. Le mode Démo ne peut ni créer des comptes ni modifier des autorisations.</p>
      </div>
    </div>;
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-purple-400" /> Centre de contrôle des accès</h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">Gestion Owner des comptes, rôles et autorisations de l’équipe Infracentra.</p>
        </div>
        <button onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300 flex gap-2"><XCircle className="w-4 h-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300 flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" />{notice}</div>}

      {loading ? <div className="py-16 flex justify-center text-[var(--ic-muted)]"><Loader2 className="w-5 h-5 animate-spin" /><span className="ml-2 text-sm">Chargement des autorisations…</span></div> :
      !me?.owner ? <div className="rounded-xl border border-rose-500/30 p-5 text-sm text-rose-300">Accès refusé : cette console est réservée au Owner.</div> : <>
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><p className="text-xs text-[var(--ic-muted)]">Comptes plateforme</p><p className="text-2xl font-semibold text-[var(--ic-heading)]">{staff.length}</p></div>
          <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><p className="text-xs text-[var(--ic-muted)]">Permissions disponibles</p><p className="text-2xl font-semibold text-[var(--ic-heading)]">{me.permission_catalog.length}</p></div>
          <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><p className="text-xs text-[var(--ic-muted)]">Règles enregistrées</p><p className="text-2xl font-semibold text-[var(--ic-heading)]">{assignments.length}</p></div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <form onSubmit={createStaff} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-3">
            <h2 className="font-semibold text-[var(--ic-heading)] flex items-center gap-2"><UserPlus className="w-4 h-4 text-cyan-400" /> Ajouter un membre plateforme</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-[var(--ic-muted)]">Nom<input required value={staffForm.name} onChange={e => setStaffForm(v => ({...v,name:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
              <label className="text-xs text-[var(--ic-muted)]">E-mail<input required type="email" value={staffForm.email} onChange={e => setStaffForm(v => ({...v,email:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
              <label className="text-xs text-[var(--ic-muted)]">Mot de passe temporaire<input required minLength={10} type="password" value={staffForm.password} onChange={e => setStaffForm(v => ({...v,password:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
              <label className="text-xs text-[var(--ic-muted)]">Rôle<select value={staffForm.role} onChange={e => setStaffForm(v => ({...v,role:e.target.value as typeof initialStaff.role}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="platform_expert">Platform Expert</option><option value="platform_analyst">Platform Analyst</option><option value="platform_user">Platform User</option></select></label>
            </div>
            <button disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Enregistrement…' : 'Créer le compte'}</button>
          </form>

          <form onSubmit={createGrant} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-3">
            <h2 className="font-semibold text-[var(--ic-heading)] flex items-center gap-2"><KeyRound className="w-4 h-4 text-cyan-400" /> Attribuer ou refuser une permission</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs text-[var(--ic-muted)]">Membre<select required value={grant.user_id} onChange={e => setGrant(v => ({...v,user_id:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="">Sélectionner…</option>{staff.filter(u => u.role !== 'platform_admin').map(u => <option key={u.id} value={u.id}>{u.name} — {roleLabels[u.role]}</option>)}</select></label>
              <label className="text-xs text-[var(--ic-muted)]">Permission<select required value={grant.permission_key} onChange={e => setGrant(v => ({...v,permission_key:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="">Sélectionner…</option>{me.permission_catalog.filter(p => p.key !== 'platform.access.manage').map(p => <option key={p.key} value={p.key}>{p.key}</option>)}</select></label>
              <label className="text-xs text-[var(--ic-muted)]">Effet<select value={grant.effect} onChange={e => setGrant(v => ({...v,effect:e.target.value as 'allow'|'deny'}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="allow">Autoriser</option><option value="deny">Refuser (prioritaire)</option></select></label>
              <label className="text-xs text-[var(--ic-muted)]">Portée<select value={grant.scope_type} onChange={e => setGrant(v => ({...v,scope_type:e.target.value as 'global'|'tenant'|'partner',scope_id:''}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="global">Globale</option><option value="tenant">Tenant</option><option value="partner">Partenaire</option></select></label>
              {grant.scope_type !== 'global' && <label className="text-xs text-[var(--ic-muted)]">ID {grant.scope_type === 'tenant' ? 'du tenant' : 'du partenaire'}<input required type="number" min="1" value={grant.scope_id} onChange={e => setGrant(v => ({...v,scope_id:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>}
              <label className="text-xs text-[var(--ic-muted)]">Expiration (facultative)<input type="datetime-local" value={grant.expires_at} onChange={e => setGrant(v => ({...v,expires_at:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
            </div>
            <button disabled={busy || !grant.user_id || !grant.permission_key || (grant.scope_type !== 'global' && !grant.scope_id)} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer la règle'}</button>
          </form>
        </section>

        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
          <div className="p-5 border-b border-[var(--ic-border)] flex items-center gap-2"><Users className="w-4 h-4 text-purple-400" /><h2 className="font-semibold text-[var(--ic-heading)]">Équipe plateforme</h2></div>
          {staff.length === 0 ? <p className="p-5 text-sm text-[var(--ic-muted)]">Aucun compte plateforme supplémentaire.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-xs text-[var(--ic-muted)]"><tr><th className="p-3">Membre</th><th className="p-3">Rôle</th><th className="p-3">Statut</th></tr></thead><tbody>{staff.map(user => <tr key={user.id} className="border-t border-[var(--ic-border)]"><td className="p-3"><div className="font-medium text-[var(--ic-heading)]">{user.name}</div><div className="text-xs text-[var(--ic-muted)]">{user.email}</div></td><td className="p-3">{user.role === 'platform_admin' ? <span className="text-purple-300">Owner — protégé</span> : <select disabled={busy} value={user.role} onChange={e => void updateRole(user.id,e.target.value as Exclude<PlatformStaffRole,'platform_admin'>)} className="rounded border border-[var(--ic-border)] bg-[var(--ic-surface)] p-1 text-xs text-[var(--ic-heading)]"><option value="platform_expert">Platform Expert</option><option value="platform_analyst">Platform Analyst</option><option value="platform_user">Platform User</option></select>}</td><td className="p-3"><span className={user.status === 'active' ? 'text-emerald-300' : 'text-rose-300'}>{user.status}</span></td></tr>)}</tbody></table></div>}
        </section>

        <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
          <div className="p-5 border-b border-[var(--ic-border)] flex items-center gap-2"><Clock3 className="w-4 h-4 text-cyan-400" /><h2 className="font-semibold text-[var(--ic-heading)]">Historique des autorisations</h2></div>
          {assignments.length === 0 ? <p className="p-5 text-sm text-[var(--ic-muted)]">Aucune règle d’accès enregistrée.</p> : <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="text-[var(--ic-muted)]"><tr><th className="p-3">Membre</th><th className="p-3">Permission</th><th className="p-3">Effet</th><th className="p-3">Portée</th><th className="p-3">Expiration</th><th className="p-3">État</th><th className="p-3">Action</th></tr></thead><tbody>{assignments.map(a => <tr key={a.id} className="border-t border-[var(--ic-border)]"><td className="p-3">{staff.find(u => u.id === a.user_id)?.email ?? `#${a.user_id}`}</td><td className="p-3 font-mono">{a.permission_key}</td><td className="p-3"><span className={a.effect === 'deny' ? 'text-rose-300' : 'text-emerald-300'}>{a.effect}</span></td><td className="p-3">{a.scope_type}{a.scope_id ? `:${a.scope_id}` : ''}</td><td className="p-3">{a.expires_at ? new Date(a.expires_at).toLocaleString() : 'Aucune'}</td><td className="p-3">{a.revoked_at ? 'Révoquée' : 'Active'}</td><td className="p-3">{!a.revoked_at && <button disabled={busy} onClick={() => void revoke(a.id)} className="text-rose-300 hover:text-rose-200 disabled:opacity-50">Révoquer</button>}</td></tr>)}</tbody></table></div>}
        </section>
      </>}
    </div>
  );
}
