// ---------------------------------------------------------------------------
// Worldwide Attack Map — Dashboard threat visualization.
//
// Basemap: bundled static world geometry (src/data/worldGeometry.ts, Natural
// Earth country polygons projected to equirectangular SVG). NO CDN, no tiles,
// works offline. The geometry is purely decorative context — attack events are
// NEVER hardcoded here.
//
// Events: fetched through attackMapApi.get() → GET /api/security/attack-map.
//   * Production mode  → real SIEM-ingested alerts with geographic context.
//   * Demo Mode        → demoStore's 'security/attack-map' branch (fixtures
//     live only there; this component never embeds sample events itself).
// Honesty rules mirrored from the backend: geo-only events, approximate
// geolocation disclaimer, classification separates observed telemetry from
// malicious-classified and confirmed attacks, honest empty state showing the
// last successful ingestion time instead of fabricated activity.
// Interactions: zoom (wheel/buttons), pan (drag), hover details, click event
// row → incident drill-down handled by the parent via onSelectEvent.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, RefreshCw, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';
import WORLD_GEOMETRY from '../data/worldGeometry';
import { attackMapApi, AttackMapEvent, AttackMapPayload } from '../services/api';

const SEV_COLOR: Record<string, string> = {
  critical: '#f43f5e', high: '#fb923c', medium: '#facc15', low: '#38bdf8', info: '#64748b',
};
const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const W = WORLD_GEOMETRY.w, H = WORLD_GEOMETRY.h;

/** Equirectangular projection shared with the basemap generator. */
function project(lat: number | null | undefined, lon: number | null | undefined): [number, number] | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [((lon + 180) / 360) * W, ((90 - lat) / 360) * H * 2];
}

