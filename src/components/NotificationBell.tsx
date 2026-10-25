/**
 * NotificationBell — top-bar bell with a real dropdown panel.
 * Clicking the bell lists the latest notifications (demo world or live
 * backend); clicking an item opens its full detail; items can be
 * acknowledged / retried (dead letters). Subscribes to the global
 * 'notifications-changed' event dispatched by the notification engine
 * so counts stay in sync across pages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, CheckCheck, RefreshCw, Mail, MessageSquare, Webhook, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { isDemoMode } from '../services/demoMode';

interface NotifItem {
  id: number;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  severity: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  created_at: string;
  acked_by?: string | null;
}

const channelIcon: Record<string, any> = { email: Mail, sms: MessageSquare, webhook: Webhook };

function ago(isoStr: string): string {
  const d = new Date(isoStr).getTime();
  const min = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [selected, setSelected] = useState<NotifItem | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: NotifItem[] }>('/notifications?limit=15');
      setItems(res.items ?? []);
    } catch { /* keep previous list */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener('notifications-changed', onChanged);
    window.addEventListener('demo-world-pushed', onChanged);
    return () => {
      window.removeEventListener('notifications-changed', onChanged);
      window.removeEventListener('demo-world-pushed', onChanged);
    };
  }, [load]);

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSelected(null); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const unread = items.filter(n => n.status === 'sent' || n.status === 'queued').length;
  const dead = items.filter(n => n.status === 'dead_letter').length;

  async function ack(n: NotifItem) {
    try { await api.post(`/notifications/${n.id}/ack`, {}); } catch { /* offline demo-safe */ }
    setSelected(null); setOpen(false);
    window.dispatchEvent(new Event('notifications-changed'));
  }

  async function retryAll() {
    try { await api.post('/notifications/retry-failed', {}); } catch { /* ignore */ }
    load();
    window.dispatchEvent(new Event('notifications-changed'));
  }

  const Icon = channelIcon[selected?.channel ?? ''] ?? Bell;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(o => !o); setSelected(null); load(); }}
        className="relative p-2 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] transition-colors"
        title="Notifications"
        aria-label={`Notifications (${unread} unread)`}
      >
        <Bell className="w-5 h-5" />
        {(unread + dead) > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-cyber-red text-[10px] font-bold text-[var(--ic-heading)] animate-pulse">
            {unread + dead}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[380px] sm:w-[420px] max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--ic-border)] bg-[var(--ic-bg)]/95 backdrop-blur-xl shadow-2xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ic-border)] sticky top-0 bg-[var(--ic-bg)]/95">
            <div className="text-sm font-semibold text-[var(--ic-heading)]">Notifications
              <span className="ml-2 text-xs text-[var(--ic-muted)]">{items.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {dead > 0 && (
                <button onClick={retryAll} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20">
                  <RefreshCw className="w-3 h-3" /> Retry failed ({dead})
                </button>
              )}
              <button onClick={() => { setOpen(false); navigate('/client-admin/notifications'); }}
                className="text-[11px] text-cyan-400 hover:text-cyan-300">View all</button>
              <button onClick={() => setOpen(false)} className="text-[var(--ic-muted)] hover:text-[var(--ic-heading)]"><X className="w-4 h-4" /></button>
            </div>
          </div>

          {!isDemoMode() && items.length === 0 && (
            <div className="p-6 text-center text-sm text-[var(--ic-muted)]">
              No notifications yet. The delivery log will appear here once rules fire.
            </div>
          )}

          {items.map(n => {
            const C = channelIcon[n.channel] ?? Bell;
            const sevColor = n.severity === 'critical' ? 'bg-rose-500' : n.severity === 'high' ? 'bg-orange-500' : 'bg-cyan-500';
            const statusColor = n.status === 'dead_letter' ? 'text-rose-400' : n.status === 'acked' ? 'text-emerald-400' : 'text-[var(--ic-muted)]';
            return (
              <button key={n.id} onClick={() => setSelected(selected?.id === n.id ? null : n)}
                className="w-full text-left px-4 py-3 border-b border-[var(--ic-border)] hover:bg-[var(--ic-surface)] transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative mt-0.5">
                    <C className="w-4 h-4 text-[var(--ic-muted)]" />
                    {(n.status === 'sent' || n.status === 'queued') && (
                      <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${sevColor}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[var(--ic-heading)] truncate">{n.subject}</div>
                    <div className="text-xs text-[var(--ic-muted)] truncate">{n.recipient}</div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className={`${statusColor} capitalize`}>{n.status.replace('_', ' ')}</span>
                      <span className="text-[var(--ic-muted)]">·</span>
                      <span className="text-[var(--ic-muted)]">{ago(n.created_at)} ago</span>
                      {n.attempts > 1 && <span className="text-[var(--ic-muted)]">· {n.attempts} tries</span>}
                    </div>
                  </div>
                </div>
                {selected?.id === n.id && (
                  <div className="mt-3 ml-7 rounded-lg border border-[var(--ic-border)] ic-page/60 p-3 space-y-2" onClick={e => e.stopPropagation()}>
                    <div className="text-xs text-[var(--ic-text)] whitespace-pre-wrap">{n.body}</div>
                    {n.last_error && (
                      <div className="flex items-start gap-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md p-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {n.last_error}
                      </div>
                    )}
                    <div className="text-[11px] text-[var(--ic-muted)]">
                      Channel: {n.channel.toUpperCase()} · Severity: {n.severity}
                      {n.acked_by ? ` · Acked by ${n.acked_by}` : ''}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {(n.status === 'sent' || n.status === 'queued') && (
                        <button onClick={() => ack(n)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20">
                          <CheckCheck className="w-3.5 h-3.5" /> Acknowledge
                        </button>
                      )}
                      <button onClick={() => { setOpen(false); navigate('/client-admin/notifications'); }}
                        className="text-[11px] px-2.5 py-1.5 rounded-md bg-[var(--ic-surface)] text-[var(--ic-text)] hover:bg-[var(--ic-surface-2)] border border-[var(--ic-border)]">
                        Open engine
                      </button>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
