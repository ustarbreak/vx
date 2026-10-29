import React, { useEffect, useMemo, useState } from 'react';
import { Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle, BarChart3, Activity } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { auditApi, BackendAuditLog } from '../../services/api';
import { isDemoMode } from '../../services/demoMode';

// ---------------------------------------------------------------------------
// §6J — Governance Timeline + event histogram.
//
// Data contract (backend parity):
//   GET /api/audit/logs        → platform_admin only (403 otherwise). Server
//                                filters: org_id, actor_role, outcome + skip/limit.
//   GET /api/audit/logs/my-org → tenant-scoped trail for client roles
//                                (skip/limit only — server has no q/role filter
//                                there, so those two are applied CLIENT-side on
//                                this page; the UI labels which filters are
//                                server-applied vs local to stay honest).
//   Response = List[AuditLogResponse] (app/schemas.py). Demo mode mirrors the
//   same paths/params (demoMode.ts audit branch supports q/actor_role/outcome).
//
// The histogram buckets the FETCHED page of real rows client-side; the panel
// states explicitly that buckets reflect the fetched scope (limit), not a
// full server-side aggregation. Buckets derive solely from persisted
// `timestamp` values — nothing is imputed for missing periods except an
// honest zero count inside the labeled window.
// ---------------------------------------------------------------------------

const AUDIT_EXPLAIN: Record<string, { origin: string; meaning: string }> = {
  'alert.generated':       { origin: 'Pipeline SIEM / corrélation', meaning: "Une règle de corrélation ou un collecteur a généré une nouvelle alerte de sécurité sur l'infrastructure supervisée d'un client." },
  'billing.invoice':       { origin: 'Moteur de facturation (Bundle All-in-One)', meaning: "Une facture a été calculée/émise : sièges supplémentaires, dépassement SIEM ou renouvellement du cycle (mensuel/annuel -12%)." },
  'compliance.scan':       { origin: 'Module Conformité', meaning: "Un scan de conformité (ISO 27001 / PCI-DSS / RGPD…) a été exécuté et le score du tenant a été recalculé." },
  'entitlement.updated':   { origin: 'Tenant Manager → Services (Grant)', meaning: "Un administrateur plateforme a activé ou désactivé un service pour un client — cela outrepasse les limites de son plan standard. L'action est tracée ici." },
  'playbook.executed':     { origin: 'Automation → Playbooks (SOAR)', meaning: "Un playbook d'automatisation a été déclenché (manuellement ou par une règle). Chaque step est journalisé séparément." },
  'service.access_attempt':{ origin: 'Passerelle API / contrôle d’accès', meaning: "Tentative d'accès à un service. 'blocked' = rôle ou plan insuffisant (refus côté serveur, jamais masqué)." },
  'threat.ingested':       { origin: 'Threat Intelligence Feed', meaning: "De nouveaux indicateurs de compromission (IOCs) ont été ingérés depuis le flux de renseignement sur les menaces." },
  'user.invited':          { origin: 'Team & Roles', meaning: "Un compte utilisateur a été invité sur le tenant ; email d'activation envoyé." },
  'rule.created':          { origin: 'Tenant Manager → Rules', meaning: "Une règle de supervision a été créée : elle sera évaluée périodiquement et pourra ouvrir un ticket automatiquement ou notifier." },
  'rule.toggled':          { origin: 'Tenant Manager → Rules', meaning: "Activation/désactivation d'une règle existante." },
  'ticket.created_for_client': { origin: 'Tenant Manager → Créer un ticket', meaning: "Un administrateur Infracentra a ouvert un ticket pour ce client (escalade proactive avant que le client ne signale le problème)." },
  'partner.created':       { origin: 'Partner Program', meaning: "Nouveau partenaire MSP enregistré dans le programme (statut prospect/trial)." },
  'partner.updated':       { origin: 'Partner Program', meaning: "Fiche partenaire modifiée (contact, palier, statut)." },
  'partner.migrated':      { origin: 'Partner Program', meaning: "Migration de licence/partenaire effectuée (changement de plan wholesale ou de marque white-label)." },
  'partner.suspended':     { origin: 'Partner Program', meaning: "Partenaire suspendu : ses tenants end-clients restent actifs mais plus de provisioning." },
};

type LoadState = 'loading' | 'ready' | 'error';

/** Auto bucket size: hourly if the fetched window ≤ 3 days, else daily. */
function chooseBucket(spanMs: number): { unit: 'hour' | 'day'; ms: number; label: string } {
  if (spanMs <= 3 * 86400000) return { unit: 'hour', ms: 3600000, label: 'heure' };
  return { unit: 'day', ms: 86400000, label: 'jour' };
}

interface Bucket { start: number; total: number; success: number; failure: number; blocked: number; }

