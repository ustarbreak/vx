import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Monitor, Plus, Search, Filter, Edit, Trash2, 
  Eye, Download, Upload, RefreshCw, CheckCircle,
  AlertTriangle, XCircle, Server
} from 'lucide-react';

interface MonitoredDevice {
  id: string;
  hostname: string;
  ip: string;
  type: 'server' | 'workstation' | 'laptop' | 'mobile' | 'iot';
  os: string;
  owner?: string;
  department?: string;
  location?: string;
  status: 'active' | 'inactive' | 'error';
  lastSeen: string;
  agentVersion?: string;
  adSynced: boolean;
}

export default function MonitoredDevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<MonitoredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);

  useEffect(() => {
    // Simulate API call
    const fetchDevices = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const mockDevices: MonitoredDevice[] = [
          {
            id: '1',
            hostname: 'DESKTOP-JohnDoe',
            ip: '10.0.10.20',
            type: 'workstation',
            os: 'Windows 11 Pro',
            owner: 'John Doe',
            department: 'IT',
            location: 'Office - Floor 1',
            status: 'active',
            lastSeen: '2 min ago',
            agentVersion: '4.7.2',
            adSynced: true,
          },
          {
            id: '2',
            hostname: 'LAPTOP-JaneSmith',
            ip: '10.0.10.21',
            type: 'laptop',
            os: 'Windows 11 Pro',
            owner: 'Jane Smith',
            department: 'HR',
            location: 'Remote',
            status: 'active',
            lastSeen: '5 min ago',
            agentVersion: '4.7.2',
            adSynced: true,
          },
          {
            id: '3',
            hostname: 'SERVER-DB-01',
            ip: '10.0.10.11',
            type: 'server',
            os: 'Ubuntu 22.04 LTS',
            department: 'IT',
            location: 'Datacenter',
            status: 'active',
            lastSeen: '1 min ago',
            agentVersion: '4.7.2',
            adSynced: false,
          },
          {
            id: '4',
            hostname: 'MOBILE-BobWilson',
            ip: '10.0.10.50',
            type: 'mobile',
            os: 'iOS 17.2',
            owner: 'Bob Wilson',
            department: 'Sales',
            location: 'Remote',
            status: 'inactive',
            lastSeen: '2 hours ago',
            agentVersion: '4.7.1',
            adSynced: true,
          },
          {
            id: '5',
            hostname: 'IOT-Camera-01',
            ip: '10.0.10.100',
            type: 'iot',
            os: 'Embedded Linux',
            department: 'Security',
            location: 'Building A - Entrance',
            status: 'error',
            lastSeen: '1 day ago',
            agentVersion: '4.6.0',
            adSynced: false,
          },
        ];
        
        setDevices(mockDevices);
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch devices:', error);
        setLoading(false);
      }
    };

    fetchDevices();
  }, []);

  const filteredDevices = devices.filter(device => {
    const matchesSearch = device.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         device.ip.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (device.owner && device.owner.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesType = filterType === 'all' || device.type === filterType;
    const matchesStatus = filterStatus === 'all' || device.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const stats = {
    total: devices.length,
    active: devices.filter(d => d.status === 'active').length,
    inactive: devices.filter(d => d.status === 'inactive').length,
    error: devices.filter(d => d.status === 'error').length,
    adSynced: devices.filter(d => d.adSynced).length,
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'server': return '🖥️';
      case 'workstation': return '💻';
      case 'laptop': return '💼';
      case 'mobile': return '📱';
      case 'iot': return '📡';
      default: return '🖥️';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'inactive': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading monitored devices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Monitored Devices</h1>
          <p className="text-gray-400 mt-1">
            Manage users and devices being monitored by Infracentra
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Device
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Monitor className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Devices</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-6 h-6 text-gray-400" />
            <span className="text-2xl font-bold text-white">{stats.inactive}</span>
          </div>
          <p className="text-gray-400 text-sm">Inactive</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.error}</span>
          </div>
          <p className="text-gray-400 text-sm">Errors</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Server className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.adSynced}</span>
          </div>
          <p className="text-gray-400 text-sm">AD Synced</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by hostname, IP, or owner..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="server">Servers</option>
            <option value="workstation">Workstations</option>
            <option value="laptop">Laptops</option>
            <option value="mobile">Mobile</option>
            <option value="iot">IoT</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="error">Error</option>
          </select>
          <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white">
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {selectedDevices.length > 0 && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <span className="text-blue-400 font-medium">
              {selectedDevices.length} device{selectedDevices.length > 1 ? 's' : ''} selected
            </span>
            <button className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
              Edit
            </button>
            <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm">
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Devices Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                <th className="text-left py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedDevices.length === filteredDevices.length && filteredDevices.length > 0}
                    onChange={toggleAllDevices}
                    className="rounded"
                  />
                </th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">IP Address</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">OS</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Owner</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Department</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Last Seen</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">AD Sync</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((device) => (
                <tr key={device.id} className="border-b border-slate-800 hover:bg-slate-800">
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
                      <span className="text-2xl">{getTypeIcon(device.type)}</span>
                      <div>
                        <p className="text-white font-medium">{device.hostname}</p>
                        <p className="text-gray-400 text-xs">{device.location}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300 capitalize">{device.type}</td>
                  <td className="py-3 px-4 text-gray-300 font-mono">{device.ip}</td>
                  <td className="py-3 px-4 text-gray-300">{device.os}</td>
                  <td className="py-3 px-4 text-gray-300">{device.owner || '-'}</td>
                  <td className="py-3 px-4 text-gray-300">{device.department || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(device.status)}`}>
                      {device.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{device.lastSeen}</td>
                  <td className="py-3 px-4">
                    {device.adSynced ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" />
                        Synced
                      </span>
                    ) : (
                      <span className="text-gray-500">Not synced</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => navigate(`/client-admin/monitored-devices/${device.id}`)}
                        className="p-1 hover:bg-slate-700 rounded text-gray-400 hover:text-white"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button className="p-1 hover:bg-slate-700 rounded text-gray-400 hover:text-white">
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

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-xl p-6 max-w-2xl w-full mx-4 border border-slate-700">
            <h2 className="text-2xl font-bold text-white mb-6">Add Monitored Device</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Hostname</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., DESKTOP-JohnDoe"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">IP Address</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 10.0.10.20"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Device Type</label>
                  <select className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="workstation">Workstation</option>
                    <option value="laptop">Laptop</option>
                    <option value="server">Server</option>
                    <option value="mobile">Mobile</option>
                    <option value="iot">IoT</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Owner</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Department</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., IT"
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Location</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Office - Floor 1"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="adSync" className="rounded" />
                <label htmlFor="adSync" className="text-gray-300">Sync with Active Directory</label>
              </div>
              <div className="flex items-center gap-3 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  Add Device
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
