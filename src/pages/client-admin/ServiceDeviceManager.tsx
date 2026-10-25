import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { 
  Server, Plus, Search, Filter, Edit, Trash2, 
  Eye, Download, Upload, RefreshCw, CheckCircle,
  AlertTriangle, XCircle
} from 'lucide-react';

interface ServiceDevice {
  id: string;
  hostname: string;
  ip: string;
  type: string;
  os: string;
  status: 'active' | 'inactive' | 'error';
  lastSeen: string;
  serviceStatus: 'enabled' | 'disabled';
}

export default function ServiceDeviceManager() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const [devices, setDevices] = useState<ServiceDevice[]>([
    { id: '1', hostname: 'server-web-01', ip: '10.0.10.10', type: 'server', os: 'Ubuntu 22.04', status: 'active', lastSeen: '2 min ago', serviceStatus: 'enabled' },
    { id: '2', hostname: 'server-db-01', ip: '10.0.10.11', type: 'server', os: 'Ubuntu 22.04', status: 'active', lastSeen: '1 min ago', serviceStatus: 'enabled' },
    { id: '3', hostname: 'workstation-01', ip: '10.0.10.20', type: 'endpoint', os: 'Windows 11', status: 'active', lastSeen: '5 min ago', serviceStatus: 'enabled' },
    { id: '4', hostname: 'workstation-02', ip: '10.0.10.21', type: 'endpoint', os: 'Windows 11', status: 'inactive', lastSeen: '2 hours ago', serviceStatus: 'disabled' },
    { id: '5', hostname: 'printer-hr', ip: '10.0.10.30', type: 'printer', os: 'HP LaserJet', status: 'active', lastSeen: '10 min ago', serviceStatus: 'enabled' },
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);

  const filteredDevices = devices.filter(device => {
    const matchesSearch = device.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         device.ip.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === 'all' || device.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const toggleDeviceSelection = (id: string) => {
    setSelectedDevices(prev => 
      prev.includes(id) 
        ? prev.filter(d => d !== id)
        : [...prev, id]
    );
  };

  const toggleAllDevices = () => {
    if (selectedDevices.length === filteredDevices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(filteredDevices.map(d => d.id));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'inactive': return <XCircle className="w-4 h-4 text-gray-500" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  const stats = {
    total: devices.length,
    active: devices.filter(d => d.status === 'active').length,
    inactive: devices.filter(d => d.status === 'inactive').length,
    error: devices.filter(d => d.status === 'error').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)] capitalize">
            {serviceId?.replace('-', ' ')} Devices
          </h1>
          <p className="text-gray-400 mt-1">
            Manage devices for this service
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)] flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button className="px-4 py-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)] flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-[var(--ic-heading)] flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Device
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Devices</p>
              <p className="text-3xl font-bold text-[var(--ic-heading)] mt-2">{stats.total}</p>
            </div>
            <Server className="w-12 h-12 text-blue-400" />
          </div>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Active</p>
              <p className="text-3xl font-bold text-green-400 mt-2">{stats.active}</p>
            </div>
            <CheckCircle className="w-12 h-12 text-green-400" />
          </div>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Inactive</p>
              <p className="text-3xl font-bold text-gray-400 mt-2">{stats.inactive}</p>
            </div>
            <XCircle className="w-12 h-12 text-gray-400" />
          </div>
        </div>
        <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Errors</p>
              <p className="text-3xl font-bold text-red-400 mt-2">{stats.error}</p>
            </div>
            <AlertTriangle className="w-12 h-12 text-red-400" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search devices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="error">Error</option>
          </select>
          <button className="p-2 bg-[var(--ic-surface)] hover:bg-[var(--ic-surface-2)] rounded-lg text-[var(--ic-heading)]">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {selectedDevices.length > 0 && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <span className="text-blue-400 font-medium">
              {selectedDevices.length} device{selectedDevices.length > 1 ? 's' : ''} selected
            </span>
            <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] rounded text-sm">
              Enable Service
            </button>
            <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-[var(--ic-heading)] rounded text-sm">
              Disable Service
            </button>
            <button className="px-3 py-1 bg-[var(--ic-surface-2)] hover:bg-slate-600 text-[var(--ic-heading)] rounded text-sm">
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Devices Table */}
      <div className="bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--ic-border)] bg-[var(--ic-surface)]">
              <th className="text-left py-3 px-4">
                <input
                  type="checkbox"
                  checked={selectedDevices.length === filteredDevices.length && filteredDevices.length > 0}
                  onChange={toggleAllDevices}
                  className="rounded"
                />
              </th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">OS</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Service</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Seen</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.map((device) => (
              <tr key={device.id} className="border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)]">
                <td className="py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedDevices.includes(device.id)}
                    onChange={() => toggleDeviceSelection(device.id)}
                    className="rounded"
                  />
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-blue-400" />
                    <span className="text-[var(--ic-heading)] font-medium">{device.hostname}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                <td className="py-3 px-4 text-gray-300">{device.os}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(device.status)}
                    <span className="text-gray-300 capitalize">{device.status}</span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    device.serviceStatus === 'enabled'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {device.serviceStatus}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{device.lastSeen}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <button className="p-1 hover:bg-[var(--ic-surface-2)] rounded text-gray-400 hover:text-[var(--ic-heading)]">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="p-1 hover:bg-[var(--ic-surface-2)] rounded text-gray-400 hover:text-[var(--ic-heading)]">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
