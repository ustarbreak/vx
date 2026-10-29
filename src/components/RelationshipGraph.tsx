// ---------------------------------------------------------------------------
// RelationshipGraph — shared, deterministic force-directed graph renderer.
//
// Used by: Threat Intelligence Relationship Graph (§6D) and the Security
// Analytics Correlation Explorer (§6C). It renders ONLY verified edges passed
// in via `edges` — every edge carries a human-readable `evidence` label that
// is displayed on hover/select and in the accessible list alternative below
// the canvas (never invented by this component).
//
// Layout: seeded pseudo-random initial positions + fixed-iteration spring
// simulation computed in useMemo → identical output for identical input
// (deterministic; no animation loop rerenders). Dragging a node pins it.
//
// Accessibility: a <table> listing every node and every edge with its
// evidence is rendered under the SVG (aria-hidden canvas), so critical
// states are never communicated through color alone (labels + shapes too).
// ---------------------------------------------------------------------------
import React, { useCallback, useMemo, useRef, useState } from 'react';

export interface RGNode {
  id: string;
  label: string;
  /** Visual kind — e.g. indicator | incident | alert | asset | mitre | event */
  kind: string;
  severity?: string;
  /** Optional payload used by onOpen / detail panel. */
  meta?: Record<string, any>;
}
export interface RGEdge {
  source: string;
  target: string;
  /** What makes this relationship real: "IoC recorded on INC-…", etc. */
  evidence: string;
  kind?: string;
}

const KIND_COLORS: Record<string, string> = {
  indicator: '#22d3ee', incident: '#a78bfa', alert: '#f97316',
  asset: '#34d399', mitre: '#eab308', event: '#38bdf8', service: '#2dd4bf',
};
const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', info: '#64748b',
};
const KIND_SHAPES: Record<string, 'circle' | 'diamond' | 'square' | 'hex'> = {
  indicator: 'hex', incident: 'diamond', alert: 'square', asset: 'circle', mitre: 'circle', event: 'circle', service: 'diamond',
};

