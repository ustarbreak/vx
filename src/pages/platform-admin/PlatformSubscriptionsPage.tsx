import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, Loader2, RefreshCw, XCircle } from 'lucide-react';
import {
  organizationsApi, platformSubscriptionsApi,
  type BackendOrganization, type PlatformSubscriptionDto,
} from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

const localInput = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};

export default function PlatformSubscriptionsPage() {
  const [orgs, setOrgs] = useState<BackendOrganization[]>([]);
  const [rows, setRows] = useState<PlatformSubscriptionDto[]>([]);
  const [plans, setPlans] = useState<{ code: string; services: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);
    return {
      org_id: '', plan_code: 'starter' as PlatformSubscriptionDto['plan_code'],
      status: 'active' as 'active' | 'trialing' | 'past_due' | 'paused',
      billing_interval: 'monthly' as 'monthly' | 'annual',
      currency: 'MAD' as 'MAD' | 'EUR' | 'USD', amount: '0',
      starts_at: localInput(now), current_period_start: localInput(now),
      current_period_end: localInput(end), trial_ends_at: localInput(end),
      change_reason: '',
    };
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [organizations, subscriptions, catalog] = await Promise.all([
        organizationsApi.list(), platformSubscriptionsApi.list(), platformSubscriptionsApi.catalog(),
      ]);
      setOrgs(organizations);
      setRows(subscriptions);
      setPlans(catalog.plans);
      setForm(current => ({ ...current, org_id: current.org_id || String(organizations[0]?.id ?? '') }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger les données de facturation.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!isDemoMode()) void load(); else setLoading(false); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await platformSubscriptionsApi.create({
        org_id: Number(form.org_id), plan_code: form.plan_code, status: form.status,
        billing_interval: form.billing_interval, currency: form.currency, amount: form.amount,
        starts_at: new Date(form.starts_at).toISOString(),
        current_period_start: new Date(form.current_period_start).toISOString(),
        current_period_end: new Date(form.current_period_end).toISOString(),
        trial_ends_at: form.status === 'trialing' ? new Date(form.trial_ends_at).toISOString() : null,
        provider: 'manual', change_reason: form.change_reason || undefined,
      });
      setNotice('L’abonnement et son historique ont été enregistrés. Aucun paiement n’a été déclenché.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’enregistrer cet abonnement.');
    } finally { setBusy(false); }
  };

  const cancel = async (row: PlatformSubscriptionDto) => {
    if (!window.confirm('Annuler immédiatement cet abonnement ? Le tenant repassera au plan STARTER si le contrat était un essai.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await platformSubscriptionsApi.cancel(row.id);
      setNotice('Abonnement annulé et événement ajouté au journal d’audit.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’annuler cet abonnement.');
    } finally { setBusy(false); }
  };

  if (isDemoMode()) return <main className="p-6"><div className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-5"><AlertTriangle className="mb-2 h-6 w-6 text-amber-400" /><h1 className="text-xl font-semibold text-[var(--ic-heading)]">Abonnements et facturation</h1><p className="mt-2 text-sm text-[var(--ic-muted)]">La gestion des abonnements exige une session réelle. Le mode Démo ne crée ni contrats ni enregistrements de facturation.</p></div></main>;

  return (
    <main className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--ic-heading)]"><CreditCard className="h-6 w-6 text-purple-400" /> Abonnements et facturation</h1><p className="mt-1 text-sm text-[var(--ic-muted)]">Contrats, périodes, essais, changements de plan et historique.</p></div>
        <button onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser</button>
      </header>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-[var(--ic-muted)]"><strong className="text-amber-300">Important :</strong> ce module enregistre les conditions contractuelles dans la base. Il ne prélève aucun paiement et ne confirme aucune transaction auprès d’un prestataire de paiement.</div>
      {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-500/30 p-3 text-sm text-rose-300"><XCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex gap-2 rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}

      <form onSubmit={create} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5 space-y-4">
        <h2 className="font-semibold text-[var(--ic-heading)]">Créer un abonnement ou enregistrer un changement de plan</h2>
        {loading ? <div className="flex items-center gap-2 py-4 text-sm text-[var(--ic-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Chargement du catalogue…</div> : <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs text-[var(--ic-muted)]">Tenant<select required value={form.org_id} onChange={e => setForm(v => ({...v,org_id:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="">Sélectionner…</option>{orgs.filter(o => !(o as any).is_partner).map(o => <option key={o.id} value={o.id}>{o.name} — #{o.id}</option>)}</select></label>
            <label className="text-xs text-[var(--ic-muted)]">Plan<select required value={form.plan_code} onChange={e => setForm(v => {
              const plan = e.target.value as PlatformSubscriptionDto['plan_code'];
              return { ...v, plan_code: plan, status: plan === 'trial' ? 'trialing' : (v.status === 'trialing' ? 'active' : v.status) };
            })} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]">{plans.map(p => <option key={p.code} value={p.code}>{p.code.toUpperCase()} — {p.services.length} services inclus</option>)}</select></label>
            <label className="text-xs text-[var(--ic-muted)]">Statut<select value={form.status} onChange={e => setForm(v => ({...v,status:e.target.value as typeof v.status}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="active">Actif</option><option value="trialing">Essai</option><option value="past_due">Paiement en retard (à traiter manuellement)</option><option value="paused">Suspendu</option></select></label>
            <label className="text-xs text-[var(--ic-muted)]">Périodicité<select value={form.billing_interval} onChange={e => setForm(v => ({...v,billing_interval:e.target.value as typeof v.billing_interval}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option value="monthly">Mensuelle</option><option value="annual">Annuelle</option></select></label>
            <label className="text-xs text-[var(--ic-muted)]">Devise<select value={form.currency} onChange={e => setForm(v => ({...v,currency:e.target.value as typeof v.currency}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-2 text-sm text-[var(--ic-heading)]"><option>MAD</option><option>EUR</option><option>USD</option></select></label>
            <label className="text-xs text-[var(--ic-muted)]">Montant contractuel<input required type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(v => ({...v,amount:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
            <label className="text-xs text-[var(--ic-muted)]">Début du contrat<input required type="datetime-local" value={form.starts_at} onChange={e => setForm(v => ({...v,starts_at:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
            <label className="text-xs text-[var(--ic-muted)]">Début de période<input required type="datetime-local" value={form.current_period_start} onChange={e => setForm(v => ({...v,current_period_start:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
            <label className="text-xs text-[var(--ic-muted)]">Fin de période<input required type="datetime-local" value={form.current_period_end} onChange={e => setForm(v => ({...v,current_period_end:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
            {form.status === 'trialing' && <label className="text-xs text-[var(--ic-muted)]">Fin de l’essai<input required type="datetime-local" value={form.trial_ends_at} onChange={e => setForm(v => ({...v,trial_ends_at:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>}
            <label className="text-xs text-[var(--ic-muted)] md:col-span-2">Motif du changement (facultatif)<input maxLength={300} value={form.change_reason} onChange={e => setForm(v => ({...v,change_reason:e.target.value}))} className="mt-1 w-full rounded-lg border border-[var(--ic-border)] bg-transparent p-2 text-sm text-[var(--ic-heading)]" /></label>
          </div>
          <button disabled={busy || !form.org_id || plans.length === 0} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer le contrat'}</button>
        </>}
      </form>

      <section className="overflow-hidden rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--ic-border)] p-5"><Clock3 className="h-4 w-4 text-cyan-400" /><h2 className="font-semibold text-[var(--ic-heading)]">Historique des abonnements</h2></div>
        {loading ? <div className="p-8 text-center text-sm text-[var(--ic-muted)]">Chargement…</div> : rows.length === 0 ? <p className="p-8 text-center text-sm text-[var(--ic-muted)]">Aucun abonnement enregistré.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[var(--ic-muted)]"><tr><th className="p-3">Tenant</th><th className="p-3">Plan</th><th className="p-3">Statut</th><th className="p-3">Montant</th><th className="p-3">Période</th><th className="p-3">Courant</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-[var(--ic-border)]"><td className="p-3">{orgs.find(o => o.id === row.org_id)?.name ?? ('Tenant #' + row.org_id)}</td><td className="p-3 font-semibold">{row.plan_code.toUpperCase()}</td><td className="p-3">{row.status}</td><td className="p-3 tabular-nums">{row.amount} {row.currency} / {row.billing_interval}</td><td className="p-3">{new Date(row.current_period_start).toLocaleDateString()} → {new Date(row.current_period_end).toLocaleDateString()}</td><td className="p-3">{row.is_current ? 'Oui' : 'Non'}</td><td className="p-3">{row.is_current && <button disabled={busy} onClick={() => void cancel(row)} className="text-rose-300 hover:text-rose-200 disabled:opacity-50">Annuler</button>}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
