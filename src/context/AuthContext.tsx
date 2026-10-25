import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { User, Organization } from '../types';
import { demoUsers, demoOrganizations } from '../data/mockData';
import { backendLogin, clearToken, getToken, ApiError } from '../services/api';

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  backendMode: boolean; // true when the session is backed by the real API
  login: (email: string, password: string) => Promise<User | null>;
  loginAsDemo: (demoKey: string) => Promise<User | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Canonical list of the 16 platform services — used to grant demo tenants
// full access (all 16 services + Advanced Ticketing included in Pro/Enterprise).
import { serviceCatalog } from '../data/mockData';

export const ALL_SERVICE_IDS: string[] = serviceCatalog.map(s => s.id); // 16 services

export const DEMO_ACCOUNTS: Record<string, { email: string; label: string; description: string }> = {
  'platform-admin': {
    email: 'ops@infracentra.io',
    label: 'Platform Admin',
    description: 'Infracentra staff — manage all clients, entitlements, billing, and audit logs',
  },
  'client-admin-enterprise': {
    email: 'admin@damanecash.ma',
    label: 'Client Admin (Enterprise)',
    description: 'Valoris System — all 16 services + Advanced Ticketing, manage users and view all services',
  },
  'client-admin-pro': {
    email: 'soc@valorissystem.ma',
    label: 'Client Admin (Pro)',
    description: 'Valoris System (Pro mirror) — Pro plan: 9 services + Advanced Ticketing unlocked for evaluation',
  },
  'client-admin-sme': {
    email: 'it@vivalissalaf.ma',
    label: 'Client Admin (SME)',
    description: 'Vivalis Salaf — SME plan: 5 services, no ticketing; see entitlement enforcement in action',
  },
  'client-admin-midmarket': {
    email: 'ciso@damanecash.ma',
    label: 'Client Admin (Mid-Market)',
    description: 'Damanecash — Pro plan: 9 services + Advanced Ticketing, some disabled',
  },
  'client-user': {
    email: 'y.elamrani@damanecash.ma',
    label: 'Client User (Analyst)',
    description: 'SOC analyst at Damanecash — operational view only',
  },
  'partner-admin': {
    email: 'rachid@atlascyber.ma',
    label: 'Partner Admin (MSP)',
    description: 'Atlas Cyber Services — white-label MSP portal: manage their own end-clients, licensing & branding',
  },
};

export const DEMO_PASSWORD = 'Admin#2026';

// ---------------------------------------------------------------------------
// Demo mode helpers — ONE single source of truth (localStorage key
// `ic_demo_mode`, defined in services/demoMode.ts). Demo mode is fully
// client-side: it never touches or pollutes the real backend. When ON, all
// API calls are answered by the in-memory simulated backend; when OFF, every
// page uses live API data only.
// ---------------------------------------------------------------------------
export { isDemoMode, setDemoMode } from '../services/demoMode';
import { isDemoMode } from '../services/demoMode';
import { demoTechnicians, demoTenants, demoDevices } from '../data/demoWorld';
import { partners } from '../data/partnerWorld';

const DEMO_ORG_ID = 'org-demo-full';

// Partner (MSP) domain → partner id. Emails on a partner's own domain log in
// as that partner's admin and land in the white-label MSP portal.
export function partnerIdForDomain(domain: string): string | null {
  const p = partners.find(x => x.contact_email.split('@')[1]?.toLowerCase() === domain.toLowerCase());
  return p ? p.id : null;
}

// Full-access demo organization: entitled to ALL 16 services.
// Advanced Ticketing is bundled with this tenant (included in Pro & Enterprise plans).
const demoFullAccessOrg: Organization = {
  id: DEMO_ORG_ID,
  name: 'Infracentra Demo Tenant (Pro/Enterprise trial)',
  tier: 'enterprise',
  status: 'active',
  contactEmail: 'demo@infracentra.io',
  contactPhone: '+1 (000) 000-0000',
  industry: 'Technology — Evaluation',
  country: 'N/A',
  memberCount: 5,
  assetCount: 50,
  riskScore: 25,
  complianceScore: 90,
  contractStart: new Date().toISOString().slice(0, 10),
  contractEnd: '2099-12-31',
  monthlyRevenue: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  entitlements: ALL_SERVICE_IDS.map(id => ({
    serviceId: id as any,
    enabled: true,
    activatedAt: new Date().toISOString().slice(0, 10),
    deactivatedAt: null,
    seatCount: 50,
  })),
};

