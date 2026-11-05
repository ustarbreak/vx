import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, CircleOff, ExternalLink, Layers3, Loader2, RefreshCw, Save, Server, ShieldAlert, ToggleLeft, ToggleRight } from 'lucide-react';
import { platformServiceCatalogApi, type PlatformServiceCatalogDto, type PlatformServiceCatalogItem } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter', pro: 'Pro', souverain: 'Souverain', custom: 'Custom', trial: 'Trial',
};

export default function PlatformServiceCatalogPage() {
  const [data, setData] = useState<PlatformServiceCatalogDto | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [draftPlans, setDraftPlans] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState<'all' | 'active' | 'inactive'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await platformServiceCatalogApi.get();
      setData(result);
      setDraftPlans(Object.fromEntries(result.plans.map(plan => [plan.code, plan.service_ids])));
      setSelected(current => result.services.some(s => s.service_id === current) ? current : result.services[0]?.service_id ?? '');
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Impossible de charger le catalogue depuis le backend.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isDemoMode()) { setLoading(false); setError('Le catalogue administrateur nécessite une session backend réelle. Aucune donnée de démonstration n’est présentée comme persistée.'); } else { void load(); } }, [load]);

  const services = data?.services ?? [];
  const activeCount = services.filter(s => s.active).length;
  const filteredServices = useMemo(() => services.filter(service =>
    (availability === 'all' || (availability === 'active' ? service.active : !service.active)) &&
    (service.label + ' ' + service.service_id + ' ' + service.engine).toLowerCase().includes(search.toLowerCase())
  ), [services, availability, search]);
  const configuredCount = services.filter(s => Object.values(s.integrations).some(v => v > 0)).length;
  const connectedCount = services.filter(s => Object.entries(s.lifecycle).some(([state, count]) => ['connected', 'first_success'].includes(state) && count > 0)).length;
  const selectedService = services.find(s => s.service_id === selected) ?? null;

  const updateService = async (service: PlatformServiceCatalogItem, patch: { active?: boolean }) => {
    setSaving(service.service_id); setError(''); setNotice('');
    try {
      await platformServiceCatalogApi.update(service.service_id, patch);
      setNotice(`Catalogue mis à jour : ${service.label}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'La mise à jour du catalogue a échoué.'); }
    finally { setSaving(''); }
  };

  const savePlan = async (code: string) => {
    setSaving(code); setError(''); setNotice('');
    try {
      await platformServiceCatalogApi.replacePlan(code, draftPlans[code] ?? []);
      setNotice(`Les services inclus dans le plan ${PLAN_LABELS[code] ?? code} ont été enregistrés.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’enregistrer les inclusions du plan.'); }
    finally { setSaving(''); }
  };

  const togglePlanService = (code: string, id: string) => {
    setDraftPlans(current => {
      const ids = current[code] ?? [];
      return { ...current, [code]: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] };
    });
  };

  const planRows = useMemo(() => (data?.plans ?? []).map(p => ({ ...p, label: PLAN_LABELS[p.code] ?? p.code })), [data]);

  if (isDemoMode()) return <main className="p-6"><div className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><ShieldAlert className="mb-2 h-6 w-6 text-amber-400" /><h1 className="text-xl font-semibold text-[var(--ic-heading)]">Catalogue de services — PA-10</h1><p className="mt-2 text-sm text-[var(--ic-muted)]">{error}</p></div></main>;

  return (
    <main className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--ic-heading)]"><Layers3 className="h-6 w-6 text-cyan-400" /> Catalogue des services & entitlements</h1><p className="mt-1 text-sm text-[var(--ic-muted)]">Configuration persistée, matrice des plans et état opérationnel issu des intégrations et du cycle de vie.</p></div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)]"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser</button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300">{notice}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Services au catalogue', value: services.length, icon: Layers3 },
          { label: 'Disponibles', value: activeCount, icon: CheckCircle2 },
          { label: 'Avec intégration', value: configuredCount, icon: Server },
          { label: 'Lifecycle renseigné', value: connectedCount, icon: Activity },
        ].map(k => <div key={k.label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><k.icon className="h-4 w-4 text-cyan-400" /><p className="mt-2 text-2xl font-semibold text-[var(--ic-heading)]">{loading ? '—' : k.value}</p><p className="text-xs text-[var(--ic-muted)]">{k.label}</p></div>)}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <div className="overflow-hidden rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)]">
          <div className="space-y-3 border-b border-[var(--ic-border)] p-4"><div><h2 className="font-semibold text-[var(--ic-heading)]">Services disponibles</h2><p className="text-xs text-[var(--ic-muted)]">L’activation/désactivation est enregistrée dans platform_settings.</p></div><div className="flex flex-wrap gap-2"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un service ou moteur…" className="min-w-0 flex-1 rounded-lg border border-[var(--ic-border)] bg-transparent px-3 py-2 text-xs text-[var(--ic-heading)]" /><select value={availability} onChange={e => setAvailability(e.target.value as typeof availability)} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] px-3 py-2 text-xs text-[var(--ic-heading)]"><option value="all">Tous les statuts</option><option value="active">Disponibles</option><option value="inactive">Désactivés</option></select></div></div>
          {loading ? <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : filteredServices.length === 0 ? <p className="p-8 text-sm text-[var(--ic-muted)]">Aucun service ne correspond à ces filtres.</p> : <div className="divide-y divide-[var(--ic-border)]">{filteredServices.map(service => <button key={service.service_id} onClick={() => setSelected(service.service_id)} className={`flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-[var(--ic-surface-2)] ${selected === service.service_id ? 'bg-cyan-500/5' : ''}`}><div className="min-w-0"><div className="font-medium text-[var(--ic-heading)]">{service.label}</div><div className="text-xs text-[var(--ic-muted)]">{service.service_id} · {service.engine}</div></div><div className="flex shrink-0 items-center gap-3"><span className={`text-xs ${service.active ? 'text-emerald-300' : 'text-rose-300'}`}>{service.active ? 'Disponible' : 'Désactivé'}</span><span className="text-[var(--ic-muted)]">{service.active ? <ToggleRight className="h-5 w-5 text-emerald-400" /> : <ToggleLeft className="h-5 w-5" />}</span></div></button>)}</div>}
        </div>

        <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
          <h2 className="font-semibold text-[var(--ic-heading)]">Fiche service</h2>
          {!selectedService ? <p className="mt-4 text-sm text-[var(--ic-muted)]">Sélectionnez un service pour afficher ses détails.</p> : <div className="mt-4 space-y-4">
            <div><p className="text-lg font-semibold text-[var(--ic-heading)]">{selectedService.label}</p><p className="text-xs text-[var(--ic-muted)]">{selectedService.engine}</p></div>
            <p className="text-sm text-[var(--ic-muted)]">{selectedService.description || 'Aucune description éditoriale enregistrée.'}</p>
            <div><p className="mb-1 text-xs font-medium text-[var(--ic-muted)]">États de cycle de vie</p><div className="flex flex-wrap gap-2">{Object.entries(selectedService.lifecycle).length ? Object.entries(selectedService.lifecycle).map(([key,value]) => <span key={key} className="rounded bg-[var(--ic-surface-2)] px-2 py-1 text-xs text-[var(--ic-text)]">{key}: {value}</span>) : <span className="text-xs text-[var(--ic-muted)]">Aucun état enregistré</span>}</div></div>
            <div><p className="mb-1 text-xs font-medium text-[var(--ic-muted)]">Intégrations enregistrées</p><div className="flex flex-wrap gap-2">{Object.entries(selectedService.integrations).length ? Object.entries(selectedService.integrations).map(([key,value]) => <span key={key} className="rounded bg-[var(--ic-surface-2)] px-2 py-1 text-xs text-[var(--ic-text)]">{key}: {value}</span>) : <span className="text-xs text-[var(--ic-muted)]">Aucune intégration enregistrée</span>}</div></div>
            <div><p className="mb-1 text-xs font-medium text-[var(--ic-muted)]">Plans incluant ce service</p><p className="text-sm text-[var(--ic-text)]">{selectedService.included_in_plans.map(p => PLAN_LABELS[p] ?? p).join(', ') || 'Aucun plan'}</p></div>
            <p className="text-xs text-[var(--ic-muted)]">Endpoints exposés : {selectedService.endpoints.join(', ') || 'aucun'}</p>
            <div className="flex flex-wrap gap-2"><button disabled={saving === selectedService.service_id} onClick={() => void updateService(selectedService,{active:!selectedService.active})} className="rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)] disabled:opacity-50">{saving === selectedService.service_id ? 'Enregistrement…' : selectedService.active ? 'Désactiver le service' : 'Réactiver le service'}</button>{selectedService.docs && <a href={selectedService.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-cyan-300">Documentation <ExternalLink className="h-3 w-3" /></a>}</div>
          </div>}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
        <div className="mb-4"><h2 className="font-semibold text-[var(--ic-heading)]">Matrice des plans & services</h2><p className="text-xs text-[var(--ic-muted)]">Les modifications sont persistées dans PlanEntitlementV2 et reflétées dans le catalogue des abonnements.</p></div>
        {planRows.length === 0 ? <p className="text-sm text-[var(--ic-muted)]">Aucune inclusion de plan n’est configurée. Enregistrez les services d’un plan pour initialiser sa matrice.</p> : <div className="grid gap-4 lg:grid-cols-2">{planRows.map(plan => <div key={plan.code} className="rounded-lg border border-[var(--ic-border)] p-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium text-[var(--ic-heading)]">{plan.label}</h3><p className="text-xs text-[var(--ic-muted)]">{draftPlans[plan.code]?.length ?? 0} services inclus</p></div><button disabled={saving === plan.code} onClick={() => void savePlan(plan.code)} className="inline-flex items-center gap-1 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving === plan.code ? 'Enregistrement…' : 'Enregistrer'}</button></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{services.map(service => <label key={service.service_id} className="flex items-center gap-2 text-xs text-[var(--ic-text)]"><input type="checkbox" checked={(draftPlans[plan.code] ?? []).includes(service.service_id)} onChange={() => togglePlanService(plan.code,service.service_id)} />{service.label}</label>)}</div></div>)}</div>}
      </section>
      {data && <p className="text-[10px] text-[var(--ic-muted)]">Sources : {data.source}. Les compteurs d’intégrations et de cycle de vie sont des agrégats persistés ; ils ne constituent pas une mesure de disponibilité réseau temps réel.</p>}
    </main>
  );
}
