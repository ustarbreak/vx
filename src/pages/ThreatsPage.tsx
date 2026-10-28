import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Skull, AlertOctagon, Clock, ChevronDown, ChevronUp, Target, Radar, Plug, PlugZap, Database, ExternalLink } from 'lucide-react';
import { mockThreats } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';
import {
  isDemoMode, fetchLiveThreats, fetchIndicatorMatches, fetchFeedsStatus, lookupIoc,
  type LiveThreat, type IndicatorMatch, type FeedsStatusResponse,
} from '../services/threatIntel';

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
    <div className="p-4 lg:p-6 space-y-6">
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

      {!isDemoMode() && <FeedStatusPanel />}

      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
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
      </div>

      {!isDemoMode() && <MatchedIndicatorsPanel search={search} />}

      <div className="space-y-3">
        {filtered.map(threat => {
          const colors = severityColors[threat.severity] ?? severityColors.info;
          return (
            <div key={threat.id} className={`bg-[var(--ic-surface)] border ${colors.border} rounded-xl overflow-hidden`}>
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
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--ic-surface-2)] text-[var(--ic-muted)]">{threat.source}</span>
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
    </div>
  );
}

export default function ThreatsPage() {
  return <ServiceGate serviceId="threat-intel"><ThreatsContent /></ServiceGate>;
}
