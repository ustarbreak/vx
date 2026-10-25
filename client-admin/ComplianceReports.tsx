import React, { useState } from 'react';
import { 
  FileCheck, Download, Calendar, CheckCircle, 
  AlertTriangle, TrendingUp, Shield
} from 'lucide-react';

interface ComplianceReport {
  id: string;
  framework: string;
  title: string;
  date: string;
  score: number;
  status: 'compliant' | 'partial' | 'non-compliant';
  controls: number;
  passed: number;
}

export default function ComplianceReports() {
  const [reports] = useState<ComplianceReport[]>([
    {
      id: '1',
      framework: 'SOC 2 Type II',
      title: 'Annual SOC 2 Audit Report',
      date: '2027-01-13',
      score: 98,
      status: 'compliant',
      controls: 64,
      passed: 63,
    },
    {
      id: '2',
      framework: 'NIST CSF 2.0',
      title: 'NIST Cybersecurity Framework Assessment',
      date: '2027-01-05',
      score: 94,
      status: 'compliant',
      controls: 108,
      passed: 102,
    },
    {
      id: '3',
      framework: 'ISO 27001',
      title: 'ISO 27001 Compliance Report',
      date: '2026-12-20',
      score: 96,
      status: 'compliant',
      controls: 114,
      passed: 109,
    },
    {
      id: '4',
      framework: 'GDPR',
      title: 'GDPR Compliance Assessment',
      date: '2026-12-15',
      score: 100,
      status: 'compliant',
      controls: 47,
      passed: 47,
    },
    {
      id: '5',
      framework: 'HIPAA',
      title: 'HIPAA Security Rule Compliance',
      date: '2026-12-01',
      score: 92,
      status: 'compliant',
      controls: 75,
      passed: 69,
    },
    {
      id: '6',
      framework: 'PCI DSS',
      title: 'PCI DSS Compliance Report',
      date: '2026-11-15',
      score: 88,
      status: 'partial',
      controls: 312,
      passed: 275,
    },
  ]);

  const stats = {
    totalReports: reports.length,
    compliant: reports.filter(r => r.status === 'compliant').length,
    avgScore: Math.round(reports.reduce((sum, r) => sum + r.score, 0) / reports.length),
    totalControls: reports.reduce((sum, r) => sum + r.controls, 0),
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'compliant': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'partial': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'non-compliant': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Compliance Reports</h1>
          <p className="text-gray-400 mt-1">
            Automated compliance monitoring and audit-ready reports
          </p>
        </div>
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2">
          <Download className="w-4 h-4" />
          Export All Reports
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <FileCheck className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-bold text-white">{stats.totalReports}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Reports</p>
          <p className="text-blue-400 text-xs mt-1">Active frameworks</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-6 h-6 text-green-400" />
            <span className="text-2xl font-bold text-white">{stats.compliant}</span>
          </div>
          <p className="text-gray-400 text-sm">Compliant</p>
          <p className="text-green-400 text-xs mt-1">Audit-ready</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-6 h-6 text-purple-400" />
            <span className="text-2xl font-bold text-white">{stats.avgScore}%</span>
          </div>
          <p className="text-gray-400 text-sm">Avg Score</p>
          <p className="text-purple-400 text-xs mt-1">Across all frameworks</p>
        </div>
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <Shield className="w-6 h-6 text-cyan-400" />
            <span className="text-2xl font-bold text-white">{stats.totalControls}</span>
          </div>
          <p className="text-gray-400 text-sm">Total Controls</p>
          <p className="text-cyan-400 text-xs mt-1">Monitored continuously</p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-green-500/20 rounded-lg">
            <CheckCircle className="w-6 h-6 text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold mb-2">Continuous Compliance Monitoring</h3>
            <p className="text-gray-400 text-sm mb-3">
              Infracentra continuously monitors your compliance posture across all frameworks. 
              These reports are automatically generated and updated in real-time, ensuring you're 
              always audit-ready. Your compliance history is maintained indefinitely, providing 
              a complete audit trail for regulators and auditors.
            </p>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Updated daily</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Audit-ready format</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-400" />
                <span className="text-gray-300">Immutable history</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Framework</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Report Title</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Date</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Score</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Controls</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="border-b border-slate-800 hover:bg-slate-800 transition-colors">
                  <td className="py-3 px-4">
                    <span className="text-white font-semibold">{report.framework}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{report.title}</td>
                  <td className="py-3 px-4 text-gray-400 text-sm">
                    {new Date(report.date).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-800 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            report.score >= 95 ? 'bg-green-500' :
                            report.score >= 85 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${report.score}%` }}
                        />
                      </div>
                      <span className="text-white font-semibold">{report.score}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(report.status)}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-300">
                    <span className="text-white font-semibold">{report.passed}</span>
                    <span className="text-gray-400"> / {report.controls}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button className="p-2 hover:bg-slate-700 rounded text-gray-400 hover:text-white transition-colors">
                        <Download className="w-4 h-4" />
                      </button>
                      <button className="p-2 hover:bg-slate-700 rounded text-gray-400 hover:text-white transition-colors">
                        <FileCheck className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compliance History */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-bold text-white mb-4">Compliance History</h2>
        <p className="text-gray-400 text-sm mb-6">
          Your compliance journey with Infracentra - all reports are stored indefinitely for audit purposes
        </p>
        <div className="space-y-3">
          {[
            { date: '2027-01', score: 94, label: 'Current Month' },
            { date: '2026-12', score: 92, label: 'Last Month' },
            { date: '2026-11', score: 89, label: '2 Months Ago' },
            { date: '2026-10', score: 87, label: '3 Months Ago' },
            { date: '2026-09', score: 85, label: '4 Months Ago' },
          ].map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div className="flex items-center gap-4">
                <Calendar className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-white font-medium">{item.date}</p>
                  <p className="text-gray-400 text-xs">{item.label}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-32 bg-slate-700 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full ${
                      item.score >= 95 ? 'bg-green-500' :
                      item.score >= 85 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
                <span className="text-white font-semibold w-12 text-right">{item.score}%</span>
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export Options */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-bold text-white mb-4">Export for Auditors</h2>
        <p className="text-gray-400 text-sm mb-6">
          Generate audit-ready reports in multiple formats for your compliance requirements
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg transition-all text-left">
            <FileCheck className="w-6 h-6 text-blue-400 mb-2" />
            <p className="text-white font-semibold mb-1">PDF Report</p>
            <p className="text-gray-400 text-xs">Complete audit package</p>
          </button>
          <button className="p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg transition-all text-left">
            <FileCheck className="w-6 h-6 text-green-400 mb-2" />
            <p className="text-white font-semibold mb-1">Excel Export</p>
            <p className="text-gray-400 text-xs">Raw data for analysis</p>
          </button>
          <button className="p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 rounded-lg transition-all text-left">
            <FileCheck className="w-6 h-6 text-purple-400 mb-2" />
            <p className="text-white font-semibold mb-1">API Access</p>
            <p className="text-gray-400 text-xs">Direct integration</p>
          </button>
        </div>
      </div>
    </div>
  );
}
