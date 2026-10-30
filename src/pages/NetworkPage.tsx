import React from 'react';
import { Network, Wifi, WifiOff, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { mockNetworkDevices } from '../data/mockData';
import ServiceGate from '../components/ServiceGate';
import { useServiceLiveFeed, feedBadgeText } from '../hooks/useServiceLiveFeed';
import DashboardWidget, {
  WidgetLayoutProvider,
  WidgetGrid,
  ResetLayoutButton,
  CustomizeHint,
  type WidgetLayoutEntry,
} from '../components/DashboardWidget';
import { AddWidgetButton, AllCatalogEntries } from '../components/WidgetCatalog';

const NETWORK_LAYOUT: WidgetLayoutEntry[] = [
  { id: 'net-stats', colSpan: 3, collapsed: false },
  { id: 'net-throughput', colSpan: 2, collapsed: false },
  { id: 'net-inventory', colSpan: 3, collapsed: false },
];

const throughputData = [
  { time: '00:00', mbps: 420 }, { time: '04:00', mbps: 380 }, { time: '08:00', mbps: 890 },
  { time: '12:00', mbps: 1200 }, { time: '16:00', mbps: 950 }, { time: '20:00', mbps: 620 },
];

function NetworkContent() {
  // Real-data wiring: Netdata/LibreNMS devices when Demo Mode is OFF.
  const feed = useServiceLiveFeed<any>('network-monitoring', mockNetworkDevices as any[]);
  const devices: any[] = feed.rows;
  const online = devices.filter(d => d.status === 'online').length;
  const degraded = devices.filter(d => d.status === 'degraded').length;
  const offline = devices.filter(d => d.status === 'offline').length;

  return (
    <WidgetLayoutProvider pageKey="network" defaultLayout={NETWORK_LAYOUT}>
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2">
            <Network className="w-7 h-7 text-purple-400" /> Network Monitoring
          </h1>
          <p className="text-[var(--ic-muted)] text-sm mt-1">Real-time network device status and throughput</p>
          <p className={`text-xs mt-2 ${feed.status === 'live' ? 'text-emerald-400' : feed.status === 'error' ? 'text-amber-400' : 'text-cyan-400'}`} title={feed.detail}>
            {feedBadgeText(feed.status, devices.length, feed.detail)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CustomizeHint />
          <AddWidgetButton pageKey="network" defaultLayout={NETWORK_LAYOUT} />
          <ResetLayoutButton pageKey="network" defaultLayout={NETWORK_LAYOUT} />
        </div>
      </div>

      <WidgetGrid>
        <DashboardWidget id="net-stats" title="Device Health Summary" spanOptions={[2, 3]}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
              <p className="text-xs text-[var(--ic-muted)]">Total Devices</p>
              <p className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{devices.length}</p>
            </div>
            <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
              <p className="text-xs text-[var(--ic-muted)]">Online</p>
              <p className="text-2xl font-bold text-cyber-green mt-1">{online}</p>
            </div>
            <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
              <p className="text-xs text-[var(--ic-muted)]">Degraded</p>
              <p className="text-2xl font-bold text-cyber-yellow mt-1">{degraded}</p>
            </div>
            <div className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-xl p-4">
              <p className="text-xs text-[var(--ic-muted)]">Offline</p>
              <p className="text-2xl font-bold text-cyber-red mt-1">{offline}</p>
            </div>
          </div>
        </DashboardWidget>

        <DashboardWidget id="net-throughput" title="Network Throughput (24h)" spanOptions={[1, 2, 3]}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={throughputData}>
              <defs><linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
              <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '8px', fontSize: '12px' }} />
              <Area type="monotone" dataKey="mbps" stroke="#8b5cf6" fill="url(#netGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </DashboardWidget>

        <DashboardWidget id="net-inventory" title="Device Inventory" spanOptions={[2, 3]}>
          <div className="border border-[var(--ic-border)] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ic-border)]">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Hostname</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">IP</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--ic-muted)]">Throughput</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface-2)]">
                    <td className="px-4 py-3 text-sm text-[var(--ic-heading)] font-mono">{d.hostname}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ic-muted)] capitalize">{d.type}</td>
                    <td className="px-4 py-3 text-xs text-[var(--ic-muted)] font-mono">{d.ip}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 text-xs font-medium ${
                        d.status === 'online' ? 'text-cyber-green' : d.status === 'degraded' ? 'text-cyber-yellow' : 'text-cyber-red'
                      }`}>
                        {d.status === 'online' ? <Wifi className="w-3 h-3" /> : d.status === 'degraded' ? <Activity className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ic-text)]">{d.throughputMbps} Mbps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashboardWidget>

        {/* Catalog widgets added via “Add widget” render here */}
        {AllCatalogEntries()}
      </WidgetGrid>
    </div>
    </WidgetLayoutProvider>
  );
}

export default function NetworkPage() {
  return <ServiceGate serviceId="network-monitoring"><NetworkContent /></ServiceGate>;
}
