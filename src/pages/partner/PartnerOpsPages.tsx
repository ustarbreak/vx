// ---------------------------------------------------------------------------
// Partner Portal — Phase 2 (Daily operations) + Phase 3 (Onboarding &
// commercial) pages. role partner_admin only (routes under /partner/*).
// Talks exclusively through partnerOpsApi (/api/partners/{pid}/…) which
// mirrors partners_ops.py / partners_commercial.py; Demo Mode answers the
// same shapes. Real mode NEVER falls back to mock data: every section shows
// explicit loading / empty / error / not-configured states (HARD RULE 3).
// All money is MAD via fmtMad, single source of truth = pricing_config.json.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { partnersApi } from '../../services/partnersApi';
import {
  partnerOpsApi, type QueueItem, type QueueResponse, type HandoverNote, type ClientHealth,
  type GoldenTemplate, type DealRow, type QuoteSummary, type OnboardingResult,
  type BillingStatement, type WholesaleInvoice, type BillingAnalytics, type MarginInfo,
} from '../../services/partnerOpsApi';
import { ApiError } from '../../services/api';
import { PRICING_CONFIG_V2, fmtMad } from '../../data/pricingConfig';

// ---- tiny shared chrome (same visual language as PartnerPortalPages) ------
const Card = ({ title, icon: Icon, children, actions, className = '' }: any) => (
  <div className={`bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-4 sm:p-5 ${className}`}>
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--ic-muted)] min-w-0 truncate">
        {Icon && <Icon className="w-4 h-4 shrink-0" />} <span className="truncate">{title}</span>
      </h3>
      {actions}
    </div>
    {children}
  </div>
);

const Loader = ({ label = 'Chargement…' }: { label?: string }) => (
  <div className="flex items-center gap-2 text-[var(--ic-muted)] text-sm py-6 px-2">
    <span className="w-4 h-4 border-2 border-[var(--ic-muted)] border-t-transparent rounded-full animate-spin inline-block" /> {label}
  </div>
);

const Empty = ({ label }: { label: string }) => (
  <div className="text-sm text-[var(--ic-muted)] border border-dashed border-[var(--ic-border)] rounded-xl py-6 px-3 text-center">{label}</div>
);

