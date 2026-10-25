import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Building2, Shield, Key, Bell, Webhook, Save, CheckCircle2, ToggleLeft, ToggleRight } from 'lucide-react';

export default function SettingsPage() {
  const { user, organization } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [saved, setSaved] = useState(false);

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'integrations', label: 'Integrations', icon: Webhook },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your account and configuration</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-56 flex lg:flex-col gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}>
              <tab.icon className="w-4 h-4" />{tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">Profile Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Full Name</label>
                  <input type="text" defaultValue={user?.name} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
                  <input type="email" defaultValue={user?.email} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'organization' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">Organization Settings</h3>
              {organization ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Organization Name</label>
                    <input type="text" defaultValue={organization.name} className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Tier</label>
                    <div className="px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-sm text-cyan-400 uppercase font-medium">{organization.tier}</div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Platform-level organization settings.</p>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">Security Configuration</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-slate-800/30 border border-slate-700/30">
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-cyan-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-200">Multi-Factor Authentication</p>
                      <p className="text-xs text-slate-500">Currently: {user?.mfaEnabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                  </div>
                  {user?.mfaEnabled ? <ToggleRight className="w-8 h-8 text-cyber-green" /> : <ToggleLeft className="w-8 h-8 text-slate-600" />}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">Integrations</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['Wazuh HIDS', 'Suricata IDS', 'MISP', 'AlienVault OTX', 'Slack', 'Jira'].map(name => (
                  <div key={name} className="p-4 rounded-lg bg-slate-800/30 border border-slate-700/30 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-200">{name}</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase bg-cyber-green/10 text-cyber-green">connected</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-white">Notification Preferences</h3>
              <div className="space-y-3">
                {['Critical Alerts', 'High Severity Alerts', 'Compliance Changes', 'Weekly Report'].map(label => (
                  <div key={label} className="flex items-center justify-between p-4 rounded-lg bg-slate-800/30 border border-slate-700/30">
                    <p className="text-sm font-medium text-slate-200">{label}</p>
                    <ToggleRight className="w-8 h-8 text-cyber-green cursor-pointer" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            {saved && <span className="flex items-center gap-1 text-xs text-cyber-green"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20">
              <Save className="w-4 h-4" />Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
