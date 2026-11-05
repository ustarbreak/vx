import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Key, Loader2, Plus, RefreshCw, Shield, Trash2, XCircle, Zap } from 'lucide-react';
import { platformIntegrationsApi, type PlatformIntegrationDto, type PlatformIntegrationInput } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

const emptyForm: PlatformIntegrationInput = {
  name: '', service_id: '', integration_type: 'api', license_type: 'commercial',
  pricing: 'paid', status: 'inactive', api_username: '', api_key: '', api_endpoint: '',
  documentation_url: '', notes: '',
};

export default function PlatformIntegrationsPage() {
  const [rows, setRows] = useState<PlatformIntegrationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string }>>({});
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'pending'>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<PlatformIntegrationInput>(emptyForm);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows(await platformIntegrationsApi.list()); }
    catch (e) { setRows([]); setError(e instanceof Error ? e.message : 'Impossible de charger les intégrations depuis le backend.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!isDemoMode()) void load(); else setLoading(false); }, [load]);

  const filtered = useMemo(() => rows.filter(row => {
    const statusMatch = filter === 'all' || row.status === filter;
    const searchMatch = (row.name + ' ' + row.service_id + ' ' + row.integration_type).toLowerCase().includes(search.toLowerCase());
    return statusMatch && searchMatch;
  }), [rows, filter, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter(row => row.status === 'active').length,
    inactive: rows.filter(row => row.status === 'inactive').length,
    pending: rows.filter(row => row.status === 'pending').length,
  }), [rows]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setCreating(true); setError(''); setNotice('');
    try {
      await platformIntegrationsApi.create({
        ...form,
        api_key: form.api_key || undefined,
        api_username: form.api_username || undefined,
        api_endpoint: form.api_endpoint || undefined,
        documentation_url: form.documentation_url || undefined,
        notes: form.notes || undefined,
      });
      setForm(emptyForm); setShowCreate(false);
      setNotice('Intégration enregistrée. Les secrets ne sont jamais renvoyés par l’API.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Échec de création de l’intégration.'); }
    finally { setCreating(false); }
  };

  const test = async (row: PlatformIntegrationDto) => {
    setBusyId(row.id); setError(''); setNotice('');
    try {
      const result = await platformIntegrationsApi.test(row.id);
      setTestResults(previous => ({ ...previous, [row.id]: result }));
      if (result.success) setNotice(result.message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Le test de connexion a échoué.'); }
    finally { setBusyId(null); }
  };

  const disable = async (row: PlatformIntegrationDto) => {
    if (!window.confirm('Désactiver cette intégration ?')) return;
    setBusyId(row.id); setError(''); setNotice('');
    try { await platformIntegrationsApi.update(row.id, { status: 'inactive' }); setNotice('Intégration désactivée.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Échec de désactivation.'); }
    finally { setBusyId(null); }
  };

  const remove = async (row: PlatformIntegrationDto) => {
    if (!window.confirm('Supprimer cette intégration ? Cette action est auditée et ne supprime pas les données déjà ingérées.')) return;
    setBusyId(row.id); setError(''); setNotice('');
    try { await platformIntegrationsApi.remove(row.id); setNotice('Intégration supprimée.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Échec de suppression.'); }
    finally { setBusyId(null); }
  };

  if (isDemoMode()) return <main className="p-6"><div className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><AlertTriangle className="mb-2 h-6 w-6 text-amber-400" /><h1 className="text-xl font-semibold text-[var(--ic-heading)]">Intégrations de la plateforme</h1><p className="mt-2 text-sm text-[var(--ic-muted)]">Le mode Démo n’affiche pas de faux statuts de connexion. Connectez-vous à une session backend pour consulter et tester les intégrations persistées.</p></div></main>;

  return (
    <main className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--ic-heading)]"><Key className="h-6 w-6 text-cyan-400" /> Gestion des intégrations</h1><p className="mt-1 text-sm text-[var(--ic-muted)]">Configuration réelle, tests de connexion et état opérationnel des connecteurs.</p></div>
        <div className="flex gap-2"><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)]"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser</button><button onClick={() => setShowCreate(v => !v)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Ajouter</button></div>
      </header>
      {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-500/30 p-3 text-sm text-rose-300"><XCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex gap-2 rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}

      {showCreate && <form onSubmit={create} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-4">
        <h2 className="font-semibold text-[var(--ic-heading)]">Nouvelle intégration</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-xs text-[var(--ic-muted)]">Nom<input required value={form.name} onChange={e => setForm(v => ({...v,name:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Service ID<input required value={form.service_id} onChange={e => setForm(v => ({...v,service_id:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Type<select value={form.integration_type} onChange={e => setForm(v => ({...v,integration_type:e.target.value as PlatformIntegrationInput['integration_type']}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="api">API</option><option value="webhook">Webhook</option><option value="agent">Agent</option><option value="native">Native</option></select></label>
          <label className="text-xs text-[var(--ic-muted)]">Licence<select value={form.license_type} onChange={e => setForm(v => ({...v,license_type:e.target.value as PlatformIntegrationInput['license_type']}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="open-source">Open source</option><option value="commercial">Commercial</option><option value="freemium">Freemium</option></select></label>
          <label className="text-xs text-[var(--ic-muted)]">Tarification<select value={form.pricing} onChange={e => setForm(v => ({...v,pricing:e.target.value as PlatformIntegrationInput['pricing']}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="free">Gratuit</option><option value="paid">Payant</option><option value="custom">Personnalisé</option></select></label>
          <label className="text-xs text-[var(--ic-muted)]">Endpoint<input type="url" value={form.api_endpoint} onChange={e => setForm(v => ({...v,api_endpoint:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Nom d’utilisateur Wazuh<input autoComplete="off" value={form.api_username} onChange={e => setForm(v => ({...v,api_username:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Clé API / secret (saisie unique)<input type="password" autoComplete="new-password" value={form.api_key} onChange={e => setForm(v => ({...v,api_key:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)]">Documentation URL<input type="url" value={form.documentation_url} onChange={e => setForm(v => ({...v,documentation_url:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          <label className="text-xs text-[var(--ic-muted)] md:col-span-3">Notes<textarea value={form.notes} onChange={e => setForm(v => ({...v,notes:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
        </div>
        <div className="flex gap-2"><button disabled={creating} className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{creating ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" onClick={() => {setShowCreate(false);setForm(emptyForm);}} className="rounded-lg border border-[var(--ic-border)] px-4 py-2 text-sm text-[var(--ic-heading)]">Annuler</button></div>
      </form>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><GlobeIcon /><p className="mt-2 text-2xl font-semibold text-[var(--ic-heading)]">{stats.total}</p><p className="text-xs text-[var(--ic-muted)]">Total</p></div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><CheckCircle2 className="h-4 w-4 text-emerald-400" /><p className="mt-2 text-2xl font-semibold text-emerald-300">{stats.active}</p><p className="text-xs text-[var(--ic-muted)]">Actives</p></div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><XCircle className="h-4 w-4 text-rose-400" /><p className="mt-2 text-2xl font-semibold text-[var(--ic-heading)]">{stats.inactive}</p><p className="text-xs text-[var(--ic-muted)]">Inactives</p></div>
        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><Clock className="h-4 w-4 text-amber-400" /><p className="mt-2 text-2xl font-semibold text-[var(--ic-heading)]">{stats.pending}</p><p className="text-xs text-[var(--ic-muted)]">En attente</p></div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)]">
        <div className="flex flex-col gap-3 border-b border-[var(--ic-border)] p-4 md:flex-row"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une intégration…" className="min-w-0 flex-1 rounded-lg border border-[var(--ic-border)] bg-transparent px-3 py-2 text-sm text-[var(--ic-heading)]" /><div className="flex gap-2">{(['all','active','inactive','pending'] as const).map(s => <button key={s} onClick={() => setFilter(s)} className={`rounded-lg border px-3 py-2 text-xs ${filter===s?'border-cyan-500/40 bg-cyan-500/10 text-cyan-300':'border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>{s === 'all' ? 'Toutes' : s}</button>)}</div></div>
        {loading ? <div className="flex justify-center gap-2 p-10 text-sm text-[var(--ic-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</div> : filtered.length === 0 ? <p className="p-10 text-center text-sm text-[var(--ic-muted)]">{rows.length === 0 ? 'Aucune intégration enregistrée dans le backend.' : 'Aucun résultat pour ce filtre.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[var(--ic-muted)]"><tr><th className="p-3">Intégration</th><th className="p-3">Service</th><th className="p-3">Type</th><th className="p-3">Statut</th><th className="p-3">Dernière synchro</th><th className="p-3">Test</th><th className="p-3">Actions</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id} className="border-t border-[var(--ic-border)]"><td className="p-3"><div className="font-medium text-[var(--ic-heading)]">{row.name}</div><div className="max-w-xs truncate text-[var(--ic-muted)]" title={row.api_endpoint ?? ''}>{row.api_endpoint ? row.api_endpoint.split('?')[0] : 'Endpoint non configuré'}</div></td><td className="p-3">{row.service_id}</td><td className="p-3">{row.integration_type}</td><td className="p-3"><span className={row.status === 'active' ? 'text-emerald-300' : row.status === 'pending' ? 'text-amber-300' : 'text-rose-300'}>{row.status}</span></td><td className="p-3">{row.last_sync ? new Date(row.last_sync).toLocaleString() : 'Jamais'}</td><td className="p-3">{testResults[row.id] ? <span className={testResults[row.id].success ? 'text-emerald-300' : 'text-rose-300'}>{testResults[row.id].message}</span> : 'Non testé'}</td><td className="p-3"><div className="flex gap-2"><button disabled={busyId === row.id} onClick={() => void test(row)} className="rounded border border-cyan-500/30 px-2 py-1 text-cyan-300 disabled:opacity-50">{busyId === row.id ? 'Test…' : 'Tester'}</button>{row.status === 'active' && <button disabled={busyId === row.id} onClick={() => void disable(row)} className="rounded border border-amber-500/30 px-2 py-1 text-amber-300 disabled:opacity-50">Désactiver</button>}<button disabled={busyId === row.id} onClick={() => void remove(row)} className="rounded border border-rose-500/30 px-2 py-1 text-rose-300 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}

function GlobeIcon() { return <Shield className="h-4 w-4 text-cyan-400" />; }
