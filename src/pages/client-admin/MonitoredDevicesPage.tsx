import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Monitor, Plus, Trash2, Play, RefreshCw, ShieldAlert, KeyRound, Download,
  CheckCircle, Radar, Server, Wifi, X, Search, Terminal, Clock, ChevronDown, Eye,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  discoveryApi, ApiError,
  SnmpCredential, ScanRow, DiscoveredDevice,
} from '../../services/api';
import { demoDevices, demoTenants, type DemoDevice } from '../../data/demoWorld';
import { demoProjects } from '../../data/demoProjects';
import { isDemoMode } from '../../services/demoMode';

/** Deterministic pseudo-project assignment for a device (demo cross-links). */
const projectForDevice = (hostname: string, orgId: number): string => {
  const pool = demoProjects.filter(p => p.org_id === orgId);
  if (!pool.length) return '—';
  let h = 0;
  for (const c of hostname) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length].name;
};

// ---------------------------------------------------------------------------
// Asset Inventory — parent section with a dropdown navigation:
//   Auto Discovery → Scan History → Monitored Devices
// ---------------------------------------------------------------------------

/** Dropdown shown on every Asset Inventory sub-page for fast switching. */
export const AssetInventoryNav: React.FC<{ current: 'discovery' | 'scans' | 'monitored' }> = ({ current }) => {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const items = [
    { id: 'discovery' as const, to: '/client-admin/monitored-devices', label: 'Auto Discovery', icon: Radar },
    { id: 'scans' as const, to: '/client-admin/scan-history', label: 'Scan History', icon: Clock },
    { id: 'monitored' as const, to: '/client-admin/asset-inventory', label: 'Monitored Devices', icon: Monitor },
  ];
  const active = items.find(i => i.id === current)!;
  const ActiveIcon = active.icon;
  return (
    <div className="relative inline-block" onMouseLeave={() => setOpen(false)}>
      <button onClick={() => setOpen(o => !o)} onMouseEnter={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-sm font-semibold text-cyan-300">
        <ActiveIcon size={15} /> Asset Inventory: {active.label} <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-56 bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl shadow-2xl overflow-hidden">
          {items.map((it, idx) => {
            const Ic = it.icon;
            return (
              <React.Fragment key={it.id}>
                {idx > 0 && <div className="mx-3 border-t border-[var(--ic-border)]" />}
                <button onClick={() => { setOpen(false); nav(it.to); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--ic-surface)] ${current === it.id ? 'text-cyan-400 font-semibold' : 'text-[var(--ic-text)]'}`}>
                  <Ic size={14} className={current === it.id ? 'text-cyan-400' : 'text-[var(--ic-muted)]'} />
                  {it.label}
                  {current === it.id && <CheckCircle size={13} className="ml-auto text-cyan-400" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border border-transparent ${className}`}>{children}</span>
);
const scanStatusColor: Record<string, string> = {
  queued: 'bg-slate-600/40 text-[var(--ic-text)]', running: 'bg-cyan-500/20 text-cyan-300 animate-pulse',
  completed: 'bg-emerald-500/20 text-emerald-300', failed: 'bg-red-500/20 text-red-300',
};

// ---------------------------------------------------------------------------
// SNMP credentials modal
// ---------------------------------------------------------------------------

const CredModal: React.FC<{ onClose: () => void; onSave: (c: Omit<SnmpCredential, 'id' | 'created_at'>) => Promise<void> }> = ({ onClose, onSave }) => {
  const [c, setC] = useState({ name: '', version: 'v2c', community: 'public', username: '', auth_protocol: 'SHA', auth_passphrase: '', priv_protocol: 'AES128', priv_passphrase: '', port: 161 });
  const [err, setErr] = useState('');
  const inp = 'w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] focus:border-cyan-500 outline-none';
  const lbl = 'block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase tracking-wide';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!c.name.trim()) { setErr('Name is required'); return; }
    try {
      await onSave({
        name: c.name, version: c.version, port: Number(c.port),
        community: c.version !== 'v3' ? c.community : null,
        username: c.version === 'v3' ? c.username : null,
        auth_protocol: c.version === 'v3' ? c.auth_protocol : null,
        auth_passphrase: c.version === 'v3' ? c.auth_passphrase : null,
        priv_protocol: c.version === 'v3' ? c.priv_protocol : null,
        priv_passphrase: c.version === 'v3' ? c.priv_passphrase : null,
      });
      onClose();
    } catch (ex: any) { setErr(ex.message); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><KeyRound className="text-cyan-400" size={18} /> New SNMP Credential</h2>
          <button type="button" onClick={onClose} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X size={18} /></button>
        </div>
        <div><label className={lbl}>Name *</label><input className={inp} value={c.name} onChange={e => setC({ ...c, name: e.target.value })} placeholder="Edge switches v2c" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Version</label>
            <select className={inp} value={c.version} onChange={e => setC({ ...c, version: e.target.value })}>
              <option value="v1">v1</option><option value="v2c">v2c</option><option value="v3">v3 (auth+priv)</option>
            </select></div>
          <div><label className={lbl}>Port</label><input type="number" className={inp} value={c.port} onChange={e => setC({ ...c, port: Number(e.target.value) })} /></div>
        </div>
        {c.version !== 'v3' ? (
          <div><label className={lbl}>Community string</label><input className={inp} value={c.community} onChange={e => setC({ ...c, community: e.target.value })} /></div>
        ) : (
          <div className="space-y-3">
            <div><label className={lbl}>Security username</label><input className={inp} value={c.username} onChange={e => setC({ ...c, username: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Auth protocol</label>
                <select className={inp} value={c.auth_protocol} onChange={e => setC({ ...c, auth_protocol: e.target.value })}>
                  {['MD5', 'SHA', 'SHA-256', 'SHA-512'].map(p => <option key={p}>{p}</option>)}
                </select></div>
              <div><label className={lbl}>Auth passphrase</label><input type="password" className={inp} value={c.auth_passphrase} onChange={e => setC({ ...c, auth_passphrase: e.target.value })} /></div>
              <div><label className={lbl}>Priv protocol</label>
                <select className={inp} value={c.priv_protocol} onChange={e => setC({ ...c, priv_protocol: e.target.value })}>
                  {['DES', '3DES', 'AES128', 'AES256'].map(p => <option key={p}>{p}</option>)}
                </select></div>
              <div><label className={lbl}>Priv passphrase</label><input type="password" className={inp} value={c.priv_passphrase} onChange={e => setC({ ...c, priv_passphrase: e.target.value })} /></div>
            </div>
          </div>
        )}
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--ic-text)] bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)]">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)]">Save Credential</button>
        </div>
        <p className="text-[11px] text-[var(--ic-muted)]">Passphrases are used only at scan time by the backend engine and never returned to the browser.</p>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const MonitoredDevicesPage: React.FC = () => {
  const { user } = useAuth();
  const isPlatform = user?.role === 'platform_admin';
  const [tab, setTab] = useState<'devices' | 'scans' | 'credentials'>('devices');
  const [creds, setCreds] = useState<SnmpCredential[]>([]);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [engine, setEngine] = useState<{ nmap_available: boolean; mode: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCred, setShowCred] = useState(false);
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const [selCreds, setSelCreds] = useState<number[]>([]);
  const [starting, setStarting] = useState(false);
  const [expandedScan, setExpandedScan] = useState<number | null>(null);
  const [scanDevices, setScanDevices] = useState<DiscoveredDevice[]>([]);
  const [q, setQ] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [cr, sc, dv, en] = await Promise.all([
        discoveryApi.credentials(), discoveryApi.scans(), discoveryApi.devices(), discoveryApi.engineStatus(),
      ]);
      setCreds(cr); setScans(sc); setDevices(dv); setEngine(en);
    } catch (ex: any) {
      setError(ex instanceof ApiError ? ex.message : 'Backend unreachable — is the API container running?');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll while a scan is running so progress updates live
  const hasRunning = scans.some(s => ['queued', 'running'].includes(s.status));
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => load(true), 2500);
    return () => clearInterval(t);
  }, [hasRunning, load]);

  const startScan = async () => {
    setStarting(true); setError('');
    try {
      await discoveryApi.startScan(cidr, selCreds);
      setTab('scans');
      await load(true);
    } catch (ex: any) { setError(ex.message); }
    finally { setStarting(false); }
  };

  const expand = async (id: number) => {
    if (expandedScan === id) { setExpandedScan(null); return; }
    setExpandedScan(id);
    try { setScanDevices(await discoveryApi.scanDevices(id)); } catch (ex: any) { setError(ex.message); }
  };

  const filtered = useMemo(() => devices.filter(d =>
    !q || [d.ip, d.hostname, d.mac, d.os_guess, d.device_type].some(x => (x || '').toLowerCase().includes(q.toLowerCase()))
  ), [devices, q]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Radar className="text-cyan-400" /> Auto Discovery &amp; Network Scanning</h1>
          <p className="text-sm text-[var(--ic-muted)]">
            Real scanner on the server: {engine ? (engine.nmap_available ? <span className="text-emerald-400">nmap available ({engine.mode})</span> : <span className="text-amber-400">pure-python engine ({engine.mode})</span>) : 'detecting…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AssetInventoryNav current="discovery" />
          <button onClick={() => load()} className="p-2 rounded-lg bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] text-[var(--ic-text)]"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2"><ShieldAlert size={16} />{error}</div>}

      {/* Start-scan panel */}
      <div className="bg-[var(--ic-surface-2)] rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label className="block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase">Target network (CIDR)</label>
          <input value={cidr} onChange={e => setCidr(e.target.value)} className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg px-3 py-2 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500" placeholder="192.168.1.0/24" />
        </div>
        <div className="flex-1 min-w-64">
          <label className="block text-xs font-semibold text-[var(--ic-muted)] mb-1 uppercase">SNMP credentials to probe with</label>
          <div className="flex flex-wrap gap-2">
            {creds.length === 0 && <span className="text-xs text-[var(--ic-muted)]">none yet — add one below</span>}
            {creds.map(cr => (
              <button key={cr.id} onClick={() => setSelCreds(s => s.includes(cr.id!) ? s.filter(x => x !== cr.id) : [...s, cr.id!])}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${selCreds.includes(cr.id!) ? 'bg-cyan-600 text-[var(--ic-heading)]' : 'bg-[var(--ic-surface-2)] text-[var(--ic-text)]'}`}>
                {cr.name} <span className="opacity-60">({cr.version})</span>
              </button>
            ))}
          </div>
        </div>
        <button onClick={startScan} disabled={starting || !cidr}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[var(--ic-heading)] text-sm font-semibold">
          <Radar size={16} className={starting ? 'animate-spin' : ''} /> {starting ? 'Queuing…' : 'Start Discovery Scan'}
        </button>
      </div>

      <div className="flex gap-1 border-b border-[var(--ic-border)]">
        {(['devices', 'scans', 'credentials'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${tab === t ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)]'}`}>
            {t}{t === 'devices' ? ` (${devices.length})` : t === 'scans' ? ` (${scans.length})` : ` (${creds.length})`}
          </button>
        ))}
      </div>

      {/* DISCOVERED / IMPORTED DEVICES */}
      {tab === 'devices' && (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-2.5 text-[var(--ic-muted)]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search IP / hostname / MAC / OS…"
              className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500" />
          </div>
          <div className="bg-[var(--ic-surface)] rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                <th className="px-4 py-3">IP</th><th className="px-4 py-3">Hostname</th><th className="px-4 py-3">MAC</th>
                <th className="px-4 py-3">Type</th><th className="px-4 py-3">OS guess</th><th className="px-4 py-3">Open ports</th>
                <th className="px-4 py-3">SNMP</th><th className="px-4 py-3">Imported</th></tr></thead>
              <tbody>
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center">
                    <Server className="mx-auto text-[var(--ic-muted)] mb-2" size={28} />
                    <p className="text-[var(--ic-muted)] mb-1">No devices discovered yet.</p>
                    <p className="text-xs text-[var(--ic-muted)]">Enter a CIDR above and press “Start Discovery Scan” — the server will run real TCP probes (and nmap SYN/UDP scanning when installed) plus SNMP walks with your credentials.</p>
                  </td></tr>
                )}
                {filtered.map(d => (
                  <tr key={d.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                    <td className="px-4 py-3 font-mono text-cyan-300">{d.ip}</td>
                    <td className="px-4 py-3 text-[var(--ic-heading)]">{d.hostname || <span className="text-[var(--ic-muted)]">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ic-muted)]">{d.mac || '—'}</td>
                    <td className="px-4 py-3 text-[var(--ic-text)] capitalize">{d.device_type || 'unknown'}</td>
                    <td className="px-4 py-3 text-[var(--ic-muted)]">{d.os_guess || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ic-text)]">{d.open_ports.slice(0, 8).join(', ') || '—'}</td>
                    <td className="px-4 py-3">{d.snmp_match ? <Badge className="bg-emerald-500/20 text-emerald-300"><Wifi size={11} className="inline mr-1" />matched</Badge> : <span className="text-[var(--ic-muted)]">no</span>}</td>
                    <td className="px-4 py-3">{d.imported ? <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle size={12} /> in CMDB</span>
                      : d.snmp_match
                        ? <button onClick={() => discoveryApi.importDevice(d.id).then(() => load(true))} title="SNMP credentials + OID matched — one click to start monitoring this device"
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[var(--ic-heading)] font-semibold whitespace-nowrap"><Download size={12} /> Add to monitored</button>
                        : <span className="text-[11px] text-[var(--ic-muted)] italic" title="No stored SNMP credential/OID answers on this host — it cannot be added to monitoring yet">No SNMP match</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SCAN HISTORY */}
      {tab === 'scans' && (
        <div className="space-y-3">
          {scans.length === 0 && !loading && <p className="text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-xl p-6 text-center">No scans yet. Start one above — history, progress and per-scan device lists appear here.</p>}
          {[...scans].reverse().map(s => (
            <div key={s.id} className="bg-[var(--ic-surface-2)] rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[var(--ic-heading)] text-sm">{s.network_cidr}</span>
                <Badge className={scanStatusColor[s.status] || ''}>{s.status}</Badge>
                <span className="text-xs text-[var(--ic-muted)]">{s.discovered}/{s.total_hosts} hosts · {s.snmp_matched} SNMP matches</span>
                <span className="text-xs text-[var(--ic-muted)] ml-auto flex items-center gap-1"><Clock size={11} /> {fmt(s.started_at || s.created_at)} · by {s.created_by}</span>
                <button onClick={() => expand(s.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]"><Terminal size={12} /> {expandedScan === s.id ? 'Hide' : 'Results'}</button>
              </div>
              {s.status === 'running' && <div className="mt-2 h-1.5 rounded bg-[var(--ic-surface-2)] overflow-hidden"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${s.total_hosts ? Math.round(100 * s.discovered / s.total_hosts) : 10}%` }} /></div>}
              {s.status === 'failed' && s.finished_at && <p className="text-xs text-red-400 mt-1">Scan failed — check the target network is reachable from the API host.</p>}
              {expandedScan === s.id && (
                <div className="mt-3 bg-[var(--ic-surface)] rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                      <th className="px-3 py-2">IP</th><th className="px-3 py-2">MAC</th><th className="px-3 py-2">Hostname</th>
                      <th className="px-3 py-2">Type</th><th className="px-3 py-2">OS</th><th className="px-3 py-2">Ports</th><th className="px-3 py-2">SNMP sysDescr</th></tr></thead>
                    <tbody>
                      {scanDevices.filter(d => d.scan_id === s.id).map(d => (
                        <tr key={d.id} className="border-b border-[var(--ic-border)]">
                          <td className="px-3 py-2 font-mono text-cyan-300">{d.ip}</td>
                          <td className="px-3 py-2 font-mono">{d.mac || '—'}</td>
                          <td className="px-3 py-2">{d.hostname || '—'}</td>
                          <td className="px-3 py-2 capitalize">{d.device_type || '?'}</td>
                          <td className="px-3 py-2">{d.os_guess || '—'}</td>
                          <td className="px-3 py-2 font-mono">{d.open_ports.join(',') || '—'}</td>
                          <td className="px-3 py-2 text-[var(--ic-muted)] max-w-64 truncate">{d.sys_desc || '—'}</td>
                        </tr>
                      ))}
                      {scanDevices.filter(d => d.scan_id === s.id).length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-[var(--ic-muted)]">No rows yet (scan may still be running).</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* SNMP CREDENTIALS */}
      {tab === 'credentials' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setShowCred(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[var(--ic-heading)] text-sm font-semibold"><Plus size={16} /> Add SNMP Credential</button>
          </div>
          {creds.length === 0 && !loading && <p className="text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-xl p-6 text-center">No SNMP credentials stored. Add v1/v2c community strings or v3 auth/priv users, then attach them to discovery scans to fingerprint devices.</p>}
          <div className="grid md:grid-cols-2 gap-3">
            {creds.map(cr => (
              <div key={cr.id} className="bg-[var(--ic-surface-2)] rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-[var(--ic-heading)] font-semibold text-sm flex items-center gap-2"><KeyRound size={14} className="text-cyan-400" /> {cr.name} <Badge className="bg-[var(--ic-surface-2)] text-[var(--ic-text)]">{cr.version}</Badge></p>
                  <p className="text-xs text-[var(--ic-muted)] mt-1">port {cr.port}{cr.version === 'v3' ? ` · user ${cr.username} · auth ${cr.auth_protocol} · priv ${cr.priv_protocol}` : ` · community ••••${(cr.community || '').slice(-2)}`}</p>
                </div>
                <button onClick={() => discoveryApi.deleteCredential(cr.id!).then(() => load(true))} className="p-2 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCred && <CredModal onClose={() => setShowCred(false)} onSave={async c => { await discoveryApi.createCredential({ ...c, org_id: isPlatform ? undefined : undefined }); await load(true); }} />}
    </div>
  );
};

export default MonitoredDevicesPage;

// ---------------------------------------------------------------------------
// SCAN HISTORY — standalone page under the Asset Inventory umbrella.
// Lists every discovery scan with progress, results and per-scan devices.
// ---------------------------------------------------------------------------
export const ScanHistoryPage: React.FC = () => {
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [scanDevices, setScanDevices] = useState<DiscoveredDevice[]>([]);
  const [expandedScan, setExpandedScan] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setScans(await discoveryApi.scans()); }
    catch (ex: any) { setError(ex instanceof ApiError ? ex.message : 'Backend unreachable'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); window.addEventListener('demo-world-pushed', () => load(true)); }, [load]);
  const hasRunning = scans.some(s => ['queued', 'running'].includes(s.status));
  useEffect(() => { if (!hasRunning) return; const t = setInterval(() => load(true), 2500); return () => clearInterval(t); }, [hasRunning, load]);

  const expand = async (id: number) => {
    if (expandedScan === id) { setExpandedScan(null); return; }
    setExpandedScan(id);
    try { setScanDevices(await discoveryApi.scanDevices(id)); } catch (ex: any) { setError(ex.message); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Clock className="text-cyan-400" /> Scan History</h1>
          <p className="text-sm text-[var(--ic-muted)]">Every discovery run, its targets, SNMP matches and discovered hosts.</p>
        </div>
        <AssetInventoryNav current="scans" />
      </div>
      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-300">{error}</div>}
      {loading ? <div className="h-32 bg-[var(--ic-surface)] animate-pulse rounded-xl" /> : (
        <div className="space-y-3">
          {scans.length === 0 && <p className="text-sm text-[var(--ic-muted)] bg-[var(--ic-surface)] rounded-xl p-6 text-center">No scans yet. Run one from “Auto Discovery”.</p>}
          {[...scans].reverse().map(s => (
            <div key={s.id} className="bg-[var(--ic-surface-2)] rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[var(--ic-heading)] text-sm">{s.network_cidr}</span>
                <Badge className={scanStatusColor[s.status] || ''}>{s.status}</Badge>
                <span className="text-xs text-[var(--ic-muted)]">{s.discovered}/{s.total_hosts} hosts · {s.snmp_matched} SNMP matches</span>
                <span className="text-xs text-[var(--ic-muted)] ml-auto flex items-center gap-1"><Clock size={11} /> {fmt(s.started_at || s.created_at)} · by {s.created_by}</span>
                <button onClick={() => expand(s.id)} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--ic-surface-2)] hover:bg-slate-600 text-xs text-[var(--ic-heading)]"><Terminal size={12} /> {expandedScan === s.id ? 'Hide' : 'Results'}</button>
              </div>
              {s.status === 'running' && <div className="mt-2 h-1.5 rounded bg-[var(--ic-surface-2)] overflow-hidden"><div className="h-full bg-cyan-500 transition-all" style={{ width: `${s.total_hosts ? Math.round(100 * s.discovered / s.total_hosts) : 10}%` }} /></div>}
              {expandedScan === s.id && (
                <div className="mt-3 bg-[var(--ic-surface)] rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
                      <th className="px-3 py-2">IP</th><th className="px-3 py-2">Hostname</th><th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">OS</th><th className="px-3 py-2">Ports</th><th className="px-3 py-2">SNMP sysDescr</th></tr></thead>
                    <tbody>
                      {scanDevices.filter(d => d.scan_id === s.id).map(d => (
                        <tr key={d.id} className="border-b border-[var(--ic-border)]">
                          <td className="px-3 py-2 font-mono text-cyan-300">{d.ip}</td>
                          <td className="px-3 py-2">{d.hostname || '—'}</td>
                          <td className="px-3 py-2 capitalize">{d.device_type || '?'}</td>
                          <td className="px-3 py-2">{d.os_guess || '—'}</td>
                          <td className="px-3 py-2 font-mono">{d.open_ports.join(',') || '—'}</td>
                          <td className="px-3 py-2 text-[var(--ic-muted)] max-w-64 truncate">{d.sys_desc || '—'}</td>
                        </tr>
                      ))}
                      {scanDevices.filter(d => d.scan_id === s.id).length === 0 && <tr><td colSpan={6} className="px-3 py-3 text-[var(--ic-muted)]">No rows yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MONITORED DEVICES — CMDB view of the assets actually supervised.
// Shows WHICH CLIENT (tenant) each device belongs to and WHICH PROJECT it is
// linked to. In demo mode this is fully synchronised with demoWorld (24
// devices across Damanecash / Valoris System / Vivalis Salaf); in real mode
// it reads the imported (in-CMDB) devices from the backend.
// ---------------------------------------------------------------------------
export const MonitoredAssetsPage: React.FC = () => {
  const { user } = useAuth();
  const isPlatform = user?.role === 'platform_admin';
  const [imported, setImported] = useState<DiscoveredDevice[]>([]);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<DemoDevice | DiscoveredDevice | null>(null);
  const loading = false;

  useEffect(() => {
    const load = async () => {
      try { const dv = await discoveryApi.devices(); setImported(dv.filter(d => d.imported)); } catch { /* demo fallback below */ }
    };
    if (!isDemoMode()) load();
    window.addEventListener('demo-world-pushed', load);
    return () => window.removeEventListener('demo-world-pushed', load);
  }, []);

  const tenantName = (orgId: number) => demoTenants.find(t => t.id === orgId)?.name ?? `Tenant #${orgId}`;

  // Demo: the 24 synchronised devices (+ any imported during this session).
  const rows = useMemo(() => {
    if (isDemoMode()) {
      const base = demoDevices.filter(d => isPlatform || d.orgId === Number(user?.orgId ?? d.orgId));
      return { demo: base as (DemoDevice & { _kind: 'demo' })[], scanned: imported.filter(d => !base.some(b => b.ip === d.ip)) as (DiscoveredDevice & { _kind: 'scanned' })[] };
    }
    return { demo: [] as (DemoDevice & { _kind: 'demo' })[], scanned: imported.map(d => ({ ...d, _kind: 'scanned' as const })) };
  }, [imported, isPlatform, user]);

  const filteredDemo = rows.demo.filter(d => !q || [d.hostname, d.ip, d.os, d.location, tenantName(d.orgId)].some(x => (x || '').toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><Monitor className="text-cyan-400" /> Monitored Devices</h1>
          <p className="text-sm text-[var(--ic-muted)]">{rows.demo.length + rows.scanned.length} assets under supervision — client, project, SNMP preview included.</p>
        </div>
        <AssetInventoryNav current="monitored" />
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-2.5 text-[var(--ic-muted)]" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search hostname / IP / client / project…"
          className="w-full bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--ic-heading)] outline-none focus:border-cyan-500" />
      </div>

      <div className="bg-[var(--ic-surface)] rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--ic-muted)] border-b border-[var(--ic-border)]">
            <th className="px-4 py-3">Hostname</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Client</th><th className="px-4 py-3">Linked project</th>
            <th className="px-4 py-3">Status</th><th className="px-4 py-3">Location</th><th className="px-4 py-3" /></tr></thead>
          <tbody>
            {filteredDemo.map(d => (
              <tr key={d.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                <td className="px-4 py-3 text-[var(--ic-heading)] font-medium">
                  {d.hostname}
                  {d.isProbe && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px] font-bold align-middle" title="Machine hôte de l'agent collector — découverte & scans exécutés depuis ce device">
                      <Radar size={10} /> PROBE
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-cyan-300">{d.ip}</td>
                <td className="px-4 py-3 capitalize text-[var(--ic-text)]">{d.type}</td>
                <td className="px-4 py-3"><Badge className="bg-violet-500/20 text-violet-300">{tenantName(d.orgId)}</Badge></td>
                <td className="px-4 py-3 text-xs text-[var(--ic-muted)] max-w-56 truncate" title={projectForDevice(d.hostname, d.orgId)}>{projectForDevice(d.hostname, d.orgId)}</td>
                <td className="px-4 py-3">{d.status === 'online'
                  ? <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle size={12} /> online</span>
                  : d.status === 'degraded' ? <Badge className="bg-amber-500/20 text-amber-300">degraded</Badge>
                  : <Badge className="bg-red-500/20 text-red-300">offline</Badge>}</td>
                <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{d.location}</td>
                <td className="px-4 py-3"><button onClick={() => setPreview(d)} className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"><Eye size={12} /> Preview</button></td>
              </tr>
            ))}
            {rows.scanned.map(d => (
              <tr key={`s-${d.id}`} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                <td className="px-4 py-3 text-[var(--ic-heading)] font-medium">{d.hostname || d.ip}</td>
                <td className="px-4 py-3 font-mono text-cyan-300">{d.ip}</td>
                <td className="px-4 py-3 capitalize text-[var(--ic-text)]">{d.device_type || 'unknown'}</td>
                <td className="px-4 py-3"><Badge className="bg-violet-500/20 text-violet-300">{tenantName(d.org_id)}</Badge></td>
                <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{projectForDevice(d.hostname || d.ip, d.org_id)}</td>
                <td className="px-4 py-3"><span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle size={12} /> monitored</span></td>
                <td className="px-4 py-3 text-xs text-[var(--ic-muted)]">{d.sys_desc ? d.sys_desc.slice(0, 24) : '—'}</td>
                <td className="px-4 py-3"><button onClick={() => setPreview(d)} className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"><Eye size={12} /> Preview</button></td>
              </tr>
            ))}
            {!loading && filteredDemo.length + rows.scanned.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-[var(--ic-muted)]">No monitored devices{q ? ' match your search' : ' yet — import them from Auto Discovery'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Full-information preview: SNMP data + scan parameters + monitoring state */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-[var(--ic-heading)] flex items-center gap-2"><Monitor size={18} className="text-cyan-400" />{'hostname' in preview ? preview.hostname : (preview.ip)}</h3>
                <p className="text-xs text-[var(--ic-muted)]">Asset preview — everything collected via SNMP walks + scan parameters</p>
              </div>
              <button onClick={() => setPreview(null)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)] text-xl">×</button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {([
                ['IP address', 'ip' in preview ? preview.ip : '—'],
                ['MAC', 'mac' in preview ? (preview.mac ?? '—') : ('id' in preview ? '—' : '—')],
                ['Type', 'type' in preview ? preview.type : ('device_type' in preview ? (preview.device_type ?? '—') : '—')],
                ['OS', 'os' in preview ? preview.os : ('os_guess' in preview ? (preview.os_guess ?? '—') : '—')],
                ['Client (tenant)', tenantName('orgId' in preview ? preview.orgId : (preview as any).org_id ?? 0)],
                ['Linked project', projectForDevice(('hostname' in preview && preview.hostname) || ('ip' in preview ? preview.ip : ''), 'orgId' in preview ? preview.orgId : (preview as any).org_id ?? 0)],
                ['Location', 'location' in preview ? preview.location : '—'],
                ['Status', 'status' in preview ? preview.status : 'monitored'],
                ['Last seen', 'lastSeenMin' in preview ? `T−${preview.lastSeenMin} min` : 'live'],
                ['Throughput', 'throughputMbps' in preview ? `${preview.throughputMbps} Mbps` : '—'],
                ['Open ports', 'open_ports' in preview ? (preview.open_ports.join(', ') || '—') : '—'],
                ['SNMP sysDescr', 'sys_desc' in preview ? (preview.sys_desc ?? '—') : ('id' in preview ? 'SNMP v2c walk OK (demo)' : '—')],
                ['Active alerts', 'alerts' in preview ? String(preview.alerts) : '0'],
                ['Monitoring agent', 'id' in preview ? (String(preview.id).startsWith('dw-') ? 'collector (demo world)' : 'SNMP poller 60s') : 'SNMP poller 60s'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="contents">
                  <span className="text-[var(--ic-muted)] text-xs uppercase tracking-wide py-1">{k}</span>
                  <span className="text-[var(--ic-heading)] py-1 break-all">{v}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--ic-muted)] pt-2 border-t border-[var(--ic-border)]">Metrics streamed live to the platform — CPU/RAM/interface tables available on the Network Monitoring page for this asset.</p>
          </div>
        </div>
      )}
    </div>
  );
};
