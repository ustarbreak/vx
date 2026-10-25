import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { navigationData } from '../../data/navigationData';
import { ChevronDown, Menu, X, Zap } from 'lucide-react';

export default function Navigation() {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { loginAsDemo } = useAuth();

  const handleDemoLogin = async (key: string) => {
    await loginAsDemo(key);
    if (key === 'platform-admin') navigate('/admin/dashboard');
    else if (key.includes('client-admin')) navigate('/client-admin/dashboard');
    else navigate('/dashboard');
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
                  <Link
                    to={item.href}
                    className="px-4 py-2 text-sm font-medium rounded-lg transition-colors ic-heading hover:bg-[var(--ic-surface-2)]"
                    style={{ color: undefined }}
                  >
                    {item.label}
                  </Link>
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
                              <a
                                href={sub.href || '#'}
                                onClick={(e) => { if (!sub.href || sub.href === '#') e.preventDefault(); }}
                                className="block px-3 py-2 rounded-lg hover:bg-[var(--ic-surface-2)] transition-colors"
                              >
                                <span className="block text-sm font-medium ic-heading">{sub.label}</span>
                                {sub.description && <span className="block text-xs ic-muted">{sub.description}</span>}
                              </a>
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
            <button onClick={() => handleDemoLogin('platform-admin')} className="ic-btn-outline px-4 py-2 text-sm">
              Partner Login
            </button>
            <button onClick={() => handleDemoLogin('platform-admin')} className="ic-btn-primary px-4 py-2 text-sm">
              Request Demo
            </button>
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
                  <Link to={item.href} className="block px-3 py-2 rounded-lg text-sm font-medium ic-heading" onClick={() => setMobileMenuOpen(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <>
                    <button className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium ic-heading" onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}>
                      {item.label} <ChevronDown className="w-4 h-4 inline" />
                    </button>
                    {activeDropdown === item.label && item.dropdown && (
                      <div className="ml-4 mt-1 space-y-1">
                        {item.dropdown.flatMap((s: any) => s.items).map((sub: any, i: number) => (
                          <a key={i} href={sub.href || '#'} onClick={(e) => { if (!sub.href || sub.href === '#') e.preventDefault(); setMobileMenuOpen(false); }} className="block px-3 py-1.5 rounded text-sm ic-muted">
                            {sub.label}
                          </a>
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
