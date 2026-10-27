import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { navigationData } from '../../data/navigationData';
import SmartLink from './SmartLink';
import BrandWordmark from '../../components/BrandWordmark';
import { ChevronDown, Menu, X, LogIn } from 'lucide-react';

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
  const [scrolled, setScrolled] = useState(false);
  const loginPortal = usePortalLogin();

  // Sticky-header polish: deepen the bar's blur/shadow once the visitor
  // scrolls past the hero fold (see .ic-lx-nav-scrolled in landing.css).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`ic-lx-nav fixed top-0 left-0 right-0 z-50 border-b ${scrolled ? 'ic-lx-nav-scrolled' : ''}`} style={{ background: 'rgba(3, 20, 38, 0.55)', borderColor: 'rgba(0, 212, 255, 0.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo — official brand mark (public/InfraLOGO.png) + two-tone
              wordmark: "Infra" in the heading colour, "Centra" in blue. Both
              colours are CSS variables, so the lock-up adapts to light/dark. */}
          <Link to="/" aria-label="Infracentra — home" className="flex items-center gap-2">
            <img
              src="/InfraLOGO.png"
              alt="Infracentra logo"
              width={32} height={32}
              className="w-8 h-8 rounded-lg object-contain"
              style={{ background: 'rgba(0, 212, 255, 0.06)' }}
              decoding="async"
            />
            <BrandWordmark className="text-xl font-bold tracking-tight" />
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
                    className="px-4 py-2 text-sm font-medium rounded-lg transition-colors hover:bg-[rgba(0,212,255,0.08)]" style={{ color: '#F4F9FF' }}
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
                  <div className="absolute top-full left-0 mt-2 w-[800px] ic-lx-card p-6 grid grid-cols-3 gap-6 animate-fade-in" style={{ boxShadow: '0 30px 70px -30px rgba(0,0,0,.85)' }}>
                    {item.dropdown.map((section, sIdx) => (
                      <div key={sIdx}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#00D4FF' }}>{section.category}</p>
                        <ul className="space-y-1">
                          {section.items.map((sub: any, i: number) => (
                            <li key={i}>
                              <SmartLink
                                href={sub.href || '#'}
                                className="block px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                              >
                                <span className="block text-sm font-medium" style={{ color: '#F4F9FF' }}>{sub.label}</span>
                                {sub.description && <span className="block text-xs" style={{ color: '#7894AC' }}>{sub.description}</span>}
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
                className="ic-lx-btn-outline px-4 py-2 text-sm inline-flex items-center gap-1"
              >
                <LogIn className="w-4 h-4" /> Portails de connexion <ChevronDown className="w-4 h-4" />
              </button>
              {portalsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-72 ic-lx-card p-2 space-y-1 animate-fade-in z-50"
                  style={{ boxShadow: '0 30px 70px -30px rgba(0,0,0,.85)' }}
                >
                  {PORTAL_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      role="menuitem"
                      onClick={() => { setPortalsOpen(false); loginPortal(p.key, p.to); }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                    >
                      <span className="block text-sm font-semibold" style={{ color: '#F4F9FF' }}>{p.label}</span>
                      <span className="block text-xs" style={{ color: '#7894AC' }}>{p.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <SmartLink href="/demo-request" className="ic-lx-btn-primary px-4 py-2 text-sm inline-block">
              Request Demo
            </SmartLink>
          </div>

          {/* Mobile menu button */}
          <button aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} className="lg:hidden" style={{ color: '#F4F9FF' }} onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t" style={{ background: '#031426', borderColor: 'rgba(0,212,255,0.22)' }}>
          <div className="px-4 py-4 space-y-2">
            {navigationData.map((item, idx) => (
              <div key={idx}>
                {item.href ? (
                  <SmartLink href={item.href} className="block px-3 py-2 rounded-lg text-sm font-medium" style={{ color: '#F4F9FF' }} onClick={() => setMobileMenuOpen(false)}>
                    {item.label}
                  </SmartLink>
                ) : (
                  <>
                    <button className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium" style={{ color: '#F4F9FF' }} onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}>
                      {item.label} <ChevronDown className="w-4 h-4 inline" />
                    </button>
                    {activeDropdown === item.label && item.dropdown && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.dropdown.flatMap((s: any) => s.items).map((sub: any, i: number) => (
                          <SmartLink key={i} href={sub.href || '#'} className="block px-3 py-1.5 rounded text-sm" style={{ color: '#A9BED1' }} onClick={() => setMobileMenuOpen(false)}>
                            {sub.label}
                          </SmartLink>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {/* Portals — same three entry points as the desktop dropdown */}
            <div className="pt-2 border-t" style={{ borderColor: 'rgba(0,212,255,0.22)' }}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#7894AC' }}>Portails de connexion</p>
              {PORTAL_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => { setMobileMenuOpen(false); loginPortal(p.key, p.to); }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                >
                  <span className="block text-sm font-medium" style={{ color: '#F4F9FF' }}>{p.label}</span>
                  <span className="block text-xs" style={{ color: '#7894AC' }}>{p.desc}</span>
                </button>
              ))}
            </div>
            {/* Real route — previously this button signed into the platform
                admin dashboard while being labelled "Request Demo". */}
            <SmartLink href="/demo-request" className="ic-lx-btn-primary block w-full px-4 py-2 text-sm mt-2 text-center" onClick={() => setMobileMenuOpen(false)}>
              Request Demo
            </SmartLink>
          </div>
        </div>
      )}
    </nav>
  );
}
