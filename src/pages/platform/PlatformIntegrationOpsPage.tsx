import React, { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, KeyRound, PlugZap, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { ApiError, platformIntegrationOpsApi, type PlatformIntegration } from '../../services/api';

export default function PlatformIntegrationOpsPage() {
  const [items,setItems]=useState<PlatformIntegration[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<number|null>(null);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState<Record<number,{success:boolean;message:string}>>({});
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setItems(await platformIntegrationOpsApi.list());}
    catch(e){setItems([]);setError(e instanceof ApiError?e.message:String(e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const test=async(item:PlatformIntegration)=>{
    setBusy(item.id);setError('');
    try{
      const result=await platformIntegrationOpsApi.test(item.id);
      setFeedback(prev=>({...prev,[item.id]:result}));
      await load();
    }catch(e){setError(e instanceof ApiError?e.message:String(e));}
    finally{setBusy(null);}
  };
  const setStatus=async(item:PlatformIntegration,status:string)=>{
    setBusy(item.id);setError('');
    try{await platformIntegrationOpsApi.update(item.id,{status});await load();}
    catch(e){setError(e instanceof ApiError?e.message:String(e));}
    finally{setBusy(null);}
  };
  const active=items.filter(x=>x.status==='active').length;
  const configured=items.filter(x=>!!x.api_endpoint).length;
  return <main className="p-4 lg:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><PlugZap className="w-6 h-6 text-cyan-400"/><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Integration Operations</h1></div>
      <p className="text-sm text-[var(--ic-muted)] mt-1">Global connector inventory, configuration controls and real connection tests.</p><p className="text-xs text-[var(--ic-muted)] mt-2">Configuration status is separate from verified reachability. Only a successful connector test updates last-sync evidence.</p></div>
      <button onClick={()=>void load()} disabled={loading||busy!==null} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Refresh</button>
    </header>
    {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400 flex gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>}
    <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {[['Registered connectors',items.length,PlugZap],['Configured endpoints',configured,KeyRound],['Marked active',active,ShieldCheck],['Not verified / inactive',items.length-active,Activity]].map(([label,value,Icon]:any)=><div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><div className="flex justify-between text-xs text-[var(--ic-muted)]"><span>{label}</span><Icon className="w-4 h-4 text-cyan-400"/></div><p className="mt-2 text-2xl font-bold text-[var(--ic-heading)]">{value}</p></div>)}
    </section>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
      <div className="p-4 border-b border-[var(--ic-border)]"><h2 className="font-semibold text-[var(--ic-heading)]">Connector inventory</h2><p className="text-xs text-[var(--ic-muted)] mt-1">Credentials are never returned to this page. Connection tests use server-side encrypted credentials.</p></div>
      {loading?<p className="p-8 text-sm text-[var(--ic-muted)]">Loading connectors…</p>:<div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-[var(--ic-surface-2)] text-[11px] uppercase text-[var(--ic-muted)]"><tr><th className="p-3 text-left">Connector</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Configuration</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Last successful test</th><th className="p-3 text-left">Operations</th></tr></thead>
        <tbody>{items.map(item=><tr key={item.id} className="border-t border-[var(--ic-border)]">
          <td className="p-3"><p className="font-medium text-[var(--ic-heading)]">{item.name}</p><p className="text-[11px] text-[var(--ic-muted)]">{item.service_id} · #{item.id}</p></td>
          <td className="p-3 text-xs text-[var(--ic-muted)]">{item.integration_type}<p>{item.license_type} · {item.pricing}</p></td>
          <td className="p-3 text-xs">{item.api_endpoint?<span className="text-emerald-400">Endpoint configured</span>:<span className="text-amber-400">Endpoint missing</span>}<p className="text-[10px] text-[var(--ic-muted)] max-w-[240px] truncate">{item.api_endpoint||'Not configured'}</p></td>
          <td className="p-3"><select aria-label={`Status ${item.name}`} disabled={busy!==null} value={item.status} onChange={e=>void setStatus(item,e.target.value)} className="rounded-md border border-[var(--ic-border)] bg-[var(--ic-surface-2)] px-2 py-1 text-xs text-[var(--ic-heading)]">{['active','inactive','pending'].map(s=><option key={s}>{s}</option>)}</select></td>
          <td className="p-3 text-xs text-[var(--ic-muted)]">{item.last_sync?new Date(item.last_sync).toLocaleString():'No successful test recorded'}</td>
          <td className="p-3"><button disabled={busy!==null} onClick={()=>void test(item)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300 disabled:opacity-50"><Activity className="w-3.5 h-3.5"/>{busy===item.id?'Testing…':'Test connection'}</button>
            {feedback[item.id]&&<p className={`mt-2 max-w-[280px] text-[11px] ${feedback[item.id].success?'text-emerald-400':'text-red-400'}`}>{feedback[item.id].success?<CheckCircle2 className="inline w-3 h-3 mr-1"/>:<XCircle className="inline w-3 h-3 mr-1"/>}{feedback[item.id].message}</p>}
          </td>
        </tr>)}{!items.length&&<tr><td colSpan={6} className="p-8 text-center text-sm text-[var(--ic-muted)]">No persisted integrations found.</td></tr>}</tbody>
      </table></div>}
    </section>
  </main>;
}