// Demo-mode user directory: seeded mock identities + any account typed by the
// visitor (so reviewers can "log in" with any email while Demo Mode is ON).
function resolveDemoUser(email: string): User | null {
  const found = demoUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (found) return found;
  if (!email || !email.includes('@')) return null;
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const domOrg: Record<string, string> = { 'damanecash.ma': 'org-dw-1', 'valorissystem.ma': 'org-dw-2', 'vivalissalaf.ma': 'org-dw-3' };
  const orgFromDomain = domOrg[email.split('@')[1]?.toLowerCase()];
  // Partner domains (MSP) → partner_admin role scoped to their own partner id.
  const partnerId = partnerIdForDomain(email.split('@')[1] ?? '');
  if (partnerId) {
    return {
      id: `demo-${email}`,
      email,
      name,
      role: 'partner_admin',
      orgId: partnerId,
      status: 'active',
      lastLogin: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      mfaEnabled: false,
    };
  }
  return {
    id: `demo-${email}`,
    email,
    name,
    role: 'client_admin',
    orgId: orgFromDomain ?? DEMO_ORG_ID,
    status: 'active',
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    mfaEnabled: false,
  };
}

// Map a backend user (real API) onto the frontend User shape used everywhere.
function toFrontUser(bu: { id: number; email: string; name: string; role: string; org_id: number | null }): User {
  return {
    id: `be-${bu.id}`,
    email: bu.email,
    name: bu.name || bu.email.split('@')[0],
    role: (bu.role as User['role']) ?? 'client_user',
    orgId: bu.org_id != null ? `org-be-${bu.org_id}` : null,
    status: 'active',
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    mfaEnabled: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<boolean>(() => !!getToken());
  const [demoUser, setDemoUser] = useState<User | null>(null);

  // Persist demo sessions so a reload keeps you logged in during evaluation.
  useEffect(() => {
    if (demoUser) localStorage.setItem('ic_demo_session', JSON.stringify(demoUser));
    else localStorage.removeItem('ic_demo_session');
  }, [demoUser]);

  // Restore a live backend session on page reload (JWT stored in localStorage).
  useEffect(() => {
    if (!getToken()) return;
    (async () => {
      try {
        const { api } = await import('../services/api');
        const me = await api.get<any>('/auth/me');
        setUser(toFrontUser(me));
        setBackendMode(true);
      } catch {
        clearToken();
        setBackendMode(false);
        setUser(null);
      }
    })();
  }, []);

  // Restore a demo session on reload when Demo Mode is ON.
  useEffect(() => {
    if (!isDemoMode()) return;
    try {
      const raw = localStorage.getItem('ic_demo_session');
      if (raw) setDemoUser(JSON.parse(raw));
    } catch { /* ignore corrupt session */ }
  }, []);

  // Real login ONLY when Demo Mode is OFF. When Demo Mode is ON we never hit
  // the backend with visitor credentials — the demo stays fully isolated from
  // production data and audit logs.
  const login = useCallback(async (email: string, password: string): Promise<User | null> => {
    setIsLoading(true);
    setAuthError(null);

    if (isDemoMode()) {
      // Simulated authentication — any email works, all services unlocked.
      const du = resolveDemoUser(email);
      if (!du) {
        setAuthError('Enter a valid email address (demo mode accepts any account).');
        setIsLoading(false);
        return null;
      }
      await new Promise(r => setTimeout(r, 400)); // simulate latency
      setDemoUser(du);
      setBackendMode(false);
      setIsLoading(false);
      return du;
    }

    try {
      const bu = await backendLogin(email, password);
      setUser(toFrontUser(bu));
      setBackendMode(true);
      setIsLoading(false);
      return toFrontUser(bu);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        setAuthError('Incorrect email or password');
      } else {
        setAuthError(e?.message ?? 'Backend unreachable — turn Demo Mode ON to explore with sample data.');
      }
      setIsLoading(false);
      return null;
    }
  }, []);

  const loginAsDemo = useCallback(async (demoKey: string): Promise<User | null> => {
    setIsLoading(true);
    setAuthError(null);
    const account = DEMO_ACCOUNTS[demoKey];
    if (!account) {
      setIsLoading(false);
      return null;
    }

    if (isDemoMode()) {
      // Pure client-side demo: seeded mock identities, full access, no backend.
      const dwOrgForEmail = (email: string) => {
        const t = demoTechnicians.find(x => x.email === email);
        return t ? `org-dw-${t.orgId}` : DEMO_ORG_ID;
      };
      const du = resolveDemoUser(account.email) ?? {
        id: `demo-${demoKey}`,
        email: account.email,
        name: account.label,
        role: 'client_admin' as const,
        orgId: dwOrgForEmail(account.email),
        status: 'active' as const,
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        mfaEnabled: false,
      };
      await new Promise(r => setTimeout(r, 300));
      setDemoUser(du);
      setBackendMode(false);
      setIsLoading(false);
      return du;
    }

    // Demo Mode OFF -> Quick Demo buttons authenticate against the REAL backend
    // with the conventional demo password (accounts created by seed-demo-tenant).
    try {
      const bu = await backendLogin(account.email, DEMO_PASSWORD);
      setUser(toFrontUser(bu));
      setBackendMode(true);
      setIsLoading(false);
      return toFrontUser(bu);
    } catch (e: any) {
      setAuthError(
        e instanceof ApiError && e.status === 401
          ? `Account "${account.email}" does not exist on the backend. Create it via Settings → Seed demo tenant, or switch Demo Mode ON for the simulated experience.`
          : 'Backend unreachable — switch Demo Mode ON to explore with sample data.'
      );
      setIsLoading(false);
      return null;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setDemoUser(null);
    setBackendMode(false);
    setAuthError(null);
  }, []);

  // Effective user/session: backend session wins; demo session used in Demo Mode.
  const activeUser = backendMode && user ? user : (isDemoMode() ? demoUser : user);

  const organization = (() => {
    if (!activeUser) return null;
    if (activeUser.orgId === DEMO_ORG_ID) return demoFullAccessOrg;
    if (activeUser.orgId?.startsWith('org-dw-')) {
      // Demo world tenants (Damanecash / Valoris System / Vivalis Salaf) — same
      // ids, names and counts as every engine page reads from demoWorld.
      const t = demoTenants.find(x => `org-dw-${x.id}` === activeUser.orgId);
      if (t) {
        return {
          ...demoFullAccessOrg,
          id: activeUser.orgId, name: t.name, tier: t.tier as any,
          memberCount: demoTechnicians.filter(x => x.orgId === t.id).length,
          assetCount: demoDevices.filter(x => x.orgId === t.id).length,
        };
      }
    }
    return demoOrganizations.find(o => o.id === activeUser.orgId) ?? null;
  })();

  return (
    <AuthContext.Provider value={{
      user: activeUser,
      organization,
      isAuthenticated: !!activeUser,
      isLoading,
      authError,
      backendMode: backendMode && !isDemoMode(),
      login,
      loginAsDemo,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function useEntitlement(serviceId: string): { entitled: boolean; orgName: string | null } {
  const { user, organization } = useAuth();
  if (!user) return { entitled: false, orgName: null };
  // Demo Mode: every one of the 16 services + Advanced Ticketing is unlocked
  // so website visitors can evaluate the whole platform without provisioning.
  if (isDemoMode()) return { entitled: true, orgName: organization?.name ?? 'Demo' };
  if (!organization) return { entitled: false, orgName: null };
  if (user.role === 'platform_admin') return { entitled: true, orgName: null };
  const ent = organization.entitlements.find(e => e.serviceId === serviceId);
  return { entitled: !!ent?.enabled, orgName: organization.name };
}
