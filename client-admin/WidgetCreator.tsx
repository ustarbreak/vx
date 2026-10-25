import React, { useState } from 'react';
import { 
  Layout, Plus, X, GripVertical, Settings, 
  BarChart3, Activity, AlertTriangle, Shield,
  Network, Server, Monitor
} from 'lucide-react';

interface Widget {
  id: string;
  type: 'alerts' | 'devices' | 'statistics' | 'network' | 'custom';
  title: string;
  size: 'small' | 'medium' | 'large';
  config?: any;
}

interface WidgetTemplate {
  type: Widget['type'];
  title: string;
  icon: any;
  description: string;
  defaultSize: Widget['size'];
}

export default function WidgetCreator() {
  const [widgets, setWidgets] = useState<Widget[]>([
    { id: '1', type: 'alerts', title: 'Recent Alerts', size: 'medium' },
    { id: '2', type: 'devices', title: 'Device Status', size: 'medium' },
    { id: '3', type: 'statistics', title: 'Network Traffic', size: 'large' },
  ]);
  
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);

  const widgetTemplates: WidgetTemplate[] = [
    {
      type: 'alerts',
      title: 'Alerts Widget',
      icon: AlertTriangle,
      description: 'Display recent security alerts and notifications',
      defaultSize: 'medium',
    },
    {
      type: 'devices',
      title: 'Device Status',
      icon: Monitor,
      description: 'Show status of all monitored devices',
      defaultSize: 'medium',
    },
    {
      type: 'statistics',
      title: 'Statistics Chart',
      icon: BarChart3,
      description: 'Visualize metrics and performance data',
      defaultSize: 'large',
    },
    {
      type: 'network',
      title: 'Network Map',
      icon: Network,
      description: 'Display network topology and connections',
      defaultSize: 'large',
    },
    {
      type: 'custom',
      title: 'Custom Widget',
      icon: Settings,
      description: 'Create a custom widget with filters',
      defaultSize: 'medium',
    },
  ];

  const addWidget = (template: WidgetTemplate) => {
    const newWidget: Widget = {
      id: Date.now().toString(),
      type: template.type,
      title: template.title,
      size: template.defaultSize,
    };
    setWidgets([...widgets, newWidget]);
    setShowWidgetPicker(false);
  };

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter(w => w.id !== id));
  };

  const handleDragStart = (id: string) => {
    setDraggedWidget(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedWidget || draggedWidget === targetId) return;

    const draggedIndex = widgets.findIndex(w => w.id === draggedWidget);
    const targetIndex = widgets.findIndex(w => w.id === targetId);

    const newWidgets = [...widgets];
    const [draggedItem] = newWidgets.splice(draggedIndex, 1);
    newWidgets.splice(targetIndex, 0, draggedItem);

    setWidgets(newWidgets);
  };

  const handleDragEnd = () => {
    setDraggedWidget(null);
  };

  const renderWidget = (widget: Widget) => {
    const sizeClasses = {
      small: 'col-span-1',
      medium: 'col-span-1 md:col-span-2',
      large: 'col-span-1 md:col-span-2 lg:col-span-3',
    };

    return (
      <div
        key={widget.id}
        className={`${sizeClasses[widget.size]} bg-slate-900 rounded-xl border border-slate-700 p-6 relative group`}
        draggable
        onDragStart={() => handleDragStart(widget.id)}
        onDragOver={(e) => handleDragOver(e, widget.id)}
        onDragEnd={handleDragEnd}
      >
        {/* Drag Handle */}
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
          <button className="p-1 hover:bg-slate-800 rounded">
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
          <button 
            onClick={() => removeWidget(widget.id)}
            className="p-1 hover:bg-red-500/20 rounded"
          >
            <X className="w-4 h-4 text-red-400" />
          </button>
          <div className="p-1 cursor-move">
            <GripVertical className="w-4 h-4 text-gray-400" />
          </div>
        </div>

        {/* Widget Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            {widget.type === 'alerts' && <AlertTriangle className="w-5 h-5 text-blue-400" />}
            {widget.type === 'devices' && <Monitor className="w-5 h-5 text-blue-400" />}
            {widget.type === 'statistics' && <BarChart3 className="w-5 h-5 text-blue-400" />}
            {widget.type === 'network' && <Network className="w-5 h-5 text-blue-400" />}
            {widget.type === 'custom' && <Settings className="w-5 h-5 text-blue-400" />}
          </div>
          <h3 className="text-lg font-bold text-white">{widget.title}</h3>
        </div>

        {/* Widget Content */}
        <div className="mt-4">
          {widget.type === 'alerts' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="text-white font-medium">High CPU Usage</p>
                    <p className="text-gray-400 text-sm">server-db-01</p>
                  </div>
                </div>
                <span className="text-red-400 text-sm">2 min ago</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <div>
                    <p className="text-white font-medium">Disk Space Low</p>
                    <p className="text-gray-400 text-sm">server-backup</p>
                  </div>
                </div>
                <span className="text-yellow-400 text-sm">15 min ago</span>
              </div>
            </div>
          )}

          {widget.type === 'devices' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <p className="text-green-400 text-2xl font-bold">45</p>
                <p className="text-gray-400 text-sm">Online</p>
              </div>
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <p className="text-red-400 text-2xl font-bold">3</p>
                <p className="text-gray-400 text-sm">Offline</p>
              </div>
              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <p className="text-yellow-400 text-2xl font-bold">7</p>
                <p className="text-gray-400 text-sm">Warnings</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-blue-400 text-2xl font-bold">55</p>
                <p className="text-gray-400 text-sm">Total</p>
              </div>
            </div>
          )}

          {widget.type === 'statistics' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Network Traffic</span>
                  <span className="text-white font-semibold">2.4 GB/s</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: '65%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">CPU Usage</span>
                  <span className="text-white font-semibold">45%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '45%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-sm">Memory Usage</span>
                  <span className="text-white font-semibold">68%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '68%' }} />
                </div>
              </div>
            </div>
          )}

          {widget.type === 'network' && (
            <div className="text-center py-8">
              <Network className="w-16 h-16 text-blue-400 mx-auto mb-4" />
              <p className="text-gray-400">Network topology visualization</p>
              <button className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
                View Full Map
              </button>
            </div>
          )}

          {widget.type === 'custom' && (
            <div className="text-center py-8">
              <Settings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-400">Configure your custom widget</p>
              <button className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">
                Configure
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard Builder</h1>
          <p className="text-gray-400 mt-1">
            Customize your dashboard with drag-and-drop widgets
          </p>
        </div>
        <button
          onClick={() => setShowWidgetPicker(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Widget
        </button>
      </div>

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {widgets.map(renderWidget)}
      </div>

      {/* Widget Picker Modal */}
      {showWidgetPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-slate-700 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Add Widget</h2>
              <button
                onClick={() => setShowWidgetPicker(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {widgetTemplates.map((template, idx) => {
                const Icon = template.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => addWidget(template)}
                    className="bg-slate-800 hover:bg-slate-700 rounded-lg p-6 text-left transition-all"
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-blue-500/20 rounded-lg">
                        <Icon className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-white font-semibold mb-1">{template.title}</h3>
                        <p className="text-gray-400 text-sm">{template.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
