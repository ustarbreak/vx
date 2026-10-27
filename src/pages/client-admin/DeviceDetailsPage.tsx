import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Activity, CheckCircle, Clock, Cpu, EyeOff, HardDrive,
  MapPin, Monitor, Network, Printer, Radar, RefreshCw, Server, Shield, ShieldAlert,
  Wifi, X, XCircle,
} from 'lucide-react';
import {
  discoveryApi, agentApi, ApiError,
  DeviceDetailInfo, DiscoveredDevice, AgentProbeOut, AgentInventoryOut,
} from '../../services/api';
import { demoDevices, demoTenants, type DemoDevice } from '../../data/demoWorld';
import { isDemoMode } from '../../services/demoMode';

// ---------------------------------------------------------------------------
// Device detail (Monitored Devices drill-down) — /client-admin/infrastructure/device/:deviceId?src=demo|scanned
//
// Honesty rules (mirrors backend GET /discovery/devices/{id}):
//   * Identity comes from the persisted inventory row only.
//   * Live status attaches ONLY from a real probe heartbeat / observation
//     record — a database row alone NEVER means "online".
//   * Missing data is displayed as missing ("—", "no evidence"), not invented.
//   * Credentials/tokens are never shown: SNMP secrets are not returned by the
//     API at all; we display which credential was used only by name.
// ---------------------------------------------------------------------------

const fmtTs = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};
const ageHuman = (iso?: string | null): string => {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'unknown';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Monitoring state derived from backend evidence only — same thresholds as
 *  the inventory list (offline >10 min silence, stale >15 min without data). */
type State = 'enrolled' | 'monitored' | 'stale' | 'offline' | 'unknown';
const deriveState = (hasCollector: boolean, lastSignal: string | null): { st: State; why: string } => {
  if (!hasCollector) return { st: 'enrolled', why: 'In the monitored inventory but no collector heartbeat record exists yet.' };
  if (!lastSignal) return { st: 'unknown', why: 'A collector is assigned but has never reported an observation timestamp.' };
  const s = (Date.now() - new Date(lastSignal).getTime()) / 1000;
  if (s > 600) return { st: 'offline', why: `No heartbeat for ${ageHuman(lastSignal)} (backend rule: >10 min = offline).` };
  if (s > 900) return { st: 'stale', why: `Last observation ${ageHuman(lastSignal)} ago — older than one sweep cycle.` };
  return { st: 'monitored', why: `Fresh signal ${ageHuman(lastSignal)} ago.` };
};
const stateStyle: Record<State, string> = {
  enrolled: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  monitored: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  stale: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  offline: 'bg-red-500/20 text-red-300 border-red-500/30',
  unknown: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
};

const TypeIcon: React.FC<{ type: string }> = ({ type }) => {
  const t = (type || '').toLowerCase();
  const Ic = t.includes('switch') || t.includes('router') ? Network
    : t.includes('firewall') ? Shield
    : t.includes('server') ? Server
    : t.includes('printer') ? Printer
    : t.includes('ap') || t.includes('wifi') ? Wifi
    : Monitor;
  return <Ic className="w-8 h-8 text-cyan-400" />;
};

const KV: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="flex justify-between gap-4 py-1.5 border-b border-[var(--ic-border)] last:border-0">
    <span className="text-gray-400 shrink-0">{k}</span>
    <span className="text-[var(--ic-heading)] text-right break-all">{children}</span>
  </div>
);

const Card: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }> = ({ title, icon, children, actions }) => (
  <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2">{icon}{title}</h2>
      {actions}
    </div>
    {children}
  </div>
);

