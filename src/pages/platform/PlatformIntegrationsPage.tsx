import React, { useEffect, useState } from 'react';
import { Activity, PlugZap, Plus, RefreshCw, Trash2, Wrench, Pencil } from 'lucide-react';
import { api } from '../../services/api';

interface IntegrationRow {
  id:number; name:string; service_id:string; integration_type:string; license_type:string;
  pricing:string; status:string; api_endpoint:string|null; documentation_url:string|null;
  last_sync:string|null; notes:string|null; created_at:string;
}
const empty = {name:'',service_id:'',integration_type:'api',license_type:'open-source',pricing:'free',status:'inactive',api_endpoint:'',api_key:'',documentation_url:'',notes:''};

export default function PlatformIntegrationsPage() {
  const [items,setItems] = useState<IntegrationRow[]>([]);
  const [form,setForm] = useState(empty);
  const [showForm,setShowForm] = useState(false);
  const [editId,setEditId] = useState<number|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState<number|null>(null);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const [testResults,setTestResults] = useState<Record<number,string>>({});
  const load = async () => { setLoading(true); setError(null); try { setItems(await api.get<IntegrationRow[]>('/integrations/')); } catch(e:any) { setError(e?.message ?? 'Unable to load integrations'); } finally { setLoading(false); } };
  useEffect(()=>{load();},[]);
  const save = async (e:React.FormEvent) => { e.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      if (editId) {
        const payload: any = { name: form.name, api_endpoint: form.api_endpoint, documentation_url: form.documentation_url, notes: form.notes };
        if (form.api_key) payload.api_key = form.api_key;
        await api.patch('/integrations/' + editId, payload);
        setMessage('Integration updated. Existing secret retained unless a new secret was supplied.');
      } else {
        await api.post('/integrations/',form);
        setMessage('Integration created. Credentials are stored encrypted and never returned by the API.');
      }
      setForm(empty); setEditId(null); setShowForm(false); await load();
    } catch(e:any){setError(e?.message ?? 'Integration save failed');} finally{setSaving(false);}
  };
  const edit = (item: IntegrationRow) => {
    setEditId(item.id); setForm({ ...empty, name:item.name, service_id:item.service_id,
      integration_type:item.integration_type, license_type:item.license_type, pricing:item.pricing,
      status:item.status, api_endpoint:item.api_endpoint ?? '', documentation_url:item.documentation_url ?? '', notes:item.notes ?? '' });
    setShowForm(true);
  };
  const test = async (id:number) => { setBusy(id); setError(null); try { const r=await api.post<{success:boolean;message:string}>(`/integrations/${id}/test`,{}); setTestResults(x=>({...x,[id]:r.message})); await load(); }
    catch(e:any){setError(e?.message ?? 'Connector test failed');} finally{setBusy(null);} };
  const setStatus = async (item:IntegrationRow,status:string) => { setBusy(item.id); setError(null); try { await api.patch(`/integrations/${item.id}`,{status}); await load(); }
    catch(e:any){setError(e?.message ?? 'Integration status update failed');} finally{setBusy(null);} };
  const remove = async (id:number) => { if(!window.confirm('Delete this integration configuration? This does not delete external systems.')) return; setBusy(id); setError(null);
    try { await api.del(`/integrations/${id}`); setMessage('Integration configuration deleted.'); await load(); }
    catch(e:any){setError(e?.message ?? 'Integration deletion failed');} finally{setBusy(null);} };
  const active=items.filter(x=>x.status==='active').length;
  const pending=items.filter(x=>x.status==='pending').length;
  return <div className="p-4 lg:p-6 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-[var(--ic-heading)] flex items-center gap-2"><PlugZap className="w-6 h-6 text-cyan-400"/>Global Integration Registry</h1><p className="text-sm text-[var(--ic-muted)] mt-1">Configure, test, monitor and retire platform integrations. Secrets are write-only.</p></div>
      <div className="flex gap-2"><button onClick={load} className="px-3 py-2 rounded-lg border border-[var(--ic-border)] text-sm"><RefreshCw className="inline w-4 h-4 mr-1"/>Refresh</button><button onClick={()=>{setEditId(null);setForm(empty);setShowForm(x=>!x);}} className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-sm"><Plus className="inline w-4 h-4 mr-1"/>Add integration</button></div></header>
    {error&&<div className="p-3 rounded-lg border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
    {message&&<div className="p-3 rounded-lg border border-emerald-500/30 text-emerald-300 text-sm">{message}</div>}
    {showForm&&<form onSubmit={save} className="rounded-xl border border-cyan-500/30 bg-[var(--ic-surface)] p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <h2 className="md:col-span-2 xl:col-span-3 font-semibold">{editId ? "Edit integration configuration" : "New integration configuration"}</h2>
      <input required placeholder="Integration name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="field"/>
      <input required placeholder="Service ID" disabled={!!editId} value={form.service_id} onChange={e=>setForm({...form,service_id:e.target.value})} className="field"/>
      <select disabled={!!editId} value={form.integration_type} onChange={e=>setForm({...form,integration_type:e.target.value})} className="field"><option value="api">API</option><option value="webhook">Webhook</option><option value="agent">Agent</option><option value="native">Native</option></select>
      <select disabled={!!editId} value={form.license_type} onChange={e=>setForm({...form,license_type:e.target.value})} className="field"><option value="open-source">Open source</option><option value="commercial">Commercial</option><option value="freemium">Freemium</option></select>
      <select disabled={!!editId} value={form.pricing} onChange={e=>setForm({...form,pricing:e.target.value})} className="field"><option value="free">Free</option><option value="paid">Paid</option><option value="custom">Custom</option></select>
      <input placeholder="API endpoint" value={form.api_endpoint} onChange={e=>setForm({...form,api_endpoint:e.target.value})} className="field"/>
      <input type="password" autoComplete="new-password" placeholder={editId ? "Rotate API key (leave blank to keep current)" : "API key / secret (write-only)"} value={form.api_key} onChange={e=>setForm({...form,api_key:e.target.value})} className="field"/>
      <input placeholder="Documentation URL" value={form.documentation_url} onChange={e=>setForm({...form,documentation_url:e.target.value})} className="field"/>
      <input placeholder="Operational notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className="field"/>
      <div className="md:col-span-2 xl:col-span-3 flex gap-2 justify-end"><button type="button" onClick={()=>{setShowForm(false);setEditId(null);setForm(empty);}} className="px-4 py-2 border border-[var(--ic-border)] rounded-lg text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm disabled:opacity-50">{saving?'Saving…':editId ? 'Save changes' : 'Save integration'}</button></div>
    </form>}
    <div className="grid grid-cols-3 gap-3">{[['Registered',items.length],['Active',active],['Pending',pending]].map(([l,v]:any)=><div key={l} className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] p-4"><div className="text-xs text-[var(--ic-muted)]">{l}</div><div className="text-2xl font-bold text-[var(--ic-heading)] mt-1">{loading?'…':v}</div></div>)}</div>
    <section className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] overflow-hidden"><div className="p-4 border-b border-[var(--ic-border)]"><h2 className="font-semibold">Configured integrations</h2><p className="text-xs text-[var(--ic-muted)]">An active status is configuration state; only a successful connector test confirms connectivity.</p></div>
      <div className="divide-y divide-[var(--ic-border)]">{items.map(item=><div key={item.id} className="p-4 flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-semibold text-[var(--ic-heading)]">{item.name}</span><span className="text-[10px] uppercase text-[var(--ic-muted)]">{item.integration_type}</span><span className={'text-[10px] rounded-full px-2 py-0.5 '+(item.status==='active'?'bg-emerald-500/10 text-emerald-400':item.status==='pending'?'bg-amber-500/10 text-amber-400':'bg-slate-500/10 text-slate-400')}>{item.status}</span></div><div className="text-xs text-[var(--ic-muted)] mt-1">{item.service_id} · {item.license_type} · {item.pricing}</div><div className="text-xs text-[var(--ic-muted)]">{item.api_endpoint ?? 'Endpoint not configured'} · last test {item.last_sync?new Date(item.last_sync).toLocaleString():'never'}</div>{testResults[item.id]&&<div className="text-xs text-cyan-300 mt-1">{testResults[item.id]}</div>}</div>
        <div className="flex flex-wrap gap-2 items-center"><button disabled={busy===item.id} onClick={()=>edit(item)} className="px-3 py-1.5 rounded-lg border border-[var(--ic-border)] text-xs"><Pencil className="inline w-3 h-3 mr-1"/>Edit</button><button disabled={busy===item.id} onClick={()=>test(item.id)} className="px-3 py-1.5 rounded-lg border border-cyan-500/30 text-cyan-300 text-xs"><Activity className="inline w-3 h-3 mr-1"/>{busy===item.id?'Testing…':'Test'}</button><select disabled={busy===item.id} value={item.status} onChange={e=>setStatus(item,e.target.value)} className="bg-[var(--ic-surface-2)] border border-[var(--ic-border)] rounded-lg px-2 py-1.5 text-xs"><option value="inactive">Inactive</option><option value="pending">Pending</option><option value="active">Active</option></select><button disabled={busy===item.id} onClick={()=>remove(item.id)} className="p-2 text-rose-400"><Trash2 size={15}/></button></div>
      </div>)}
      {!items.length&&!loading&&<div className="p-8 text-center text-sm text-[var(--ic-muted)]"><Wrench className="mx-auto mb-2 opacity-50"/>No integrations configured. Add a connector configuration before enabling service flows.</div>}</div>
    </section>
    <style>{'.field{background:var(--ic-surface-2);border:1px solid var(--ic-border);border-radius:.5rem;padding:.6rem .75rem;color:var(--ic-text);font-size:.85rem;min-width:0}'}</style>
  </div>;
}
