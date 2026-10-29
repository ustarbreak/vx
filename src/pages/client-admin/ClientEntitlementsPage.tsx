import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../src/context/AuthContext';
import { serviceCatalog } from '../../../src/data/mockData';
import { SERVICE_DEPENDENCY_RULES } from '../../../src/data/serviceDependencies';
import { RelationshipGraph, RGNode, RGEdge } from '../../components/RelationshipGraph';
import { entitlementsApi, BackendEntitlement } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';
import { CheckCircle2, XCircle, RefreshCw, Network, Unplug } from 'lucide-react';

// ---------------------------------------------------------------------------
// §6F — Service Entitlements + Service Dependency Graph.
//
// Data contract (backend parity):
//   GET /api/entitlements/  → List[EntitlementResponse] (routers/entitlements.py)
//   Authorization is server-side: client roles ALWAYS receive their own org's
//   rows only; platform_admin sees all. The frontend never sends its own org
//   id as an authorization claim in production — the JWT principal scopes it.
//   Demo mode intercepts the same path with identical shapes (demoMode.ts).
//
// The dependency graph renders nodes = services present in the tenant's
// entitlement rows, edges = ONLY pairs declared in SERVICE_DEPENDENCY_RULES
// where BOTH endpoints exist in those rows. Each edge carries the catalog
// rationale as its evidence label. No row → no node; no declared rule →
// no edge. Health is never claimed here: a card shows provisioning state
// (enabled/disabled per persisted `enabled` flag), not operational health.
// ---------------------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'error';

/** Numeric backend org id from AuthContext orgId conventions ('org-dw-3', '3'), or null. */
function parseNumericOrg(orgId?: string | null): number | null {
  if (!orgId) return null;
  const m = /^org-dw-(\d+)$/.exec(orgId);
  if (m) return Number(m[1]);
  if (/^\d+$/.test(orgId)) return Number(orgId);
  return null; // e.g. 'org-infracentra' demo full-access — server scopes by session anyway
}

