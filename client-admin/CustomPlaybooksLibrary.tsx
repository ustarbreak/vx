import React, { useState } from 'react';
import { 
  BookOpen, Play, Pause, Edit, Trash2, Plus,
  Zap, Shield, AlertTriangle, CheckCircle, Clock
} from 'lucide-react';

interface Playbook {
  id: string;
  name: string;
  description: string;
  category: string;
  executions: number;
  successRate: number;
  lastUsed?: string;
  isCustom: boolean;
  status: 'active' | 'inactive' | 'draft';
}

export default function CustomPlaybooksLibrary() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([
    {
      id: '1',
      name: 'Ransomware Response - Finance Dept',
      description: 'Automated response for ransomware attempts targeting finance systems',
      category: 'Incident Response',
      executions: 47,
      successRate: 98,
      lastUsed: '2027-01-15T09:30:00Z',
      isCustom: true,
      status: 'active',
    },
    {
      id: '2',
      name: 'Phishing Investigation - Custom Rules',
      description: 'Investigation workflow for phishing attempts with custom detection rules',
      category: 'Threat Detection',
      executions: 123,
      successRate: 95,
      lastUsed: '2027-01-14T14:20:00Z',
      isCustom: true,
      status: 'active',
    },
    {
      id: '3',
      name: 'DDoS Mitigation - Auto-Scale',
      description: 'Automatic scaling and mitigation for DDoS attacks',
      category: 'Network Security',
      executions: 12,
      successRate: 100,
      lastUsed: '2027-01-10T08:15:00Z',
      isCustom: true,
      status: 'active',
    },
    {
      id: '4',
      name: 'Compliance Check - SOC 2',
      description: 'Automated SOC 2 compliance verification',
      category: 'Compliance',
      executions: 89,
      successRate: 100,
      lastUsed: '2027-01-13T11:45:00Z',
      isCustom: true,
      status: 'active',
    },
    {
      id: '5',
      name: 'Insider Threat Detection',
      description: 'Monitor and respond to insider threat patterns',
      category: 'Threat Detection',
      executions: 34,
      successRate: 91,
      lastUsed: '2027-01-08T13:30:00Z',
      isCustom: true,
      status: 'active',
    },
    {
      id: '6',
      name: 'Zero-Day Exploit Response',
      description: 'Emergency response for zero-day vulnerabilities',
      category: 'Incident Response',
      executions: 8,
      successRate: 100,
      lastUsed: '2027-01-03T15:45:00Z',
      isCustom: true,
      status: 'active',
    },
  ]);

  const [showCreateModal, setShowCreateModal] = useState(false);

  const stats = {
    total: playbooks.length,
    active: playbooks.filter(p => p.status === 'active').length,
    totalExecutions: playbooks.reduce((sum, p) => sum + p.executions, 0),
    avgSuccessRate: Math.round(playbooks.reduce((sum, p) => sum + p.successRate, 0) / playbooks.length),
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'inactive': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      case 'draft': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Custom Playbooks Library</h1>
          <p className="text-gray-400 mt-1">
            Your personalized automation workflows optimized for your infrastructure
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Playbook
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <BookOpen className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.total}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Playbooks</p>
          <p className="text-cyan-400 text-xs mt-1">All custom-built</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.active}</span>
          </div>
          <p className="text-gray-400 text-sm">Active</p>
          <p className="text-green-400 text-xs mt-1">Ready to execute</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Zap className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.totalExecutions}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Executions</p>
          <p className="text-purple-400 text-xs mt-1">Automated responses</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-cyan-400" />
            <span className="text-2xl font-bold text-white">{stats.avgSuccessRate}%</span>
          </div>
          <p className="text-gray-400 text-sm">Avg Success Rate</p>
          <p className="text-cyan-400 text-xs mt-1">Optimized for you</p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-cyan-500/20 rounded-lg">
            <Shield className="w-6 h-6 text-cyan-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold mb-2">Your Custom Playbooks Are Unique</h3>
            <p className="text-gray-400 text-sm mb-3">
              These playbooks have been developed specifically for your infrastructure, tested on your environment, 
              and optimized based on your security patterns. They represent hundreds of hours of configuration 
              and cannot be easily replicated on another platform.
            </p>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span className="text-gray-300">~400 hours of configuration</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Tested on your infrastructure</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-purple-400" />
                <span className="text-gray-300">Optimized for your patterns</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Playbooks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {playbooks.map((playbook) => (
          <div key={playbook.id} className="bg-slate-900 rounded-xl border border-slate-700 p-6 hover:border-slate-600 transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-white font-semibold">{playbook.name}</h3>
                  {playbook.isCustom && (
                    <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-xs font-medium">
                      CUSTOM
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm">{playbook.description}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(playbook.status)}`}>
                {playbook.status}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-gray-400 text-xs mb-1">Executions</p>
                <p className="text-white font-semibold">{playbook.executions}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Success Rate</p>
                <p className="text-green-400 font-semibold">{playbook.successRate}%</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">Last Used</p>
                <p className="text-white text-sm">
                  {playbook.lastUsed ? new Date(playbook.lastUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Never'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-700">
              <span className="px-2 py-1 bg-slate-800 text-gray-300 rounded text-xs">
                {playbook.category}
              </span>
              <div className="flex items-center gap-2">
                <button className="p-2 hover:bg-slate-800 rounded text-gray-400 hover:text-white transition-colors">
                  <Play className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-slate-800 rounded text-gray-400 hover:text-white transition-colors">
                  <Edit className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Migration Warning */}
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-1" />
          <div>
            <h3 className="text-white font-semibold mb-2">Important: Playbook Portability</h3>
            <p className="text-gray-400 text-sm">
              These custom playbooks are built using Infracentra's proprietary automation engine and are optimized 
              for your specific infrastructure. Migrating these playbooks to another platform would require significant 
              reconfiguration and testing, estimated at 3-6 months of engineering time.
            </p>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-xl max-w-2xl w-full border border-slate-700">
            <div className="p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold text-white">Create Custom Playbook</h2>
              <p className="text-gray-400 text-sm mt-1">
                Build a new automation workflow tailored to your infrastructure
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Playbook Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Custom Ransomware Response"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Description</label>
                <textarea
                  rows={3}
                  className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe what this playbook does..."
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Category</label>
                <select className="w-full bg-slate-800 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>Incident Response</option>
                  <option>Threat Detection</option>
                  <option>Network Security</option>
                  <option>Compliance</option>
                  <option>Custom</option>
                </select>
              </div>
            </div>
            <div className="p-6 border-t border-slate-700 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
              >
                Cancel
              </button>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                Create Playbook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