export default function PlatformAuditPage() {
  const { user, backendMode } = useAuth();
  const [rows, setRows] = useState<BackendAuditLog[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Filters → sent to the server as query params (server applies them; demo
  // router mirrors the same param names on the same paths).
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterOutcome, setFilterOutcome] = useState('all');
  const [selected, setSelected] = useState<BackendAuditLog | null>(null);

  const isPlatformAdmin = user?.role === 'platform_admin';
  // Backend /audit/logs (platform) supports actor_role/outcome server-side;
  // /logs/my-org supports only skip/limit → q + role + outcome are applied
  // locally for client-role sessions. Track so the UI can label this honestly.
  const serverFilters = isPlatformAdmin || !backendMode;

  useEffect(() => {
    let cancelled = false;
    setState('loading'); setErr(null);
    const params = {
      limit: 500,
      ...(serverFilters && filterRole !== 'all' ? { actor_role: filterRole } : {}),
      ...(serverFilters && filterOutcome !== 'all' ? { outcome: filterOutcome } : {}),
      ...(serverFilters && search.trim() ? { q: search.trim() } : {}),
    };
    const req = serverFilters
      ? auditApi.logs(params as any)
      : auditApi.myOrgLogs({ limit: 500 });
    req
      .then(list => { if (!cancelled) { setRows(list); setState('ready'); } })
      .catch(e => {
        if (cancelled) return;
        const msg = String((e as Error).message ?? e);
        if (/403/.test(msg)) setErr("Journal plateforme réservé aux administrateurs plateforme. Votre rôle consulte /audit/logs/my-org.");
        else if (/401/.test(msg)) setErr('Session expirée — reconnectez-vous pour consulter le journal.');
        else setErr(`Le serveur n'a pas répondu pour /api/audit/logs (${msg}). Réessayez.`);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [serverFilters, filterRole, filterOutcome, search, reloadKey]);

  // Client-side fallback filters for the my-org route (server has no q/role/outcome there).
  const rows2 = useMemo(() => {
    if (serverFilters) return rows;
    let list = rows;
    if (filterRole !== 'all') list = list.filter(r => r.actor_role === filterRole);
    if (filterOutcome !== 'all') list = list.filter(r => r.outcome === filterOutcome);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => `${r.actor_name} ${r.action} ${r.resource} ${r.resource_id} ${r.details ?? ''}`.toLowerCase().includes(q));
    return list;
  }, [rows, serverFilters, filterRole, filterOutcome, search]);

  // ---- Histogram over the fetched rows (client-side buckets) --------------
  const hist = useMemo(() => {
    if (rows2.length === 0) return null;
    const ts = rows2.map(r => Date.parse(r.timestamp)).filter(t => !Number.isNaN(t));
    if (ts.length === 0) return null;
    const min = Math.min(...ts), max = Math.max(...ts);
    const span = Math.max(max - min, 1);
    const bucket = chooseBucket(span);
    const start = Math.floor(min / bucket.ms) * bucket.ms;
    const end = Math.ceil((max + 1) / bucket.ms) * bucket.ms;
    const n = Math.min(96, Math.max(1, Math.round((end - start) / bucket.ms))); // rendering cap
    const width = (end - start) / n;
    const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({
      start: start + i * width, total: 0, success: 0, failure: 0, blocked: 0,
    }));
    const outcomeIdx: Record<string, keyof Bucket> = { success: 'success', failure: 'failure', blocked: 'blocked' };
    for (const r of rows2) {
      const t = Date.parse(r.timestamp); if (Number.isNaN(t)) continue;
      let i = Math.floor((t - start) / width); if (i >= n) i = n - 1; if (i < 0) i = 0;
      buckets[i].total++;
      const k = outcomeIdx[r.outcome]; if (k) (buckets[i] as any)[k]++;
    }
    const peak = Math.max(...buckets.map(b => b.total), 1);
    return { buckets, peak, bucketLabel: bucket.label, widthMs: width, min, max };
  }, [rows2]);

  // Action breakdown (top actions within fetched scope)
  const actionBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows2) m.set(r.action, (m.get(r.action) ?? 0) + 1);
    return [...m.entries()].sort((a, z) => z[1] - a[1]).slice(0, 8);
  }, [rows2]);

  const fmtBucket = (t: number, ms: number) => {
    const d = new Date(t);
    return ms >= 86400000
      ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
  };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Audit Log</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">
            Trail d'activité vérifié — <code className="text-cyan-400">{isPlatformAdmin || !backendMode ? 'GET /api/audit/logs' : 'GET /api/audit/logs/my-org'}</code>{' '}
            {isDemoMode() && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold uppercase">DEMO DATA</span>}
          </p>
        </div>
        <button onClick={() => { setRefreshing(true); setReloadKey(k => k + 1); setTimeout(() => setRefreshing(false), 400); }}
          disabled={refreshing || state === 'loading'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-text)] text-sm hover:bg-[var(--ic-surface)] disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${refreshing || state === 'loading' ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {/* Filters — server-applied params */}
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Recherche (acteur, action, ressource, détails)…"
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50" />
          </div>
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/50">
            <option value="all">All Roles</option>
            <option value="platform_admin">Platform Admin</option>
            <option value="client_admin">Client Admin</option>
            <option value="client_user">Client User</option>
          </select>
          <select value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/50">
            <option value="all">All Outcomes</option>
            <option value="success">Success</option>
            <option value="blocked">Blocked</option>
            <option value="failure">Failure</option>
          </select>
        </div>
      </div>

      {/* Loading / error — never render zeros as data on failure */}
      {state === 'loading' && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-8 text-center text-[var(--ic-muted)] text-sm">
          Interrogation du journal d'audit…
        </div>
      )}
      {state === 'error' && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-sm space-y-2">
          <p className="text-red-300 font-semibold">Journal indisponible</p>
          <p className="text-[var(--ic-muted)]">{err}</p>
          <button onClick={() => setReloadKey(k => k + 1)} className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25">Réessayer</button>
        </div>
      )}

      {state === 'ready' && (
        <>
          {/* §6J — Governance timeline histogram */}
          {hist && (
            <section className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--ic-heading)] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" /> Chronologie de gouvernance — événements par {hist.bucketLabel}
                </h2>
                <span className="text-[11px] text-[var(--ic-muted)]">
                  Fenêtre affichée : {fmtBucket(hist.min, hist.widthMs)} → {fmtBucket(hist.max, hist.widthMs)} · agrégation client sur la page récupérée (≤500 lignes), pas une agrégation serveur complète
                </span>
              </div>
              <div role="img" aria-label={`Histogramme d'événements d'audit par ${hist.bucketLabel}, ${hist.buckets.length} intervalles, pic à ${hist.peak} événements`}>
                <div className="flex items-end gap-px h-28 overflow-x-auto pb-1">
                  {hist.buckets.map((b, i) => {
                    const hPct = b.total === 0 ? 0 : Math.max(4, Math.round(b.total / hist.peak * 100));
                    return (
                      <div key={i} className="flex-shrink-0 group relative" style={{ width: Math.max(10, Math.min(28, 840 / hist.buckets.length)) }}>
                        <div className="w-full flex flex-col justify-end h-24">
                          {b.total > 0 ? (
                            <>
                              {b.blocked > 0 && <div style={{ height: `${(b.blocked / b.total) * hPct}%` }} className="bg-red-500/70 w-full rounded-t-sm" />}
                              {b.failure > 0 && <div style={{ height: `${(b.failure / b.total) * hPct}%` }} className="bg-amber-500/70 w-full" />}
                              <div style={{ height: `${(b.success / b.total) * hPct}%` }} className="bg-cyan-500/70 w-full" />
                            </>
                          ) : (
                            <div className="w-full h-px bg-[var(--ic-border)] mb-[96px]" title="aucun événement" />
                          )}
                        </div>
                        <title>{`${fmtBucket(b.start, hist.widthMs)} — ${b.total} evt (✓${b.success} ✗${b.failure} ⛔${b.blocked})`}</title>
                        <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-10 whitespace-nowrap text-[10px] bg-black/90 border border-[var(--ic-border)] rounded px-2 py-1 pointer-events-none">
                          {fmtBucket(b.start, hist.widthMs)} · {b.total} evt — {b.success} succès, {b.failure} échecs, {b.blocked} bloqués
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-[var(--ic-muted)] mt-1">
                  <span>{fmtBucket(hist.buckets[0].start, hist.widthMs)}</span>
                  <span>granularité : {hist.bucketLabel === 'heure' ? '1 h' : '1 j'}{hist.buckets.length >= 96 ? ' · borne haute de rendu atteinte — narrower via filtres' : ''}</span>
                  <span>{fmtBucket(hist.buckets[hist.buckets.length - 1].start + hist.widthMs, hist.widthMs)}</span>
                </div>
                <div className="flex gap-3 text-[10px] text-[var(--ic-muted)] pt-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-500/70 inline-block rounded-sm" />succès</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500/70 inline-block rounded-sm" />échec</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500/70 inline-block rounded-sm" />bloqué</span>
                  <span className="italic">(les segments sont empilés et légendés par texte au survol — pas de lecture par couleur seule)</span>
                </div>
              </div>
              {actionBreakdown.length > 0 && (
                <div className="border-t border-[var(--ic-border)] pt-2">
                  <p className="text-[11px] font-semibold text-[var(--ic-muted)] uppercase mb-1.5 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />Actions les plus fréquentes (périmètre récupéré)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {actionBreakdown.map(([a, c]) => (
                      <button key={a} onClick={() => setSearch(a)}
                        className="px-2 py-1 rounded-md bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[11px] text-[var(--ic-text)] hover:border-cyan-500/40">
                        <code className="text-cyan-400">{a}</code> <span className="text-[var(--ic-muted)]">×{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Empty vs no-results — distinguished honestly */}
          {rows2.length === 0 && (
            <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-10 text-center space-y-2">
              <p className="text-[var(--ic-heading)] font-semibold">{rows.length === 0 ? "Aucun événement d'audit" : "Aucun résultat pour ces filtres"}</p>
              <p className="text-sm text-[var(--ic-muted)] max-w-md mx-auto">
                Le backend ne renvoie aucune entrée pour ce périmètre/filtre. Les mutations futures (grants, règles, playbooks, accès refusés)
                alimenteront ce journal automatiquement — rien n'est simulé côté client.
              </p>
            </div>
          )}

          {/* Records table */}
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--ic-border)]">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Timestamp</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Actor</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Details</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">Outcome</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--ic-muted)] uppercase">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows2.map(entry => (
                    <tr key={entry.id} onClick={() => setSelected(entry)} title="Cliquer pour expliquer cette entrée"
                        className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] transition-colors cursor-pointer">
                      <td className="px-4 py-3"><span className="text-xs text-[var(--ic-muted)] font-mono">{new Date(entry.timestamp).toLocaleString()}</span></td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-[var(--ic-heading)]">{entry.actor_name}</p>
                        <p className="text-xs text-[var(--ic-muted)]">{entry.actor_role.replace('_', ' ')}</p>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-cyan-400 font-mono">{entry.action}</code>
                        {AUDIT_EXPLAIN[entry.action] && (
                          <p className="text-[10px] text-[var(--ic-muted)] mt-0.5 truncate max-w-[220px]">{AUDIT_EXPLAIN[entry.action].origin}</p>
                        )}
                      </td>
                      <td className="px-4 py-3"><p className="text-sm text-[var(--ic-text)] max-w-md truncate">{entry.details}</p></td>
                      <td className="px-4 py-3">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${
                          entry.outcome === 'success' ? 'text-cyber-green' : entry.outcome === 'blocked' ? 'text-cyber-red' : 'text-cyber-yellow'}`}>
                          {entry.outcome === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                           entry.outcome === 'blocked' ? <XCircle className="w-3.5 h-3.5" /> :
                           <AlertTriangle className="w-3.5 h-3.5" />}
                          {entry.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-3"><code className="text-xs text-[var(--ic-muted)] font-mono">{entry.ip_address ?? '—'}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Explainable audit entry modal */}
      {selected && (() => {
        const ex = AUDIT_EXPLAIN[selected.action];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative w-full max-w-lg bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 space-y-4"
                 onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <h3 className="text-lg font-bold text-[var(--ic-heading)] font-mono">{selected.action}</h3>
                <button onClick={() => setSelected(null)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]" aria-label="Fermer">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <p><span className="text-[var(--ic-muted)]">Origine :</span>{' '}
                  <b className="text-[var(--ic-heading)]">{ex?.origin ?? 'Journal système Infracentra'}</b></p>
                <p className="text-[var(--ic-text)]">{ex?.meaning ?? `Action « ${selected.action} » exécutée par ${selected.actor_name} sur la ressource ${selected.resource}${selected.resource_id ? ` (${selected.resource_id})` : ''}.`}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
                <div><span className="text-[var(--ic-muted)] block">Horodatage (UTC)</span>{new Date(selected.timestamp).toISOString()}</div>
                <div><span className="text-[var(--ic-muted)] block">Acteur</span>{selected.actor_name} · {selected.actor_role}</div>
                <div><span className="text-[var(--ic-muted)] block">Ressource</span>{selected.resource} {selected.resource_id}</div>
                <div><span className="text-[var(--ic-muted)] block">IP source</span><code>{selected.ip_address ?? '—'}</code></div>
                <div><span className="text-[var(--ic-muted)] block">Tenant</span>{selected.org_id ?? 'plateforme'}</div>
                <div><span className="text-[var(--ic-muted)] block">Résultat</span>{selected.outcome}</div>
              </div>
              <p className="text-xs text-[var(--ic-muted)] italic border-t border-[var(--ic-border)] pt-3">
                🔒 Entrée immuable lue depuis le backend FastAPI (mode réel) ou le monde démo unifié (mode démo) — mêmes schémas, mêmes actions. Aucune entrée n'est générée côté client.
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
