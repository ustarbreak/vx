import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Skull, AlertOctagon, Clock, ChevronDown, ChevronUp, Target, Radar, Plug, PlugZap, Database, ExternalLink, Network } from 'lucide-react';
import { mockThreats } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';
import { RelationshipGraph, type RGNode, type RGEdge } from '../components/RelationshipGraph';
import DashboardWidget, {
  WidgetLayoutProvider,
  WidgetGrid,
  ResetLayoutButton,
  CustomizeHint,
  type WidgetLayoutEntry,
} from '../components/DashboardWidget';
import { AddWidgetButton, AllCatalogEntries } from '../components/WidgetCatalog';

const THREATS_LAYOUT: WidgetLayoutEntry[] = [
  { id: 'th-graph', colSpan: 3, collapsed: false },
  { id: 'th-lookup', colSpan: 2, collapsed: false },
  { id: 'th-feed', colSpan: 3, collapsed: false },
];
import {
  isDemoMode, fetchLiveThreats, fetchIndicatorMatches, fetchFeedsStatus, lookupIoc,
  type LiveThreat, type IndicatorMatch, type FeedsStatusResponse,
} from '../services/threatIntel';

// ---------------------------------------------------------------------------
// Threat Intelligence Relationship Graph (§6D).
// Data sources (no others): GET /api/threat-intel/matches (indicator ⇄
// incident ⇄ asset ⇄ alert evidence links) + the feed threat list
// (GET /api/threat-intel/threats | lookup enrichment, MITRE techniques as
// shared nodes only when a source actually maps the indicator to them).
// Every edge carries its provenance; nothing is inferred by name/subnet/time.
// ---------------------------------------------------------------------------
function IntelRelationshipGraph({ threats, matches }: { threats: any[]; matches: IndicatorMatch[] }) {
  const navigate = useNavigate();
  const [selKind, setSelKind] = useState<'all' | 'matched'>('all');

  const { nodes, edges } = useMemo(() => {
    const n = new Map<string, RGNode>();
    const e: RGEdge[] = [];
    const addNode = (node: RGNode) => { if (!n.has(node.id)) n.set(node.id, node); };
    // Indicators matched to this tenant's environment — verified evidence edges.
    const scoped = selKind === 'matched' ? matches : matches;
    scoped.forEach(m => {
      const indId = `ind:${m.indicator}`;
      addNode({ id: indId, label: m.indicator, kind: 'indicator', severity: m.severity, meta: { match: m } });
      addNode({ id: `inc:${m.incident_uid}`, label: m.incident_uid, kind: 'incident', severity: m.severity, meta: { uid: m.incident_uid } });
      e.push({ source: indId, target: `inc:${m.incident_uid}`, evidence: `IoC recorded on incident ${m.incident_uid} (${m.status ?? '—'})` });
      m.assets.forEach(a => {
        addNode({ id: `asset:${a}`, label: a, kind: 'asset' });
        e.push({ source: indId, target: `asset:${a}`, evidence: `Asset listed among affected assets of ${m.incident_uid}` });
      });
      m.related_alert_uids.forEach(u => {
        addNode({ id: `alert:${u}`, label: u, kind: 'alert' });
        e.push({ source: `inc:${m.incident_uid}`, target: `alert:${u}`, evidence: `Alert correlated to ${m.incident_uid} by resource match (server-side join)` });
      });
    });
    // Feed indicators + their MITRE mappings (only when the source provides them).
    threats.slice(0, 40).forEach(t => {
      if (!t.ioc) return;
      const indId = `ind:${t.ioc}`;
      addNode({ id: indId, label: t.ioc, kind: 'indicator', severity: t.severity, meta: { threat: t } });
      (t.mitreAttack ?? []).slice(0, 3).forEach((tech: string) => {
        addNode({ id: `mitre:${tech}`, label: tech, kind: 'mitre' });
        e.push({ source: indId, target: `mitre:${tech}`, evidence: `MITRE technique ${tech} mapped by source ${t.source}` });
      });
    });
    return { nodes: [...n.values()], edges: e };
  }, [threats, matches, selKind]);

  const openNode = (node: RGNode) => {
    if (node.kind === 'incident') navigate(`/incidents?q=${encodeURIComponent(String(node.meta?.uid ?? node.label))}`);
    else if (node.kind === 'alert') navigate(`/client-admin/alerts?q=${encodeURIComponent(node.label)}`);
    else if (node.kind === 'indicator') { /* selection already shows the drawer */ }
  };

  const selNode = nodes.find(x => x.kind === 'indicator' && (edges.some(ed => ed.source === x.id || ed.target === x.id)));

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" /> Indicator relationship graph
        </h3>
        <span className="text-[10px] text-[var(--ic-muted)]">
          Edges = real records only ({matches.length} evidence link{matches.length === 1 ? '' : 's'} from /threat-intel/matches + source MITRE mappings)
        </span>
      </div>
      {nodes.length === 0 ? (
        <p className="text-xs text-[var(--ic-muted)] py-6 text-center">
          No indicators with verifiable relationships in scope yet. The graph populates automatically when incidents carry IoCs or feed sources publish MITRE mappings — no nodes are invented.
        </p>
      ) : (
        <RelationshipGraph nodes={nodes} edges={edges} height={380} onOpen={openNode} maxNodes={140}
          title="Threat intelligence relationship graph" />
      )}
      {/* Drawer for the selected indicator (provenance + supporting records) */}
      {selNode && selNode.meta?.match && (
        <div className="border border-[var(--ic-border)] rounded-lg p-3 text-xs bg-[var(--ic-surface-2)]/50">
          <p className="font-mono text-cyan-300">{String(selNode.label)}</p>
          <p className="text-[var(--ic-muted)] mt-1">
            Provenance: observed on incident <Link className="text-purple-400" to={`/incidents?q=${encodeURIComponent(selNode.meta.match.incident_uid)}`}>{selNode.meta.match.incident_uid}</Link>
            {' '}· category {selNode.meta.match.category ?? '—'} · status {selNode.meta.match.status ?? '—'}
            {selNode.meta.match.observed_at && <> · first recorded {new Date(selNode.meta.match.observed_at).toLocaleString()}</>}
          </p>
        </div>
      )}
      {void selKind}
    </div>
  );
}

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  high: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  medium: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  low: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  info: { bg: 'bg-slate-500/10', text: 'text-[var(--ic-muted)]', border: 'border-slate-500/20' },
};

