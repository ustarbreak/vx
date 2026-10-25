import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Server, Network, Wifi, Shield, Monitor, Printer,
  ArrowLeft, Activity, Cpu, HardDrive, Clock, MapPin,
  AlertTriangle, CheckCircle, XCircle, Edit, Save, X
} from 'lucide-react';

interface Interface {
  id: string;
  name: string;
  type: 'RJ45' | 'SFP' | 'SFP+' | 'QSFP' | 'WiFi';
  speed: string;
  status: 'up' | 'down' | 'disabled';
  connectedTo?: string;
  macAddress: string;
  ip?: string;
  vlan?: number;
}

interface SNMPConfig {
  version: 'v1' | 'v2c' | 'v3';
  community?: string;
  username?: string;
  authProtocol?: 'MD5' | 'SHA';
  authPassword?: string;
  privProtocol?: 'DES' | 'AES';
  privPassword?: string;
  contextEngine?: string;
  contextName?: string;
}

interface Device {
  id: string;
  hostname: string;
  ip: string;
  type: string;
  os: string;
  status: 'online' | 'offline' | 'warning';
  cpu: number;
  memory: number;
  disk: number;
  uptime: string;
  location: string;
  lastSeen: string;
  alerts: number;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  firmware?: string;
  snmp: SNMPConfig;
  interfaces: Interface[];
}

