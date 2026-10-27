import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, isDemoMode } from '../context/AuthContext';
import { DEMO_WORLD_VERSION, computeDemoStats, isDemoWorldInstalled } from '../data/demoWorld';

import { useTheme } from '../context/ThemeContext';
import Clock from './Clock';
import Breadcrumb from './Breadcrumb';
import NotificationBell from './NotificationBell';
import {
  Shield, LayoutDashboard, AlertTriangle, Target, FileCheck, FileBarChart2,
  Activity, Settings, LogOut, ChevronLeft, ChevronRight,
  Bell, Search, Menu, Zap, Users, Building2, Network,
  HardDrive, UserCog, BarChart3, ClipboardList, ShieldCheck,
  Sun, Moon, Key, Ticket, Mail, Cloud, Wifi, Lock, Globe,
  Scan, Wrench, Database, Monitor, TrendingUp, Package,
  BellRing, Radio, Inbox, CheckCircle2, FolderKanban, Users2, Radar, Server, FileText, Palette,
  MonitorSmartphone
} from 'lucide-react';
import { partnerById } from '../data/partnerWorld';

// ---------------------------------------------------------------------------
// PushDemoButton — visible ONLY while Demo Mode is ON.
// One click materialises the single coherent demo world (devices, alerts,
// tickets, technicians, playbooks) into the simulated backend so every page
// and engine (ticketing, notifications, SOAR, discovery, reports) reads the
// exact same synchronized numbers.
// ---------------------------------------------------------------------------
function PushDemoButton() {
  const [state, setState] = useState<'idle' | 'pushing' | 'done'>('idle');

  useEffect(() => {
    if (isDemoWorldInstalled()) setState('done');
    const onPushed = () => setState('done');
    window.addEventListener('demo-world-pushed', onPushed);
    return () => window.removeEventListener('demo-world-pushed', onPushed);
  }, []);

  const push = async () => {
    setState('pushing');
    try {
      // Same path as the real API client — in Demo Mode it is answered by the
      // in-memory simulated backend (services/demoMode.ts), never the network.
      const base = (import.meta as any).env?.VITE_API_URL || '/api/v1';
      await fetch(`${base}/settings/push-demo-world`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch { /* demo fetch always resolves via interceptor; ignore */ }
    setState('done');
    window.dispatchEvent(new Event('demo-world-pushed'));
  };

  const st = computeDemoStats();
  return (
    <button
      onClick={push}
      title={`Injects the synchronized demo dataset (${st.devicesTotal} devices · ${st.alertsTotal} alerts · ${st.ticketsTotal} tickets) into all engines`}
      className={`w-full mt-3 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all border flex items-center gap-2 justify-start
        ${state === 'done'
          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
          : state === 'pushing'
            ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 animate-pulse'
            : 'bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20'}`}
    >
      {state === 'done'
        ? <><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="leading-tight">Demo data live<br /><span className="text-[9px] opacity-70">v{DEMO_WORLD_VERSION} · {st.devicesTotal} dev / {st.alertsTotal} alerts / {st.ticketsTotal} tickets</span></span></>
        : state === 'pushing'
          ? <><Zap className="w-3.5 h-3.5 flex-shrink-0 animate-spin" /><span>Pushing demo world…</span></>
          : <><Database className="w-3.5 h-3.5 flex-shrink-0" /><span className="leading-tight">Push Demo Dataset<br /><span className="text-[9px] opacity-70">sync all engines & dashboards</span></span></>}
    </button>
  );
}

interface NavItem {
  to: string;
  icon: any;
  label: string;
  /** Optional live badge count (Active Incidents, Pending Tickets…). */
  badge?: number;
}

/** Collapsible parent entry with sub-items revealed on hover / click. */
interface NavGroup {
  group: true;
  icon: any;
  label: string;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => (e as NavGroup).group === true;

// ---------------------------------------------------------------------------
// Command palette index — every feature searchable under BOTH its new and its
// legacy name (typing "tickets" finds "Service Desk", etc.). Ctrl/Cmd+K.
// ---------------------------------------------------------------------------
const COMMAND_INDEX: { label: string; aliases: string; to: string }[] = [
  { label: 'Executive Dashboard', aliases: 'overview dashboard home value receipt roi', to: '/client-admin/dashboard' },
  { label: 'ROI & Business Value', aliases: 'value loyalty receipt money savings proof pack roi', to: '/client-admin/dashboard' },
  { label: 'Active Incidents', aliases: 'alerts threats open incidents', to: '/client-admin/alerts' },
  { label: 'Performance Metrics', aliases: 'statistics stats kpi mttr mttd', to: '/client-admin/statistics' },
  { label: 'Notification Center', aliases: 'notification engine rules email sms webhook', to: '/client-admin/notifications' },
  { label: 'Incidents & Statistics', aliases: 'security history devices network system performance compliance', to: '/client-admin/statistics' },
  { label: 'Topology Visualizer', aliases: 'infrastructure map topology network map', to: '/client-admin/infrastructure' },
  { label: 'Asset Inventory — Auto Discovery', aliases: 'discovery scan snmp network cidr fingerprint', to: '/client-admin/monitored-devices' },
  { label: 'Asset Inventory — Scan History', aliases: 'scans history previous runs results', to: '/client-admin/scan-history' },
  { label: 'Asset Inventory — Monitored Devices', aliases: 'cmdb monitored assets clients projects preview', to: '/client-admin/asset-inventory' },
  { label: 'Collection Agents', aliases: 'agent probe goinfra install token enrollment remote collector fleet', to: '/client-admin/agents' },
  { label: 'Service Desk', aliases: 'tickets ticketing advanced tickets', to: '/client-admin/advanced-tickets' },
  { label: 'Playbooks', aliases: 'soar automation custom playbooks runbooks scripts', to: '/client-admin/playbooks' },
  { label: 'Project Portfolio', aliases: 'projects project manager delivery', to: '/projects' },
  { label: 'Compliance Posture', aliases: 'compliance reports iso nis2 rgpd pci', to: '/client-admin/compliance-reports' },
  { label: 'Advanced Reporting', aliases: 'reports builder unified pdf csv', to: '/reports' },
  { label: 'Team & Roles', aliases: 'technicians users staff admins', to: '/client-admin/technicians' },
  { label: 'Subscription & Billing', aliases: 'plans billing pricing seats', to: '/client-admin/plans' },
  { label: 'Platform Configuration', aliases: 'settings configuration', to: '/settings' },
  { label: 'Threat Intel Feed', aliases: 'threat intelligence iocs', to: '/threats' },
  { label: 'IR Workspace', aliases: 'incident response ir', to: '/incidents' },
  { label: 'Vulnerability Management', aliases: 'vulnerability scanning cve', to: '/client-admin/vulnerability-scanning' },
  { label: 'Patch & Remediation', aliases: 'patch management psa', to: '/client-admin/patch-management' },
];

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  if (!open) return null;
  const ql = q.toLowerCase().trim();
  const results = COMMAND_INDEX.filter(c => !ql || (c.label + ' ' + c.aliases).toLowerCase().includes(ql)).slice(0, 8);
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-[var(--ic-surface)] border border-[var(--ic-primary)] rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && results[0]) { navigate(results[0].to); onClose(); } }}
          placeholder="Search features… (try “tickets”, “playbooks”, “value”)"
          className="w-full px-4 py-3 bg-transparent text-sm text-[var(--ic-heading)] placeholder-slate-500 outline-none border-b border-[var(--ic-border)]" />
        <ul className="max-h-72 overflow-y-auto py-1">
          {results.map(r => (
            <li key={r.label + r.to}>
              <button onClick={() => { navigate(r.to); onClose(); }}
                className="w-full text-left px-4 py-2 text-sm text-[var(--ic-text)] hover:bg-cyan-500/10 hover:text-cyan-300 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-[var(--ic-muted)]" /> {r.label}
              </button>
            </li>
          ))}
          {!results.length && <li className="px-4 py-3 text-sm text-[var(--ic-muted)]">No match.</li>}
        </ul>
        <p className="px-4 py-2 text-[10px] text-[var(--ic-muted)] border-t border-[var(--ic-border)]">Ctrl/Cmd + K to open · Enter to go · Esc to close</p>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, organization, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [, forceRender] = useState(0);
  useEffect(() => {
    const h = () => forceRender(n => n + 1);
    window.addEventListener('demo-mode-changed', h);
    return () => window.removeEventListener('demo-mode-changed', h);
  }, []);
  // Global Ctrl/Cmd+K opens the command palette anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Build navigation based on role
  let operationsNav: NavEntry[] = [];
  let adminNav: NavEntry[] = [];
  let servicesNav: NavEntry[] = [];

  if (user?.role === 'platform_admin') {
    operationsNav = [
      { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/admin/clients', icon: Building2, label: 'Tenant Manager (Clients)' },
      { to: '/admin/partners', icon: Users2, label: 'Partner Program (MSP)' },
      { to: '/admin/themes', icon: Palette, label: 'Infracentra Themes' },
      { to: '/admin/audit', icon: ClipboardList, label: 'Audit Log' },
      { to: '/admin/services-ops', icon: BellRing, label: 'Ticketing & Alerts Ops' },
      { to: '/projects', icon: FolderKanban, label: 'Project Manager' },
      { to: '/client-admin/advanced-tickets', icon: Ticket, label: 'Service Desk' },
      { to: '/client-admin/notifications', icon: Radio, label: 'Notifications' },
      {
        group: true, icon: Zap, label: 'Automation', items: [
          { to: '/client-admin/playbooks', icon: Zap, label: 'Playbooks' },
          { to: '/client-admin/automation/scripts', icon: Scan, label: 'Scripts' },
          { to: '/client-admin/automation/runbooks', icon: FileText, label: 'Runbooks' },
        ],
      },
    ];
    adminNav = [
      { to: '/admin/settings', icon: Settings, label: 'Platform Settings' },
      { to: '/admin/packs', icon: Package, label: 'Pack Customizer' },
      {
        group: true, icon: Monitor, label: 'Asset Inventory', items: [
          { to: '/client-admin/monitored-devices', icon: Radar, label: 'Auto Discovery' },
          { to: '/client-admin/scan-history', icon: Clock, label: 'Scan History' },
          { to: '/client-admin/agents', icon: MonitorSmartphone, label: 'Collection Agents' },
        ],
      },
    ];
  } else if (user?.role === 'partner_admin') {
    // MSP Partner Portal — white-label. Partners manage THEIR OWN end-clients;
    // they never see Infracentra's direct clients nor other partners.
    const me = partnerById(String(user.orgId ?? ''));
    operationsNav = [
      { to: '/partner/dashboard', icon: LayoutDashboard, label: `${me?.branding.brand_name ?? 'Partner'} Dashboard` },
      { to: '/partner/clients', icon: Building2, label: 'My Clients' },
      { to: '/client-admin/alerts', icon: AlertTriangle, label: 'Active Incidents' },
      { to: '/client-admin/advanced-tickets', icon: Inbox, label: 'Service Desk' },
      {
        group: true, icon: Monitor, label: 'Asset Inventory', items: [
          { to: '/client-admin/monitored-devices', icon: Radar, label: 'Auto Discovery' },
          { to: '/client-admin/scan-history', icon: Clock, label: 'Scan History' },
          { to: '/client-admin/asset-inventory', icon: Server, label: 'Monitored Devices' },
          { to: '/client-admin/agents', icon: MonitorSmartphone, label: 'Collection Agents' },
        ],
      },
      { to: '/reports', icon: FileBarChart2, label: 'Client Reports' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
    ];
    adminNav = [
      { to: '/partner/value', icon: TrendingUp, label: 'Value & Loyalty' },
      { to: '/partner/licensing', icon: ShieldCheck, label: 'Licensing & Usage' },
      { to: '/partner/branding', icon: Globe, label: 'Branding & Domain' },
      { to: '/partner/training', icon: Users, label: 'Team Training' },
      { to: '/settings', icon: Settings, label: 'Settings' },
    ];
    servicesNav = [];
  } else if (user?.role === 'client_admin') {
    operationsNav = [
      { to: '/client-admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/client-admin/alerts', icon: AlertTriangle, label: 'Active Incidents', badge: undefined },
      { to: '/client-admin/statistics', icon: BarChart3, label: 'Performance Metrics' },
      { to: '/client-admin/notifications', icon: Radio, label: 'Notifications' },
      // Grouped drop-down (hover/click expands): everything incident/statistic related.
      {
        group: true, icon: Activity, label: 'Incidents & Statistics', items: [
          { to: '/client-admin/security-history', icon: Shield, label: 'Security History' },
          { to: '/client-admin/statistics', icon: BarChart3, label: 'Statistics' },
          { to: '/client-admin/statistics/devices', icon: Monitor, label: 'Devices' },
          { to: '/client-admin/statistics/network', icon: Network, label: 'Network Statistics' },
          { to: '/client-admin/statistics/performance', icon: Activity, label: 'System Performance' },
          { to: '/client-admin/compliance-reports', icon: FileCheck, label: 'Compliance' },
        ],
      },
      // "Architecture & Integration" hidden for now — see INTEGRATION-HIDDEN.md
      // to bring it back online (one line to re-add + one route already exists).
      { to: '/client-admin/infrastructure', icon: Network, label: 'Infrastructure Map' },
      {
        group: true, icon: Zap, label: 'Automation', items: [
          { to: '/client-admin/playbooks', icon: Zap, label: 'Playbooks' },
          { to: '/client-admin/automation/scripts', icon: Scan, label: 'Scripts' },
          { to: '/client-admin/automation/runbooks', icon: FileText, label: 'Runbooks' },
        ],
      },
      { to: '/client-admin/advanced-tickets', icon: Inbox, label: 'Service Desk' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
      { to: '/reports', icon: FileBarChart2, label: 'Advanced Reporting' },
    ];
    adminNav = [
      { to: '/client-admin/plans', icon: ShieldCheck, label: 'Subscription & Billing' },
      {
        group: true, icon: Monitor, label: 'Asset Inventory', items: [
          { to: '/client-admin/monitored-devices', icon: Radar, label: 'Auto Discovery' },
          { to: '/client-admin/scan-history', icon: Clock, label: 'Scan History' },
          { to: '/client-admin/asset-inventory', icon: Server, label: 'Monitored Devices' },
          { to: '/client-admin/agents', icon: MonitorSmartphone, label: 'Collection Agents' },
        ],
      },
      { to: '/client-admin/technicians', icon: UserCog, label: 'Team & Roles' },
      { to: '/client-admin/entitlements', icon: Key, label: 'My Services' },
      { to: '/settings', icon: Settings, label: 'Platform Configuration' },
    ];
    servicesNav = [
      // Security Services
      { to: '/threats', icon: Target, label: 'Threat Intelligence' },
      { to: '/compliance', icon: FileCheck, label: 'Compliance' },
      { to: '/incidents', icon: AlertTriangle, label: 'Incident Response' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics' },
      { to: '/client-admin/soar', icon: Zap, label: 'SOAR Automation' },
      { to: '/client-admin/endpoint-protection', icon: Shield, label: 'Endpoint Protection' },
      { to: '/client-admin/email-security', icon: Mail, label: 'Email Security' },
      { to: '/client-admin/cloud-security', icon: Cloud, label: 'Cloud Security' },
      // Network Services
      { to: '/network', icon: Network, label: 'Network Monitoring' },
      { to: '/client-admin/dns-filtering', icon: Globe, label: 'DNS Filtering' },
      { to: '/client-admin/firewall-mgmt', icon: Lock, label: 'Firewall Management' },
      { to: '/client-admin/vpn-gateway', icon: Wifi, label: 'VPN Gateway' },
      { to: '/client-admin/sd-wan', icon: Network, label: 'SD-WAN' },
      // PSA Services
      { to: '/client-admin/vulnerability-scanning', icon: Scan, label: 'Vulnerability Scanning' },
      { to: '/client-admin/patch-management', icon: Wrench, label: 'Patch Management' },
      { to: '/client-admin/backup-dr', icon: Database, label: 'Backup & DR' },
    ];
  } else {
    // client_user
    operationsNav = [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/threats', icon: Target, label: 'Threat Intel' },
      { to: '/compliance', icon: FileCheck, label: 'Compliance' },
      { to: '/incidents', icon: AlertTriangle, label: 'Incidents' },
      { to: '/analytics', icon: Activity, label: 'Analytics' },
      { to: '/network', icon: Network, label: 'Network' },
      { to: '/psa', icon: HardDrive, label: 'PSA' },
      { to: '/portal', icon: Inbox, label: 'Client Portal' },
      { to: '/projects', icon: FolderKanban, label: 'Projects' },
    ];
    adminNav = [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ];
  }

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const renderEntries = (items: NavEntry[], color: string = 'cyan') =>
    items.map(item => {
      if (isGroup(item)) {
        const expanded = openGroups[item.label] || collapsed;
        return (
          <div key={item.label} className="relative group/group"
            onMouseEnter={() => setOpenGroups(g => ({ ...g, [item.label]: true }))}
            onMouseLeave={() => setOpenGroups(g => ({ ...g, [item.label]: false }))}>
            <button
              onClick={() => setOpenGroups(g => ({ ...g, [item.label]: !g[item.label] }))}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] transition-all">
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium flex-1 text-left">{item.label}</span>}
              {!collapsed && <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />}
            </button>
            {expanded && (
              <div className={`${collapsed ? 'absolute left-full top-0 ml-2 z-50 bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-2 shadow-2xl min-w-[200px]' : 'ml-5 border-l border-[var(--ic-border)] pl-2 my-1'} space-y-0.5`}>
                {renderNavItemsFlat(item.items, color)}
              </div>
            )}
          </div>
        );
      }
      return renderNavItems([item], color);
    });

  const renderNavItemsFlat = (items: NavItem[], color: string) =>
    items.map(item => (
      <NavLink key={item.to + item.label} to={item.to} end
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium w-full
          ${isActive
            ? (color === 'purple'
              ? 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
              : color === 'green'
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                : 'bg-cyan-500/10 text-cyan-300 border border-[var(--ic-border)]')
            : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] border border-transparent'}`
        }>
        <item.icon className="w-4 h-4 flex-shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {item.badge !== undefined && item.badge > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/20 border border-red-500/40 text-[10px] font-bold text-red-300 flex items-center justify-center">{item.badge}</span>
        )}
      </NavLink>
    ));

  const renderNavItems = (items: NavItem[], color: string = 'cyan') => renderNavItemsFlat(items, color);


  return (
    <div className="flex h-screen overflow-hidden ic-page">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-20' : 'w-64'} hidden lg:flex flex-col transition-all duration-300
        bg-[var(--ic-bg)]/95 backdrop-blur-xl border-r border-[var(--ic-border)]`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--ic-border)]">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-[var(--ic-heading)]" />
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-cyber-green rounded-full animate-pulse" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                {user?.role === 'partner_admin' ? (partnerById(String(user.orgId ?? ''))?.branding.brand_name ?? 'Partner Portal') : 'Infracentra'}
              </h1>
              <p className="text-[10px] text-[var(--ic-muted)] font-mono tracking-wider">
                {user?.role === 'platform_admin' ? 'PLATFORM ADMIN' : user?.role === 'partner_admin' ? 'PARTNER PORTAL · MSP' : 'CLIENT PORTAL'}
              </p>
              {isDemoMode() && (
                <>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[9px] font-semibold text-amber-400 uppercase tracking-wider">
                    Demo Mode · 16 services + ticketing unlocked
                  </span>
                  <PushDemoButton />
                </>
              )}
            </div>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {!collapsed && <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">
            {user?.role === 'platform_admin' ? 'Platform Operations' : user?.role === 'client_admin' ? 'Dashboard & Intelligence' : 'Operations'}
          </p>}
          {renderEntries(operationsNav, user?.role === 'platform_admin' ? 'purple' : 'cyan')}

          {adminNav.length > 1 && (
            <>
              {!collapsed && <p className="px-3 pt-4 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">
                {user?.role === 'platform_admin' ? 'System' : user?.role === 'client_admin' ? 'Service Delivery & Operations' : 'Account'}
              </p>}
              {collapsed && <div className="my-3 border-t border-[var(--ic-border)]" />}
              {renderEntries(adminNav, 'cyan')}
            </>
          )}

          {servicesNav.length > 0 && (
            <>
              {!collapsed && <p className="px-3 pt-4 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">
                Security & Network Services
              </p>}
              {collapsed && <div className="my-3 border-t border-[var(--ic-border)]" />}
              {renderEntries(servicesNav, 'green')}
            </>
          )}
        </nav>

        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mx-3 mb-3 p-2 rounded-lg text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-[var(--ic-surface-2)] transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* User Info */}
        {!collapsed && user && (
          <div className="px-4 py-3 border-t border-[var(--ic-border)]">
            <button onClick={() => navigate(user?.role === 'platform_admin' ? '/admin/settings' : '/settings')}
              className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg text-sm font-medium text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] transition-colors">
              <Settings className="w-4 h-4" /> Settings
            </button>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center text-xs font-bold">
                {user.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--ic-heading)] truncate">{user.name}</p>
                <p className="text-xs text-[var(--ic-muted)] truncate">{organization?.name || 'Platform Admin'}</p>
              </div>
              <button onClick={handleLogout} className="p-1.5 rounded text-[var(--ic-muted)] hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-[var(--ic-surface)] border-r border-[var(--ic-border)] overflow-y-auto">
            <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--ic-border)]">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-[var(--ic-heading)]" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Infracentra</h1>
                <p className="text-[10px] text-[var(--ic-muted)] font-mono">2027</p>
              </div>
            </div>
            <nav className="px-3 py-4 space-y-1">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">Operations</p>
              {renderEntries(operationsNav, user?.role === 'platform_admin' ? 'purple' : 'cyan')}
              {adminNav.length > 1 && (
                <>
                  <p className="px-3 pt-4 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">
                    {user?.role === 'client_admin' ? 'Administration' : 'Account'}
                  </p>
                  {renderEntries(adminNav, 'cyan')}
                </>
              )}
              {servicesNav.length > 0 && (
                <>
                  <p className="px-3 pt-4 pb-1 text-[10px] font-semibold text-[var(--ic-muted)] uppercase tracking-widest">
                    Services
                  </p>
                  {renderEntries(servicesNav, 'green')}
                </>
              )}
            </nav>
          </aside>
        </div>
      )}

      {/* Command palette (Ctrl/Cmd+K) */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 flex items-center justify-between px-4 lg:px-6 border-b border-[var(--ic-border)] bg-[var(--ic-surface)] backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface)]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] hover:border-cyan-500/40 transition-colors">
              <Search className="w-4 h-4 text-[var(--ic-muted)]" />
              <span className="text-sm text-[var(--ic-muted)]">Search features…</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--ic-surface)] border border-[var(--ic-border)] text-[10px] font-mono text-[var(--ic-muted)]">⌘K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyber-green/10 border border-cyber-green/20">
              <Zap className="w-3.5 h-3.5 text-cyber-green" />
              <span className="text-xs font-medium text-cyber-green">Systems Operational</span>
            </div>
            
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-[var(--ic-muted)] hover:text-[var(--ic-heading)] hover:bg-[var(--ic-surface-2)] transition-colors"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            
            {/* Clock */}
            <Clock />
            
            <NotificationBell />
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center text-xs font-bold lg:hidden">
              {user?.name.split(' ').map(n => n[0]).join('') || 'U'}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto" style={{
          backgroundImage: 'linear-gradient(rgba(0,212,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.02) 1px, transparent 1px)',
          backgroundSize: '50px 50px'
        }}>
          <div className="p-6">
            <Breadcrumb />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