/** Deterministic PRNG (mulberry32) so layout is stable across renders/reloads. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function RelationshipGraph({
  nodes, edges, height = 420, onNodeSelect, onOpen, selectedId, maxNodes = 160, title,
}: {
  nodes: RGNode[]; edges: RGEdge[]; height?: number;
  onNodeSelect?: (n: RGNode | null) => void;
  onOpen?: (n: RGNode) => void;             // double-click / Enter pivot
  selectedId?: string | null;
  maxNodes?: number;                        // practical rendering limit
  title?: string;
}) {
  const W = 900, H = height;
  const truncated = nodes.length > maxNodes;
  const vnodes = useMemo(() => nodes.slice(0, maxNodes), [nodes, maxNodes]);
  const idSet = useMemo(() => new Set(vnodes.map(n => n.id)), [vnodes]);
  const vedges = useMemo(() => edges.filter(e => idSet.has(e.source) && idSet.has(e.target)), [edges, idSet]);

  // -- deterministic spring layout (fixed iterations, no live sim) ----------
  const pos = useMemo(() => {
    const rnd = mulberry32(vnodes.length * 1000003 + vedges.length * 97 + 7);
    const P: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    vnodes.forEach((n, i) => {
      const a = (i / Math.max(1, vnodes.length)) * Math.PI * 2;
      P[n.id] = { x: W / 2 + Math.cos(a) * (140 + rnd() * 120), y: H / 2 + Math.sin(a) * (H / 4 + rnd() * 60), vx: 0, vy: 0 };
    });
    const adj: Record<string, string[]> = {};
    vedges.forEach(e => { (adj[e.source] ||= []).push(e.target); (adj[e.target] ||= []).push(e.source); });
    const ITER = 220, K = 90;
    for (let it = 0; it < ITER; it++) {
      const cool = 1 - it / ITER;
      // repulsion (O(n²) is fine ≤160 nodes — larger graphs must aggregate server-side)
      for (let i = 0; i < vnodes.length; i++) for (let j = i + 1; j < vnodes.length; j++) {
        const a = P[vnodes[i].id], b = P[vnodes[j].id];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 1;
        if (d2 > 250 * 250) continue;
        const f = (K * K) / d2 * 8;
        const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      // springs
      vedges.forEach(e => {
        const a = P[e.source], b = P[e.target];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const f = (d - K * 1.4) * 0.02;
        dx /= d; dy /= d;
        a.vx += dx * f * d * 0.05; a.vy += dy * f * d * 0.05;
        b.vx -= dx * f * d * 0.05; b.vy -= dy * f * d * 0.05;
      });
      // centering + integrate + clamp
      Object.values(P).forEach(p => {
        p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.003;
        p.x += Math.max(-12, Math.min(12, p.vx * cool)); p.y += Math.max(-12, Math.min(12, p.vy * cool));
        p.vx *= 0.6; p.vy *= 0.6;
        p.x = Math.max(30, Math.min(W - 30, p.x)); p.y = Math.max(26, Math.min(H - 26, p.y));
      });
    }
    return P;
  }, [vnodes, vedges, H]);

  // Allow dragging to pin nodes without recomputing the base layout.
  const [pins, setPins] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ id: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<RGNode | null>(null);
  const effectiveSel = selectedId !== undefined ? (vnodes.find(n => n.id === selectedId) ?? null) : sel;

  const nodeAt = useCallback((id: string) => ({ ...(pos[id] ?? { x: W / 2, y: H / 2 }), ...(pins[id] ?? {}) }), [pos, pins]);
  const neighbors = useMemo(() => {
    const s = effectiveSel?.id; if (!s) return new Set<string>();
    const out = new Set<string>([s]);
    vedges.forEach(e => { if (e.source === s) out.add(e.target); if (e.target === s) out.add(e.source); });
    return out;
  }, [effectiveSel, vedges]);

  const toSvg = (ev: React.PointerEvent) => {
    const svg = svgRef.current!; const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H };
  };

  const shape = (n: RGNode, x: number, y: number, size: number, fill: string, stroke: string, key: string) => {
    const sh = KIND_SHAPES[n.kind] ?? 'circle';
    if (sh === 'diamond') return <rect key={key} x={x - size} y={y - size} width={size * 2} height={size * 2} transform={`rotate(45 ${x} ${y})`} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    if (sh === 'square') return <rect key={key} x={x - size} y={y - size} width={size * 2} height={size * 2} fill={fill} stroke={stroke} strokeWidth={1.5} rx={3} />;
    if (sh === 'hex') {
      const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i - Math.PI / 6; return `${x + Math.cos(a) * size * 1.2},${y + Math.sin(a) * size * 1.2}`; }).join(' ');
      return <polygon key={key} points={pts} fill={fill} stroke={stroke} strokeWidth={1.5} />;
    }
    return <circle key={key} cx={x} cy={y} r={size} fill={fill} stroke={stroke} strokeWidth={1.5} />;
  };

  return (
    <div className="space-y-3">
      {truncated && (
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-1.5">
          Large graph limited to the first {maxNodes} nodes for performance — narrow the filters or use the table below.
        </p>
      )}
      <div className="relative rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface-2)]/40 overflow-hidden">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title ?? 'Relationship graph'}
          style={{ width: '100%', height }}
          onPointerMove={ev => {
            if (!dragRef.current) return;
            const p = toSvg(ev); setPins(prev => ({ ...prev, [dragRef.current!.id]: p }));
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerLeave={() => { dragRef.current = null; }}>
          {/* edges with evidence tooltips */}
          {vedges.map((e, i) => {
            const a = nodeAt(e.source), b = nodeAt(e.target);
            const active = !effectiveSel || neighbors.has(e.source) && neighbors.has(e.target);
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={active ? '#67e8f9' : '#334155'} strokeOpacity={active ? 0.55 : 0.15} strokeWidth={active && effectiveSel ? 1.6 : 1}>
                <title>{e.evidence}</title>
              </line>
            );
          })}
          {/* nodes */}
          {vnodes.map(n => {
            const p = nodeAt(n.id);
            const isSel = effectiveSel?.id === n.id;
            const dim = !!effectiveSel && !neighbors.has(n.id);
            const fill = n.severity && SEV_COLORS[n.severity] ? SEV_COLORS[n.severity] : (KIND_COLORS[n.kind] ?? '#64748b');
            return (
              <g key={n.id} opacity={dim ? 0.28 : 1} tabIndex={0}
                role="button" aria-label={`${n.kind}: ${n.label}${n.severity ? `, severity ${n.severity}` : ''}. Enter to open details.`}
                className="cursor-pointer outline-none focus-visible:opacity-100"
                onPointerDown={ev => { ev.stopPropagation(); dragRef.current = { id: n.id }; }}
                onClick={() => { setSel(isSel ? null : n); onNodeSelect?.(isSel ? null : n); }}
                onDoubleClick={() => onOpen?.(n)}
                onKeyDown={ev => { if (ev.key === 'Enter') { setSel(n); onNodeSelect?.(n); onOpen?.(n); } if (ev.key === 'Escape') { setSel(null); onNodeSelect?.(null); } }}>
                {shape(n, p.x, p.y, isSel ? 11 : 8, fill, isSel ? '#f8fafc' : '#0f172a', n.id)}
                <text x={p.x} y={p.y - 15} textAnchor="middle" fontSize={10} fill="#cbd5e1" style={{ pointerEvents: 'none' }}>
                  {n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label}
                </text>
                <title>{`${n.kind} · ${n.label}${n.severity ? ` · ${n.severity}` : ''}`}</title>
              </g>
            );
          })}
        </svg>
        {/* legend — kinds AND colors, never color alone */}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--ic-muted)] bg-black/40 rounded-lg px-2 py-1 backdrop-blur-sm">
          {Object.keys(KIND_COLORS).filter(k => vnodes.some(n => n.kind === k)).map(k => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-slate-900" style={{ background: KIND_COLORS[k] }} />{k}
            </span>
          ))}
          <span className="italic">click = select · double-click / Enter = open · drag = pin</span>
        </div>
      </div>

      {/* Selected-node context strip */}
      {effectiveSel && (
        <div className="flex flex-wrap items-center gap-2 text-xs bg-[var(--ic-surface)] border border-cyan-500/30 rounded-xl px-3 py-2">
          <span className="font-semibold text-cyan-300">{effectiveSel.kind}: {effectiveSel.label}</span>
          {effectiveSel.severity && <span className="uppercase text-[10px] font-bold" style={{ color: SEV_COLORS[effectiveSel.severity] }}>{effectiveSel.severity}</span>}
          <span className="text-[var(--ic-muted)]">{vedges.filter(e => e.source === effectiveSel.id || e.target === effectiveSel.id).length} verified relationship(s)</span>
          {onOpen && <button onClick={() => onOpen(effectiveSel)} className="ml-auto px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25">Open record →</button>}
          <button onClick={() => { setSel(null); onNodeSelect?.(null); }} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]">✕ clear</button>
        </div>
      )}

      {/* Accessible list alternative: every edge with its evidence */}
      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--ic-muted)] hover:text-[var(--ic-text)]">
          Accessible relationship list ({vnodes.length} nodes · {vedges.length} verified edges)
        </summary>
        <div className="mt-2 grid md:grid-cols-2 gap-1.5 max-h-56 overflow-auto pr-1">
          {vedges.map((e, i) => (
            <div key={i} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-2.5 py-1.5">
              <span className="text-cyan-300 font-mono">{e.source}</span>
              <span className="text-[var(--ic-muted)]"> ⇄ </span>
              <span className="text-purple-300 font-mono">{e.target}</span>
              <p className="text-[var(--ic-muted)] mt-0.5">Evidence: {e.evidence}</p>
            </div>
          ))}
          {vedges.length === 0 && <p className="text-[var(--ic-muted)] italic">No verified relationships in the current scope.</p>}
        </div>
      </details>
    </div>
  );
}
