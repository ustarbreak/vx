import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../src/context/AuthContext';
import { discoveryApi, type DiscoveredDevice, type DeviceDetailInfo } from '../../services/api';
import {
  Server, Network, Monitor, Printer, Wifi, Shield, HardDrive, HelpCircle,
  AlertTriangle, CheckCircle, XCircle, Activity,
  Map, ZoomIn, ZoomOut, RefreshCw
} from 'lucide-react';

interface Device {
  id: string;
  hostname: string;
  type: 'server' | 'switch' | 'router' | 'firewall' | 'endpoint' | 'printer' | 'ap' | 'storage' | 'unknown';
  ip: string;
  status: 'online' | 'offline' | 'warning' | 'unmonitored';
  os?: string;
  location?: string;
  cpu?: number;
  memory?: number;
  uptime?: string;
  alerts?: number;        // open incidents — undefined means no alert data (never a fake 0)
  lastSeen?: string;      // real heartbeat timestamp when monitored
  snmp_match?: boolean;
  open_ports?: number[];
}

const KNOWN_TYPES: Device['type'][] = ['server','switch','router','firewall','endpoint','printer','ap','storage'];

// Identity comes ONLY from persisted DiscoveredDevice rows. Live status is
// attached afterwards from actual probe/collector records (deviceDetail) —
// never inferred from mere existence in the inventory.
function baseDevice(d: DiscoveredDevice): Device {
  const t = (d.device_type || 'unknown') as Device['type'];
  return {
    id: String(d.id),
    hostname: d.hostname || d.ip,
    type: KNOWN_TYPES.includes(t) ? t : 'unknown',
    ip: d.ip,
    status: 'unmonitored',
    os: d.os_guess || undefined,
    location: (d as any).location || undefined,
    alerts: undefined,
    snmp_match: !!d.snmp_match,
    open_ports: d.open_ports || [],
  };
}

function enrich(dev: Device, info: DeviceDetailInfo): Device {
  const status: Device['status'] = !info.monitored ? 'unmonitored'
    : info.status === 'online' ? 'online'
    : info.status === 'offline' ? 'offline'
    : (info.status === 'degraded' || info.status === 'stale') ? 'warning'
    : 'unmonitored';
  return { ...dev, status, os: info.os || dev.os, location: info.location || dev.location,
           lastSeen: info.last_seen || undefined, alerts: info.related_incidents ?? undefined };
}