export default function ClientEntitlementsPage() {
  const { organization, user } = useAuth();

  const [rows, setRows] = useState<BackendEntitlement[] | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selService, setSelService] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setErr(null);
    // In production the endpoint ignores any client-suggested scope for client
    // roles (server derives org from the token). We pass ?org_id= only when we
    // can map our demo-world id deterministically — harmless for admins, ignored
    // for client roles server-side.
    const numericOrg = parseNumericOrg(organization?.id ?? user?.orgId ?? null);
    entitlementsApi
      .list(numericOrg ?? undefined)
      .then(list => { if (!cancelled) { setRows(list); setState('ready'); } })
      .catch(e => {
        if (cancelled) return;
        const msg = String((e as Error).message ?? e);
        if (/403/.test(msg)) setErr("Accès refusé — votre rôle actuel n'a pas de dossier d'entitlements consultable.");
        else if (/401/.test(msg)) setErr('Session expirée — reconnectez-vous pour charger les entitlements.');
        else setErr(`Le serveur n'a pas répondu pour /api/entitlements/ (${msg}). Réessayez.`);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [organization?.id, user?.orgId, reloadKey]);

  const refresh = () => { setRefreshing(true); setReloadKey(k => k + 1); setTimeout(() => setRefreshing(false), 400); };

  // Join entitlement rows against the static catalog by service_id.
  const cards = useMemo(() => {
    if (!rows) return [];
    return rows.map(r => ({
      row: r,
      service: serviceCatalog.find(s => s.id === r.service_id) ?? null,
    }));
  }, [rows]);

  // ---- Graph model — verified relationships only --------------------------
  const { nodes, edges, missingDeps } = useMemo(() => {
    const present = new Set(rows?.map(r => r.service_id) ?? []);
    const nameOf = (id: string) => serviceCatalog.find(s => s.id === id)?.name ?? id;
    const ns: RGNode[] = [...present].map(id => ({
      id, label: nameOf(id), kind: 'service',
      meta: { enabled: rows!.find(r => r.service_id === id)?.enabled ?? false },
    }));
    const es: RGEdge[] = [];
    const missing: { service: string; requires: string; rationale: string }[] = [];
    for (const rule of SERVICE_DEPENDENCY_RULES) {
      for (const req of rule.requires) {
        if (present.has(rule.service) && present.has(req)) {
          es.push({ source: req, target: rule.service, evidence: rule.rationale, kind: 'declared-dependency' });
        } else if (present.has(rule.service) && !present.has(req)) {
          missing.push({ service: rule.service, requires: req, rationale: rule.rationale });
        }
      }
    }
    return { nodes: ns, edges: es, missingDeps: missing };
  }, [rows]);

  const selCard = selService ? cards.find(c => c.row.service_id === selService) : null;

  if (!organization && !user) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header + freshness/actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Service Entitlements</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">
            Provisioned services for {organization?.name ?? 'your organization'} — served by{' '}
            <code className="text-cyan-400">GET /api/entitlements/</code>{' '}
            {isDemoMode() ? <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold uppercase">DEMO DATA</span> : <span className="text-[11px]">(session authentifiée, périmètre serveur)</span>}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing || state === 'loading'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-text)] text-sm hover:bg-[var(--ic-surface)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing || state === 'loading' ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {/* Loading / error states — never show zero/empty on failure */}
      {state === 'loading' && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-8 text-center text-[var(--ic-muted)] text-sm">
          Chargement des entitlements depuis le backend…
        </div>
      )}
      {state === 'error' && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-sm space-y-2">
          <p className="text-red-300 font-semibold">Impossible de charger les entitlements</p>
          <p className="text-[var(--ic-muted)]">{err}</p>
          <button onClick={() => setReloadKey(k => k + 1)} className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25">Réessayer</button>
        </div>
      )}

      {state === 'ready' && rows && (
        <>
          {/* Empty state — honest, no fabricated cards */}
          {rows.length === 0 ? (
            <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-10 text-center space-y-2">
              <Unplug className="w-8 h-8 mx-auto text-[var(--ic-muted)]" />
              <p className="text-[var(--ic-heading)] font-semibold">Aucun service provisionné pour cette organisation</p>
              <p className="text-sm text-[var(--ic-muted)] max-w-md mx-auto">
                Le backend ne renvoie aucune ligne d'entitlement pour ce tenant. Un administrateur plateforme doit activer des services
                via <code className="text-cyan-400">POST /api/entitlements/</code> (ou passer par la souscription du plan) pour peupler cette vue.
              </p>
            </div>
          ) : (
            <>
              {/* §6F — Service dependency graph */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2">
                    <Network className="w-4 h-4 text-cyan-400" /> Graphe de dépendance des services
                  </h2>
                  <span className="text-[11px] text-[var(--ic-muted)]">
                    {nodes.length} service(s) provisionné(s) · {edges.length} dépendance(s) déclarée(s) — arêtes issues uniquement du catalogue plateforme, jamais inférées
                  </span>
                </div>
                {edges.length === 0 ? (
                  <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 text-sm text-[var(--ic-muted)]">
                    Aucune paire de services provisionnés n'est reliée par une dépendance déclarée dans le catalogue plateforme.
                    Les services ci-dessous sont autonomes dans ce périmètre — ce n'est pas une erreur.
                  </div>
                ) : (
                  <RelationshipGraph
                    nodes={nodes} edges={edges} height={380} title="Graphe de dépendance des services du tenant"
                    selectedId={selService}
                    onNodeSelect={n => setSelService(n ? String(n.meta?.serviceId ?? n.id) : null)}
                    onOpen={n => setSelService(n.id)}
                  />
                )}
                {missingDeps.length > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-xs space-y-1">
                    <p className="font-semibold text-amber-300">Dépendances déclarées dont le prérequis n'est pas provisionné pour ce tenant :</p>
                    {missingDeps.map((m, i) => (
                      <p key={i} className="text-[var(--ic-muted)]">
                        <span className="text-amber-200">{serviceCatalog.find(s => s.id === m.service)?.name ?? m.service}</span>
                        {' '}requiert{' '}
                        <span className="text-amber-200">{serviceCatalog.find(s => s.id === m.requires)?.name ?? m.requires}</span>
                        {' '}— non présent dans les entitlements. Fonction attendue partielle ; aucune santé opérationnelle n'est affirmée.
                      </p>
                    ))}
                  </div>
                )}
              </section>

              {/* Cards grid — real rows joined to catalog metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cards.map(({ row, service }) => {
                  const isEnabled = row.enabled;
                  const availableTiers = service?.availableTiers as string[] | undefined;
                  const isAvailable = service ? (availableTiers?.includes(organization?.tier ?? '') ?? false) : true;
                  return (
                    <button key={row.id} onClick={() => setSelService(row.service_id)}
                      className={`text-left bg-[var(--ic-surface)] border rounded-xl p-5 transition-all ${
                        selService === row.service_id ? 'border-cyan-500/50 ring-1 ring-cyan-500/30' : 'border-[var(--ic-border)] hover:border-slate-500'
                      } ${!isAvailable ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{service?.icon ?? '📦'}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-[var(--ic-heading)]">{service?.name ?? row.service_id}</h3>
                              {service && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase ${
                                  service.category === 'security' ? 'bg-cyan-500/10 text-cyan-400' :
                                  service.category === 'networking' ? 'bg-purple-500/10 text-purple-400' :
                                  'bg-green-500/10 text-green-400'}`}>{service.category}</span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--ic-muted)] mt-1">{service?.description ?? 'Service référencé par le dossier d\u2019entitlements (hors catalogue affiché).'}</p>
                          </div>
                        </div>
                        {isEnabled
                          ? <CheckCircle2 className="w-5 h-5 text-cyber-green flex-shrink-0" aria-label="activé" />
                          : <XCircle className="w-5 h-5 text-[var(--ic-muted)] flex-shrink-0" aria-label="désactivé" />}
                      </div>
                      <div className="mt-3 pt-3 border-t border-[var(--ic-border)] flex items-center justify-between text-xs text-[var(--ic-muted)]">
                        <span>{row.seat_count} sièges</span>
                        <span>{row.activated_at ? `Activé: ${new Date(row.activated_at).toLocaleDateString()}` : 'Jamais activé'}</span>
                      </div>
                      {row.notes && <p className="text-[11px] text-purple-300 mt-1.5">{row.notes}</p>}
                      {!isAvailable && service && <p className="text-xs text-cyber-red mt-2">Non prévu au catalogue pour le palier {organization?.tier}</p>}
                    </button>
                  );
                })}
              </div>

              {/* Selected-service detail strip — persisted fields + verified deps */}
              {selCard && (() => {
                const id = selCard.row.service_id;
                const upstream = SERVICE_DEPENDENCY_RULES.filter(r => r.service === id).flatMap(r => r.requires);
                const downstream = SERVICE_DEPENDENCY_RULES.filter(r => r.requires.includes(id)).map(r => r.service);
                const nameOf = (x: string) => serviceCatalog.find(s => s.id === x)?.name ?? x;
                return (
                  <div className="fixed inset-x-4 bottom-4 z-40 md:left-auto md:right-6 md:w-[420px] bg-[var(--ic-surface)] border border-cyan-500/30 rounded-2xl p-4 shadow-2xl space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="text-sm font-bold text-[var(--ic-heading)]">{selCard.service?.name ?? id}</h3>
                      <button onClick={() => setSelService(null)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]" aria-label="Fermer le détail">✕</button>
                    </div>
                    <p className="text-xs text-[var(--ic-muted)]">
                      État persisté : <b className={selCard.row.enabled ? 'text-cyber-green' : 'text-[var(--ic-heading)]'}>{selCard.row.enabled ? 'activé' : 'désactivé'}</b>
                      {' · '}{selCard.row.seat_count} sièges
                      {selCard.row.deactivated_at ? ` · désactivé le ${new Date(selCard.row.deactivated_at).toLocaleString()}` : ''}
                      {' · créé le '}{new Date(selCard.row.created_at).toLocaleDateString()}
                    </p>
                    <div className="text-xs space-y-1">
                      <p><span className="text-[var(--ic-muted)]">Dépend de (catalogue déclaré) :</span>{' '}
                        {upstream.length ? upstream.map(nameOf).join(', ') : <i>aucune dépendance déclarée</i>}</p>
                      <p><span className="text-[var(--ic-muted)]">Alimente :</span>{' '}
                        {downstream.length ? downstream.map(nameOf).join(', ') : <i>aucun service connu</i>}</p>
                    </div>
                    <p className="text-[10px] text-[var(--ic-muted)] italic border-t border-[var(--ic-border)] pt-2">
                      Ces relations proviennent du catalogue de dépendances plateforme ; elles décrivent la conception du produit,
                      pas une télémétrie temps réel. La santé opérationnelle n'est jamais déduite de la seule présence d'un entitlement.
                    </p>
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}
