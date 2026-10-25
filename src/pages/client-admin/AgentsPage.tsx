import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MonitorSmartphone, Plus, RefreshCw, Trash2, X, Copy, CheckCircle,
  Server, Wifi, Cpu, HardDrive, Package, Clock, Search, Eye, KeyRound, AlertTriangle,
} from 'lucide-react';
import {
  agentApi, agentInstallCommands, ApiError,
  AgentProbeOut, AgentTokenOut, AgentInventoryOut, AgentMetricPoint, AgentDiscoveredDeviceOut,
} from '../../services/api';

// ---------------------------------------------------------------------------
// goinfra — Collection Agents management (client admin)
//   Tab 1: Fleet            — probes, online/offline pulse, detail drawer
//   Tab 2: Tokens           — enrollment tokens + copy-paste install commands
//   Tab 3: Discovered       — devices seen by probe network sweeps
// Backend: /api/agents/* (JWT reads), /api/agent-tokens (CRUD)
// ---------------------------------------------------------------------------

const fmtBytes = (n?: number | null): string => {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

const timeAgo = (iso: string | null): string => {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fmtTime = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/** Small inline SVG sparkline for metric series. */
const Sparkline: React.FC<{
  label: string; points: { ts: number; v: number }[]; color: string; max?: number; unit?: string;
}> = ({ label, points, color, max, unit = '%' }) => {
  const W = 260, H = 56, PAD = 2;
  const vals = points.map(p => p.v);
  const hi = max ?? Math.max(1, ...vals);
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const stepX = (W - PAD * 2) / (points.length - 1);
    return points
      .map((p, i) => {
        const x = PAD + i * stepX;
        const y = H - PAD - (Math.min(p.v, hi) / hi) * (H - PAD * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, hi]);
  const last = vals.length ? vals[vals.length - 1] : null;
  return (
    <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[var(--ic-muted)]">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>
          {last === null ? '—' : `${last.toFixed(1)}${unit}`}
        </span>
      </div>
      <svg width={W} height={H} className="block w-full">
        {path ? (
          <>
            <path d={`${path} L${W - PAD},${H - PAD} L${PAD},${H - PAD} Z`} fill={color} opacity={0.12} />
            <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
          </>
        ) : (
          <text x={W / 2} y={H / 2} fill="var(--ic-muted)" fontSize={10} textAnchor="middle">no data yet</text>
        )}
      </svg>
    </div>
  );
};

const OsIcon: React.FC<{ os: string }> = ({ os }) => (
  os === 'windows'
    ? <MonitorSmartphone size={14} className="text-sky-400" />
    : <Server size={14} className="text-emerald-400" />
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const online = status === 'online';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${
      online
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
    }`}>
      <span className="relative flex h-2 w-2">
        {online && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${online ? 'bg-emerald-400' : 'bg-rose-500'}`} />
      </span>
      {online ? 'Online' : 'Offline'}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Detail drawer — inventory + sparklines
// ---------------------------------------------------------------------------
const ProbeDrawer: React.FC<{ probe: AgentProbeOut; onClose: () => void }> = ({ probe, onClose }) => {
  const [inv, setInv] = useState<AgentInventoryOut | null>(null);
  const [metrics, setMetrics] = useState<AgentMetricPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.allSettled([
      agentApi.latestInventory(probe.id),
      agentApi.metrics(probe.id, 24),
    ]).then(([invRes, metRes]) => {
      if (!alive) return;
      if (invRes.status === 'fulfilled') setInv(invRes.value);
      else if (invRes.reason instanceof ApiError && invRes.reason.status !== 404) setErr(invRes.reason.message);
      if (metRes.status === 'fulfilled') setMetrics(metRes.value);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [probe.id]);

  const p = inv?.payload ?? {};
  const series = (key: keyof AgentMetricPoint, max?: number) =>
    metrics.filter(m => (m[key] as number | null) !== null && m[key] !== undefined)
      .map(m => ({ ts: m.ts, v: Number(m[key]) })).slice(-180);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full overflow-y-auto bg-[var(--ic-bg)] border-l border-[var(--ic-border)] shadow-2xl">
        <div className="sticky top-0 z-10 bg-[var(--ic-bg)]/95 backdrop-blur border-b border-[var(--ic-border)] px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <OsIcon os={probe.os} />
              <h2 className="text-lg font-bold text-[var(--ic-text)]">{probe.hostname}</h2>
              <StatusBadge status={probe.status} />
            </div>
            <p className="text-xs text-[var(--ic-muted)] mt-1">
              Probe #{probe.id} · {probe.ip || '—'} · goinfra v{probe.agent_version} · last seen {timeAgo(probe.last_seen)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--ic-surface)] text-[var(--ic-muted)]"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          {loading && <p className="text-sm text-[var(--ic-muted)] animate-pulse">Loading telemetry…</p>}
          {err && <p className="text-sm text-rose-400">{err}</p>}

          {/* Live metrics sparklines */}
          {!loading && (
            <section>
              <h3 className="text-sm font-bold text-[var(--ic-text)] mb-2 flex items-center gap-2"><Cpu size={14} className="text-cyan-400" /> Last 24 hours</h3>
              <div className="grid grid-cols-2 gap-3">
                <Sparkline label="CPU %" points={series('cpu_percent')} color="#22d3ee" max={100} />
                <Sparkline label="Memory %" points={series('mem_used_percent')} color="#a78bfa" max={100} />
                <Sparkline label="Disk worst %" points={series('disk_worst_percent')} color="#f59e0b" max={100} />
                <Sparkline label="Load 1" points={series('load1')} color="#34d399" unit="" />
                <Sparkline label="Net recv KB/s" points={series('net_recv_bps').map(s => ({ ...s, v: s.v / 1024 }))} color="#60a5fa" unit=' KB/s' />
                <Sparkline label="Net sent KB/s" points={series('net_sent_bps').map(s => ({ ...s, v: s.v / 1024 }))} color="#f472b6" unit=' KB/s' />
              </div>
            </section>
          )}

          {/* Latest inventory */}
          {!loading && !inv && !err && (
            <div className="text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-400" /> No inventory collected yet — first snapshot arrives within ~5 min of enrollment.
            </div>
          )}
          {!loading && inv && (
            <>
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[var(--ic-text)] flex items-center gap-2"><Server size={14} className="text-emerald-400" /> Inventory</h3>
                  <span className="text-xs text-[var(--ic-muted)] flex items-center gap-1"><Clock size={11} /> collected {timeAgo(inv.collected_at)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Platform', p.platform ?? '—'], ['Kernel / build', p.kernel ?? '—'],
                    ['CPU', `${p.cpu?.model ?? '—'} (${p.cpu?.cores ?? '?'} cores)`], ['CPU usage', p.cpu?.percent !== undefined ? `${p.cpu.percent.toFixed(0)}%` : '—'],
                    ['RAM', `${fmtBytes(p.memory?.total_bytes)} total`], ['RAM usage', p.memory?.percent !== undefined ? `${p.memory.percent.toFixed(0)}%` : '—'],
                    ['Addresses', (p.ips ?? []).join(', ') || '—'],
                  ].map(([k, v]) => (
                    <div key={k as string} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2">
                      <div className="text-[var(--ic-muted)]">{k}</div><div className="font-semibold text-[var(--ic-text)] break-all">{v}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-bold text-[var(--ic-text)] mb-2 flex items-center gap-2"><HardDrive size={14} className="text-amber-400" /> Disks</h3>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[var(--ic-muted)]">
                    <th className="py-1 pr-2">Mount</th><th className="pr-2">Device</th><th className="pr-2">Size</th><th className="pr-2">Used</th><th>%</th>
                  </tr></thead>
                  <tbody>
                    {(p.disks ?? []).map((d, i) => (
                      <tr key={i} className="border-t border-[var(--ic-border)]">
                        <td className="py-1.5 pr-2 font-mono">{d.mount}</td>
                        <td className="pr-2 font-mono text-[var(--ic-muted)]">{d.device}</td>
                        <td className="pr-2">{fmtBytes(d.total_bytes)}</td>
                        <td className="pr-2">{fmtBytes(d.used_bytes)}</td>
                        <td className={`font-bold ${(d.percent ?? 0) > 90 ? 'text-rose-400' : (d.percent ?? 0) > 75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {(d.percent ?? 0).toFixed(0)}%</td>
                      </tr>
                    ))}
                    {!(p.disks ?? []).length && <tr><td colSpan={5} className="py-2 text-[var(--ic-muted)]">none reported</td></tr>}
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="text-sm font-bold text-[var(--ic-text)] mb-2 flex items-center gap-2"><Wifi size={14} className="text-cyan-400" /> Services ({(p.services ?? []).length})</h3>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {(p.services ?? []).slice(0, 120).map((s, i) => (
                    <span key={i} title={`${s.name} pid=${s.pid ?? '?'}`}
                      className={`px-2 py-0.5 rounded-md text-[11px] border ${s.status === 'running' || s.status === 'active'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                      {s.name}
                    </span>
                  ))}
                  {!(p.services ?? []).length && <span className="text-xs text-[var(--ic-muted)]">none reported</span>}
                </div>
              </section>

              {!!(p.patches ?? []).length && (
                <section>
                  <h3 className="text-sm font-bold text-[var(--ic-text)] mb-2 flex items-center gap-2"><Package size={14} className="text-violet-400" /> Recent patches ({p.patches!.length})</h3>
                  <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                    {p.patches!.slice(0, 40).map((pt, i) => (
                      <li key={i} className="flex justify-between bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-1.5">
                        <span className="font-mono">{pt.id}</span><span className="text-[var(--ic-muted)]">{pt.installed_on}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Copy box
// ---------------------------------------------------------------------------
const CopyBox: React.FC<{ label: string; cmd: string }> = ({ label, cmd }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); } catch { /* clipboard blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-[var(--ic-muted)] uppercase tracking-wide">{label}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-cyan-300">
          {copied ? <CheckCircle size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] font-mono bg-black/40 border border-[var(--ic-border)] rounded-lg p-3 whitespace-pre-wrap break-all text-emerald-300">{cmd}</pre>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
type Tab = 'fleet' | 'tokens' | 'discovered';

const AgentsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('fleet');
  const [probes, setProbes] = useState<AgentProbeOut[]>([]);
  const [tokens, setTokens] = useState<AgentTokenOut[]>([]);
  const [devices, setDevices] = useState<AgentDiscoveredDeviceOut[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AgentProbeOut | null>(null);
  const [search, setSearch] = useState('');

  // token modal state
  const [showNewToken, setShowNewToken] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<AgentTokenOut | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [pr, tk, dv] = await Promise.allSettled([
        agentApi.listProbes(), agentApi.listTokens(), agentApi.discoveredDevices(),
      ]);
      if (pr.status === 'fulfilled') setProbes(pr.value);
      if (tk.status === 'fulfilled') setTokens(tk.value);
      if (dv.status === 'fulfilled') setDevices(dv.value);
      const failed = [pr, tk, dv].find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) setErr(failed.reason instanceof ApiError ? failed.reason.message : String(failed.reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // auto-refresh fleet every 30s while on the fleet tab
  useEffect(() => {
    if (tab !== 'fleet') return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [tab, load]);

  const createToken = async () => {
    setBusy(true);
    try {
      const t = await agentApi.createToken(tokenName.trim() || 'default');
      setCreatedToken(t);
      setShowNewToken(false); setTokenName('');
      setTokens(await agentApi.listTokens());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const revoke = async (id: number) => {
    if (!window.confirm('Revoke this enrollment token? Probes already installed keep working until their next re-enroll.')) return;
    try { await agentApi.revokeToken(id); setTokens(await agentApi.listTokens()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };

  // Regenerate install commands for an existing label: the secret is hashed
  // server-side and never recoverable, so we mint a fresh token with the same
  // name and show its one-liners in the banner above.
  const showCommands = async (t: AgentTokenOut) => {
    setBusy(true);
    try {
      const fresh = await agentApi.regenerateToken(t.name);
      setCreatedToken(fresh);
      setTokens(await agentApi.listTokens());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const onlineCount = probes.filter(p => p.status === 'online').length;
  const q = search.toLowerCase();
  const filteredProbes = probes.filter(p => !q || p.hostname.toLowerCase().includes(q) || p.ip.includes(q));
  const filteredDevices = devices.filter(d => !q ||
    (d.ip + ' ' + (d.hostname ?? '') + ' ' + d.device_type + ' ' + (d.sys_name ?? '')).toLowerCase().includes(q));
  const probeHost = (id: number) => probes.find(p => p.id === id)?.hostname ?? `#${id}`;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'fleet', label: 'Fleet', count: probes.length },
    { id: 'tokens', label: 'Tokens', count: tokens.filter(t => !t.revoked).length },
    { id: 'discovered', label: 'Discovered Devices', count: devices.length },
  ];

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--ic-text)] flex items-center gap-2">
            <MonitorSmartphone size={20} className="text-cyan-400" /> Collection Agents
          </h1>
          <p className="text-sm text-[var(--ic-muted)] mt-1">
            goinfra probes — remote-installed collectors on client networks. {onlineCount}/{probes.length} online.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-text)]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setTab('tokens')} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white">
            <Plus size={14} /> New enrollment token
          </button>
        </div>
      </div>

      {err && (
        <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} /> {err}
        </div>
      )}

      {/* Newly-created token secret — shown once */}
      {createdToken && createdToken.token && (
        <div className="bg-[var(--ic-surface)] border border-emerald-500/40 rounded-xl p-4 relative">
          <button onClick={() => setCreatedToken(null)} className="absolute top-3 right-3 text-[var(--ic-muted)] hover:text-[var(--ic-text)]"><X size={16} /></button>
          <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-1"><KeyRound size={14} /> Token created — copy it now, it will never be shown again</h3>
          <CopyBox label="Secret token" cmd={createdToken.token} />
          <div className="mt-3">
            {(['linux', 'windows'] as const).map(k => (
              <CopyBox key={k} label={k === 'linux' ? 'Linux one-liner (curl | sh)' : 'Windows one-liner (PowerShell as Administrator)'}
                cmd={agentInstallCommands(createdToken.token!)[k]} />
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--ic-border)]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition ${
              tab === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-[var(--ic-muted)] hover:text-[var(--ic-text)]'}`}>
            {t.label} <span className="text-xs opacity-70">({t.count})</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <Search size={14} className="text-[var(--ic-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter…"
            className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-cyan-500" />
        </div>
      </div>

      {/* ---- FLEET TAB ---- */}
      {tab === 'fleet' && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                <th className="px-4 py-3">Hostname</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">OS</th>
                <th className="px-4 py-3">Version</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filteredProbes.map(p => (
                <tr key={p.id} onClick={() => setSelected(p)}
                  className="border-b border-[var(--ic-border)]/50 hover:bg-[var(--ic-surface-2)] cursor-pointer transition">
                  <td className="px-4 py-3 font-semibold text-[var(--ic-text)]">{p.hostname}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ic-muted)]">{p.ip || '—'}</td>
                  <td className="px-4 py-3"><span className="flex items-center gap-1.5 capitalize"><OsIcon os={p.os} /> {p.os}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{p.agent_version}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{timeAgo(p.last_seen)}</td>
                  <td className="px-4 py-3 text-right"><Eye size={15} className="inline text-cyan-400" /></td>
                </tr>
              ))}
              {!loading && !filteredProbes.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--ic-muted)]">
                  No probes enrolled yet. Create a token in the <b>Tokens</b> tab, then run the install one-liner on any client machine — no site visit needed.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- TOKENS TAB ---- */}
      {tab === 'tokens' && (
        <div className="space-y-4">
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 flex flex-wrap items-center gap-3">
            <input value={tokenName} onChange={e => setTokenName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createToken()}
              placeholder="Token label (e.g. Acme Corp – main office)"
              className="flex-1 min-w-52 bg-[var(--ic-bg)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500" />
            <button onClick={createToken} disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white">
              <Plus size={14} /> {busy ? 'Creating…' : 'New token'}
            </button>
          </div>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                  <th className="px-4 py-3">Name</th><th className="px-4 py-3">Prefix</th><th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th><th className="px-4 py-3">Last used</th><th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(t => (
                  <tr key={t.id} className="border-b border-[var(--ic-border)]/50">
                    <td className="px-4 py-3 font-semibold">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ic-muted)]">{t.prefix}…</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${t.revoked
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}>
                        {t.revoked ? 'Revoked' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{fmtTime(t.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{t.last_used_at ? timeAgo(t.last_used_at) : 'never'}</td>
                    <td className="px-4 py-3 text-right">
                      {!t.revoked && (
                        <>
                          <button onClick={() => showCommands(t)} title="Show install commands (mints a fresh secret for this label)"
                            className="mr-1 px-2 py-1 rounded-md text-xs hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-cyan-300 inline-flex items-center gap-1">
                            <Copy size={12} /> Install commands
                          </button>
                          <button onClick={() => revoke(t.id)} title="Revoke"
                            className="p-1.5 rounded-md hover:bg-rose-500/10 text-rose-400"><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!tokens.length && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--ic-muted)]">No tokens yet — create one above to enroll your first probe.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-[var(--ic-muted)] bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 leading-relaxed">
            <b className="text-[var(--ic-text)]">How installation works:</b> the secret token is shown exactly once at creation (only its hash is stored server-side).
            Paste the generated one-liner into the client machine's terminal — Linux: <code className="font-mono text-emerald-300">curl … | sudo sh</code>,
            Windows: elevated PowerShell <code className="font-mono text-emerald-300">Invoke-WebRequest … | iex</code>. The script downloads the correct
            binary from <code className="font-mono">https://app.infracentra.com/downloads/goinfra/…</code>, installs a systemd unit / Windows service
            (auto-start on boot), and enrolls. Only outbound HTTPS/443 is required.
          </div>
        </div>
      )}

      {/* ---- DISCOVERED TAB ---- */}
      {tab === 'discovered' && (
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                <th className="px-4 py-3">IP</th><th className="px-4 py-3">Hostname</th><th className="px-4 py-3">MAC</th>
                <th className="px-4 py-3">Type</th><th className="px-4 py-3">SNMP name</th><th className="px-4 py-3">SNMP</th>
                <th className="px-4 py-3">Open ports</th><th className="px-4 py-3">Seen by</th><th className="px-4 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.slice(0, 500).map(d => (
                <tr key={d.id} className="border-b border-[var(--ic-border)]/50 hover:bg-[var(--ic-surface-2)]">
                  <td className="px-4 py-2.5 font-mono text-xs">{d.ip}</td>
                  <td className="px-4 py-2.5">{d.hostname ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ic-muted)]">{d.mac ?? '—'}</td>
                  <td className="px-4 py-2.5"><span className="capitalize px-2 py-0.5 rounded-md bg-[var(--ic-bg)] border border-[var(--ic-border)] text-xs">{d.device_type || 'unknown'}</span></td>
                  <td className="px-4 py-2.5 text-xs">{d.sys_name ?? '—'}</td>
                  <td className="px-4 py-2.5">{d.snmp ? <CheckCircle size={14} className="text-emerald-400" /> : <span className="text-[var(--ic-muted)] text-xs">no</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-amber-300">{(d.open_ports ?? []).slice(0, 8).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ic-muted)]">{probeHost(d.probe_id)}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ic-muted)]">{timeAgo(d.last_seen)}</td>
                </tr>
              ))}
              {!loading && !filteredDevices.length && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[var(--ic-muted)]">
                  Nothing discovered yet. Probes sweep the CIDR ranges configured under Auto Discovery every 15 minutes; results also appear in the normal Discovery pages and feed alert rules automatically.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ProbeDrawer probe={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

export default AgentsPage;
