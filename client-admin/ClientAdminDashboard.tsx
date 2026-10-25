import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  Server, Network, Monitor, Printer, Wifi, Shield, 
  AlertTriangle, CheckCircle, XCircle, Activity,
  Map, ZoomIn, ZoomOut, RefreshCw, Settings
} from 'lucide-react';

interface Device {
  id: string;
  hostname: string;
  type: 'server' | 'switch' | 'router' | 'firewall' | 'endpoint' | 'printer' | 'ap';
  ip: string;
  status: 'online' | 'offline' | 'warning';
  os?: string;
  location?: string;
  cpu?: number;
  memory?: number;
  uptime?: string;
  alerts?: number;
}

export default function ClientAdminDashboard() {
  const { user, organization } = useAuth();
  const [view, setView] = useState<'grid' | 'map'>('map');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [zoom, setZoom] = useState(1);

  // Mock devices data
  const [devices] = useState<Device[]>([
    { id: '1', hostname: 'router-main', type: 'router', ip: '10.0.10.1', status: 'online', os: 'pfSense', location: 'Datacenter', cpu: 25, memory: 40, uptime: '45d 12h', alerts: 0 },
    { id: '2', hostname: 'switch-core', type: 'switch', ip: '10.0.10.2', status: 'online', os: 'Cisco IOS', location: 'Datacenter', cpu: 15, memory: 30, uptime: '45d 12h', alerts: 0 },
    { id: '3', hostname: 'firewall-ext', type: 'firewall', ip: '10.0.10.3', status: 'online', os: 'pfSense', location: 'Datacenter', cpu: 35, memory: 50, uptime: '45d 12h', alerts: 2 },
    { id: '4', hostname: 'server-web', type: 'server', ip: '10.0.10.10', status: 'online', os: 'Ubuntu 22.04', location: 'Datacenter', cpu: 45, memory: 60, uptime: '30d 8h', alerts: 0 },
    { id: '5', hostname: 'server-db', type: 'server', ip: '10.0.10.11', status: 'warning', os: 'Ubuntu 22.04', location: 'Datacenter', cpu: 75, memory: 85, uptime: '30d 8h', alerts: 3 },
    { id: '6', hostname: 'server-app', type: 'server', ip: '10.0.10.12', status: 'online', os: 'Ubuntu 22.04', location: 'Datacenter', cpu: 55, memory: 70, uptime: '30d 8h', alerts: 1 },
    { id: '7', hostname: 'workstation-01', type: 'endpoint', ip: '10.0.10.20', status: 'online', os: 'Windows 11', location: 'Office', cpu: 30, memory: 45, uptime: '5d 3h', alerts: 0 },
    { id: '8', hostname: 'workstation-02', type: 'endpoint', ip: '10.0.10.21', status: 'offline', os: 'Windows 11', location: 'Office', cpu: 0, memory: 0, uptime: '0d 0h', alerts: 0 },
    { id: '9', hostname: 'printer-hr', type: 'printer', ip: '10.0.10.30', status: 'online', os: 'HP LaserJet', location: 'HR Department', cpu: 10, memory: 20, uptime: '15d 6h', alerts: 0 },
    { id: '10', hostname: 'ap-floor1', type: 'ap', ip: '10.0.10.40', status: 'online', os: 'Ubiquiti', location: 'Floor 1', cpu: 20, memory: 35, uptime: '60d 2h', alerts: 0 },
    { id: '11', hostname: 'ap-floor2', type: 'ap', ip: '10.0.10.41', status: 'warning', os: 'Ubiquiti', location: 'Floor 2', cpu: 65, memory: 75, uptime: '60d 2h', alerts: 1 },
    { id: '12', hostname: 'server-backup', type: 'server', ip: '10.0.10.50', status: 'online', os: 'Ubuntu 22.04', location: 'Datacenter', cpu: 40, memory: 55, uptime: '90d 4h', alerts: 0 },
  ]);

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'server': return Server;
      case 'switch': return Network;
      case 'router': return Network;
      case 'firewall': return Shield;
      case 'endpoint': return Monitor;
      case 'printer': return Printer;
      case 'ap': return Wifi;
      default: return Monitor;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const stats = {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    warning: devices.filter(d => d.status === 'warning').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Infrastructure Dashboard</h1>
          <p className="text-gray-400 mt-1">
            {organization?.name} - Real-time monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView(view === 'grid' ? 'map' : 'grid')}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white flex items-center gap-2"
          >
            <Map className="w-4 h-4" />
            {view === 'grid' ? 'Map View' : 'Grid View'}
          </button>
          <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white">
            <RefreshCw className="w-5 h-5" />
          </button>
          <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Devices</p>
              <p className="text-3xl font-bold mt-2">{stats.total}</p>
            </div>
            <Monitor className="w-12 h-12 text-blue-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Online</p>
              <p className="text-3xl font-bold mt-2">{stats.online}</p>
            </div>
            <CheckCircle className="w-12 h-12 text-green-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-100 text-sm">Offline</p>
              <p className="text-3xl font-bold mt-2">{stats.offline}</p>
            </div>
            <XCircle className="w-12 h-12 text-red-200" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl p-6 text-white">
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
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Infrastructure Map</h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-white">{Math.round(zoom * 100)}%</span>
              <button 
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="relative bg-slate-800 rounded-lg p-8 min-h-[600px] overflow-hidden">
            <div 
              className="relative w-full h-full"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
            >
              {/* Network Topology Visualization */}
              <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
                {/* Connection lines */}
                {devices.map((device, idx) => {
                  if (idx === 0) return null;
                  const parentIdx = Math.floor((idx - 1) / 2);
                  const parent = devices[parentIdx];
                  if (!parent) return null;
                  
                  const x1 = 100 + (parentIdx % 4) * 200;
                  const y1 = 100 + Math.floor(parentIdx / 4) * 150;
                  const x2 = 100 + (idx % 4) * 200;
                  const y2 = 100 + Math.floor(idx / 4) * 150;
                  
                  return (
                    <line
                      key={idx}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#475569"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                    />
                  );
                })}
              </svg>

              {/* Devices */}
              <div className="relative grid grid-cols-4 gap-8">
                {devices.map((device) => {
                  const Icon = getDeviceIcon(device.type);
                  return (
                    <div
                      key={device.id}
                      onClick={() => setSelectedDevice(device)}
                      className="bg-slate-700 hover:bg-slate-600 rounded-lg p-4 cursor-pointer transition-all hover:scale-105"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <Icon className={`w-8 h-8 ${getStatusColor(device.status)}`} />
                        <div className={`w-3 h-3 rounded-full ${
                          device.status === 'online' ? 'bg-green-500' :
                          device.status === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
                        } animate-pulse`} />
                      </div>
                      <p className="text-white font-semibold text-sm truncate">{device.hostname}</p>
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
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Device List</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
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
                      className="border-b border-slate-800 hover:bg-slate-800 cursor-pointer"
                      onClick={() => setSelectedDevice(device)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Icon className={`w-5 h-5 ${getStatusColor(device.status)}`} />
                          <span className="text-white font-medium">{device.hostname}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                      <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          device.status === 'online' ? 'bg-green-500/20 text-green-400' :
                          device.status === 'offline' ? 'bg-red-500/20 text-red-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {device.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-300">{device.cpu || 0}%</td>
                      <td className="py-3 px-4 text-gray-300">{device.memory || 0}%</td>
                      <td className="py-3 px-4">
                        {device.alerts && device.alerts > 0 ? (
                          <span className="text-red-400 font-semibold">{device.alerts}</span>
                        ) : (
                          <span className="text-gray-500">0</span>
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
          <div className="bg-slate-900 rounded-xl p-6 max-w-2xl w-full mx-4 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{selectedDevice.hostname}</h2>
              <button
                onClick={() => setSelectedDevice(null)}
                className="text-gray-400 hover:text-white"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">IP Address</p>
                <p className="text-white font-mono text-lg">{selectedDevice.ip}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Type</p>
                <p className="text-white capitalize text-lg">{selectedDevice.type}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Status</p>
                <p className={`text-lg font-semibold ${getStatusColor(selectedDevice.status)}`}>
                  {selectedDevice.status.toUpperCase()}
                </p>
              </div>
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">OS</p>
                <p className="text-white text-lg">{selectedDevice.os || 'N/A'}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Location</p>
                <p className="text-white text-lg">{selectedDevice.location || 'N/A'}</p>
              </div>
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Uptime</p>
                <p className="text-white text-lg">{selectedDevice.uptime || 'N/A'}</p>
              </div>
            </div>

            {selectedDevice.cpu !== undefined && selectedDevice.memory !== undefined && (
              <div className="mt-6 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400">CPU Usage</span>
                    <span className="text-white font-semibold">{selectedDevice.cpu}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
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
                    <span className="text-white font-semibold">{selectedDevice.memory}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
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
              <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium">
                View Details
              </button>
              <button className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg font-medium">
                Edit Device
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