export default function DeviceDetails() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Device>>({});

  useEffect(() => {
    // Simulate API call
    const fetchDevice = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mock device data - in production, fetch from API
        const mockDevice: Device = {
          id: deviceId || '1',
          hostname: 'server-web-01',
          ip: '10.0.10.10',
          type: 'server',
          os: 'Ubuntu 22.04 LTS',
          status: 'online',
          cpu: 45,
          memory: 68,
          disk: 52,
          uptime: '45d 12h 34m',
          location: 'Datacenter - Rack A3',
          lastSeen: '2 min ago',
          alerts: 0,
          serialNumber: 'SN-2024-001234',
          model: 'PowerEdge R740',
          manufacturer: 'Dell',
          firmware: '2.12.1',
          snmp: {
            version: 'v3',
            username: 'snmp_monitor',
            authProtocol: 'SHA',
            authPassword: '••••••••',
            privProtocol: 'AES',
            privPassword: '••••••••',
            contextEngine: '',
            contextName: '',
          },
          interfaces: [
            { id: '1', name: 'eth0', type: 'RJ45', speed: '1 Gbps', status: 'up', connectedTo: 'switch-core port 12', macAddress: '00:1A:2B:3C:4D:5E', ip: '10.0.10.10', vlan: 10 },
            { id: '2', name: 'eth1', type: 'RJ45', speed: '1 Gbps', status: 'up', connectedTo: 'switch-core port 13', macAddress: '00:1A:2B:3C:4D:5F', ip: '10.0.20.10', vlan: 20 },
            { id: '3', name: 'eth2', type: 'RJ45', speed: '1 Gbps', status: 'down', macAddress: '00:1A:2B:3C:4D:60' },
            { id: '4', name: 'ens1f0', type: 'SFP+', speed: '10 Gbps', status: 'up', connectedTo: 'firewall-ext port 1', macAddress: '00:1A:2B:3C:4D:61', vlan: 100 },
          ],
        };
        
        setDevice(mockDevice);
        setEditData(mockDevice);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch device:', error);
        setLoading(false);
      }
    };

    fetchDevice();
  }, [deviceId]);

  const handleSave = () => {
    // In production, save to API
    setDevice(editData as Device);
    setEditing(false);
  };

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
      case 'online': case 'up': return 'text-green-500 bg-green-500/20';
      case 'offline': case 'down': return 'text-red-500 bg-red-500/20';
      case 'warning': return 'text-yellow-500 bg-yellow-500/20';
      case 'disabled': return 'text-gray-500 bg-gray-500/20';
      default: return 'text-gray-500 bg-gray-500/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': case 'up': return CheckCircle;
      case 'offline': case 'down': return XCircle;
      case 'warning': return AlertTriangle;
      default: return XCircle;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading device details...</p>
        </div>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-2">Device Not Found</h2>
          <p className="text-gray-400 mb-4">The device you're looking for doesn't exist or has been removed.</p>
          <button
            onClick={() => navigate('/client-admin/infrastructure')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded-lg"
          >
            Back to Infrastructure
          </button>
        </div>
      </div>
    );
  }

  const Icon = getDeviceIcon(device.type);
  const StatusIcon = getStatusIcon(device.status);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/client-admin/infrastructure')}
            className="p-2 hover:bg-[var(--ic-surface)] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <Icon className="w-8 h-8 text-blue-400" />
              <h1 className="text-3xl font-bold text-[var(--ic-heading)]">{device.hostname}</h1>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(device.status)}`}>
                {device.status}
              </span>
            </div>
            <p className="text-gray-400 mt-1">{device.ip} • {device.location}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-[var(--ic-heading)] rounded-lg flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={() => { setEditing(false); setEditData(device); }}
                className="px-4 py-2 bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] rounded-lg flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded-lg flex items-center gap-2"
            >
              <Edit className="w-4 h-4" />
              Edit Device
            </button>
          )}
        </div>
      </div>

      {/* Device Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center gap-3 mb-2">
            <Cpu className="w-5 h-5 text-blue-400" />
            <span className="text-gray-400 text-sm">CPU Usage</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{device.cpu}%</p>
          <div className="mt-2 w-full bg-[var(--ic-surface)] rounded-full h-2">
            <div 
              className={`h-2 rounded-full ${
                device.cpu > 80 ? 'bg-red-500' :
                device.cpu > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${device.cpu}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-5 h-5 text-purple-400" />
            <span className="text-gray-400 text-sm">Memory Usage</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{device.memory}%</p>
          <div className="mt-2 w-full bg-[var(--ic-surface)] rounded-full h-2">
            <div 
              className={`h-2 rounded-full ${
                device.memory > 80 ? 'bg-red-500' :
                device.memory > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${device.memory}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center gap-3 mb-2">
            <HardDrive className="w-5 h-5 text-green-400" />
            <span className="text-gray-400 text-sm">Disk Usage</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{device.disk}%</p>
          <div className="mt-2 w-full bg-[var(--ic-surface)] rounded-full h-2">
            <div 
              className={`h-2 rounded-full ${
                device.disk > 80 ? 'bg-red-500' :
                device.disk > 60 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${device.disk}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            <span className="text-gray-400 text-sm">Uptime</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{device.uptime}</p>
          <p className="text-gray-400 text-sm mt-1">Last seen: {device.lastSeen}</p>
        </div>
      </div>

      {/* Device Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hardware Info */}
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Hardware Information</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Manufacturer</span>
              <span className="text-[var(--ic-heading)]">{device.manufacturer || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Model</span>
              <span className="text-[var(--ic-heading)]">{device.model || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Serial Number</span>
              <span className="text-[var(--ic-heading)] font-mono">{device.serialNumber || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Operating System</span>
              <span className="text-[var(--ic-heading)]">{device.os}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Firmware Version</span>
              <span className="text-[var(--ic-heading)]">{device.firmware || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Location</span>
              <span className="text-[var(--ic-heading)] flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {device.location}
              </span>
            </div>
          </div>
        </div>

        {/* SNMP Configuration */}
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">SNMP Configuration</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">SNMP Version</span>
              <span className="text-[var(--ic-heading)] font-semibold">{device.snmp.version}</span>
            </div>
            {device.snmp.version === 'v3' ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-400">Username</span>
                  <span className="text-[var(--ic-heading)] font-mono">{device.snmp.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Auth Protocol</span>
                  <span className="text-[var(--ic-heading)]">{device.snmp.authProtocol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Auth Password</span>
                  <span className="text-[var(--ic-heading)] font-mono">{device.snmp.authPassword}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Privacy Protocol</span>
                  <span className="text-[var(--ic-heading)]">{device.snmp.privProtocol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Privacy Password</span>
                  <span className="text-[var(--ic-heading)] font-mono">{device.snmp.privPassword}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-gray-400">Community String</span>
                <span className="text-[var(--ic-heading)] font-mono">{device.snmp.community || '••••••••'}</span>
              </div>
            )}
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-400 text-sm">
                <strong>Note:</strong> SNMP credentials are encrypted and stored securely. 
                Contact support to update SNMP configuration.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Network Interfaces */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Network Interfaces</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Interface</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Speed</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Connected To</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">MAC Address</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">VLAN</th>
              </tr>
            </thead>
            <tbody>
              {device.interfaces.map((iface) => (
                <tr key={iface.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                  <td className="py-3 px-4 text-[var(--ic-heading)] font-mono">{iface.name}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 bg-[var(--ic-surface)] rounded text-gray-300 text-sm">
                      {iface.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{iface.speed}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(iface.status)}`}>
                      {iface.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{iface.connectedTo || '-'}</td>
                  <td className="py-3 px-4 text-gray-300 font-mono text-sm">{iface.macAddress}</td>
                  <td className="py-3 px-4 text-gray-300 font-mono">{iface.ip || '-'}</td>
                  <td className="py-3 px-4 text-gray-300">{iface.vlan || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