const DeviceDetailsPage: React.FC = () => {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [params] = useSearchParams();
  // ?src=scanned → the id is a numeric backend DiscoveredDevice row.
  // Otherwise: demo world row id (dw-*) or legacy mock id.
  const src = params.get('src') === 'scanned' ? 'scanned' : 'demo';

  const [info, setInfo] = useState<DeviceDetailInfo | null>(null);
  const [raw, setRaw] = useState<DemoDevice | DiscoveredDevice | null>(null);
  const [collector, setCollector] = useState<AgentProbeOut | null>(null);
  const [inventory, setInventory] = useState<AgentInventoryOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true); setError('');
    try {
      const numId = Number(decodeURIComponent(deviceId));
      if (src === 'scanned' && !Number.isNaN(numId)) {
        // Scanned/imported device: numeric backend id → real detail endpoint.
        const [det, devs, probes] = await Promise.all([
          discoveryApi.deviceDetail(numId),
          discoveryApi.devices().catch(() => [] as DiscoveredDevice[]),
          agentApi.listProbes().catch(() => [] as AgentProbeOut[]),
        ]);
        setInfo(det);
        setRaw(devs.find(d => d.id === numId) ?? null);
        // Collector assignment: match probe by IP then hostname (backend rule).
        const m = probes.find(p => det.ip && p.ip === det.ip)
          ?? probes.find(p => det.hostname && (det.hostname || '').toLowerCase() === (p.hostname || '').toLowerCase());
        setCollector(m ?? null);
        if (m) {
          const inv = await agentApi.latestInventory(m.id).catch(() => null);
          setInventory(inv);
        }
      } else if (isDemoMode() || String(deviceId).startsWith('dw-')) {
        // Demo-world device: identity from the synchronised CMDB; live status
        // attaches ONLY through the simulated probe fleet (same matching rule
        // as GET /agents/probes), never because the row exists.
        const dd = demoDevices.find(d => String(d.id) === deviceId) ?? null;
        if (!dd) throw new Error(`Device ${deviceId} not found in the tenant inventory.`);
        setRaw(dd);
        // Mirror the numeric id used by the discovery store for this device.
        const mirrorId = demoDevices.findIndex(d => String(d.id) === deviceId) + 1;
        const det = await discoveryApi.deviceDetail(mirrorId).catch(() => null);
        setInfo(det);
        const probes = await agentApi.listProbes().catch(() => [] as AgentProbeOut[]);
        const m = probes.find(p => p.ip === dd.ip) ?? probes.find(p => p.hostname.toLowerCase() === dd.hostname.toLowerCase()) ?? null;
        setCollector(m);
        if (m) {
          const inv = await agentApi.latestInventory(m.id).catch(() => null);
          setInventory(inv);
        }
      } else if (!Number.isNaN(numId)) {
        const det = await discoveryApi.deviceDetail(numId);
        const devs = await discoveryApi.devices().catch(() => [] as DiscoveredDevice[]);
        setInfo(det);
        setRaw(devs.find(d => d.id === numId) ?? null);
        setCollector(null);
      } else {
        throw new Error('Unknown device identifier.');
      }
    } catch (ex: any) {
      setError(ex instanceof ApiError ? ex.message : String(ex?.message ?? ex));
    } finally { setLoading(false); }
  }, [deviceId, src]);

  useEffect(() => { load(); }, [load]);

  // ---- unified view-model --------------------------------------------------
  const view = useMemo(() => {
    if (!raw && !info) return null;
    const d = raw as DemoDevice | null;
    const s = raw as DiscoveredDevice | null;
    const hostname = info?.hostname ?? d?.hostname ?? s?.hostname ?? (s?.ip ?? '—');
    const ip = info?.ip ?? d?.ip ?? s?.ip ?? '—';
    const type = info?.device_type ?? d?.type ?? s?.device_type ?? 'unknown';
    const os = info?.os ?? d?.os ?? s?.os_guess ?? null;
    const orgId = (info as any)?.org_id ?? d?.orgId ?? s?.org_id ?? 0;
    const location = info?.location ?? d?.location ?? null;
    const lastSeen = collector?.last_seen ?? info?.last_seen
      ?? (d?.lastSeenMin != null ? new Date(Date.now() - d.lastSeenMin * 60000).toISOString() : s?.last_seen ?? null);
    // A device is only "collector-backed" when a real probe row matched it, or
    // the backend detail endpoint itself confirmed monitoring.
    const hasCollector = !!collector || info?.monitored === true;
    const st = deriveState(hasCollector, lastSeen);
    return { hostname, ip, type, os, orgId, location, lastSeen, state: st.st, stateWhy: st.why, alerts: d?.alerts ?? info?.related_incidents ?? null };
  }, [raw, info, collector]);

  const tenantName = (orgId: number) => demoTenants.find(t => t.id === orgId)?.name ?? (orgId ? `Tenant #${orgId}` : '—');

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-[var(--ic-surface)] animate-pulse rounded-lg" />
        <div className="grid md:grid-cols-4 gap-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-32 bg-[var(--ic-surface)] animate-pulse rounded-xl" />)}</div>
        <div className="h-64 bg-[var(--ic-surface)] animate-pulse rounded-xl" />
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-2">Device not found</h2>
          <p className="text-gray-400 mb-1">The requested asset does not exist in this tenant's inventory{error ? ` — ${error}` : '.'}</p>
          <p className="text-xs text-gray-500 mb-4">Cross-tenant ids are rejected by the backend (403); demo rows only resolve inside the demo world.</p>
          <Link to="/client-admin/asset-inventory" className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm">
            <ArrowLeft size={14} /> Back to Monitored Devices
          </Link>
        </div>
      </div>
    );
  }

  const cpu = inventory?.payload?.cpu?.percent ?? null;
  const diskWorst = inventory?.payload?.disks?.reduce((m, x) => Math.max(m, x.percent ?? 0), 0) ?? null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link to="/client-admin/asset-inventory" className="p-2 hover:bg-[var(--ic-surface)] rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-400" /></Link>
          <TypeIcon type={view.type} />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-[var(--ic-heading)]">{view.hostname}</h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium border ${stateStyle[view.state]}`} title={view.stateWhy}>{view.state}</span>
              {src === 'demo' && (raw as DemoDevice | null)?.isProbe && (
                <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-bold flex items-center gap-1"><Radar size={10} /> PROBE HOST</span>
              )}
            </div>
            <p className="text-gray-400 mt-0.5 text-sm">{view.ip} · {view.location ?? 'site not registered'} · {tenantName(view.orgId)}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)] border border-[var(--ic-border)]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {/* Evidence banner — exactly WHY this state is shown */}
      <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-3 text-xs text-[var(--ic-muted)] flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-cyan-400" />
        <span>
          <b className="text-[var(--ic-heading)]">State evidence:</b> {view.stateWhy}
          {' '}Status is never inferred from the inventory row alone — it requires a collector heartbeat or observation timestamp recorded by the backend.
        </span>
      </div>

      {/* Metric cards — only when real data exists */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="CPU" icon={<Cpu className="w-4 h-4 text-blue-400" />}>
          {cpu != null ? (
            <>
              <p className="text-2xl font-bold text-[var(--ic-heading)]">{cpu}%</p>
              <div className="mt-2 w-full bg-[var(--ic-surface-2)] rounded-full h-2"><div className={`h-2 rounded-full ${cpu > 80 ? 'bg-red-500' : cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${cpu}%` }} /></div>
              <p className="text-xs text-gray-400 mt-2">{inventory?.payload?.cpu?.model ?? ''} · {inventory?.payload?.cpu?.cores ?? '?'} cores</p>
            </>
          ) : <p className="text-sm text-gray-400 flex items-center gap-2"><EyeOff size={14} /> No live metrics — host has no reporting collector snapshot.</p>}
        </Card>
        <Card title="Memory" icon={<Activity className="w-4 h-4 text-purple-400" />}>
          {inventory?.payload?.memory ? (
            <>
              <p className="text-2xl font-bold text-[var(--ic-heading)]">{inventory.payload.memory.percent ?? '—'}%</p>
              <p className="text-xs text-gray-400 mt-2">{((inventory.payload.memory.used_bytes ?? 0) / 1e9).toFixed(1)} / {((inventory.payload.memory.total_bytes ?? 0) / 1e9).toFixed(1)} GB</p>
            </>
          ) : <p className="text-sm text-gray-400 flex items-center gap-2"><EyeOff size={14} /> Not collected (SNMP-only device or offline collector).</p>}
        </Card>
        <Card title="Disk (worst)" icon={<HardDrive className="w-4 h-4 text-green-400" />}>
          {diskWorst != null && diskWorst > 0 ? (
            <>
              <p className="text-2xl font-bold text-[var(--ic-heading)]">{diskWorst.toFixed(0)}%</p>
              <p className="text-xs text-gray-400 mt-2">{inventory?.payload?.disks?.length ?? 0} volume(s)</p>
            </>
          ) : <p className="text-sm text-gray-400 flex items-center gap-2"><EyeOff size={14} /> No disk telemetry for this asset class.</p>}
        </Card>
        <Card title="Freshness" icon={<Clock className="w-4 h-4 text-cyan-400" />}>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{ageHuman(view.lastSeen)}</p>
          <p className="text-xs text-gray-400 mt-2">since last heartbeat / observation<br />{fmtTs(view.lastSeen)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Identity & provenance */}
        <Card title="Identity & provenance">
          <div className="space-y-1 text-sm">
            <KV k="Hostname">{view.hostname}</KV>
            <KV k="IP address"><span className="font-mono">{view.ip}</span></KV>
            <KV k="MAC">{(raw as DiscoveredDevice | null)?.mac ?? (raw as DemoDevice | null)?.id ? ((raw as any).mac ?? '—') : '—'}</KV>
            <KV k="Device type"><span className="capitalize">{view.type}</span></KV>
            <KV k="Operating system">{view.os ?? <span className="text-gray-500 italic">not fingerprinted</span>}</KV>
            <KV k="Client / site">{tenantName(view.orgId)} · {view.location ?? 'unregistered site'}</KV>
            <KV k="Collection source">{collector ? <span className="flex items-center gap-1 justify-end"><Server size={12} /> goinfra probe « {collector.hostname} » v{collector.agent_version || '?'}</span>
              : src === 'demo' ? 'SNMP poller (demo world)' : <span className="text-gray-500 italic">none — enrolled only</span>}</KV>
            <KV k="Provenance">{(raw as DiscoveredDevice | null)?.source === 'manual' ? 'manual entry' : (raw as DiscoveredDevice | null) ? 'network discovery scan' : src === 'demo' ? 'demo world CMDB' : '—'}</KV>
            <KV k="SNMP identity">{info?.snmp_match ? <Badge ok>verified by SNMP walk</Badge> : <Badge>discovered (unverified)</Badge>}</KV>
            <KV k="Open ports">{(info?.open_ports ?? (raw as DiscoveredDevice | null)?.open_ports ?? []).join(', ') || '—'}</KV>
          </div>
        </Card>

        {/* Related security events + links */}
        <Card title="Related telemetry & events" icon={<Shield className="w-4 h-4 text-cyan-400" />}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between bg-[var(--ic-surface-2)] rounded-lg px-4 py-3">
              <span className="text-gray-300">Open incidents referencing this device</span>
              <span className={`font-bold ${!view.alerts ? 'text-emerald-400' : 'text-amber-300'}`}>{view.alerts == null ? 'no correlation data' : view.alerts}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/client-admin/alerts?q=${encodeURIComponent(view.hostname || view.ip)}`} className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]">View alerts</Link>
              <Link to={`/client-admin/incidents?q=${encodeURIComponent(view.hostname || view.ip)}`} className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]">Incidents</Link>
              <Link to={`/client-admin/network?q=${encodeURIComponent(view.ip)}`} className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]">Network telemetry</Link>
              <Link to={`/client-admin/monitored-devices?q=${encodeURIComponent(view.hostname || view.ip)}`} className="px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]">Find in discovery</Link>
              {collector && <Link to="/client-admin/agents" className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 text-xs">Open collector in Fleet</Link>}
            </div>
            {collector && (
              <div className="bg-[var(--ic-surface-2)] rounded-lg p-3 text-xs space-y-1">
                <p className="font-semibold text-[var(--ic-heading)] mb-1">Collector health (from heartbeat records)</p>
                <p>Status: <span className={collector.status === 'online' ? 'text-emerald-400' : 'text-red-400'}>{collector.status}</span> · last heartbeat {ageHuman(collector.last_seen)} ago</p>
                <p>Version {collector.agent_version || '?'} on {collector.os || '?'}, seen at {collector.ip || '?'}</p>
              </div>
            )}
            {!collector && src !== 'demo' && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200">
                <b>Missing prerequisite:</b> this device is enrolled in the inventory but no collector (goinfra probe) reports on it. Assign one via <Link className="underline" to="/client-admin/agents">Collection Agents → Tokens</Link> before expecting live status. Lifecycle actions (restart / upgrade / removal) are intentionally not offered — the agent service exposes no such command channel.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Host services / patches from the latest REAL inventory snapshot */}
      {inventory && (
        <Card title="Latest collector inventory snapshot" icon={<Server className="w-4 h-4 text-emerald-400" />}
          actions={<span className="text-xs text-gray-400">collected {fmtTs(inventory.collected_at)}</span>}>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="font-semibold text-[var(--ic-heading)] mb-2">Services</p>
              <table className="w-full text-xs">
                <tbody>
                  {(inventory.payload.services ?? []).slice(0, 8).map(sv => (
                    <tr key={sv.name} className="border-b border-[var(--ic-border)]">
                      <td className="py-1.5 text-[var(--ic-heading)]">{sv.name}</td>
                      <td className="py-1.5 text-right">{sv.status === 'running'
                        ? <span className="text-emerald-400 flex items-center gap-1 justify-end"><CheckCircle size={11} /> running</span>
                        : <span className="text-red-400 flex items-center gap-1 justify-end"><X size={11} /> {sv.status}</span>}</td>
                    </tr>
                  ))}
                  {!(inventory.payload.services ?? []).length && <tr><td className="text-gray-400">none reported</td></tr>}
                </tbody>
              </table>
            </div>
            <div>
              <p className="font-semibold text-[var(--ic-heading)] mb-2">Disks</p>
              <table className="w-full text-xs">
                <tbody>
                  {(inventory.payload.disks ?? []).map(dk => (
                    <tr key={dk.mount} className="border-b border-[var(--ic-border)]">
                      <td className="py-1.5 font-mono">{dk.mount}</td>
                      <td className="py-1.5">{dk.percent != null ? `${dk.percent}% used` : '—'}</td>
                    </tr>
                  ))}
                  {!(inventory.payload.disks ?? []).length && <tr><td className="text-gray-400">none reported</td></tr>}
                </tbody>
              </table>
              <p className="font-semibold text-[var(--ic-heading)] mt-4 mb-1">Platform</p>
              <p className="text-gray-300 text-xs">{inventory.payload.platform ?? '—'} · kernel {inventory.payload.kernel ?? '—'}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mt-4 flex items-center gap-1"><EyeOff size={11} /> Diagnostic data is read-only and sanitized: SNMP passphrases and enrollment tokens are never exposed by the API (hashes stored server-side only).</p>
        </Card>
      )}

      {/* Site link */}
      <div className="text-xs text-gray-400 flex items-center gap-1"><MapPin size={12} /> Trace path: discovery scan → imported to CMDB → collector assignment → alerts correlated by hostname/IP.</div>
    </div>
  );
};

const Badge: React.FC<{ ok?: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/40 text-[var(--ic-text)]'}`}>{children}</span>
);

export default DeviceDetailsPage;
