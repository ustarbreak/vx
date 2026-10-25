import React from 'react';
import { useAuth } from '../../../src/context/AuthContext';
import { Building2, Users, Shield, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import ValueEngineSection from '../../components/ValueEngineWidgets';

export default function ClientAdminDashboardPage() {
  const { organization } = useAuth();
  if (!organization) return <div className="p-6 text-[var(--ic-heading)]">No organization found.</div>;

  const activeServices = organization.entitlements.filter(e => e.enabled).length;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--ic-heading)]">Client Administration — Overview</h1>
        <p className="text-[var(--ic-muted)] text-sm mt-1">Your posture, your team and the business value delivered this month — one page.</p>
      </div>

      {/* Merged: former "Overview" + "Value & Loyalty" → single Executive Dashboard */}
      <ValueEngineSection orgId={Number(organization.id) || undefined} />

      <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
            organization.tier === 'enterprise' ? 'bg-amber-500/10 text-amber-400' :
            organization.tier === 'mid-market' ? 'bg-purple-500/10 text-purple-400' :
            'bg-blue-500/10 text-blue-400'
          }`}>
            <Building2 className="w-7 h-7" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[var(--ic-heading)]">{organization.name}</h2>
            <p className="text-sm text-[var(--ic-muted)] mt-1">
              {organization.tier.toUpperCase()} • {organization.industry} • {organization.country}
            </p>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-xs text-[var(--ic-muted)]">{organization.memberCount} members</span>
              <span className="text-xs text-[var(--ic-muted)]">{organization.assetCount} assets</span>
              <span className="text-xs text-[var(--ic-muted)]">Contract: {organization.contractEnd}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-[var(--ic-muted)]">Active Services</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{activeServices}</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">of {organization.entitlements.length} available</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-[var(--ic-muted)]">Team Members</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{organization.memberCount}</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">Active users</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Risk Score</span>
          </div>
          <p className={`text-2xl font-bold ${
            organization.riskScore <= 30 ? 'text-cyber-green' :
            organization.riskScore <= 60 ? 'text-cyber-yellow' : 'text-cyber-red'
          }`}>{organization.riskScore}</p>
          <p className="text-xs text-cyber-green mt-1">-11% vs last month</p>
        </div>
        <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-xs text-[var(--ic-muted)]">Compliance</span>
          </div>
          <p className="text-2xl font-bold text-[var(--ic-heading)]">{organization.complianceScore}%</p>
          <p className="text-xs text-[var(--ic-muted)] mt-1">NIST CSF 2.0</p>
        </div>
      </div>
    </div>
  );
}
