import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Building2, CheckCircle2, Clock3,
  Database, FileText, Layers3, Loader2, RefreshCw, Server, Shield,
  Users, Workflow, XCircle,
} from 'lucide-react';
import { platformDashboardApi, type PlatformDashboardOverview } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

function MetricCard({ label, value, detail, icon: Icon }: {
  label: string; value: number | string; detail: string; icon: React.ElementType;
}) {
  return (
    <article className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--ic-muted)]"><Icon className="h-4 w-4 text-cyan-400" />{label}</div>
      <p className="mt-3 text-2xl font-semibold text-[var(--ic-heading)] tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[var(--ic-muted)]">{detail}</p>
    </article>
  );
}

export default function PlatformDashboardPage() {
  const [data, setData] = useState<PlatformDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await platformDashboardApi.overview();
      setData(result);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Les indicateurs de la plateforme sont indisponibles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!isDemoMode()) void load(); else setLoading(false); }, [load]);

  if (isDemoMode()) {
    return <div className="p-6">
      <div className="max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <AlertTriangle className="mb-2 h-6 w-6 text-amber-400" />
        <h1 className="text-xl font-semibold text-[var(--ic-heading)]">Vue d’ensemble de la plateforme</h1>
        <p className="mt-2 text-sm text-[var(--ic-muted)]">Les métriques de production ne sont pas simulées. Désactivez le mode Démo et connectez-vous au backend pour consulter les agrégats réels.</p>
      </div>
    </div>;
  }

  return (
    <main className="space-y-6 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Administration de la plateforme</h1>
          <p className="mt-1 text-sm text-[var(--ic-muted)]">Indicateurs opérationnels calculés à partir des données persistées d’Infracentra.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm text-[var(--ic-heading)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300"><XCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--ic-muted)]"><Loader2 className="h-5 w-5 animate-spin" />Chargement des métriques réelles…</div>}

      {!loading && data && <>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 px-2 py-1 text-emerald-300"><CheckCircle2 className="h-3 w-3" /> Source : base de données</span>
          <span className="text-[var(--ic-muted)]">Actualisé le {new Date(data.generated_at).toLocaleString()}</span>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ic-muted)]">Écosystème clients et équipe</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Tenants" value={data.tenants.total} detail={`${data.tenants.active} actifs`} icon={Building2} />
            <MetricCard label="Partenaires MSP" value={data.partners.total} detail={`${data.partners.active} actifs`} icon={Layers3} />
            <MetricCard label="Utilisateurs" value={data.users.total} detail={`${data.users.active} comptes actifs · ${data.users.platform_staff} staff plateforme`} icon={Users} />
            <MetricCard label="Intégrations" value={data.integrations.total} detail={`${data.integrations.active} actives`} icon={Workflow} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ic-muted)]">Services et infrastructure</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Entitlements activés" value={data.commercial.enabled_entitlements} detail={`${data.commercial.enabled_services_in_use} services distincts utilisés`} icon={Shield} />
            <MetricCard label="Agents collecteurs" value={data.infrastructure.collector_probes} detail={`${data.infrastructure.collector_probes_online} en ligne`} icon={Server} />
            <MetricCard label="Équipements découverts" value={data.infrastructure.discovered_devices} detail="Enregistrements d’inventaire issus de la découverte" icon={Database} />
            <MetricCard label="Alertes" value={data.operations.alerts} detail="Alertes enregistrées" icon={AlertTriangle} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ic-muted)]">Opérations et fiabilité</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Tickets" value={data.operations.tickets} detail="Tickets persistés" icon={FileText} />
            <MetricCard label="Exécutions SOAR" value={data.operations.playbook_runs} detail="Exécutions enregistrées, tous statuts" icon={Activity} />
            <MetricCard label="Tâches Security Ops" value={data.operations.security_ops_tasks} detail="Demandes et tâches enregistrées" icon={Clock3} />
            <MetricCard label="Notifications en attente" value={data.notification_queue.queued} detail={`${data.notification_queue.failed_or_dead_letter} en échec ou dead-letter · ${data.notification_queue.total} au total`} icon={Bell} />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <article className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-5">
            <h2 className="font-semibold text-[var(--ic-heading)]">Journal et sécurité</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div><p className="text-2xl font-semibold tabular-nums text-[var(--ic-heading)]">{data.audit.total}</p><p className="text-xs text-[var(--ic-muted)]">Événements</p></div>
              <div><p className="text-2xl font-semibold tabular-nums text-rose-300">{data.audit.failures}</p><p className="text-xs text-[var(--ic-muted)]">Échecs</p></div>
              <div><p className="text-2xl font-semibold tabular-nums text-amber-300">{data.audit.blocked}</p><p className="text-xs text-[var(--ic-muted)]">Bloqués</p></div>
            </div>
          </article>
          <article className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
            <h2 className="font-semibold text-[var(--ic-heading)]">Abonnements et facturation</h2>
            <p className="mt-2 text-sm text-[var(--ic-muted)]">{data.commercial.subscriptions.available ? (data.commercial.subscriptions.current ?? 0) + ' abonnement(s) courant(s), dont ' + (data.commercial.subscriptions.active ?? 0) + ' actif(s) et ' + (data.commercial.subscriptions.trialing ?? 0) ' en essai.' : (data.commercial.subscriptions.reason ?? 'Données d’abonnement indisponibles.')}</p>
            <p className="mt-2 text-xs text-amber-300">Les contrats sont enregistrés dans la base. Aucun prestataire de paiement n’est connecté et aucun MRR/ARR encaissé n’est calculé ici.</p>
          </article>
        </section>
      </>}

      {!loading && !data && !error && <p className="rounded-xl border border-[var(--ic-border)] p-5 text-sm text-[var(--ic-muted)]">Aucune donnée disponible.</p>}
    </main>
  );
}