interface View { x: number; y: number; k: number }
const clampView = (v: View): View => {
  const k = Math.min(8, Math.max(1, v.k));
  const maxX = (W * (k - 1)) / 2 + 40, maxY = (H * (k - 1)) / 2 + 40;
  return { k, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
};

export interface WorldAttackMapProps {
  /** Extra filters forwarded to the API (time window etc.). */
  filters?: { start_time?: string; end_time?: string; severity?: string; event_type?: string; source_country?: string; destination_country?: string };
  onSelectEvent?: (e: AttackMapEvent) => void;
  heightClass?: string; // e.g. "h-[420px]"
}

interface Cluster { x: number; y: number; count: number; sev: string; events: AttackMapEvent[] }

/** Simple grid clustering in projected space — active when points are dense. */
function clusterPoints(events: AttackMapEvent[], cell: number): Cluster[] {
  const cells = new Map<string, Cluster>();
  for (const e of events) {
    const pt = project(e.dst?.lat ?? e.src?.lat, e.dst?.lon ?? e.src?.lon);
    if (!pt) continue;
    const key = `${Math.floor(pt[0] / cell)}:${Math.floor(pt[1] / cell)}`;
    const c = cells.get(key) ?? { x: pt[0], y: pt[1], count: 0, sev: 'info', events: [] };
    c.events.push(e); c.count += e.count;
    if (SEV_RANK[e.severity] > SEV_RANK[c.sev]) c.sev = e.severity;
    cells.set(key, c);
  }
  return [...cells.values()];
}

export default function WorldAttackMap({ filters, onSelectEvent, heightClass = 'h-[380px]' }: WorldAttackMapProps) {
  const [data, setData] = useState<AttackMapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<{ ev: AttackMapEvent; x: number; y: number } | null>(null);
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [clsFilter, setClsFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);

  const filterKey = JSON.stringify(filters ?? {});
  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const payload = await attackMapApi.get(filters ?? {});
      setData(payload);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message ?? 'Attack map data unavailable');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => { load(); }, [load]);
  // Polling refresh (this product has no WebSocket channel — we do NOT claim
  // real-time; the UI shows the last successful refresh instead).
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const events = useMemo(() => {
    let list = data?.events ?? [];
    if (sevFilter !== 'all') list = list.filter(e => e.severity === sevFilter);
    if (clsFilter !== 'all') list = list.filter(e => e.classification === clsFilter);
    return list;
  }, [data, sevFilter, clsFilter]);

  const arcs = useMemo(() => events.map((e, i) => {
    const a = project(e.src?.lat, e.src?.lon);
    const b = project(e.dst?.lat, e.dst?.lon);
    if (!a || !b) return null;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lift = Math.min(90, dist * 0.35);
    return { d: `M${a[0]},${a[1]} Q${mx},${my - lift} ${b[0]},${b[1]}`, color: SEV_COLOR[e.severity] ?? SEV_COLOR.info, delay: (i % 6) * 0.45, dur: 2.6 + (i % 4) * 0.4, id: e.id };
  }).filter(Boolean) as { d: string; color: string; delay: number; dur: number; id: number }[], [events]);

  const clusters = useMemo(() => clusterPoints(events, 26 / view.k), [events, view.k]);
  const srcOnlyMarkers = useMemo(() => {
    // endpoints that exist only as sources (so origin markers stay visible)
    const dstKeys = new Set(events.filter(e => e.dst).map(e => `${e.dst!.lat?.toFixed(2)},${e.dst!.lon?.toFixed(2)}`));
    return events.filter(e => e.src && !dstKeys.has(`${e.src.lat?.toFixed(2)},${e.src.lon?.toFixed(2)}`));
  }, [events]);

  const fmt = (d?: Date | string | null) => d ? new Date(d).toLocaleString(undefined, { hour12: false }) : '—';
  const staleMin = lastRefresh ? Math.round((Date.now() - lastRefresh.getTime()) / 60000) : null;

  const onWheel = (ev: React.WheelEvent) => {
    const factor = ev.deltaY < 0 ? 1.25 : 0.8;
    setView(v => clampView({ ...v, k: v.k * factor }));
  };
  const onPointerDown = (ev: React.PointerEvent) => {
    dragRef.current = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = svgWrapRef.current?.getBoundingClientRect();
    const scale = rect ? W / rect.width : 1;
    setView(v => clampView({ ...v, x: d.vx + (ev.clientX - d.sx) * scale, y: d.vy + (ev.clientY - d.sy) * scale }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const rankedCountries = useMemo(() => {
    const m = new Map<string, { count: number; worst: string }>();
    for (const e of events) {
      const c = e.src?.country;
      if (!c) continue;
      const cur = m.get(c) ?? { count: 0, worst: 'info' };
      cur.count += e.count;
      if (SEV_RANK[e.severity] > SEV_RANK[cur.worst]) cur.worst = e.severity;
      m.set(c, cur);
    }
    return [...m.entries()].sort((a, z) => z[1].count - a[1].count).slice(0, 6);
  }, [events]);

  return (
    <div className={`bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden ${expanded ? 'fixed inset-3 z-50 shadow-2xl flex flex-col' : ''}`}>
      <style>{`
        @keyframes ic-arc-flow { to { stroke-dashoffset: -240; } }
        @keyframes ic-pulse-ring { 0% { r: 3; opacity: .9; } 70% { r: 11; opacity: 0; } 100% { r: 11; opacity: 0; } }
        .ic-anim-off .ic-arc { animation: none !important; }
        @media (prefers-reduced-motion: reduce) { .ic-arc { animation: none !important; } }
      `}</style>

      {/* Header: title + filters + refresh */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--ic-border)]">
        <Globe2 className="w-4 h-4 text-cyan-400" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--ic-heading)]">Worldwide Threat Map</h3>
        <span className="text-[10px] uppercase tracking-wide text-[var(--ic-muted)] border border-[var(--ic-border)] rounded px-1.5 py-0.5">geolocation approximate</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ic-map-sev">Severity filter</label>
          <select id="ic-map-sev" value={sevFilter} onChange={e => setSevFilter(e.target.value)}
            className="bg-[var(--ic-bg)] border border-[var(--ic-border)] rounded-md text-xs px-2 py-1 text-[var(--ic-text)]">
            <option value="all">All severities</option>
            {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="sr-only" htmlFor="ic-map-cls">Classification filter</label>
          <select id="ic-map-cls" value={clsFilter} onChange={e => setClsFilter(e.target.value)}
            className="bg-[var(--ic-bg)] border border-[var(--ic-border)] rounded-md text-xs px-2 py-1 text-[var(--ic-text)]">
            <option value="all">All classes</option>
            <option value="observed">Observed</option>
            <option value="malicious">Malicious</option>
            <option value="confirmed">Confirmed</option>
          </select>
          <button onClick={() => setView(v => clampView({ ...v, k: v.k * 1.3 }))} title="Zoom in" aria-label="Zoom in"
            className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-400"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button onClick={() => setView(v => clampView({ ...v, k: v.k / 1.3 }))} title="Zoom out" aria-label="Zoom out"
            className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-400"><ZoomOut className="w-3.5 h-3.5" /></button>
          <button onClick={load} title="Refresh data" aria-label="Refresh data"
            className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-400"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={() => setExpanded(x => !x)} title={expanded ? 'Collapse' : 'Expand'} aria-label={expanded ? 'Collapse map' : 'Expand map'}
            className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-400">{expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
        </div>
      </div>

      <div className={`grid ${expanded ? 'lg:grid-cols-[1fr_320px]' : 'lg:grid-cols-[1fr_260px]'} flex-1 min-h-0`}>
        {/* Map canvas */}
        <div ref={svgWrapRef} className={`relative bg-[#060b16] ${expanded ? 'flex-1' : heightClass}`}>
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 gap-2">
              <Globe2 className="w-8 h-8 text-[var(--ic-muted)] opacity-40" />
              <p className="text-sm text-cyber-red max-w-md">{error}</p>
              <p className="text-xs text-[var(--ic-muted)]">The map integration is unavailable — no data was invented to fill it.</p>
              <button onClick={load} className="mt-2 text-xs px-3 py-1.5 rounded-md border border-[var(--ic-border)] text-cyan-400 hover:border-cyan-400">Retry</button>
            </div>
          ) : (
            <svg viewBox={`${W / 2 - W / (2 * view.k) + view.x / view.k} ${H / 2 - H / (2 * view.k) + view.y / view.k} ${W / view.k} ${H / view.k}`}
              className="w-full h-full cursor-grab touch-none select-none" role="img"
              aria-label={`Worldwide threat map with ${events.length} geolocated security events`}
              onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
              <defs>
                <radialGradient id="ic-ocean" cx="50%" cy="40%" r="80%">
                  <stop offset="0%" stopColor="#0a1428" /><stop offset="100%" stopColor="#050a14" />
                </radialGradient>
              </defs>
              <rect x="-200" y="-200" width={W + 400} height={H + 400} fill="url(#ic-ocean)" />
              {/* graticule */}
              <g stroke="#12203a" strokeWidth={0.6 / view.k} opacity={0.7}>
                {[...Array(17)].map((_, i) => <line key={`v${i}`} x1={i * (W / 16)} y1={0} x2={i * (W / 16)} y2={H} />)}
                {[...Array(9)].map((_, i) => <line key={`h${i}`} x1={0} y1={i * (H / 8)} x2={W} y2={i * (H / 8)} />)}
              </g>
              {/* bundled country geometry */}
              <g fill="#10203a" stroke="#1d3a5c" strokeWidth={0.5 / view.k}>
                {WORLD_GEOMETRY.countries.map(c => <path key={c.n} d={c.d}><title>{c.n}</title></path>)}
              </g>
              {/* animated origin→target arcs (only real/demomode API events) */}
              <g fill="none" strokeLinecap="round">
                {arcs.map(a => (
                  <path key={a.id} className="ic-arc" d={a.d} stroke={a.color} strokeWidth={1.4 / Math.sqrt(view.k)} opacity={0.75}
                    strokeDasharray="6 14" style={{ animation: `ic-arc-flow ${a.dur}s linear infinite`, animationDelay: `${a.delay}s` }} />
                ))}
              </g>
              {/* target clusters (severity-colored, pulse ring on top severity) */}
              {clusters.map((c, i) => (
                <g key={i} transform={`translate(${c.x},${c.y})`} onMouseEnter={() => c.events[0] && setHover({ ev: c.events[0], x: c.x, y: c.y })}
                  onMouseLeave={() => setHover(null)} onClick={() => c.events[0] && onSelectEvent?.(c.events[0])} className="cursor-pointer">
                  {(c.sev === 'critical' || c.sev === 'high') && (
                    <circle r={3} fill="none" stroke={SEV_COLOR[c.sev]} strokeWidth={1 / view.k} style={{ animation: 'ic-pulse-ring 2.4s ease-out infinite' }} />
                  )}
                  <circle r={Math.min(9, 2.6 + Math.log2(c.count + 1) * 1.7) / Math.sqrt(view.k)} fill={SEV_COLOR[c.sev]} opacity={0.9} />
                  {c.count > 1 && <text fontSize={7 / view.k} dy={-6 / Math.sqrt(view.k)} textAnchor="middle" fill="#e2e8f0" style={{ pointerEvents: 'none' }}>{c.count}</text>}
                </g>
              ))}
              {/* origin-only markers (hollow = source, approximate) */}
              {srcOnlyMarkers.map(e => {
                const p = project(e.src!.lat, e.src!.lon);
                if (!p) return null;
                return <circle key={`s${e.id}`} cx={p[0]} cy={p[1]} r={2.4 / Math.sqrt(view.k)} fill="none" stroke={SEV_COLOR[e.severity] ?? SEV_COLOR.info} strokeWidth={1 / view.k} opacity={0.8}><title>{`${e.src!.country ?? '?'} → origin (approx.)`}</title></circle>;
              })}
              {hover && (
                <g transform={`translate(${Math.min(hover.x + 8, W - 210)},${Math.max(hover.y - 44, 8)})`} style={{ pointerEvents: 'none' }}>
                  <rect width={200} height={46} rx={6} fill="#0b1527" stroke="#1d3a5c" />
                  <text x={8} y={16} fontSize={9} fill="#e2e8f0">{hover.ev.title.slice(0, 42)}</text>
                  <text x={8} y={30} fontSize={8} fill="#7dd3fc">{hover.ev.severity.toUpperCase()} • {hover.ev.classification} • ×{hover.ev.count}</text>
                  <text x={8} y={41} fontSize={7.5} fill="#94a3b8">{(hover.ev.src?.country ?? '?')} → {(hover.ev.dst?.country ?? 'local')} • {fmt(hover.ev.timestamp)}</text>
                </g>
              )}
            </svg>
          )}
          {/* legend */}
          <div className="absolute left-3 bottom-3 flex flex-wrap gap-2 text-[10px] text-[var(--ic-muted)] bg-[#0b1527]/80 border border-[var(--ic-border)] rounded-md px-2 py-1 backdrop-blur">
            {Object.entries(SEV_COLOR).filter(([k]) => k !== 'info').map(([k, c]) => (
              <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />{k}</span>
            ))}
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block border border-orange-400" />origin (approx.)</span>
          </div>
          {loading && !data && <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--ic-muted)]"><RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading security events…</div>}
        </div>

        {/* Side panel: status + ranked sources + accessible list */}
        <div className="border-t lg:border-t-0 lg:border-l border-[var(--ic-border)] p-3 space-y-3 overflow-y-auto max-h-[420px]">
          <div className="text-[11px] text-[var(--ic-muted)] space-y-0.5">
            <p>Last refresh: <span className="text-[var(--ic-text)]">{lastRefresh ? fmt(lastRefresh) : 'never'}</span>{staleMin != null && staleMin >= 2 && <span className="text-amber-400"> · {staleMin} min ago</span>}</p>
            <p>Data source: <span className="text-[var(--ic-text)]">GET /api/security/attack-map</span> (polled every 60 s — not real-time)</p>
            {data?.note && <p className="italic leading-snug">{data.note}</p>}
          </div>

          {rankedCountries.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--ic-heading)] mb-1">Top source regions</p>
              <ul className="space-y-1">
                {rankedCountries.map(([c, v]) => (
                  <li key={c} className="flex items-center justify-between text-[11px] text-[var(--ic-muted)]">
                    <span>{c}</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: SEV_COLOR[v.worst] }} />{v.count} events</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-[var(--ic-heading)] mb-1">Events ({events.length})</p>
            {events.length === 0 ? (
              <p className="text-[11px] text-[var(--ic-muted)] leading-relaxed">
                No geolocated events{data && data.events.length > 0 ? ' match the current filters' : ''} — last ingestion{' '}
                <span className="text-[var(--ic-text)]">{fmt(data?.last_ingestion_at)}</span>.
                {!loading && ' This is the actual state of the feed; nothing is simulated.'}
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {events.slice(0, 30).map(e => (
                  <li key={e.uid}>
                    <button onClick={() => onSelectEvent?.(e)}
                      className="w-full text-left rounded-md border border-[var(--ic-border)] bg-[var(--ic-bg)] px-2 py-1.5 hover:border-cyan-500/50">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SEV_COLOR[e.severity] ?? SEV_COLOR.info }} />
                        <span className="text-[11px] text-[var(--ic-text)] truncate">{e.title}</span>
                      </div>
                      <div className="text-[10px] text-[var(--ic-muted)] mt-0.5">
                        {(e.src?.country ?? '?')} → {(e.dst?.country ?? 'tenant')} · {e.classification} · ×{e.count} · {fmt(e.timestamp)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
