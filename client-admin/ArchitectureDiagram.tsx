import React, { useState } from 'react';
import { 
  Server, Cloud, Shield, Network, Database, 
  Lock, Globe, Wifi, Monitor, Smartphone,
  ArrowRight, ArrowDown, ArrowLeft, ArrowUp,
  ZoomIn, ZoomOut, RotateCcw, Download
} from 'lucide-react';

interface DiagramNode {
  id: string;
  type: 'client' | 'infracentra' | 'integration' | 'cloud';
  label: string;
  icon: any;
  x: number;
  y: number;
  description?: string;
}

interface Connection {
  from: string;
  to: string;
  label?: string;
  type: 'data' | 'control' | 'monitoring' | 'integration';
}

export default function ArchitectureDiagram() {
  const [view, setView] = useState<'network' | 'dataflow' | 'integration'>('network');
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Architecture nodes
  const nodes: DiagramNode[] = [
    // Client Infrastructure
    { id: 'endpoints', type: 'client', label: 'Endpoints', icon: Monitor, x: 100, y: 100, description: 'Workstations, laptops, mobile devices' },
    { id: 'servers', type: 'client', label: 'Servers', icon: Server, x: 100, y: 250, description: 'On-premise servers (Windows, Linux)' },
    { id: 'network-devices', type: 'client', label: 'Network Devices', icon: Network, x: 100, y: 400, description: 'Routers, switches, firewalls' },
    { id: 'iot', type: 'client', label: 'IoT Devices', icon: Wifi, x: 100, y: 550, description: 'Cameras, sensors, smart devices' },
    
    // Cloud Infrastructure
    { id: 'aws', type: 'cloud', label: 'AWS', icon: Cloud, x: 350, y: 100, description: 'Amazon Web Services' },
    { id: 'azure', type: 'cloud', label: 'Azure', icon: Cloud, x: 350, y: 250, description: 'Microsoft Azure' },
    { id: 'gcp', type: 'cloud', label: 'GCP', icon: Cloud, x: 350, y: 400, description: 'Google Cloud Platform' },
    { id: 'saas', type: 'cloud', label: 'SaaS Apps', icon: Globe, x: 350, y: 550, description: 'Office 365, Google Workspace, etc.' },
    
    // Infracentra Platform
    { id: 'collector', type: 'infracentra', label: 'Data Collector', icon: Database, x: 600, y: 150, description: 'Collects logs, metrics, alerts from all sources' },
    { id: 'siem', type: 'infracentra', label: 'SIEM Engine', icon: Shield, x: 600, y: 300, description: 'Correlation, detection, analytics' },
    { id: 'soar', type: 'infracentra', label: 'SOAR Engine', icon: Lock, x: 600, y: 450, description: 'Automation, orchestration, response' },
    { id: 'dashboard', type: 'infracentra', label: 'Dashboard', icon: Monitor, x: 600, y: 600, description: 'Visualization, reporting, management' },
    
    // Integrations
    { id: 'wazuh', type: 'integration', label: 'Wazuh', icon: Shield, x: 850, y: 100, description: 'EDR/XDR integration' },
    { id: 'zabbix', type: 'integration', label: 'Zabbix', icon: Network, x: 850, y: 250, description: 'Monitoring integration' },
    { id: 'misp', type: 'integration', label: 'MISP', icon: Globe, x: 850, y: 400, description: 'Threat intelligence sharing' },
    { id: 'thehive', type: 'integration', label: 'TheHive', icon: Database, x: 850, y: 550, description: 'Incident management' },
  ];

  // Connections between nodes
  const connections: Connection[] = [
    // Client to Collector
    { from: 'endpoints', to: 'collector', type: 'data', label: 'Logs & Metrics' },
    { from: 'servers', to: 'collector', type: 'data', label: 'System Logs' },
    { from: 'network-devices', to: 'collector', type: 'data', label: 'Network Traffic' },
    { from: 'iot', to: 'collector', type: 'data', label: 'IoT Data' },
    
    // Cloud to Collector
    { from: 'aws', to: 'collector', type: 'data', label: 'Cloud Logs' },
    { from: 'azure', to: 'collector', type: 'data', label: 'Azure Logs' },
    { from: 'gcp', to: 'collector', type: 'data', label: 'GCP Logs' },
    { from: 'saas', to: 'collector', type: 'data', label: 'SaaS Logs' },
    
    // Collector to SIEM
    { from: 'collector', to: 'siem', type: 'data', label: 'Normalized Data' },
    
    // SIEM to SOAR
    { from: 'siem', to: 'soar', type: 'control', label: 'Alerts & Incidents' },
    
    // SOAR to Dashboard
    { from: 'soar', to: 'dashboard', type: 'control', label: 'Actions & Results' },
    
    // SIEM to Dashboard
    { from: 'siem', to: 'dashboard', type: 'monitoring', label: 'Analytics' },
    
    // Integrations
    { from: 'siem', to: 'wazuh', type: 'integration', label: 'EDR Data' },
    { from: 'collector', to: 'zabbix', type: 'integration', label: 'Metrics' },
    { from: 'siem', to: 'misp', type: 'integration', label: 'Threat Intel' },
    { from: 'soar', to: 'thehive', type: 'integration', label: 'Cases' },
  ];

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'client': return '#3b82f6';
      case 'cloud': return '#8b5cf6';
      case 'infracentra': return '#06b6d4';
      case 'integration': return '#10b981';
      default: return '#64748b';
    }
  };

  const getConnectionColor = (type: string) => {
    switch (type) {
      case 'data': return '#3b82f6';
      case 'control': return '#ef4444';
      case 'monitoring': return '#10b981';
      case 'integration': return '#8b5cf6';
      default: return '#64748b';
    }
  };

  const selectedNodeData = nodes.find(n => n.id === selectedNode);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Architecture & Integration</h1>
          <p className="text-gray-400 mt-1">
            Visual representation of how Infracentra integrates with your infrastructure
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-white text-sm">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export
          </button>
        </div>
      </div>

      {/* View Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('network')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            view === 'network'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
          }`}
        >
          Network Architecture
        </button>
        <button
          onClick={() => setView('dataflow')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            view === 'dataflow'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
          }`}
        >
          Data Flow
        </button>
        <button
          onClick={() => setView('integration')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            view === 'integration'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
          }`}
        >
          Integration Points
        </button>
      </div>

      {/* Main Diagram */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 overflow-hidden">
        <div 
          className="relative w-full h-[700px]"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
        >
          {/* SVG for connections */}
          <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#64748b" />
              </marker>
            </defs>
            
            {connections.map((conn, idx) => {
              const fromNode = nodes.find(n => n.id === conn.from);
              const toNode = nodes.find(n => n.id === conn.to);
              if (!fromNode || !toNode) return null;

              const x1 = fromNode.x + 60;
              const y1 = fromNode.y + 30;
              const x2 = toNode.x + 60;
              const y2 = toNode.y + 30;

              return (
                <g key={idx}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={getConnectionColor(conn.type)}
                    strokeWidth="2"
                    strokeDasharray={conn.type === 'integration' ? '5,5' : '0'}
                    markerEnd="url(#arrowhead)"
                    opacity={0.6}
                  />
                  {conn.label && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 10}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor="middle"
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const Icon = node.icon;
            const isSelected = selectedNode === node.id;
            const color = getNodeColor(node.type);

            return (
              <div
                key={node.id}
                onClick={() => setSelectedNode(isSelected ? null : node.id)}
                className={`absolute cursor-pointer transition-all hover:scale-110 ${
                  isSelected ? 'scale-110 z-10' : ''
                }`}
                style={{ left: node.x, top: node.y }}
              >
                <div 
                  className={`w-[120px] p-4 rounded-xl border-2 transition-all ${
                    isSelected ? 'shadow-2xl' : 'hover:shadow-lg'
                  }`}
                  style={{ 
                    backgroundColor: `${color}20`,
                    borderColor: color
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Icon className="w-8 h-8" style={{ color }} />
                    <span className="text-white text-xs font-medium text-center">
                      {node.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Node Details */}
      {selectedNodeData && (
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
          <div className="flex items-start gap-4">
            <div 
              className="p-3 rounded-lg"
              style={{ backgroundColor: `${getNodeColor(selectedNodeData.type)}20` }}
            >
              <selectedNodeData.icon 
                className="w-8 h-8" 
                style={{ color: getNodeColor(selectedNodeData.type) }}
              />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">
                {selectedNodeData.label}
              </h3>
              <p className="text-gray-400 mb-4">
                {selectedNodeData.description}
              </p>
              <div className="flex items-center gap-4">
                <span 
                  className="px-3 py-1 rounded-full text-xs font-medium"
                  style={{ 
                    backgroundColor: `${getNodeColor(selectedNodeData.type)}20`,
                    color: getNodeColor(selectedNodeData.type)
                  }}
                >
                  {selectedNodeData.type}
                </span>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
                  View Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">Legend</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3b82f6' }}></div>
            <span className="text-gray-300 text-sm">Client Infrastructure</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#8b5cf6' }}></div>
            <span className="text-gray-300 text-sm">Cloud Services</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#06b6d4' }}></div>
            <span className="text-gray-300 text-sm">Infracentra Platform</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10b981' }}></div>
            <span className="text-gray-300 text-sm">Integrations</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5" style={{ backgroundColor: '#3b82f6' }}></div>
            <span className="text-gray-300 text-sm">Data Flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5" style={{ backgroundColor: '#ef4444' }}></div>
            <span className="text-gray-300 text-sm">Control Flow</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5" style={{ backgroundColor: '#10b981' }}></div>
            <span className="text-gray-300 text-sm">Monitoring</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-0.5 border-dashed" style={{ borderColor: '#8b5cf6' }}></div>
            <span className="text-gray-300 text-sm">Integration</span>
          </div>
        </div>
      </div>

      {/* Workflow Description */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h3 className="text-lg font-bold text-white mb-4">How It Works</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-blue-400 font-bold">1</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Data Collection</h4>
              <p className="text-gray-400 text-sm">
                Infracentra collects logs, metrics, and alerts from all your infrastructure: endpoints, servers, network devices, cloud services, and SaaS applications.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
              <span className="text-cyan-400 font-bold">2</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Analysis & Detection</h4>
              <p className="text-gray-400 text-sm">
                The SIEM engine correlates data, applies detection rules, and uses AI to identify threats and anomalies in real-time.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-400 font-bold">3</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Automation & Response</h4>
              <p className="text-gray-400 text-sm">
                The SOAR engine automatically responds to incidents using predefined playbooks, isolates threats, and notifies your team.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-green-400 font-bold">4</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Visualization & Reporting</h4>
              <p className="text-gray-400 text-sm">
                The dashboard provides real-time visibility, customizable widgets, and comprehensive reports for compliance and management.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