export default function ClientAdminDashboard() {
  const { user, organization } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<'grid' | 'map'>('map');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [zoom, setZoom] = useState(1);

  // Real inventory: discovery rows + per-device monitoring enrichment.
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await discoveryApi.devices();
      const list = rows.map(baseDevice);
      // Enrich with ACTUAL monitoring status where available; a failed or
      // unmonitored lookup leaves the device honestly "unmonitored".
      await Promise.all(list.map(async (dv, i) => {
        try { Object.assign(list[i], enrich(dv, await discoveryApi.deviceDetail(Number(dv.id)))); }
        catch { /* keep unmonitored */ }
      }));
      setDevices(list);
      setRefreshedAt(new Date().toISOString());
    } catch (ex: any) {
      setLoadError(ex?.message || 'Failed to load infrastructure inventory from the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'server': return Server;
      case 'switch': return Network;
      case 'router': return Network;
      case 'firewall': return Shield;
      case 'endpoint': return Monitor;
      case 'printer': return Printer;
      case 'ap': return Wifi;
      case 'storage': return HardDrive;
      default: return HelpCircle;   // unknown type — never pretend it's a monitor
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-gray-400';  // unmonitored = gray, NOT green
    }
  };

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    warning: devices.filter(d => d.status === 'warning').length,
    unmonitored: devices.filter(d => d.status === 'unmonitored').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Infrastructure Dashboard</h1>
          <p className="text-gray-400 mt-1">
            {organization?.name} — inventory &amp; monitoring status from actual backend records
            {refreshedAt && <span className="ml-2 text-gray-500">· refreshed {new Date(refreshedAt).toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView(view === 'grid' ? 'map' : 'grid')}
            className="px-4 py-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)] flex items-center gap-2"
          >
            <Map className="w-4 h-4" />
            {view === 'grid' ? 'Map View' : 'Grid View'}
          </button>
          <button onClick={() => load()} title="Reload inventory from the backend"
            className="p-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)]">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-300 font-semibold">Could not load the infrastructure inventory</p>
            <p className="text-red-400/80 text-sm mt-1">{loadError}</p>
          </div>
          <button onClick={() => load()} className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm">Retry</button>
        </div>
      )}

      {!loadError && !loading && devices.length === 0 && (
        <div className="bg-[var(--ic-surface)] border border-dashed border-[var(--ic-border)] rounded-xl p-10 text-center">
          <Activity className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-[var(--ic-heading)] font-semibold">No devices registered yet</p>
          <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto">
            This map shows only hosts that exist in your actual discovery/monitoring records.
            Run an Auto Discovery scan to populate it — nothing is simulated here.
          </p>
          <button onClick={() => navigate('/client-admin/monitored-devices')}
            className="mt-4 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
            Open Auto Discovery
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-[var(--ic-heading)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Devices</p>
              <p className="text-3xl font-bold mt-2">{stats.total}</p>
            </div>
            <Monitor className="w-12 h-12 text-blue-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-[var(--ic-heading)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Online</p>
              <p className="text-3xl font-bold mt-2">{stats.online}</p>
            </div>
            <CheckCircle className="w-12 h-12 text-green-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-[var(--ic-heading)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-100 text-sm">Offline</p>
              <p className="text-3xl font-bold mt-2">{stats.offline}</p>
            </div>
            <XCircle className="w-12 h-12 text-red-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-6 text-[var(--ic-heading)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm">Warnings</p>
              <p className="text-3xl font-bold mt-2">{stats.warning}</p>
            </div>
            <AlertTriangle className="w-12 h-12 text-yellow-200" />
          </div>
        </div>
      </div>

      {/* Infrastructure Map */}
      {view === 'map' ? (
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[var(--ic-heading)]">Infrastructure Map</h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="p-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)]"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[var(--ic-heading)]">{Math.round(zoom * 100)}%</span>
              <button 
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="p-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)]"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="relative bg-[var(--ic-surface)] rounded-lg p-8 min-h-[600px] overflow-hidden">
            <div 
              className="relative w-full h-full"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            >
              {/* No physical/logical network links are drawn: no relationship table
                  exists in the backend, and connections are NEVER inferred from
                  inventory order or shared subnets. Organizational hierarchy lives
                  in the Dashboard topology (orgTopologyApi). */}

              {/* Devices */}
              <div className="relative grid grid-cols-4 gap-8">
                {devices.map((device) => {
                  const Icon = getDeviceIcon(device.type);
                  return (
                    <div
                      key={device.id}
                      onClick={() => setSelectedDevice(device)}
                      className="bg-[var(--ic-surface-2)] hover:bg-slate-600 rounded-lg p-4 cursor-pointer transition-all hover:scale-105"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Icon className={`w-8 h-8 ${getStatusColor(device.status)}`} />
                        <div title={device.status === 'unmonitored' ? 'No collector/probe reports for this host' : device.status} className={`w-3 h-3 rounded-full ${
                          device.status === 'online' ? 'bg-green-500' :
                          device.status === 'offline' ? 'bg-red-500' :
                          device.status === 'warning' ? 'bg-yellow-500' : 'bg-gray-500'
                        } animate-pulse`} />
                      </div>
                      <p className="text-[var(--ic-heading)] font-semibold text-sm truncate">{device.hostname}</p>
                      <p className="text-gray-400 text-xs">{device.ip}</p>
                      {device.alerts && device.alerts > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-red-400 text-xs">
                          <AlertTriangle className="w-3 h-3" />
                          {device.alerts} alerts
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Device List</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--ic-border)]">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">CPU</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Memory</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Alerts</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => {
                  const Icon = getDeviceIcon(device.type);
                  return (
                    <tr 
                      key={device.id} 
                      className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] cursor-pointer"
                      onClick={() => setSelectedDevice(device)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Icon className={`w-5 h-5 ${getStatusColor(device.status)}`} />
                          <span className="text-[var(--ic-heading)] font-medium">{device.hostname}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                      <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          device.status === 'online' ? 'bg-green-500/20 text-green-400' :
                          device.status === 'offline' ? 'bg-red-500/20 text-red-400' :
                          device.status === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {device.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500" title="No resource-metric feed wired for this view">{device.cpu !== undefined ? device.cpu + '%' : '\u2014'}</td>
                      <td className="py-3 px-4 text-gray-500" title="No resource-metric feed wired for this view">{device.memory !== undefined ? device.memory + '%' : '\u2014'}</td>
                      <td className="py-3 px-4">
                        {device.alerts !== undefined && device.alerts > 0 ? (
                          <span className="text-red-400 font-semibold">{device.alerts}</span>
                        ) : device.alerts === 0 ? (
                          <span className="text-gray-500">0</span>
                        ) : (
                          <span className="text-gray-600" title="Unmonitored host or no alert correlation data">no data</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Device Details Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ic-surface)] rounded-xl p-6 max-w-2xl w-full mx-4 border border-[var(--ic-border)]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--ic-heading)]">{selectedDevice.hostname}</h2>
              <button
                onClick={() => setSelectedDevice(null)}
                className="text-gray-400 hover:text-[var(--ic-heading)]"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">IP Address</p>
                <p className="text-[var(--ic-heading)] font-mono text-lg">{selectedDevice.ip}</p>
              </div>
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">Type</p>
                <p className="text-[var(--ic-heading)] capitalize text-lg">{selectedDevice.type}</p>
              </div>
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">Status</p>
                <p className={`text-lg font-semibold ${getStatusColor(selectedDevice.status)}`}>
                  {selectedDevice.status.toUpperCase()}
                </p>
              </div>
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">OS</p>
                <p className="text-[var(--ic-heading)] text-lg">{selectedDevice.os || 'N/A'}</p>
              </div>
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">Location</p>
                <p className="text-[var(--ic-heading)] text-lg">{selectedDevice.location || 'N/A'}</p>
              </div>
              <div className="bg-[var(--ic-surface)] rounded-lg p-4">
                <p className="text-gray-400 text-sm">Last heartbeat</p>
                <p className="text-[var(--ic-heading)] text-lg">
                  {selectedDevice.lastSeen ? new Date(selectedDevice.lastSeen).toLocaleString() : 'No collector data'}
                </p>
              </div>
              {selectedDevice.status === 'unmonitored' && (
                <div className="col-span-2 bg-gray-500/10 border border-gray-500/30 rounded-lg p-3 text-sm text-gray-400">
                  This host exists in the discovery inventory but no probe/collector reports on it — health cannot be shown and is never assumed.
                </div>
              )}
            </div>

            {selectedDevice.cpu !== undefined && selectedDevice.memory !== undefined && (
              <div className="mt-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400">CPU Usage</span>
                    <span className="text-[var(--ic-heading)] font-semibold">{selectedDevice.cpu}%</span>
                  </div>
                  <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        selectedDevice.cpu > 80 ? 'bg-red-500' :
                        selectedDevice.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${selectedDevice.cpu}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400">Memory Usage</span>
                    <span className="text-[var(--ic-heading)] font-semibold">{selectedDevice.memory}%</span>
                  </div>
                  <div className="w-full bg-[var(--ic-surface)] rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        selectedDevice.memory > 80 ? 'bg-red-500' :
                        selectedDevice.memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${selectedDevice.memory}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              {/* Real drill-down: monitored devices view, focused on this host. */}
              <button onClick={() => navigate(`/client-admin/monitored-devices?q=${encodeURIComponent(selectedDevice.hostname || selectedDevice.ip)}`)}
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white py-2 rounded-lg font-medium">
                View in Monitored Devices
              </button>
              {/* No device-edit endpoint exists — do not offer a fake action. */}
              <a href="/client-admin/asset-inventory"
                className="flex-1 text-center bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] py-2 rounded-lg font-medium">
                Asset Inventory
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
