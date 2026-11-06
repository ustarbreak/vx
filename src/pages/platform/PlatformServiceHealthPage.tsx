import React,{useCallback,useEffect,useState} from 'react';
import {Activity,AlertTriangle,CheckCircle2,Clock3,Database,RefreshCw,Server,ShieldAlert,XCircle} from 'lucide-react';
import {ApiError,platformServiceHealthApi,type PlatformServiceHealth} from '../../services/api';

export default function PlatformServiceHealthPage(){
 const [items,setItems]=useState<PlatformServiceHealth[]>([]);
 const [checked,setChecked]=useState<number|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const [catalog,health]=await Promise.all([platformServiceHealthApi.catalog(),platformServiceHealthApi.sync()]);
   const byId=new Map(health.results.map(x=>[x.service_id,x]));
   setItems(catalog.map(x=>({...x,...(byId.get(x.service_id)||{})})));
   setChecked(health.checked);
  }catch(e){setItems([]);setChecked(null);setError(e instanceof ApiError?e.message:String(e));}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 const reachable=items.filter(x=>x.reachable===true).length;
 const failed=items.filter(x=>x.configured===true&&x.reachable===false).length;
 const unconfigured=items.filter(x=>x.configured===false).length;
 return <main className="p-4 lg:p-6 space-y-6">
  <header className="flex flex-wrap justify-between items-start gap-4">
   <div><div className="flex items-center gap-2"><Activity className="w-6 h-6 text-cyan-400"/><h1 className="text-2xl font-bold text-[var(--ic-heading)]">Platform Service Health</h1></div>
    <p className="text-sm text-[var(--ic-muted)] mt-1">Global health checks across the service connector catalog.</p>
    <p className="text-xs text-[var(--ic-muted)] mt-2">Reachability is based on active connector probes, not configuration labels or inferred uptime.</p></div>
   <button onClick={()=>void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--ic-border)] px-3 py-2 text-sm"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/>Run health checks</button>
  </header>
  {error&&<div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400 flex gap-2"><AlertTriangle className="w-4 h-4"/>{error}</div>}
  <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
   {[['Catalog services',items.length,Server],['Reachable',reachable,CheckCircle2],['Configured but failing',failed,ShieldAlert],['Not configured',unconfigured,Database]].map(([label,value,Icon]:any)=><div key={label} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><div className="flex justify-between text-xs text-[var(--ic-muted)]"><span>{label}</span><Icon className="w-4 h-4 text-cyan-400"/></div><p className="mt-2 text-2xl font-bold text-[var(--ic-heading)]">{value}</p></div>)}
  </section>
  <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden">
   <div className="p-4 border-b border-[var(--ic-border)] flex justify-between gap-3"><div><h2 className="font-semibold text-[var(--ic-heading)]">Service connector health</h2><p className="text-xs text-[var(--ic-muted)] mt-1">{checked===null?'No check result':`${checked} connectors checked in the latest run`}</p></div><span className="text-xs text-[var(--ic-muted)]">{loading?'Checking…':`Updated ${new Date().toLocaleTimeString()}`}</span></div>
   {loading&&!items.length?<p className="p-8 text-sm text-[var(--ic-muted)]">Running platform service checks…</p>:<div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm">
    <thead className="bg-[var(--ic-surface-2)] text-[11px] uppercase text-[var(--ic-muted)]"><tr><th className="p-3 text-left">Service</th><th className="p-3 text-left">Engine</th><th className="p-3 text-left">Configuration</th><th className="p-3 text-left">Reachability</th><th className="p-3 text-left">Probe detail</th></tr></thead>
    <tbody>{items.map(x=><tr key={x.service_id} className="border-t border-[var(--ic-border)]">
     <td className="p-3 font-medium text-[var(--ic-heading)]">{x.service_id}</td><td className="p-3 text-xs text-[var(--ic-muted)]">{x.engine}</td>
     <td className="p-3 text-xs">{x.configured===false?<span className="text-amber-400">Not configured</span>:x.configured===true?<span className="text-emerald-400">Configured</span>:<span className="text-[var(--ic-muted)]">Unavailable</span>}</td>
     <td className="p-3 text-xs">{x.reachable===true?<span className="text-emerald-400"><CheckCircle2 className="inline w-3.5 h-3.5 mr-1"/>Reachable</span>:x.reachable===false?<span className={x.configured?'text-red-400':'text-[var(--ic-muted)]'}><XCircle className="inline w-3.5 h-3.5 mr-1"/>{x.configured?'Unreachable':'Not tested'}</span>:<span className="text-[var(--ic-muted)]">No probe result</span>}</td>
     <td className="p-3 text-xs text-[var(--ic-muted)]">{x.reason|| (x.latency_ms!==undefined?`Latency ${x.latency_ms} ms`:'No detail reported')}</td>
    </tr>)}{!items.length&&<tr><td colSpan={5} className="p-8 text-center text-sm text-[var(--ic-muted)]">Service catalog is unavailable or empty.</td></tr>}</tbody>
   </table></div>}
  </section>
  <p className="text-xs text-[var(--ic-muted)] flex items-center gap-2"><Clock3 className="w-3.5 h-3.5"/>A failed or unconfigured connector is not counted as healthy. This view does not claim an uptime SLA.</p>
 </main>;
}
