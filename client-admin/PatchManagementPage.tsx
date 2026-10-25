import React, { useState, useEffect } from 'react';
import { Wrench, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

interface Patch {
  id: string;
  name: string;
  device: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'available' | 'installing' | 'installed' | 'failed';
  releasedAt: string;
  installedAt?: string;
}

export default function PatchManagementPage() {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPatches = async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      setPatches([
        { id: 'PATCH-001', name: 'Windows Security Update KB5034441', device: 'workstation-01', severity: 'critical', status: 'installed', releasedAt: '2027-01-10T00:00:00Z', installedAt: '2027-01-12T14:30:00Z' },
        { id: 'PATCH-002', name: 'Ubuntu Security Patch USN-6543-1', device: 'server-web-01', severity: 'high', status: 'available', releasedAt: '2027-01-14T00:00:00Z' },
        { id: 'PATCH-003', name: 'VMware ESXi Security Update', device: 'esxi-host-01', severity: 'critical', status: 'installing', releasedAt: '2027-01-13T00:00:00Z' },
        { id: 'PATCH-004', name: 'Chrome Security Update', device: 'workstation-02', severity: 'medium', status: 'failed', releasedAt: '2027-01-11T00:00:00Z' },
      ]);
      setLoading(false);
    };
    fetchPatches();
  }, []);

  const stats = {
    total: patches.length,
    available: patches.filter(p => p.status === 'available').length,
    installed: patches.filter(p => p.status === 'installed').length,
    failed: patches.filter(p => p.status === 'failed').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Patch Management</h1>
        <p className="text-gray-400 mt-1">Manage and deploy security patches across your infrastructure</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Wrench className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Patches</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-6 h-6 text-yellow-400" />
            <span className="text-2xl font-bold text-white">{stats.available}</span>
          </div>
          <p className="text-gray-400 text-sm">Available</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.installed}</span>
          </div>
          <p className="text-gray-400 text-sm">Installed</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <span className="text-2xl font-bold text-white">{stats.failed}</span>
          </div>
          <p className="text-gray-400 text-sm">Failed</p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Patch Name</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Device</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Severity</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Released</th>
              <th className="text-left py-3 px-4 text-gray-400 font-semibold">Installed</th>
            </tr>
          </thead>
          <tbody>
            {patches.map((patch) => (
              <tr key={patch.id} className="border-b border-slate-800 hover:bg-slate-800">
                <td className="py-3 px-4 text-white">{patch.name}</td>
                <td className="py-3 px-4 text-blue-400 cursor-pointer hover:text-blue-300">{patch.device}</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    patch.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    patch.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    patch.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{patch.severity}</span>
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    patch.status === 'available' ? 'bg-yellow-500/20 text-yellow-400' :
                    patch.status === 'installing' ? 'bg-blue-500/20 text-blue-400' :
                    patch.status === 'installed' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>{patch.status}</span>
                </td>
                <td className="py-3 px-4 text-gray-400 text-sm">{new Date(patch.releasedAt).toLocaleDateString()}</td>
                <td className="py-3 px-4 text-gray-400 text-sm">{patch.installedAt ? new Date(patch.installedAt).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
