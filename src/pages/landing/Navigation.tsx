import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { navigationData } from '../../data/navigationData';
import SmartLink from './SmartLink';
import { ChevronDown, Menu, X, Zap, LogIn } from 'lucide-react';

// Landing CTA helper: sign in with the simulated demo session for a portal
// key. In real-backend mode (Demo Mode OFF) loginAsDemo authenticates against
// the backend; if that fails we fall back to the login page pre-focused on
// that portal instead of dumping the visitor into the admin dashboard.
function usePortalLogin() {
  const { loginAsDemo } = useAuth();
  const navigate = useNavigate();
  return async (demoKey: string, redirectTo: string) => {
    const u = await loginAsDemo(demoKey);
    if (u) navigate(redirectTo);
    else navigate('/login', { state: { intent: demoKey } });
  };
}

const PORTAL_OPTIONS = [
  { key: 'partner-admin', label: 'Partner portal', desc: 'MSP white-label — clients, licensing, marge', to: '/partner/dashboard' },
  { key: 'client-admin-enterprise', label: 'Client portal', desc: 'Votre environnement supervisé et vos factures', to: '/client-admin/dashboard' },
  { key: 'platform-admin', label: 'Platform portal', desc: 'Équipe Infracentra — tenants, audit, ventes', to: '/admin/dashboard' },
] as const;

export default function Navigation() {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [portalsOpen, setPortalsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const loginPortal = usePortalLogin();

  const handleDemoLogin = async (key: string) => {
    // Legacy call sites keep their previous behaviour (full-access client admin).
    await loginPortal(key === 'platform-admin' ? 'platform-admin' : key,
      key === 'platform-admin' ? '/admin/dashboard' : '/client-admin/dashboard');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 ic-page border-b" style={{ background: 'color-mix(in srgb, var(--ic-bg) 92%, transparent)', borderColor: 'var(--ic-border)', backdropFilter: 'blur(10px)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--ic-primary)' }}>
              <Zap className="w-5 h-5 ic-heading" />
            </div>
            <span className="text-xl font-bold ic-heading">Infracentra</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-1">
            {navigationData.map((item, idx) => (
              <div
                key={idx}
                className="relative"
                onMouseEnter={() => setActiveDropdown(item.label)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                {item.href ? (
                  // SmartLink: under HashRouter a raw <a href="/pricing"> leaves
                  // the SPA and reloads the home page (the reported bug). This
                  // routes through react-router instead.
                  <SmartLink
                    href={item.href}
                    className="px-4 py-2 text-sm font-medium rounded-lg transition-colors ic-heading hover:bg-[var(--ic-surface-2)]"
                  >
                    {item.label}
                  </SmartLink>
                ) : (
                  <button className="px-4 py-2 text-sm font-medium rounded-lg transition-colors ic-heading hover:bg-[var(--ic-surface-2)] flex items-center gap-1">
                    {item.label}
                    <ChevronDown className="w-4 h-4" />
                  </button>
                )}

                {/* Dropdown */}
                {item.dropdown && activeDropdown === item.label && (
                  <div className="absolute top-full left-0 mt-2 w-[800px] ic-card p-6 grid grid-cols-3 gap-6 animate-fade-in" style={{ boxShadow: 'var(--ic-shadow-lg)' }}>
                    {item.dropdown.map((section, sIdx) => (
                      <div key={sIdx}>
                        <p className="text-xs font-semibold uppercase tracking-wider ic-muted mb-3">{section.category}</p>
                        <ul className="space-y-1">
                          {section.items.map((sub: any, i: number) => (
                            <li key={i}>
                              <SmartLink
                                href={sub.href || '#'}
                                className="block px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                              >
                                <span className="block text-sm font-medium ic-heading">{sub.label}</span>
                                {sub.description && <span className="block text-xs ic-muted">{sub.description}</span>}
                              </SmartLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* CTA buttons */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Portals dropdown — replaces the old "Partner Login" button:
                choose which portal you are signing in to. */}
            <div className="relative" onMouseLeave={() => setPortalsOpen(null)}>
              <button
                onClick={() => setPortalsOpen(!portalsOpen)}
                aria-haspopup="menu"
                aria-expanded={!!portalsOpen}
                className="ic-btn-outline px-4 py-2 text-sm inline-flex items-center gap-1"
              >
                <LogIn className="w-4 h-4" /> Portails de connexion <ChevronDown className="w-4 h-4" />
              </button>
              {portalsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-72 ic-card p-2 space-y-1 animate-fade-in z-50"
                  style={{ boxShadow: 'var(--ic-shadow-lg)' }}
                >
                  {PORTAL_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      role="menuitem"
                      onClick={() => { setPortalsOpen(false); loginPortal(p.key, p.to); }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                    >
                      <span className="block text-sm font-semibold ic-heading">{p.label}</span>
                      <span className="block text-xs ic-muted">{p.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <SmartLink href="/demo-request" className="ic-btn-primary px-4 py-2 text-sm inline-block">
              Request Demo
            </SmartLink>
          </div>

          {/* Mobile menu button */}
          <button className="lg:hidden ic-heading" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden ic-page border-t" style={{ borderColor: 'var(--ic-border)' }}>
          <div className="px-4 py-4 space-y-2">
            {navigationData.map((item, idx) => (
              <div key={idx}>
                {item.href ? (
                  <SmartLink href={item.href} className="block px-3 py-2 rounded-lg text-sm font-medium ic-heading" onClick={() => setMobileMenuOpen(false)}>
                    {item.label}
                  </SmartLink>
                ) : (
                  <>
                    <button className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium ic-heading" onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}>
                      {item.label} <ChevronDown className="w-4 h-4 inline" />
                    </button>
                    {activeDropdown === item.label && item.dropdown && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.dropdown.flatMap((s: any) => s.items).map((sub: any, i: number) => (
                          <SmartLink key={i} href={sub.href || '#'} className="block px-3 py-1.5 rounded text-sm ic-muted" onClick={() => setMobileMenuOpen(false)}>
                            {sub.label}
                          </SmartLink>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <button onClick={() => handleDemoLogin('platform-admin')} className="ic-btn-primary w-full px-4 py-2 text-sm mt-2">
              Request Demo
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
