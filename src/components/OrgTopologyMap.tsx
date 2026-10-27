// ---------------------------------------------------------------------------
// Organizational Infrastructure Topology — Dashboard section.
//
// Renders GET /api/org-topology (backend/app/routers/org_topology.py) as an
// interactive radial hierarchy: Organization → HQ/Branches/Sites → enrolled
// collectors. SEPARATE from the worldwide attack map (WorldAttackMap.tsx):
// this answers "what does my organization look like and is it healthy?".
//
// Honesty rules mirrored from the backend:
//   * Nodes come ONLY from the authenticated payload — nothing is synthesized.
//   * Edges are organizational ownership links. Device-to-device network
//     connectivity is never drawn; when the payload says
//     network_topology_available=false we state it explicitly.
//   * Health badges (healthy/degraded/offline/stale/monitoring_unavailable/
//     unknown) reflect real status + last_seen timestamps only.
//   * Empty payload → honest empty state with a retry action, never fake nodes.
// In Demo Mode orgTopologyApi.get() transparently serves the demo branch of
// demoStore.handle() (fixtures labeled "DEMO MODE" in the payload note).
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Maximize2, RefreshCw, Search, X, ZoomIn, ZoomOut, Building2, Globe2,
  Server, ShieldAlert, Network, MapPinOff,
} from 'lucide-react';
import { orgTopologyApi, OrgTopologyPayload, TopoNode, TopoHealth } from '../services/api';

const HEALTH_COLOR: Record<TopoHealth | 'none', string> = {
  healthy: '#34d399',            // emerald
  degraded: '#fbbf24',           // amber
  stale: '#fb923c',              // orange
  offline: '#f87171',            // red
  monitoring_unavailable: '#64748b', // slate — NOT promoted to healthy
  unknown: '#94a3b8',
  none: '#22d3ee',               // cyan — org/site layers have no collector health
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Healthy', degraded: 'Degraded', stale: 'Stale telemetry',
  offline: 'Offline', monitoring_unavailable: 'Monitoring unavailable',
  unknown: 'Unknown', none: '—',
};

interface Pos { x: number; y: number }

/** Deterministic radial tidy layout computed once per payload/collapse state. */
function computeLayout(
  data: OrgTopologyPayload, collapsed: Set<string>,
): { pos: Map<string, Pos>; bounds: { w: number; h: number } } {
  const childrenOf = new Map<string, string[]>();
  for (const n of data.nodes) {
    if (!n.parent) continue;
    childrenOf.set(n.parent, [...(childrenOf.get(n.parent) ?? []), n.id]);
  }
  const root = data.nodes.find((n) => !n.parent) ?? data.nodes[0];
  const pos = new Map<string, Pos>();
  if (!root) return { pos, bounds: { w: 800, h: 500 } };

  // Count visible leaves under each node (respecting collapse) for spacing.
  const leafCount = (id: string): number => {
    if (collapsed.has(id)) return 1;
    const kids = childrenOf.get(id) ?? [];
    if (!kids.length) return 1;
    return kids.reduce((s, k) => s + leafCount(k), 0);
  };
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const levelGap = 130;
  const unit = 96;

  let cursor = { x: 0, y: 0 };
  const place = (id: string, depth: number, spanStart: number, spanUnits: number) => {
    const node = byId.get(id)!;
    const kids = collapsed.has(id) ? [] : (childrenOf.get(id) ?? []);
    if (!kids.length) {
      pos.set(id, { x: depth * levelGap, y: spanStart + (spanUnits * unit) / 2 });
      return;
    }
    let acc = spanStart;
    let sum = 0;
    for (const k of kids) {
      const lc = leafCount(k);
      place(k, depth + 1, acc, lc);
      acc += lc * unit;
      sum += lc;
    }
    const first = pos.get(kids[0])!, last = pos.get(kids[kids.length - 1])!;
    void node;
    pos.set(id, { x: depth * levelGap, y: (first.y + last.y) / 2 });
  };
  const total = leafCount(root.id) * unit;
  place(root.id, 0, 0, leafCount(root.id));
  cursor = { x: 0, y: 0 }; void cursor;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pos.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
  if (!isFinite(minX)) { minX = 0; maxX = 800; minY = 0; maxY = 500; }
  return { pos, bounds: { w: maxX - minX + 260, h: maxY - minY + 90 } };
}