// Rule 3: distinguish "not configured" (404/501/no endpoint) from real errors.
const ErrorBox = ({ err, onRetry }: { err: unknown; onRetry: () => void }) => {
  const status = (err as ApiError)?.status ?? 0;
  const msg = (err as Error)?.message ?? 'Erreur inconnue';
  const notConfigured = status === 404 || status === 501 || status === 0;
  return (
    <div className={`rounded-xl p-4 text-sm border ${notConfigured ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
      <div className="font-semibold mb-1">{notConfigured ? 'Non configuré' : 'Erreur'}</div>
      <div className="opacity-90 break-words">{msg}</div>
      <button onClick={onRetry} className="mt-3 text-xs border border-current rounded-lg px-3 py-1 hover:bg-white/5 cursor-pointer">Réessayer</button>
    </div>
  );
};

const SevBadge = ({ s }: { s: string }) => {
  const map: Record<string, string> = {
    critical: 'bg-rose-500/15 text-rose-400', p1: 'bg-rose-500/15 text-rose-400',
    high: 'bg-orange-500/15 text-orange-400', p2: 'bg-orange-500/15 text-orange-400',
    medium: 'bg-amber-500/15 text-amber-300', p3: 'bg-amber-500/15 text-amber-300',
    low: 'bg-sky-500/15 text-sky-300', p4: 'bg-sky-500/15 text-sky-300', info: 'bg-slate-500/15 text-slate-300',
  };
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${map[s] ?? 'bg-slate-500/15 text-slate-300'}`}>{s}</span>;
};

const SlaBadge = ({ state, due }: { state: string; due?: string | null }) => {
  if (state === 'none') return <span className="text-[10px] text-[var(--ic-muted)]">—</span>;
  const cls = state === 'breached' ? 'text-rose-400' : state === 'at_risk' ? 'text-amber-300' : 'text-emerald-400';
  return <span className={`text-[10px] font-semibold ${cls}`}>{state === 'breached' ? 'SLA ✗' : state === 'at_risk' ? 'SLA ⚠' : 'SLA ✓'}{due ? ` · ${new Date(due).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span>;
};

function usePid() {
  const { user } = useAuth();
  return String(user?.orgId ?? '');
}

// ===========================================================================
// 1. OPS CENTER — cross-client queue + health + console + handovers (Phase 2)
// ===========================================================================
export function PartnerOpsCenterPage() {
  const pid = usePid();
  const [tab, setTab] = useState<'queue' | 'health'>('queue');

  // ---- queue state ----
  const [filters, setFilters] = useState({ client: '', kind: '', severity: '', status: '', sla: '', q: '' });
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [qLoading, setQLoading] = useState(true);
  const [qErr, setQErr] = useState<unknown>(null);
  const [assignFor, setAssignFor] = useState<QueueItem | null>(null);
  const [assignEmail, setAssignEmail] = useState('');
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- handover state ----
  const [notes, setNotes] = useState<HandoverNote[]>([]);
  const [hShift, setHShift] = useState<'morning' | 'afternoon' | 'night'>('morning');
  const [hContent, setHContent] = useState('');

  // ---- impersonation state ----
  const [impClient, setImpClient] = useState<number | ''>('');
  const [impReason, setImpReason] = useState('');
  const [impMinutes, setImpMinutes] = useState(30);
  const [impSession, setImpSession] = useState<{ token: string; client_name: string; expires_at: string } | null>(null);
  const [impErr, setImpErr] = useState<string | null>(null);

  // ---- health state ----
  const [health, setHealth] = useState<ClientHealth[] | null>(null);
  const [hLoading, setHLoading] = useState(false);
  const [hErr, setHErr] = useState<unknown>(null);

  const loadQueue = useCallback(async () => {
    setQLoading(true); setQErr(null);
    try {
      const r = await partnerOpsApi.queue(pid, filters as any);
      setQueue(r);
      if (!notes.length) { /* noop */ }
    } catch (e) { setQErr(e); }
    finally { setQLoading(false); }
  }, [pid, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHealth = useCallback(async () => {
    setHLoading(true); setHErr(null);
    try { setHealth((await partnerOpsApi.health(pid)).clients); }
    catch (e) { setHErr(e); }
    finally { setHLoading(false); }
  }, [pid]);

  const loadHandovers = useCallback(async () => {
    try { setNotes(await partnerOpsApi.handovers(pid)); } catch { /* empty state is fine */ }
  }, [pid]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { loadHandovers(); }, [loadHandovers]);
  useEffect(() => { if (tab === 'health' && health === null && !hLoading && !hErr) loadHealth(); }, [tab, health, hLoading, hErr, loadHealth]);

  const doAssign = async () => {
    if (!assignFor || !assignEmail) return;
    setBusy(true); setAssignMsg(null);
    try {
      await partnerOpsApi.assign(pid, { kind: assignFor.kind, item_uid: assignFor.uid, assignee_email: assignEmail });
      setAssignMsg(`✓ ${assignFor.uid} → ${assignEmail}`);
      loadQueue();
    } catch (e: any) { setAssignMsg(e?.message ?? 'Échec'); }
    finally { setBusy(false); }
  };

  const addHandover = async (e: React.FormEvent) => {
    e.preventDefault(); if (hContent.trim().length < 3) return;
    setBusy(true);
    try { await partnerOpsApi.addHandover(pid, { shift: hShift, content: hContent.trim() }); setHContent(''); loadHandovers(); }
    catch { /* keep form */ }
    finally { setBusy(false); }
  };

  const openConsole = async () => {
    setImpErr(null);
    if (impClient === '' || impReason.trim().length < 5) { setImpErr('Client requis + motif ≥ 5 caractères.'); return; }
    setBusy(true);
    try {
      const r = await partnerOpsApi.openConsole(pid, { client_org_id: Number(impClient), minutes: impMinutes, reason: impReason.trim() });
      setImpSession({ token: r.token, client_name: r.client_name, expires_at: r.expires_at });
      setImpReason('');
    } catch (e: any) { setImpErr(e?.message ?? 'Échec de la demande de console.'); }
    finally { setBusy(false); }
  };

  const closeConsole = async () => {
    setBusy(true);
    try { await partnerOpsApi.closeConsole(pid); setImpSession(null); }
    catch (e: any) { setImpErr(e?.message ?? 'Échec'); }
    finally { setBusy(false); }
  };

  const sel = 'bg-transparent border border-[var(--ic-border)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-500/60';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Centre opérations partenaire</h1>
          <p className="text-sm text-[var(--ic-muted)]">File unifiée multi-clients, santé par tenant, accès console temps-limité et passations.</p>
        </div>
        <div className="flex rounded-xl border border-[var(--ic-border)] overflow-hidden text-sm">
          {(['queue', 'health'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 cursor-pointer ${tab === t ? 'bg-cyan-500/15 text-cyan-300 font-semibold' : 'text-[var(--ic-muted)] hover:text-white'}`}>
              {t === 'queue' ? 'File & passations' : 'Santé clients'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'queue' && (
        <>
          {/* KPI strip from counts — compact, no wrap */}
          {queue && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[['Alertes ouvertes', queue.counts.alerts_open, '#f87171'], ['Tickets ouverts', queue.counts.tickets_open, '#22d3ee'],
                ['Incidents ouverts', queue.counts.incidents_open, '#fbbf24'], ['SLA en breach', queue.counts.sla_breached, '#fb7185']].map(([l, v, c]) => (
                <div key={l as string} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)]">{l}</div>
                  <div className="text-xl font-bold tabular-nums" style={{ color: c as string }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          <Card title="File transverse (alertes · tickets · incidents)" icon={null}
            actions={<button onClick={loadQueue} className="text-xs text-cyan-300 hover:underline cursor-pointer">Actualiser</button>}>
            <div className="flex flex-wrap gap-2 mb-3">
              <select className={sel} value={filters.client} onChange={e => setFilters(f => ({ ...f, client: e.target.value }))}>
                <option value="">Tous les clients</option>
                {(queue?.clients ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={sel} value={filters.kind} onChange={e => setFilters(f => ({ ...f, kind: e.target.value }))}>
                <option value="">Tous types</option><option value="alert">Alertes</option><option value="ticket">Tickets</option><option value="incident">Incidents</option>
              </select>
              <select className={sel} value={filters.severity} onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}>
                <option value="">Sévérité</option>{['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className={sel} value={filters.sla} onChange={e => setFilters(f => ({ ...f, sla: e.target.value }))}>
                <option value="">SLA</option>{['breached', 'at_risk', 'ok', 'none'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className={`${sel} flex-1 min-w-[140px]`} placeholder="Recherche titre / ressource…" value={filters.q}
                onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
            </div>

            {qLoading ? <Loader label="Chargement de la file…" /> :
              qErr ? <ErrorBox err={qErr} onRetry={loadQueue} /> :
                !queue || queue.items.length === 0 ? <Empty label="Aucun élément ouvert sur votre portefeuille — rien à traiter. 🎉" /> : (
                  <div className="max-h-[420px] overflow-y-auto -mx-1">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--ic-surface)]"><tr className="text-left text-[10px] uppercase tracking-wide text-[var(--ic-muted)]">
                        <th className="py-1.5 pr-2">Type</th><th className="py-1.5 pr-2">Client</th><th className="py-1.5 pr-2">Titre</th>
                        <th className="py-1.5 pr-2">Sev</th><th className="py-1.5 pr-2">Statut</th><th className="py-1.5 pr-2">SLA</th>
                        <th className="py-1.5 pr-2">Assigné</th><th className="py-1.5"></th></tr></thead>
                      <tbody>
                        {queue.items.map(it => (
                          <tr key={`${it.kind}-${it.uid}`} className="border-t border-[var(--ic-border)] align-top">
                            <td className="py-1.5 pr-2 text-[var(--ic-muted)] capitalize">{it.kind}</td>
                            <td className="py-1.5 pr-2 max-w-[110px] truncate" title={it.client_name}>{it.client_name}</td>
                            <td className="py-1.5 pr-2 max-w-[260px]"><div className="truncate" title={it.title}>{it.title}</div>
                              <div className="text-[10px] text-[var(--ic-muted)]">{it.uid}{it.resource ? ` · ${it.resource}` : ''}</div></td>
                            <td className="py-1.5 pr-2"><SevBadge s={it.severity} /></td>
                            <td className="py-1.5 pr-2 text-[var(--ic-muted)]">{it.status}</td>
                            <td className="py-1.5 pr-2"><SlaBadge state={it.sla_state} due={it.sla_due_at} /></td>
                            <td className="py-1.5 pr-2 max-w-[130px] truncate text-[var(--ic-muted)]" title={it.assignee ?? undefined}>{it.assignee ?? '—'}</td>
                            <td className="py-1.5"><button onClick={() => { setAssignFor(it); setAssignEmail(it.assignee ?? ''); setAssignMsg(null); }}
                              className="text-cyan-300 hover:underline cursor-pointer whitespace-nowrap">Assigner</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

            {assignFor && (
              <div className="mt-3 border border-[var(--ic-border)] rounded-xl p-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ic-muted)]">Assigner <b className="text-white">{assignFor.uid}</b> ({assignFor.kind}) à un membre de votre équipe :</span>
                  <button onClick={() => setAssignFor(null)} className="text-xs text-[var(--ic-muted)] hover:text-white cursor-pointer">✕ Fermer</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input className={`${sel} flex-1 min-w-[200px]`} type="email" placeholder="analyste@votremsp.ma" value={assignEmail} onChange={e => setAssignEmail(e.target.value)} />
                  <button onClick={doAssign} disabled={busy} className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-semibold disabled:opacity-50 cursor-pointer">Confirmer</button>
                </div>
                {assignMsg && <div className="text-xs text-[var(--ic-muted)]">{assignMsg}</div>}
              </div>
            )}
          </Card>

          <Card title="Notes de passation (shift handover)" icon={null}>
            <form onSubmit={addHandover} className="flex flex-wrap gap-2 mb-3">
              <select className={sel} value={hShift} onChange={e => setHShift(e.target.value as any)}>
                <option value="morning">Matin</option><option value="afternoon">Après-midi</option><option value="night">Nuit</option>
              </select>
              <input className={`${sel} flex-1 min-w-[220px]`} maxLength={4000} placeholder="Consignes pour la relève (ex. : TCK-00042 en attente retour client)…"
                value={hContent} onChange={e => setHContent(e.target.value)} />
              <button type="submit" disabled={busy || hContent.trim().length < 3}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-xs font-semibold disabled:opacity-40 cursor-pointer">Ajouter</button>
            </form>
            {notes.length === 0 ? <Empty label="Aucune note de passation pour l'instant." /> : (
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {notes.map(n => (
                  <li key={n.id} className="border border-[var(--ic-border)] rounded-lg px-3 py-2 text-xs">
                    <div className="flex justify-between text-[10px] text-[var(--ic-muted)] mb-0.5">
                      <span className="uppercase font-semibold">{n.shift} · {n.author}</span>
                      <span>{n.created_at ? new Date(n.created_at + (n.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('fr-FR') : ''}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">{n.content}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Ouvrir la console d'un client (accès temps-limité, audité)" icon={null}>
            <div className="grid md:grid-cols-4 gap-2 text-sm">
              <select className={sel} value={impClient} onChange={e => setImpClient(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Client…</option>
                {(queue?.clients ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={sel} value={impMinutes} onChange={e => setImpMinutes(Number(e.target.value))}>
                {[15, 30, 60, 120].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
              <input className={`${sel} md:col-span-2`} placeholder="Motif (min. 5 car., journalisé)" value={impReason} onChange={e => setImpReason(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={openConsole} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/40 text-xs font-semibold disabled:opacity-50 cursor-pointer">Ouvrir la console client</button>
              {impSession && (
                <button onClick={closeConsole} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/40 text-xs font-semibold cursor-pointer">Révoquer toutes les sessions</button>
              )}
            </div>
            {impErr && <div className="text-xs text-rose-300 mt-2">{impErr}</div>}
            {impSession && (
              <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 text-xs space-y-1">
                <div className="font-semibold text-emerald-300">Session ouverte chez « {impSession.client_name} » — expire le {new Date(impSession.expires_at + (impSession.expires_at.endsWith('Z') ? '' : 'Z')).toLocaleString('fr-FR')}</div>
                <div className="text-[var(--ic-muted)]">Jeton scopes <code className="text-cyan-300">partner_console</code> (audité ; révocable). Collez-le dans un nouvel onglet pour entrer la console du client :</div>
                <textarea readOnly rows={2} className="w-full bg-black/30 rounded-lg p-2 font-mono text-[10px] break-all"
                  value={impSession.token} onFocus={(e) => e.currentTarget.select()} />
                <button className="text-cyan-300 hover:underline cursor-pointer"
                  onClick={() => navigator.clipboard?.writeText(impSession.token)}>Copier le jeton</button>
              </div>
            )}
            <p className="text-[10px] text-[var(--ic-muted)] mt-2">Chaque ouverture/fermeture est écrite au journal d'audit ; le grant expire automatiquement.</p>
          </Card>
        </>
      )}

      {tab === 'health' && (
        <Card title="Santé & risque par client" icon={null}
          actions={<button onClick={loadHealth} className="text-xs text-cyan-300 hover:underline cursor-pointer">Actualiser</button>}>
          {hLoading ? <Loader label="Calcul des scores…" /> :
            hErr ? <ErrorBox err={hErr} onRetry={loadHealth} /> :
              !health || health.length === 0 ? <Empty label="Aucun client rattaché — ajoutez-en depuis « Mes clients »." /> : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs min-w-[720px]">
                    <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[var(--ic-muted)]">
                      <th className="py-1.5 pr-3">Client</th><th className="py-1.5 pr-3">Alertes C/H/o</th><th className="py-1.5 pr-3">Incidents</th>
                      <th className="py-1.5 pr-3">Tickets</th><th className="py-1.5 pr-3">En retard</th><th className="py-1.5 pr-3">SLA</th>
                      <th className="py-1.5 pr-3">Agents</th><th className="py-1.5">Risque</th></tr></thead>
                    <tbody>
                      {health.map(c => (
                        <tr key={c.client_org_id} className="border-t border-[var(--ic-border)]">
                          <td className="py-2 pr-3 font-medium max-w-[160px] truncate" title={c.name}>{c.name}<div className="text-[10px] text-[var(--ic-muted)] normal-case">{c.status}</div></td>
                          <td className="py-2 pr-3 tabular-nums">{c.open_alerts.critical}/{c.open_alerts.high}/{c.open_alerts.other}</td>
                          <td className="py-2 pr-3 tabular-nums">{c.open_incidents}</td>
                          <td className="py-2 pr-3 tabular-nums">{c.open_tickets}</td>
                          <td className={`py-2 pr-3 tabular-nums ${c.overdue_tickets ? 'text-rose-400 font-semibold' : ''}`}>{c.overdue_tickets}</td>
                          <td className="py-2 pr-3"><SlaBadge state={c.sla_state} /></td>
                          <td className="py-2 pr-3 tabular-nums">{c.agents_online}/{c.agents_total}</td>
                          <td className="py-2"><span className={`inline-flex items-center gap-1 font-semibold capitalize ${c.risk_level === 'critical' ? 'text-rose-400' : c.risk_level === 'high' ? 'text-orange-400' : c.risk_level === 'medium' ? 'text-amber-300' : 'text-emerald-400'}`}>
                            <span className="w-2 h-2 rounded-full bg-current inline-block" />{c.risk_level} <span className="text-[var(--ic-muted)] font-normal">({c.risk_score})</span></span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          <p className="text-[10px] text-[var(--ic-muted)] mt-3">Score = 10×critiques + 4×hautes + autres alertes + 5×incidents + 3×tickets hors SLA (temps réel, backend).</p>
        </Card>
      )}
    </div>
  );
}

// ===========================================================================
// 2. TEMPLATES — golden rule/notification/playbook library (Phase 2.4)
// ===========================================================================
export function PartnerTemplatesPage() {
  const pid = usePid();
  const [tpls, setTpls] = useState<GoldenTemplate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [targets, setTargets] = useState<number[]>([]);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      setTpls(await partnerOpsApi.templates(pid));
      const q = await partnerOpsApi.queue(pid, {});
      setClients(q.clients);
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const cur = tpls?.find(t => t.id === selected) ?? null;

  const apply = async () => {
    if (!cur || targets.length === 0) return;
    setBusy(true); setApplyMsg(null);
    try {
      const r = await partnerOpsApi.applyTemplate(pid, cur.id, targets);
      setApplyMsg(`✓ Appliqué : ${r.applied?.monitoring_rules ?? 0} règles monitoring, ${r.applied?.notification_rules ?? 0} notifications, ${r.applied?.playbooks ?? 0} playbooks sur ${targets.length} client(s).`);
    } catch (e: any) { setApplyMsg(`✗ ${e?.message ?? 'Échec'}`); }
    finally { setBusy(false); }
  };

  const seedDefault = async () => {
    // Create the standard golden template if the library is empty (PUT upsert).
    setBusy(true);
    try {
      const t = await partnerOpsApi.putTemplate(pid, 'golden-base', {
        name: 'Base dorée Infracentra',
        monitoring_rules: [
          { name: 'CPU > 90% (5 min)', scope: 'asset', trigger_metric: 'cpu', operator: '>', threshold: '90', duration_min: 5, action: 'create_ticket', ticket_priority: 'P3', notify_channels: ['email'] },
          { name: 'Disque > 85%', scope: 'asset', trigger_metric: 'disk', operator: '>', threshold: '85', duration_min: 10, action: 'notify', notify_channels: ['email', 'teams'] },
        ],
        notification_rules: [
          { name: 'Critique → on-call', conditions: { severity: ['critical'] }, channels: ['email', 'sms'], escalate_after_minutes: 15 },
        ],
        playbooks: [{ name: 'Ransomware — isolation', steps: ['snapshot_process_list', 'block_ip', 'quarantine_host', 'notify'] }],
      });
      setTpls([t]); setSelected(t.id);
    } catch (e: any) { setApplyMsg(`✗ ${e?.message ?? 'Échec'}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Bibliothèque de templates dorés</h1>
        <p className="text-sm text-[var(--ic-muted)]">Clonez règles de monitoring, notifications et playbooks vers un ou plusieurs clients.</p>
      </header>
      {loading ? <Loader label="Chargement des templates…" /> :
        err ? <ErrorBox err={err} onRetry={load} /> :
          !tpls || tpls.length === 0 ? (
            <Card title="Aucun template" icon={null}>
              <Empty label="Votre bibliothèque est vide." />
              <button onClick={seedDefault} disabled={busy}
                className="mt-3 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 text-xs font-semibold cursor-pointer disabled:opacity-50">Créer le template « Base dorée »</button>
              {applyMsg && <div className="text-xs mt-2 text-[var(--ic-muted)]">{applyMsg}</div>}
            </Card>
          ) : (
            <div className="grid lg:grid-cols-3 gap-5">
              <Card title={`Templates (${tpls.length})`} icon={null}>
                <ul className="space-y-1.5">
                  {tpls.map(t => (
                    <li key={t.id}>
                      <button onClick={() => { setSelected(t.id); setApplyMsg(null); }}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm cursor-pointer ${selected === t.id ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200' : 'border-[var(--ic-border)] hover:border-cyan-500/30'}`}>
                        <div className="font-medium truncate">{t.name}</div>
                        <div className="text-[10px] text-[var(--ic-muted)]">{t.monitoring_rules?.length ?? 0} monitoring · {t.notification_rules?.length ?? 0} notif · {t.playbooks?.length ?? 0} playbook</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title={cur ? `Contenu — ${cur.name}` : 'Contenu'} icon={null} className="lg:col-span-2">
                {!cur ? <Empty label="Sélectionnez un template." /> : (
                  <div className="space-y-4 text-xs">
                    {[['Règles de monitoring', cur.monitoring_rules], ['Règles de notification', cur.notification_rules], ['Playbooks', cur.playbooks]].map(([label, arr]: any) => (
                      <div key={label as string}>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)] mb-1">{label}</div>
                        {(arr ?? []).length === 0 ? <div className="text-[var(--ic-muted)] italic">—</div> : (
                          <ul className="space-y-1">
                            {arr.map((r: any, i: number) => (
                              <li key={i} className="border border-[var(--ic-border)] rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
                                <span className="truncate">{r.name}</span>
                                <span className="text-[10px] text-[var(--ic-muted)] shrink-0">{r.action ?? r.channels?.join('+') ?? r.steps?.length + ' étapes'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-[var(--ic-border)]">
                      <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)] mb-2">Déployer vers mes clients</div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {clients.map(c => (
                          <label key={c.id} className={`px-2.5 py-1 rounded-lg border text-xs cursor-pointer select-none ${targets.includes(c.id) ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>
                            <input type="checkbox" className="hidden" checked={targets.includes(c.id)}
                              onChange={() => setTargets(ts => ts.includes(c.id) ? ts.filter(x => x !== c.id) : [...ts, c.id])} />
                            {c.name}
                          </label>
                        ))}
                      </div>
                      <button onClick={apply} disabled={busy || targets.length === 0}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-xs font-semibold disabled:opacity-40 cursor-pointer">Appliquer aux {targets.length || 0} client(s) sélectionné(s)</button>
                      {applyMsg && <div className="mt-2 text-[var(--ic-muted)]">{applyMsg}</div>}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
    </div>
  );
}

// ===========================================================================
// 3. ONBOARDING WIZARD + OFFBOARDING (Phase 3.1)
// ===========================================================================
export function PartnerOnboardingPage() {
  const pid = usePid();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [step, setStep] = useState(0);
  const [cid, setCid] = useState<number | ''>('');
  const [pack, setPack] = useState<'starter' | 'pro' | 'souverain'>('pro');
  const [contractMonths, setContractMonths] = useState(12);
  const [adminEmail, setAdminEmail] = useState('');
  const [integrations, setIntegrations] = useState<string[]>([]);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [offExport, setOffExport] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setClients(await partnersApi.clients(pid)); }
    catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const packs = PRICING_CONFIG_V2.packs;
  const INTEGRATIONS = ['m365', 'connectwise', 'autotask', 'halopsa', 'ninjaone'];

  const submit = async () => {
    if (cid === '') { setMsg('Sélectionnez un client.'); return; }
    setBusy(true); setMsg(null);
    try {
      setResult(await partnerOpsApi.startOnboarding(pid, Number(cid), {
        pack, contract_months: contractMonths, admin_email: adminEmail || null, integrations,
      }));
      setStep(4);
    } catch (e: any) { setMsg(e?.message ?? 'Échec'); }
    finally { setBusy(false); }
  };

  const doExport = async (clientId: number) => {
    setBusy(true); setMsg(null);
    try { setOffExport(await partnerOpsApi.offboardingExport(pid, clientId)); }
    catch (e: any) { setMsg(`Export : ${e?.message}`); }
    finally { setBusy(false); }
  };
  const doDisable = async (clientId: number) => {
    setBusy(true);
    try { await partnerOpsApi.offboardingDisable(pid, clientId); setMsg(`Client ${clientId} désactivé.`); load(); }
    catch (e: any) { setMsg(e?.message); }
    finally { setBusy(false); }
  };
  const doDelete = async (clientId: number) => {
    if (!window.confirm('Suppression définitive de ce client ? Irréversible.')) return;
    setBusy(true);
    try { await partnerOpsApi.offboardingDelete(pid, clientId); setMsg(`Client ${clientId} supprimé.`); setOffExport(null); load(); }
    catch (e: any) { setMsg(e?.message); }
    finally { setBusy(false); }
  };

  const StepDot = ({ n, label }: { n: number; label: string }) => (
    <button onClick={() => step >= 1 && n <= Math.min(step, 4) && setStep(n)}
      className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer whitespace-nowrap ${step === n ? 'border-cyan-500/60 text-cyan-300 bg-cyan-500/10' : n < step ? 'border-emerald-500/40 text-emerald-300' : 'border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>{n}. {label}</button>
  );

  const sel = 'bg-transparent border border-[var(--ic-border)] rounded-lg px-2 py-1.5 text-xs w-full focus:outline-none focus:border-cyan-500/60';

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Onboarding & offboarding clients</h1>
        <p className="text-sm text-[var(--ic-muted)]">Assistant d'onboarding (pack, agent, jeton d'enrôlement, intégrations, invitation) et sortie de contrat (export → disable → delete).</p>
      </header>

      <Card title="Assistant d'onboarding" icon={null}>
        <div className="flex flex-wrap gap-2 mb-4">
          <StepDot n={1} label="Client" /><StepDot n={2} label="Pack & contrat" /><StepDot n={3} label="Intégrations & invité" /><StepDot n={4} label="Agent & jeton" />
        </div>
        {loading ? <Loader label="Chargement des clients…" /> :
          err ? <ErrorBox err={err} onRetry={load} /> :
            clients.length === 0 ? <Empty label="Aucun client — créez-en dans « My Clients » avant l'onboarding." /> : (
              <div className="space-y-3 text-sm">
                {step === 0 && (<>
                  <p className="text-xs text-[var(--ic-muted)]">Sur quel client lancer l'onboarding ?</p>
                  <select className={sel} value={cid} onChange={e => { setCid(e.target.value === '' ? '' : Number(e.target.value)); setStep(1); }}>
                    <option value="">Choisir…</option>
                    {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                  </select>
                </>)}
                {step >= 1 && (<>
                  {step === 1 && (
                    <div className="grid sm:grid-cols-3 gap-3">
                      {(Object.keys(packs) as Array<'starter' | 'pro' | 'souverain'>).map(p => (
                        <button key={p} onClick={() => { setPack(p); setStep(2); }}
                          className={`text-left rounded-xl border p-3 cursor-pointer ${pack === p ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-[var(--ic-border)] hover:border-cyan-500/30'}`}>
                          <div className="font-semibold capitalize text-sm">{p}</div>
                          <div className="text-xs text-emerald-400">{fmtMad(packs[p].price)} <span className="text-[var(--ic-muted)]">/ unité / mois</span></div>
                          <div className="text-[10px] text-[var(--ic-muted)] mt-1">min {packs[p].minUnits} unités · rétention SIEM {packs[p].retentionDays} j · {packs[p].support}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {step === 1 && (
                    <label className="flex items-center gap-2 text-xs text-[var(--ic-muted)]">Durée du contrat :
                      <select className={`${sel} w-auto`} value={contractMonths} onChange={e => setContractMonths(Number(e.target.value))}>
                        {[0, 12, 24, 36].map(m => <option key={m} value={m}>{m === 0 ? 'sans engagement' : `${m} mois`}</option>)}
                      </select>
                    </label>
                  )}
                  {step >= 2 && step < 4 && (
                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)] mb-1">Intégrations à connecter</div>
                        <div className="flex flex-wrap gap-2">
                          {INTEGRATIONS.map(k => (
                            <label key={k} className={`px-2.5 py-1 rounded-lg border text-xs cursor-pointer select-none uppercase ${integrations.includes(k) ? 'border-violet-500/60 bg-violet-500/10 text-violet-300' : 'border-[var(--ic-border)] text-[var(--ic-muted)]'}`}>
                              <input type="checkbox" className="hidden" checked={integrations.includes(k)}
                                onChange={() => setIntegrations(xs => xs.includes(k) ? xs.filter(x => x !== k) : [...xs, k])} />{k}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)] mb-1">Inviter l'administrateur client (optionnel)</div>
                        <input className={sel} type="email" placeholder="admin@client.ma" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} />
                      </div>
                      <button onClick={submit} disabled={busy || cid === ''}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 text-xs font-semibold disabled:opacity-40 cursor-pointer">Générer l'installeur agent + jeton</button>
                    </div>
                  )}
                  {step === 4 && result && (
                    <div className="space-y-3">
                      <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 text-xs space-y-2">
                        <div className="font-semibold text-emerald-300">✓ Onboarding initialisé — pack {result.pack} ({fmtMad(result.pack_summary.price_mad)}/unité/mois, rétention {result.pack_summary.siem_retention_days} j)</div>
                        <div>
                          <div className="text-[10px] uppercase text-[var(--ic-muted)] mb-1">Commande d'installation agent (jeton visible une seule fois)</div>
                          <textarea readOnly rows={2} className="w-full bg-black/30 rounded-lg p-2 font-mono text-[10px]" value={result.agent_installer} onFocus={e => e.currentTarget.select()} />
                        </div>
                        <div className="text-[var(--ic-muted)]">Invitation admin : {result.invite.sent ? `envoyée à ${result.invite.email}` : 'non demandée'} · Intégrations déclarées : {result.integrations.join(', ') || 'aucune'}</div>
                        <ol className="list-decimal list-inside text-[var(--ic-muted)] space-y-0.5">{result.next_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      </div>
                      <button onClick={() => { setStep(0); setResult(null); setCid(''); }} className="text-xs text-cyan-300 hover:underline cursor-pointer">Nouvel onboarding</button>
                    </div>
                  )}
                  {msg && <div className="text-xs text-rose-300">{msg}</div>}
                </>)}
              </div>
            )}
      </Card>

      <Card title="Offboarding (export → désactivation → suppression)" icon={null}>
        {clients.length === 0 ? <Empty label="Aucun client." /> : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs min-w-[560px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-[var(--ic-muted)]">
                <th className="py-1.5 pr-3">Client</th><th className="py-1.5 pr-3">Statut</th><th className="py-1.5 pr-3">Devices</th><th className="py-1.5">Actions</th></tr></thead>
              <tbody>
                {clients.map((c: any) => (
                  <tr key={c.id} className="border-t border-[var(--ic-border)]">
                    <td className="py-2 pr-3 font-medium truncate max-w-[180px]">{c.name}</td>
                    <td className="py-2 pr-3 capitalize">{c.status}</td>
                    <td className="py-2 pr-3 tabular-nums">{c.devices}</td>
                    <td className="py-2 space-x-2 whitespace-nowrap">
                      <button onClick={() => doExport(Number(c.org_id ?? c.id))} disabled={busy} className="text-cyan-300 hover:underline cursor-pointer disabled:opacity-40">Exporter</button>
                      <button onClick={() => doDisable(Number(c.org_id ?? c.id))} disabled={busy || c.status === 'disabled'} className="text-amber-300 hover:underline cursor-pointer disabled:opacity-40">Désactiver</button>
                      <button onClick={() => doDelete(Number(c.org_id ?? c.id))} disabled={busy || c.status !== 'disabled'} className="text-rose-400 hover:underline cursor-pointer disabled:opacity-40" title="D'abord désactiver">Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {offExport && (
          <pre className="mt-3 bg-black/30 rounded-xl p-3 text-[10px] overflow-auto max-h-48">{JSON.stringify(offExport.export, null, 2)}</pre>
        )}
        {msg && !result && <div className="text-xs text-[var(--ic-muted)] mt-2">{msg}</div>}
      </Card>
    </div>
  );
}

// ===========================================================================
// 4. DEALS & QUOTES (Phase 3.2 + 3.3)
// ===========================================================================
export function PartnerDealsQuotesPage() {
  const pid = usePid();
  const [deals, setDeals] = useState<DealRow[] | null>(null);
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [dForm, setDForm] = useState({ prospect_company: '', prospect_email: '', expected_units: '', pack: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPlatform, setIsPlatform] = useState(false);
  const [qForm, setQForm] = useState({ assets_qty: '50', retail_per_unit: '200', deal_id: '', siem_gb_day: '0', support247: false });
  const [lastQuote, setLastQuote] = useState<{ number: string; margin: MarginInfo | null; wholesale: number; tier: string; bonus: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [d, q] = await Promise.all([partnerOpsApi.deals(pid), partnerOpsApi.quotes(pid)]);
      setDeals(d.deals); setQuotes(q.quotes);
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const createDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dForm.prospect_company.trim().length < 2 || !Number(dForm.expected_units)) { setMsg('Société (≥2 car.) et unités attendues requis.'); return; }
    setBusy(true); setMsg(null);
    try {
      const d = await partnerOpsApi.createDeal(pid, {
        prospect_company: dForm.prospect_company.trim(), prospect_email: dForm.prospect_email || null,
        expected_units: Number(dForm.expected_units), pack: dForm.pack || null,
      });
      setMsg(d.state === 'conflict' ? `⚠ Deal #${d.id} enregistré EN CONFLIT : ${d.conflict_note}` : `✓ Deal #${d.id} enregistré (${d.state}).`);
      setDForm({ prospect_company: '', prospect_email: '', expected_units: '', pack: '' });
      load();
    } catch (e: any) { setMsg(e?.message ?? 'Échec'); }
    finally { setBusy(false); }
  };

  const decide = async (id: number, ok: boolean) => {
    setBusy(true);
    try { ok ? await partnerOpsApi.approveDeal(pid, id) : await partnerOpsApi.rejectDeal(pid, id); load(); }
    catch (e: any) { setMsg(e?.message); }
    finally { setBusy(false); }
  };

  const makeQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await partnerOpsApi.createQuote(pid, {
        mode: 'pack', pack: 'pro',
        assets: [{ class: 'server', qty: Number(qForm.assets_qty) }],
        contract_months: 12, siem_gb_day: Number(qForm.siem_gb_day) || 0,
        backup_volume_gb: 0, support247: qForm.support247,
        deal_id: qForm.deal_id ? Number(qForm.deal_id) : null,
        retail_per_unit_mad: Number(qForm.retail_per_unit) || undefined,
      });
      setLastQuote({ number: r.number, margin: r.margin, wholesale: r.quote?.totals?.monthly_excl_vat_mad ?? 0, tier: r.partner_tier, bonus: r.deal_bonus_applied });
      load();
    } catch (e: any) { setMsg(e?.message ?? 'Échec devis'); }
    finally { setBusy(false); }
  };

  const sel = 'bg-transparent border border-[var(--ic-border)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-500/60';
  const input = `${sel} w-full`;
  const stateCls: Record<string, string> = { registered: 'text-cyan-300', approved: 'text-emerald-400', rejected: 'text-rose-400', conflict: 'text-amber-300', won: 'text-emerald-400', expired: 'text-[var(--ic-muted)]' };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Deal registrations & devis partenaires</h1>
        <p className="text-sm text-[var(--ic-muted)]">Détection de conflit, fenêtre de bonus 12 mois après approbation, prix de gros au tier + calculateur de marge.</p>
      </header>

      {loading ? <Loader /> : err ? <ErrorBox err={err} onRetry={load} /> : (
        <div className="grid xl:grid-cols-2 gap-5">
          <Card title={`Deals enregistrés (${deals?.length ?? 0})`} icon={null}>
            <form onSubmit={createDeal} className="grid sm:grid-cols-2 gap-2 mb-4 text-xs">
              <input className={input} placeholder="Société prospect *" value={dForm.prospect_company} onChange={e => setDForm(f => ({ ...f, prospect_company: e.target.value }))} />
              <input className={input} type="email" placeholder="email prospect" value={dForm.prospect_email} onChange={e => setDForm(f => ({ ...f, prospect_email: e.target.value }))} />
              <input className={input} type="number" min={1} placeholder="unités attendues *" value={dForm.expected_units} onChange={e => setDForm(f => ({ ...f, expected_units: e.target.value }))} />
              <select className={input} value={dForm.pack} onChange={e => setDForm(f => ({ ...f, pack: e.target.value }))}>
                <option value="">pack (optionnel)</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="souverain">Souverain</option>
              </select>
              <button type="submit" disabled={busy} className="sm:col-span-2 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 font-semibold disabled:opacity-40 cursor-pointer">Enregistrer le deal</button>
            </form>
            {msg && <div className="text-xs mb-2 text-[var(--ic-muted)] break-words">{msg}</div>}
            {!deals || deals.length === 0 ? <Empty label="Aucun deal enregistré." /> : (
              <ul className="space-y-2 max-h-80 overflow-y-auto">
                {deals.map(d => (
                  <li key={d.id} className="border border-[var(--ic-border)] rounded-lg px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold">#{d.id} {d.prospect_company}</span>
                        <span className={`ml-2 font-bold uppercase ${stateCls[d.state] ?? ''}`}>{d.state}</span>
                        <div className="text-[var(--ic-muted)]">{d.expected_units} unités {d.pack ? `· pack ${d.pack}` : ''} · créé {d.created_at ? new Date(d.created_at + (d.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('fr-FR') : ''}</div>
                        {d.conflict_note && <div className="text-amber-300/90 mt-0.5">{d.conflict_note}</div>}
                        {d.bonus_window_open && <div className="text-emerald-400 mt-0.5">★ Bonus deal actif (+{d.bonus_points} pts) jusqu'au {d.bonus_window_ends ? new Date(d.bonus_window_ends + (d.bonus_window_ends.endsWith('Z') ? '' : 'Z')).toLocaleDateString('fr-FR') : ''}</div>}
                      </div>
                      {(d.state === 'registered' || d.state === 'conflict') && isPlatform && (
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => decide(d.id, true)} disabled={busy} className="text-emerald-400 hover:underline cursor-pointer">Approuver</button>
                          <button onClick={() => decide(d.id, false)} disabled={busy} className="text-rose-400 hover:underline cursor-pointer">Rejeter</button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-[var(--ic-muted)] mt-2">L'approbation/rejet est réservé à l'éditeur (platform_admin) ; un partenaire voit l'état et la fenêtre de bonus.</p>
          </Card>

          <Card title="Devis & marge (prix de gros = tier)" icon={null}>
            <form onSubmit={makeQuote} className="grid sm:grid-cols-2 gap-2 text-xs mb-3">
              <label className="space-y-1">Unités (serveurs)<input className={input} type="number" min={1} max={100000} value={qForm.assets_qty} onChange={e => setQForm(f => ({ ...f, assets_qty: e.target.value }))} /></label>
              <label className="space-y-1">Prix revente / unité (MAD)<input className={input} type="number" min={1} step="0.01" value={qForm.retail_per_unit} onChange={e => setQForm(f => ({ ...f, retail_per_unit: e.target.value }))} /></label>
              <label className="space-y-1">SIEM Go/jour<input className={input} type="number" min={0} value={qForm.siem_gb_day} onChange={e => setQForm(f => ({ ...f, siem_gb_day: e.target.value }))} /></label>
              <label className="space-y-1">Deal approuvé (bonus)<select className={input} value={qForm.deal_id} onChange={e => setQForm(f => ({ ...f, deal_id: e.target.value }))}>
                <option value="">—</option>{(deals ?? []).filter(d => d.bonus_window_open).map(d => <option key={d.id} value={d.id}>#{d.id} {d.prospect_company}</option>)}
              </select></label>
              <label className="flex items-center gap-2 text-[var(--ic-muted)]"><input type="checkbox" checked={qForm.support247} onChange={e => setQForm(f => ({ ...f, support247: e.target.checked }))} /> Astreinte 24/7</label>
              <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/40 font-semibold disabled:opacity-40 cursor-pointer self-end">Générer le devis</button>
            </form>
            {lastQuote && (
              <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-3 text-xs space-y-1 mb-3">
                <div className="font-semibold text-emerald-300">✓ {lastQuote.number} · tier {lastQuote.tier}{lastQuote.bonus ? ' · bonus deal appliqué' : ''}</div>
                <div>Prix de gros : <b>{fmtMad(lastQuote.wholesale)}</b> /mois HT</div>
                {lastQuote.margin && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div><div className="text-[10px] text-[var(--ic-muted)]">Retail mensuel</div><b>{fmtMad(lastQuote.margin.retail_monthly_mad)}</b></div>
                    <div><div className="text-[10px] text-[var(--ic-muted)]">Marge brute</div><b className="text-emerald-400">{fmtMad(lastQuote.margin.gross_margin_mad)}</b></div>
                    <div><div className="text-[10px] text-[var(--ic-muted)]">Marge %</div><b className="text-emerald-400">{lastQuote.margin.margin_pct}%</b></div>
                  </div>
                )}
              </div>
            )}
            {!quotes || quotes.length === 0 ? <Empty label="Aucun devis généré." /> : (
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] uppercase text-[var(--ic-muted)]"><th className="py-1 pr-2">N°</th><th className="py-1 pr-2">Unités</th><th className="py-1 pr-2">Gros HT</th><th className="py-1">Date</th></tr></thead>
                  <tbody>{quotes.map(q => (
                    <tr key={q.id} className="border-t border-[var(--ic-border)]">
                      <td className="py-1.5 pr-2 font-mono">{q.number}</td><td className="py-1.5 pr-2 tabular-nums">{q.units}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{fmtMad(q.wholesale_monthly_excl_vat_mad)}</td>
                      <td className="py-1.5 text-[var(--ic-muted)]">{q.created_at ? new Date(q.created_at + (q.created_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString('fr-FR') : ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 5. BILLING (Phase 3.4) — statements, wholesale invoice, MRR/margin, CSV
// ===========================================================================
export function PartnerBillingPage() {
  const pid = usePid();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [analytics, setAnalytics] = useState<BillingAnalytics | null>(null);
  const [invoice, setInvoice] = useState<WholesaleInvoice | null>(null);
  const [statement, setStatement] = useState<BillingStatement | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [selClient, setSelClient] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [invLoading, setInvLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [a, cs] = await Promise.all([partnerOpsApi.billingAnalytics(pid), partnersApi.clients(pid)]);
      setAnalytics(a); setClients(cs);
      if (cs.length && selClient === '') setSelClient(Number((cs[0] as any).org_id ?? (cs[0] as any).id));
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadInvoice = useCallback(async () => {
    setInvLoading(true);
    try { setInvoice(await partnerOpsApi.billingInvoice(pid, month)); }
    catch { setInvoice(null); }
    finally { setInvLoading(false); }
  }, [pid, month]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadInvoice(); }, [loadInvoice]);
  useEffect(() => {
    if (selClient === '') return;
    partnerOpsApi.billingStatement(pid, Number(selClient), month).then(setStatement).catch(() => setStatement(null));
  }, [pid, selClient, month]);

  const exportCsv = (kind: 'statement' | 'invoice' | 'analytics') => {
    // Real-mode download via api.downloadFile; demo mode builds blob locally.
    const qs = kind === 'statement' ? `&client_org_id=${selClient}&month=${month}` : kind === 'invoice' ? `&month=${month}` : '';
    import('../../services/api').then(({ downloadFile }) =>
      downloadFile(`/partners/${pid}/billing/export?kind=${kind}${qs}`, `billing-${kind}.csv`)
    ).catch(() => window.open(`/api/partners/${pid}/billing/export?kind=${kind}${qs}`, '_blank'));
  };

  const sel = 'bg-transparent border border-[var(--ic-border)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-cyan-500/60';

  if (loading) return <Loader label="Chargement billing…" />;
  if (err) return <ErrorBox err={err} onRetry={load} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Facturation partenaire</h1>
          <p className="text-sm text-[var(--ic-muted)]"> relevés par client, facture de gros, MRR / churn / marge — tout en MAD (HT puis TVA {(((analytics as any)?.tier_discount_pct ?? 0) && 0) || 20}%).</p>
        </div>
        <input type="month" className={sel} value={month} onChange={e => setMonth(e.target.value)} />
      </header>

      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 text-sm">
          {[['Tier', analytics.tier, '#a78bfa'], ['Unités gérées', String(analytics.managed_units), '#22d3ee'],
            ['Clients actifs', String(analytics.active_clients), '#34d399'], ['Churnés', String(analytics.churned_clients), '#f87171'],
            ['MRR détail', fmtMad(analytics.retail_mrr_mad), '#fff'], ['MRR gros', fmtMad(analytics.wholesale_mrr_mad), '#fbbf24']].map(([l, v, c]) => (
            <div key={l as string} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)]">{l}</div>
              <div className="text-lg font-bold tabular-nums truncate" style={{ color: c as string }} title={v as string}>{v}</div>
            </div>
          ))}
          <div className="md:col-span-3 xl:col-span-6 flex flex-wrap gap-3 text-xs text-[var(--ic-muted)] items-center">
            <span>Marge : <b className="text-emerald-400">{fmtMad(analytics.margin_mrr_mad)}/mois ({analytics.margin_pct}%)</b></span>
            <span>Remise tier : <b>{Math.round(analytics.tier_discount_pct * 100)}%</b></span>
            <button onClick={() => exportCsv('analytics')} className="ml-auto px-2.5 py-1 rounded-lg border border-[var(--ic-border)] hover:border-cyan-500/50 cursor-pointer">Export CSV analytics</button>
          </div>
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-5">
        <Card title={`Facture de gros — ${month}`} icon={null}
          actions={<button onClick={() => exportCsv('invoice')} className="text-xs text-cyan-300 hover:underline cursor-pointer">CSV</button>}>
          {invLoading ? <Loader label="Calcul…" /> : !invoice || invoice.clients.length === 0 ? <Empty label="Aucun client facturable ce mois-ci." /> : (
            <div className="text-xs space-y-2">
              <div className="overflow-x-auto -mx-1 max-h-64 overflow-y-auto">
                <table className="w-full min-w-[480px]">
                  <thead className="sticky top-0 bg-[var(--ic-surface)]"><tr className="text-left text-[10px] uppercase text-[var(--ic-muted)]">
                    <th className="py-1 pr-2">Client</th><th className="py-1 pr-2">U.</th><th className="py-1 pr-2">Détail HT</th><th className="py-1 pr-2">− remise</th><th className="py-1">Gros</th></tr></thead>
                  <tbody>{invoice.clients.map(l => (
                    <tr key={l.client_org_id} className="border-t border-[var(--ic-border)]">
                      <td className="py-1.5 pr-2 max-w-[140px] truncate" title={l.name}>{l.name}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{l.units}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{fmtMad(l.monthly_excl_vat_mad)}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-rose-300">−{fmtMad(l.tier_discount_mad)}</td>
                      <td className="py-1.5 tabular-nums font-semibold">{fmtMad(l.wholesale_mad)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="border-t border-[var(--ic-border)] pt-2 grid grid-cols-2 gap-y-1 text-right tabular-nums">
                <span className="text-left text-[var(--ic-muted)]">Total détail HT</span><span>{fmtMad(invoice.retail_total_mad)}</span>
                <span className="text-left text-[var(--ic-muted)]">Total gros HT (tier {invoice.tier})</span><span className="font-bold">{fmtMad(invoice.wholesale_total_mad)}</span>
                <span className="text-left text-[var(--ic-muted)]">TVA 20%</span><span>{fmtMad(invoice.vat_mad)}</span>
                <span className="text-left font-semibold">Total TTC</span><span className="font-bold text-emerald-400">{fmtMad(invoice.total_incl_vat_mad)}</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Relevé mensuel par client" icon={null}
          actions={<button onClick={() => statement && exportCsv('statement')} disabled={!statement} className="text-xs text-cyan-300 hover:underline cursor-pointer disabled:opacity-40">CSV</button>}>
            <select className={`${sel} w-full mb-3`} value={selClient} onChange={e => setSelClient(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Choisir un client…</option>
              {clients.map((c: any) => <option key={c.id} value={Number(c.org_id ?? c.id)}>{c.name}</option>)}
            </select>
            {statement ? (
              <div className="text-xs space-y-2">
                <div className="flex justify-between text-[var(--ic-muted)]"><span>{statement.statement.name} · {statement.month} · pack {statement.statement.pack ?? 'non configuré'}</span><span>{statement.statement.units} unités</span></div>
                <ul className="divide-y divide-[var(--ic-border)]">
                  {statement.statement.lines.map((l, i) => (
                    <li key={i} className="flex justify-between py-1"><span className="truncate pr-2">{l.label}{l.qty ? ` (${l.qty})` : ''}</span><span className="tabular-nums shrink-0">{fmtMad(l.amount_mad)}</span></li>
                  ))}
                </ul>
                <div className="border-t border-[var(--ic-border)] pt-2 flex justify-between"><span>Détail HT</span><b className="tabular-nums">{fmtMad(statement.statement.monthly_excl_vat_mad)}</b></div>
                <div className="flex justify-between text-rose-300"><span>Remise tier {statement.statement.tier} ({Math.round(statement.statement.tier_discount_pct * 100)}%)</span><span className="tabular-nums">−{fmtMad(statement.statement.tier_discount_mad)}</span></div>
                <div className="flex justify-between font-bold"><span>Revenu de gros</span><span className="tabular-nums text-emerald-400">{fmtMad(statement.statement.wholesale_mad)}</span></div>
              </div>
            ) : selClient === '' ? <Empty label="Sélectionnez un client." /> : <Empty label="Relevé indisponible (client sans pack facturable ou non configuré)." />}
        </Card>
      </div>
    </div>
  );
}