// -- Feed synchronization panel (GET /api/threat-intel/feeds/status) --------
// Honest by construction: shows only real Integration rows. There is NO
// background sync job in the platform, so last_sync is labelled "last
// recorded update" and never presented as an active synchronization.
function FeedStatusPanel() {
  const [feeds, setFeeds] = useState<FeedsStatusResponse | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchFeedsStatus().then(r => { if (!cancelled) setFeeds(r); }).catch(e => { if (!cancelled) setErr(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  if (err) return (
    <div className="bg-[var(--ic-surface)] border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-center gap-2">
      <AlertOctagon className="w-4 h-4" /> Feed status endpoint unreachable: {err}
    </div>
  );
  if (!feeds) return <div className="h-16 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] animate-pulse" />;

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-3 flex items-center gap-2">
        <Radar className="w-4 h-4 text-cyan-400" /> Threat feed configuration
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {feeds.feeds.map(f => (
          <div key={f.name} className={`p-3 rounded-lg border ${f.configured ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/25 bg-amber-500/5'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--ic-heading)]">{f.name}</span>
              <span className={`flex items-center gap-1 text-[10px] font-bold uppercase ${f.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
                {f.configured ? <PlugZap className="w-3 h-3" /> : <Plug className="w-3 h-3" />}
                {f.configured ? (f.kind === 'instance' ? 'configured' : 'available on demand') : 'not configured'}
              </span>
            </div>
            {f.kind === 'public-on-demand' && f.note && (
              <p className="text-[10px] text-[var(--ic-muted)] mt-1.5">{f.note}</p>
            )}
            {f.statuses && f.statuses.length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.statuses.map(s => (
                  <li key={s.id} className="text-[10px] text-[var(--ic-muted)] flex flex-wrap gap-x-3">
                    <span>row #{s.id}: <span className={s.status === 'active' ? 'text-emerald-400' : 'text-amber-400'}>{s.status}</span></span>
                    <span>endpoint {s.endpoint_set ? 'set' : 'missing'}</span>
                    <span title="Last recorded update on the Integration row — no background sync job exists">
                      last recorded update: {s.last_sync ? new Date(s.last_sync).toLocaleString() : 'never'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {f.name === 'MISP' && !f.configured && (
              <p className="text-[10px] text-amber-300/80 mt-1.5">
                No active MISP integration with endpoint + key → recent-event feed returns nothing. Configure it under Settings → Integrations. The UI never fabricates feed results.
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[var(--ic-muted)] mt-3">
        Note: timestamps above reflect the stored Integration rows only. Infracentra performs lookups on demand per indicator; there is no scheduled feed synchronization to report progress for.
      </p>
    </div>
  );
}

// -- Matched indicators panel (GET /api/threat-intel/matches) ---------------
// Only IoCs actually attached to this tenant's incidents are listed, each
// linked back to its incident and related alerts. Empty = honest empty state.
function MatchedIndicatorsPanel({ search }: { search: string }) {
  const [matches, setMatches] = useState<IndicatorMatch[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchIndicatorMatches().then(m => { if (!cancelled) setMatches(m); }).catch(e => { if (!cancelled) setErr(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  if (err) return (
    <div className="bg-[var(--ic-surface)] border border-amber-500/30 rounded-xl p-3 text-xs text-amber-300 flex items-center gap-2">
      <AlertOctagon className="w-4 h-4" /> Could not load indicator matches: {err}
    </div>
  );
  if (!matches) return <div className="h-20 rounded-xl bg-[var(--ic-surface)] border border-[var(--ic-border)] animate-pulse" />;

  const filtered = search
    ? matches.filter(m => m.indicator.toLowerCase().includes(search.toLowerCase()) || m.incident_uid.toLowerCase().includes(search.toLowerCase()))
    : matches;

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-1 flex items-center gap-2">
        <Database className="w-4 h-4 text-purple-400" /> Indicators matched to your environment ({matches.length})
      </h3>
      <p className="text-[10px] text-[var(--ic-muted)] mb-3">
        IoCs recorded on this tenant's incidents — real evidence links, not external assertions. Drill into each incident or its correlated alerts.
      </p>
      {filtered.length === 0 ? (
        <p className="text-xs text-[var(--ic-muted)] py-4 text-center">
          {matches.length === 0
            ? 'No indicators are linked to any incident of this organization yet. Matches appear automatically when analysts attach IoCs during IR triage — none are invented here.'
            : 'No matched indicators for the current search.'}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--ic-border)] max-h-72 overflow-auto">
          {filtered.slice(0, 100).map((m, i) => {
            const colors = severityColors[m.severity] ?? severityColors.info;
            return (
              <li key={`${m.indicator}-${m.incident_uid}-${i}`} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <code className="font-mono text-cyan-300 break-all">{m.indicator}</code>
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${colors.bg} ${colors.text}`}>{m.severity}</span>
                <span className="text-[var(--ic-muted)]">{m.category ?? '—'} · {m.status ?? '—'}</span>
                {m.observed_at && <span className="text-[var(--ic-muted)] flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(m.observed_at).toLocaleString()}</span>}
                <span className="ml-auto flex items-center gap-3">
                  {m.assets.length > 0 && <span className="text-[var(--ic-muted)]" title={m.assets.join(', ')}>{m.assets.length} asset{m.assets.length > 1 ? 's' : ''}</span>}
                  {m.related_alert_uids.length > 0 && (
                    <span className="text-[var(--ic-muted)]" title={m.related_alert_uids.join(', ')}>{m.related_alert_uids.length} alert{m.related_alert_uids.length > 1 ? 's' : ''}</span>
                  )}
                  <Link to={`/incidents?q=${encodeURIComponent(m.incident_uid)}`} className="text-purple-400 hover:text-purple-300 flex items-center gap-1">
                    {m.incident_uid}<ExternalLink className="w-3 h-3" />
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ThreatsContent() {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Real-mode data (backend /api/threat-intel). Demo Mode keeps mockThreats.
  const [liveThreats, setLiveThreats] = useState<any[] | null>(null);
  const [feedStatus, setFeedStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [feedError, setFeedError] = useState('');

  // On-demand single-indicator enrichment (real: OTX+MISP live; demo: simulated fixtures).
  const [lookupState, setLookupState] = useState<{ ioc: string; count: number; threats: LiveThreat[] } | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState('');

  // Evidence links shared with the relationship graph (§6D) — same fetch that
  // powers MatchedIndicatorsPanel's endpoint, lifted so both views stay in sync.
  const [graphMatches, setGraphMatches] = useState<IndicatorMatch[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchIndicatorMatches().then(m => { if (!cancelled) setGraphMatches(m); }).catch(() => { /* honest empty graph */ });
    return () => { cancelled = true; };
  }, []);

  const baseList: any[] = !isDemoMode() && liveThreats && liveThreats.length > 0 ? liveThreats : mockThreats;

  useEffect(() => {
    if (isDemoMode()) return; // simulated dataset already rendered
    let cancelled = false;
    setFeedStatus('loading');
    fetchLiveThreats()
      .then(list => {
        if (cancelled) return;
        setLiveThreats(list);
        setFeedStatus('ok');
      })
      .catch(e => {
        if (cancelled) return;
        setFeedError(String(e?.message ?? e));
        setFeedStatus('error');
      });
    return () => { cancelled = true; };
  }, []);

  const runLookup = async () => {
    const ioc = search.trim();
    if (!ioc) return;
    setLookupBusy(true); setLookupErr(''); setLookupState(null);
    try {
      const r = await lookupIoc(ioc);
      setLookupState(r);
    } catch (e: any) {
      setLookupErr(String(e?.message ?? e));
    } finally {
      setLookupBusy(false);
    }
  };

  const filtered = baseList.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.ioc ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <WidgetLayoutProvider pageKey="threats" defaultLayout={THREATS_LAYOUT}>
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Threat Intelligence</h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">
            {isDemoMode()
              ? 'Simulated indicator dataset + local evidence links (Demo Mode)'
              : 'On-demand lookups via AlienVault OTX and the configured MISP instance'}
          </p>
          {!isDemoMode() && (
            <div className="mt-2 text-xs">
              {feedStatus === 'loading' && <span className="text-cyan-400">● Fetching live feed from backend…</span>}
              {feedStatus === 'ok' && (liveThreats?.length ?? 0) > 0 &&
                <span className="text-emerald-400">● LIVE FEED — {liveThreats?.length ?? 0} events from the configured MISP instance</span>}
              {feedStatus === 'error' && <span className="text-amber-400" title={feedError}>● Live feed unreachable ({feedError}) — showing reference dataset</span>}
              {feedStatus === 'ok' && (liveThreats?.length ?? 0) === 0 &&
                <span className="text-amber-400">● Backend reachable but no MISP instance configured — recent-feed results are empty by design (Settings → Integrations → MISP). Per-indicator lookups below still use OTX.</span>}
            </div>
          )}
          {isDemoMode() && <p className="text-[10px] text-fuchsia-400/70 mt-1 uppercase tracking-wide">Demo Mode — simulated feed data</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CustomizeHint />
          <AddWidgetButton pageKey="threats" defaultLayout={THREATS_LAYOUT} />
          <ResetLayoutButton pageKey="threats" defaultLayout={THREATS_LAYOUT} />
        </div>
      </div>

      {!isDemoMode() && <FeedStatusPanel />}

      <WidgetGrid>
        {/* §6D — Threat Intelligence Relationship Graph (verified evidence only) */}
        <DashboardWidget id="th-graph" title="Threat Relationship Graph" spanOptions={[2, 3]}
          subtitle="Verified evidence links only — indicator ⇄ incident ⇄ asset ⇄ alert">
          <IntelRelationshipGraph threats={baseList} matches={graphMatches} />
        </DashboardWidget>

        <DashboardWidget id="th-lookup" title="IoC Search & Enrichment" spanOptions={[1, 2, 3]}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runLookup(); }}
              placeholder="Search threats, or enter an IP / domain / URL / hash and press Enter for live enrichment…"
              className="w-full pl-10 pr-28 py-2 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm text-[var(--ic-heading)] placeholder-slate-600 focus:outline-none focus:border-cyan-500/50" />
            <button onClick={runLookup} disabled={!search.trim() || lookupBusy}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40">
              {lookupBusy ? 'Looking up…' : 'Enrich IoC'}
            </button>
          </div>
          {isDemoMode() && search.trim() && (
            <p className="text-[10px] text-fuchsia-400/70 mt-2">Demo Mode: enrichment results below are simulated fixtures, not live external intelligence.</p>
          )}
          {lookupErr && (
            <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><AlertOctagon className="w-3.5 h-3.5" /> Lookup failed: {lookupErr}</p>
          )}
          {lookupState && (
            <div className="mt-3 border-t border-[var(--ic-border)] pt-3">
              <p className="text-xs font-semibold text-[var(--ic-heading)] mb-2">
                Enrichment for <code className="font-mono text-cyan-300">{lookupState.ioc}</code> — {lookupState.count} result{lookupState.count === 1 ? '' : 's'}
                {lookupState.count === 0 && <span className="text-[var(--ic-muted)] font-normal"> · no source reported this indicator (absence of intel is shown as-is, never guessed)</span>}
              </p>
              <ul className="space-y-1.5 max-h-48 overflow-auto">
                {lookupState.threats.map((t, i) => {
                  const colors = severityColors[t.severity] ?? severityColors.info;
                  return (
                    <li key={`${t.id}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${colors.bg} ${colors.text}`}>{t.severity}</span>
                      <span className="text-[var(--ic-text)] truncate max-w-[280px]">{t.title}</span>
                      <span className="text-[var(--ic-muted)]">{t.source}</span>
                      <span className="text-[var(--ic-muted)]">confidence {t.confidence}%</span>
                      {(t.mitreAttack ?? []).slice(0, 3).map(m => <span key={m} className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[10px] font-mono">{m}</span>)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </DashboardWidget>

        {!isDemoMode() && <MatchedIndicatorsPanel search={search} />}

        <DashboardWidget id="th-feed" title="Threat Feed" spanOptions={[2, 3]}
          subtitle={`${filtered.length} indicator${filtered.length === 1 ? '' : 's'} — click a row to expand details`}>
          <div className="space-y-3">
            {filtered.map(threat => {
              const colors = severityColors[threat.severity] ?? severityColors.info;
              return (
                <div key={threat.id} className={`bg-[var(--ic-surface-2)] border ${colors.border} rounded-xl overflow-hidden`}>
                  <div className="p-4 cursor-pointer" onClick={() => setExpandedId(expandedId === threat.id ? null : threat.id)}>
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${colors.bg} flex-shrink-0`}>
                        <Target className={`w-5 h-5 ${colors.text}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-[var(--ic-heading)]">{threat.title}</h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${colors.bg} ${colors.text}`}>
                            {threat.severity}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--ic-surface)] text-[var(--ic-muted)]">{threat.source}</span>
                        </div>
                        <p className="text-xs text-[var(--ic-muted)] mt-1">{threat.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--ic-muted)]">
                          <span className="flex items-center gap-1"><Skull className="w-3 h-3" />{threat.iocType ?? 'indicator'}</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(threat.timestamp).toLocaleString()}</span>
                          <span>Confidence: <span className="font-medium text-[var(--ic-text)]">{threat.confidence}%</span></span>
                        </div>
                      </div>
                      {expandedId === threat.id ? <ChevronUp className="w-4 h-4 text-[var(--ic-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--ic-muted)]" />}
                    </div>
                  </div>
                  {expandedId === threat.id && (
                    <div className="px-4 pb-4 border-t border-[var(--ic-border)] pt-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-[var(--ic-surface)]">
                          <p className="text-xs text-[var(--ic-muted)] mb-1">IoC</p>
                          <code className="text-xs text-cyan-300 font-mono break-all">{threat.ioc}</code>
                        </div>
                        <div className="p-3 rounded-lg bg-[var(--ic-surface)]">
                          <p className="text-xs text-[var(--ic-muted)] mb-1">Affected Assets</p>
                          <p className="text-lg font-bold text-[var(--ic-heading)]">{threat.affectedAssets}</p>
                        </div>
                      </div>
                      <div className="mt-3 p-3 rounded-lg bg-[var(--ic-surface)]">
                        <p className="text-xs text-[var(--ic-muted)] mb-2">MITRE ATT&CK</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(threat.mitreAttack ?? []).map(t => (
                            <span key={t} className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs font-mono">{t}</span>
                          ))}
                          {(threat.mitreAttack ?? []).length === 0 && (
                            <span className="text-xs text-[var(--ic-muted)]">No technique mapping provided by the source.</span>
                          )}
                        </div>
                      </div>
                      {/* Cross-page drill-down: does this indicator appear on OUR incidents? */}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <Link to={`/incidents?q=${encodeURIComponent(threat.ioc)}`}
                          className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/25 hover:bg-purple-500/20 flex items-center gap-1.5">
                          <AlertOctagon className="w-3.5 h-3.5" /> Check this IoC against incidents
                        </Link>
                        <Link to="/analytics"
                          className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/20 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" /> View detection trends
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DashboardWidget>

        {/* Catalog widgets added via “Add widget” render here */}
        {AllCatalogEntries()}
      </WidgetGrid>
    </div>
    </WidgetLayoutProvider>
  );
}

export default function ThreatsPage() {
  return <ServiceGate serviceId="threat-intel"><ThreatsContent /></ServiceGate>;
}
