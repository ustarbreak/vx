import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Building2, CreditCard, PlugZap, RefreshCw, Shield, Ticket, Users, Server, ArrowUpRight } from 'lucide-react';
import WorldAttackMap from '../../components/WorldAttackMap';
import { platformAdminApi, PlatformOverviewResponse } from '../../services/api';

const tiles = [
  {key:'tenants_active',label:'Active clients',icon:Building2,link:'/admin/clients'},
  {key:'partners_total',label:'Partners / MSSPs',icon:Users,link:'/admin/partners'},
  {key:'platform_staff',label:'Platform staff',icon:Shield,link:'/admin/team'},
  {key:'tickets_active',label:'Open tickets',icon:Ticket,link:'/admin/services-ops'},
  {key:'incidents_active',label:'Active incidents',icon:AlertTriangle,link:'/incidents'},
  {key:'integrations_active',label:'Active integration configs',icon:PlugZap,link:'/admin/integrations'},
  {key:'agents_seen_15m',label:'Agents seen · 15 min',icon:Server,link:'/admin/operations'},
  {key:'users_total',label:'Platform users',icon:Users,link:'/admin/clients'},
];

export default function PlatformDashboardPage() {
  const [data,setData] = useState<PlatformOverviewResponse|null>(null);
  const [health,setHealth] = useState<any>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const navigate = useNavigate();
  const load = async () => {
    setLoading(true); setError(null);
    try { const [overview,h] = await Promise.all([platformAdminApi.overview(),platformAdminApi.health()]); setData(overview); setHealth(h); }
    catch(e:any) { setError(e?.message ?? 'Platform overview could not be loaded'); }
    finally { setLoading(false); }
  };
  useEffect(()=>{load();},[]);
  const currency = data?.currency ?? 'MAD';
  const mrr = data?.kpis.mrr_recorded ?? 0;
  const activity = data?.audit_activity_14d ?? [];
  const maxActivity = Math.max(1,...activity.map(x=>x.events));
  return <div className="p-4 lg:p-6 space-y-6">
    <header className="flex flex-wrap justify-between items-start gap-3">
      <div><div className="text-xs tracking-[.22em] uppercase text-cyan-400 mb-2">Infracentra · Control Plane</div>
        <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Platform Command Center</h1>
        <p className="text-sm text-[var(--ic-muted)] mt-1">Live portfolio, security operations, connector health and platform activity.</p></div>
      <button onClick={load} className="px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm"><RefreshCw className={'inline w-4 h-4 mr-2 '+(loading?'animate-spin':'')}/>Refresh live data</button>
    </header>
    {error&&<div className="p-3 rounded-lg border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
    <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
      {tiles.map(t=>{const Icon=t.icon;return <button key={t.key} onClick={()=>navigate(t.link)} className="text-left rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] hover:border-cyan-500/50 p-3">
        <Icon size={17} className="text-cyan-400 mb-2"/><div className="text-[11px] text-[var(--ic-muted)]">{t.label}</div>
        <div className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{loading?'…':(data?.kpis as any)?.[t.key] ?? '—'}</div></button>})}
    </section>
    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold text-[var(--ic-heading)]">Worldwide security activity</h2><p className="text-xs text-[var(--ic-muted)]">Geolocated alert telemetry only · approximate locations</p></div><Link to="/threats" className="text-xs text-cyan-400">Open threats <ArrowUpRight className="inline w-3 h-3"/></Link></div>
        <div className="mt-3"><WorldAttackMap heightClass="h-[390px]"/></div>
      </div>
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4 space-y-4">
        <div><h2 className="font-semibold text-[var(--ic-heading)]">Platform health</h2><p className="text-xs text-[var(--ic-muted)]">Backend-confirmed health snapshot</p></div>
        {[['Database',health?.database?.status],['Connectors',health?.connectors?.status]].map(([label,status]:any)=><div key={label} className="flex justify-between items-center p-3 rounded-lg bg-[var(--ic-surface-2)]"><span className="text-sm">{label}</span><span className={'text-xs font-semibold '+(status==='healthy'?'text-emerald-400':status==='attention'?'text-amber-400':'text-rose-400')}>{status ?? (loading?'checking':'unknown')}</span></div>)}
        <div className="pt-2 border-t border-[var(--ic-border)]"><div className="text-xs text-[var(--ic-muted)]">Recorded monthly recurring revenue</div><div className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{loading?'…':new Intl.NumberFormat('fr-FR',{style:'currency',currency,maximumFractionDigits:0}).format(mrr)}</div><Link to="/admin/billing" className="text-xs text-cyan-400">Open global billing →</Link></div>
        <Link to="/admin/operations" className="block w-full text-center rounded-lg bg-cyan-600/15 text-cyan-300 py-2 text-sm">Connector & infrastructure operations</Link>
      </div>
    </section>
    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
        <h2 className="font-semibold text-[var(--ic-heading)]">Platform activity · 14 days</h2><p className="text-xs text-[var(--ic-muted)]">Audit events persisted by the platform; no forecast or synthetic trend.</p>
        <div className="h-44 flex items-end gap-1 mt-5">{activity.map((d,i)=><div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0"><div title={d.events+' events'} className="w-full rounded-t bg-cyan-500/70" style={{height:Math.max(2,(d.events/maxActivity)*125)}}/><span className="text-[9px] text-[var(--ic-muted)]">{d.date.slice(5)}</span></div>)}
        {!activity.length&&<div className="m-auto text-sm text-[var(--ic-muted)]">No audit activity recorded in this period.</div>}</div>
      </div>
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
        <h2 className="font-semibold text-[var(--ic-heading)]">Tenant footprint</h2><p className="text-xs text-[var(--ic-muted)]">Country values from organization records.</p>
        <div className="space-y-3 mt-4">{(data?.tenant_countries??[]).map(x=><div key={x.country}><div className="flex justify-between text-xs mb-1"><span>{x.country}</span><span>{x.count}</span></div><div className="h-1.5 rounded-full bg-[var(--ic-surface-2)] overflow-hidden"><div className="h-full bg-indigo-400" style={{width:Math.min(100,x.count/Math.max(1,...(data?.tenant_countries??[]).map(y=>y.count))*100)+'%'}}/></div></div>)}
        {!data?.tenant_countries.length&&<p className="text-xs text-[var(--ic-muted)]">Country metadata is not available.</p>}</div>
      </div>
    </section>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4">
      <div className="flex justify-between items-center mb-3"><h2 className="font-semibold text-[var(--ic-heading)]">Recent platform audit activity</h2><Link to="/admin/audit" className="text-xs text-cyan-400">Full audit trail →</Link></div>
      <div className="divide-y divide-[var(--ic-border)]">{(data?.recent_activity??[]).slice(0,8).map(row=><div key={row.id} className="py-2 flex flex-wrap gap-2 justify-between text-xs"><div><span className="text-[var(--ic-heading)] font-medium">{row.actor}</span><span className="text-[var(--ic-muted)]"> · {row.action} · {row.resource} {row.resource_id}</span></div><span className={row.outcome==='success'?'text-emerald-400':row.outcome==='blocked'?'text-rose-400':'text-amber-400'}>{row.outcome} · {row.timestamp?new Date(row.timestamp).toLocaleString():'—'}</span></div>)}
      {!data?.recent_activity.length&&<p className="text-xs text-[var(--ic-muted)]">No audit records returned.</p>}</div>
    </section>
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Tenant Manager','/admin/clients'],['Partner Program','/admin/partners'],['Platform Team','/admin/team'],['Billing & Metering','/admin/billing'],['Integrations','/admin/integrations'],['Platform Operations','/admin/operations'],['Service Desk','/client-admin/advanced-tickets'],['Reporting','/reports']].map(([label,to])=><Link key={to} to={to} className="rounded-lg border border-[var(--ic-border)] bg-[var(--ic-surface)] p-3 text-sm hover:border-cyan-500/50">{label} <ArrowUpRight className="inline w-3 h-3 text-cyan-400"/></Link>)}</section>
  </div>;
}