export default function OrgTopologyMap({ compact = false }: { compact?: boolean }) {
  const nav = useNavigate();
  const [data, setData] = useState<OrgTopologyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | TopoHealth>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    orgTopologyApi.get()
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e: any) => { if (!cancelled) { setError(e?.message ?? 'Unable to load topology'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const { pos, bounds } = useMemo(
    () => (data ? computeLayout(data, collapsed) : { pos: new Map<string, Pos>(), bounds: { w: 800, h: 500 } }),
    [data, collapsed],
  );

  const matches = useCallback((n: TopoNode) => {
    if (query && !`${n.name} ${n.os ?? ''} ${n.ip ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (healthFilter !== 'all') {
      const h = (n.health ?? 'none') as TopoHealth | 'none';
      if (h !== healthFilter) return false;
    }
    return true;
  }, [query, healthFilter]);

  const selectedNode = data?.nodes.find((n) => n.id === selected) ?? null;
  const childIds = useMemo(() => {
    const m = new Map<string, number>();
    data?.nodes.forEach((n) => { if (n.parent) m.set(n.parent, (m.get(n.parent) ?? 0) + 1); });
    return m;
  }, [data]);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const k = Math.min(rect.width / bounds.w, rect.height / bounds.h, 1.4);
    setView({ x: (rect.width - bounds.w * k) / 2 - (Math.min(...[...pos.values()].map((p) => p.x)) - 130) * k, y: (rect.height - bounds.h * k) / 2, k });
  }, [bounds, pos]);

  useEffect(() => { if (data && !loading) fit(); /* refit on new payload */ }, [data, loading, expanded, fit]);

  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(3, Math.max(0.3, v.k * f)) }));

  if (loading) {
    return <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 h-[{compact ? 320 : 480}px] flex items-center justify-center gap-2 text-[var(--ic-muted)] text-sm"><RefreshCw className="w-4 h-4 animate-spin" /> Loading organizational topology…</div>;
  }
  if (error) {
    return (
      <div className="bg-[var(--ic-surface)] border border-red-500/30 rounded-xl p-6 text-center">
        <ShieldAlert className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-[var(--ic-text)]">Topology unavailable: {error}</p>
        <p className="text-xs text-[var(--ic-muted)] mt-1">No data is fabricated while the endpoint fails.</p>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20 inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Retry</button>
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6 text-center">
        <MapPinOff className="w-6 h-6 text-[var(--ic-muted)] mx-auto mb-2" />
        <p className="text-sm text-[var(--ic-text)]">No registered sites or collectors found for your organization.</p>
        <p className="text-xs text-[var(--ic-muted)] mt-1">The topology shows only real organization records — nothing is invented. Register sites in Organization &amp; Settings or enroll a collector.</p>
        <button onClick={() => setRefreshKey((k) => k + 1)} className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300 inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Retry</button>
      </div>
    );
  }

  const height = compact && !expanded ? 340 : 520;
  const edgesVisible = new Set(data.nodes.filter(matches).map((n) => n.id));

  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2 border-b border-[var(--ic-border)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--ic-muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites, assets…" aria-label="Search topology"
            className="pl-8 pr-2 py-1.5 text-xs rounded-lg bg-[#0b1220] border border-[var(--ic-border)] text-[var(--ic-text)] focus:outline-none focus:border-cyan-500/60 w-44" />
        </div>
        <label className="text-[11px] text-[var(--ic-muted)]" htmlFor="topo-health">Health</label>
        <select id="topo-health" value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as any)}
          className="text-xs py-1.5 px-2 rounded-lg bg-[#0b1220] border border-[var(--ic-border)] text-[var(--ic-text)]">
          <option value="all">All</option><option value="healthy">Healthy</option><option value="degraded">Degraded</option>
          <option value="stale">Stale</option><option value="offline">Offline</option>
          <option value="monitoring_unavailable">Monitoring unavailable</option><option value="unknown">Unknown</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => zoom(1.2)} aria-label="Zoom in" className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button onClick={() => zoom(0.8)} aria-label="Zoom out" className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300"><ZoomOut className="w-3.5 h-3.5" /></button>
          <button onClick={fit} aria-label="Fit to view" className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300"><Maximize2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => { setView({ x: 0, y: 0, k: 1 }); setCollapsed(new Set()); setQuery(''); setHealthFilter('all'); }} className="text-[11px] px-2 py-1 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300">Reset</button>
          <button onClick={() => setExpanded((x) => !x)} className="text-[11px] px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/40 text-cyan-300">{expanded ? 'Compact' : 'Expand'}</button>
          <button onClick={() => setRefreshKey((k) => k + 1)} aria-label="Refresh" className="p-1.5 rounded-md border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="relative">
        <svg ref={svgRef} width="100%" height={height} role="img" aria-label="Organizational infrastructure topology"
          className="cursor-grab active:cursor-grabbing select-none" style={{ background: '#0a1120' }}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.08 : 0.92)}
          onMouseDown={(e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; }}
          onMouseMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: drag.current!.ox + e.clientX - drag.current!.sx, y: drag.current!.oy + e.clientY - drag.current!.sy })); }}
          onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
          <defs>
            <pattern id="topo-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M 26 0 L 0 0 0 26" fill="none" stroke="#16233b" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#topo-grid)" />
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {/* Edges: organizational ownership ONLY (cyan solid = org layer, dimmer dashed = collector attach) */}
            {data.edges.map((e, i) => {
              const a = pos.get(e.source), b = pos.get(e.target);
              if (!a || !b) return null;
              const target = data.nodes.find((n) => n.id === e.target);
              const dim = !edgesVisible.has(e.target) || !edgesVisible.has(e.source);
              const isProbe = target?.kind === 'probe';
              return (
                <path key={i} d={`M ${a.x + 130} ${a.y} C ${a.x + 130 + 40} ${a.y}, ${b.x + 130 - 40} ${b.y}, ${b.x + 130} ${b.y}`}
                  fill="none" stroke={isProbe ? '#0e7490' : '#22d3ee'} strokeOpacity={dim ? 0.12 : isProbe ? 0.5 : 0.75}
                  strokeWidth={isProbe ? 1.2 : 1.8} strokeDasharray={isProbe ? '4 4' : undefined} />
              );
            })}
            {/* Nodes */}
            {data.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const dim = !edgesVisible.has(n.id);
              const x = p.x + 130, y = p.y;
              const isOrgLayer = n.kind !== 'probe';
              const color = HEALTH_COLOR[(n.health ?? 'none') as keyof typeof HEALTH_COLOR] ?? HEALTH_COLOR.none;
              const sel = selected === n.id;
              const kidCount = childIds.get(n.id) ?? 0;
              return (
                <g key={n.id} transform={`translate(${x},${y})`} opacity={dim ? 0.3 : 1}
                  onClick={(ev) => { ev.stopPropagation(); setSelected(sel ? null : n.id); }}
                  style={{ cursor: 'pointer' }} tabIndex={0} role="button"
                  aria-label={`${n.name}${n.health ? `, ${HEALTH_LABEL[n.health]}` : ''}`}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelected(sel ? null : n.id); } }}>
                  {n.kind === 'hq' || (isOrgLayer && n.org_type === 'HQ') ? (
                    <rect x={-56} y={-16} width={112} height={32} rx={8} fill="#0e2a3a" stroke="#22d3ee" strokeWidth={sel ? 2.4 : 1.4} />
                  ) : isOrgLayer ? (
                    <rect x={-52} y={-14} width={104} height={28} rx={7} fill="#101c30" stroke={sel ? '#22d3ee' : '#2b3f5c'} strokeWidth={sel ? 2.2 : 1.2} />
                  ) : (
                    <ellipse cx={0} cy={0} rx={46} ry={13} fill="#0c1626" stroke={sel ? '#22d3ee' : color} strokeWidth={sel ? 2.2 : 1.3} strokeDasharray={n.health === 'monitoring_unavailable' ? '3 3' : undefined} />
                  )}
                  <text x={0} y={4} textAnchor="middle" fontSize={10.5} fill="#dbe7f3" style={{ pointerEvents: 'none' }}>
                    {n.name.length > 18 ? `${n.name.slice(0, 17)}…` : n.name}
                  </text>
                  {isOrgLayer && (
                    <>
                      <circle cx={-58} cy={-10} r={3.4} fill={color} stroke="#0a1120" strokeWidth={1} />
                      {(n.related_incidents ?? 0) > 0 && (
                        <g>
                          <circle cx={58} cy={-10} r={8} fill="#7f1d1d" stroke="#f87171" strokeWidth={1} />
                          <text x={58} y={-7} textAnchor="middle" fontSize={9} fill="#fecaca">{n.related_incidents}</text>
                        </g>
                      )}
                      {kidCount > 0 && (
                        <g onClick={(ev) => { ev.stopPropagation(); setCollapsed((c) => { const nc = new Set(c); if (nc.has(n.id)) nc.delete(n.id); else nc.add(n.id); return nc; }); }}
                          style={{ cursor: 'pointer' }} role="button" aria-label={collapsed.has(n.id) ? 'Expand group' : 'Collapse group'}>
                          <circle cx={62} cy={12} r={7} fill="#122138" stroke="#2b3f5c" />
                          <text x={62} y={15} textAnchor="middle" fontSize={9} fill="#7dd3fc">{collapsed.has(n.id) ? '+' : '−'}</text>
                        </g>
                      )}
                    </>
                  )}
                  {!isOrgLayer && n.health && n.health !== 'healthy' && (
                    <text x={0} y={24} textAnchor="middle" fontSize={8.5} fill={color}>{HEALTH_LABEL[n.health]}</text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Node detail panel */}
        {selectedNode && (
          <aside className="absolute right-2 top-2 bottom-2 w-64 bg-[#0d1830]/95 backdrop-blur border border-[var(--ic-border)] rounded-xl p-3 overflow-y-auto" aria-label="Node details">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {selectedNode.kind === 'probe' ? <Server className="w-4 h-4 text-cyan-300" />
                  : selectedNode.kind === 'hq' || selectedNode.org_type === 'HQ' ? <Building2 className="w-4 h-4 text-cyan-300" />
                  : <Globe2 className="w-4 h-4 text-cyan-300" />}
                <h4 className="text-xs font-semibold text-[var(--ic-heading)] break-words">{selectedNode.name}</h4>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close details" className="text-[var(--ic-muted)] hover:text-cyan-300"><X className="w-3.5 h-3.5" /></button>
            </div>
            <dl className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Entity type</dt><dd className="text-[var(--ic-text)]">{selectedNode.kind}{selectedNode.org_type ? ` (${selectedNode.org_type})` : ''}</dd></div>
              {selectedNode.parent && (() => { const par = data.nodes.find((n) => n.id === selectedNode.parent); return <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Parent</dt><dd className="text-[var(--ic-text)] text-right">{par?.name ?? selectedNode.parent}</dd></div>; })()}
              {selectedNode.country && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Country</dt><dd className="text-[var(--ic-text)]">{selectedNode.country}</dd></div>}
              {selectedNode.asset_count != null && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Assets</dt><dd className="text-[var(--ic-text)]">{selectedNode.asset_count}</dd></div>}
              {selectedNode.kind === 'probe' && (
                <>
                  <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Health</dt>
                    <dd className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: HEALTH_COLOR[(selectedNode.health ?? 'none') as keyof typeof HEALTH_COLOR] }} />{HEALTH_LABEL[selectedNode.health ?? 'unknown']}</dd></div>
                  <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Last heartbeat</dt><dd className="text-[var(--ic-text)]">{selectedNode.last_seen ? new Date(selectedNode.last_seen).toLocaleString() : 'never recorded'}</dd></div>
                  {selectedNode.agent_version && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Agent version</dt><dd className="text-[var(--ic-text)]">{selectedNode.agent_version}</dd></div>}
                  {selectedNode.os && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">OS</dt><dd className="text-[var(--ic-text)]">{selectedNode.os}</dd></div>}
                  {selectedNode.ip && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">IP (authorized)</dt><dd className="text-[var(--ic-text)] font-mono">{selectedNode.ip}</dd></div>}
                </>
              )}
              {selectedNode.site_status && <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Site status</dt><dd className="text-[var(--ic-text)]">{selectedNode.site_status}</dd></div>}
              {selectedNode.related_incidents != null && selectedNode.kind !== 'probe' && (
                <div className="flex justify-between"><dt className="text-[var(--ic-muted)]">Open incidents</dt><dd className={selectedNode.related_incidents > 0 ? 'text-red-400 font-semibold' : 'text-emerald-400'}>{selectedNode.related_incidents}</dd></div>
              )}
            </dl>
            <div className="mt-3 space-y-1.5">
              {selectedNode.kind === 'probe' && /^\d+$/.test(selectedNode.id.split(':')[1]) && (
                <button onClick={() => nav(`/client-admin/monitored-devices?probe=${selectedNode.id.split(':')[1]}`)}
                  className="w-full text-[11px] px-2 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/20">Open device / collector view</button>
              )}
              {selectedNode.kind !== 'probe' && (selectedNode.related_incidents ?? 0) > 0 && (
                <button onClick={() => nav('/client-admin/alerts')} className="w-full text-[11px] px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/40 text-red-300 hover:bg-red-500/20 inline-flex items-center justify-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> View related incidents</button>
              )}
              <button onClick={() => nav('/client-admin/infrastructure')} className="w-full text-[11px] px-2 py-1.5 rounded-lg border border-[var(--ic-border)] text-[var(--ic-muted)] hover:text-cyan-300 inline-flex items-center justify-center gap-1.5"><Network className="w-3.5 h-3.5" /> Full infrastructure map</button>
            </div>
          </aside>
        )}
      </div>

      {/* Legend + honesty notes */}
      <div className="px-4 py-2.5 border-t border-[var(--ic-border)] flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[var(--ic-muted)]">
        {(['healthy', 'degraded', 'stale', 'offline', 'monitoring_unavailable', 'unknown'] as TopoHealth[]).map((h) => (
          <span key={h} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: HEALTH_COLOR[h] }} aria-hidden />{HEALTH_LABEL[h]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="w-4 border-t-2 border-cyan-400" aria-hidden />Ownership link</span>
        <span className="inline-flex items-center gap-1"><span className="w-4 border-t border-dashed border-cyan-700" aria-hidden />Collector attach</span>
        <span title={data.note}>ⓘ {data.network_topology_available ? 'Network links shown' : 'Network topology incomplete — ownership links only'} · updated {new Date(data.generated_at).toLocaleTimeString()}</span>
        {!data.hq_configured && <span className="text-amber-400">Headquarters not configured</span>}
      </div>
    </div>
  );
}
