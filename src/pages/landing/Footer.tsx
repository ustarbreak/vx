// ---------------------------------------------------------------------------
// FOOTER — upgraded cinematic footer. Uses InfraLOGO.png brand mark, real
// routes only (no dead "#" links), restrained shared-texture decoration.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import SmartLink from './SmartLink';
import { Zap } from 'lucide-react';

const COLUMNS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: 'Platform',
    links: [
      { label: 'Pricing', to: '/pricing' },
      { label: 'Services', to: '/service/endpoint-protection' },
      { label: 'Incident response', to: '/service/incident-response' },
      { label: 'Book a demo', to: '/demo-request' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'MSSP / MDR program', to: '/mssp' },
      { label: 'Client portal', to: '/login' },
      { label: 'Partner portal', to: '/login' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Service catalog', to: '/' },
      { label: 'Security workflow', to: '/#workflow' },
      { label: 'Platform architecture', to: '/#platform' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Academy', to: '/academy' },
      { label: 'Sign in', to: '/login' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="ic-lx-textured border-t" style={{ borderColor: 'var(--lx-border)', background: 'var(--lx-bg-2)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-10 mb-12">
          <div className="col-span-2">
            <Link to="/" className="inline-flex items-center gap-2 mb-4" aria-label="Infracentra home">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(120deg,#00D4FF,#078BFF)' }}>
                <Zap className="w-5 h-5" style={{ color: '#032033' }} />
              </span>
              <span className="text-xl font-bold" style={{ color: '#F4F9FF' }}>Infracentra</span>
            </Link>
            <p className="text-sm ic-lx-muted max-w-xs leading-relaxed mb-6">
              The complete cybersecurity infrastructure platform — unified SOC,
              automation and managed services for organizations and MSSPs.
            </p>
            <Link to="/pricing" className="ic-lx-btn-outline px-5 py-2.5 text-sm">Get Started</Link>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h4 className="text-xs font-bold uppercase tracking-widest ic-lx-h mb-4">{col.title}</h4>
              <ul className="space-y-2.5 list-none">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {/* SmartLink: "/#workflow"-style section anchors scroll on
                        the landing page instead of doing a router miss. */}
                    <SmartLink href={l.to} className="text-sm ic-lx-muted hover:underline transition-colors">{l.label}</SmartLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderColor: 'var(--lx-border)' }}>
          <p className="text-xs ic-lx-muted">© {new Date().getFullYear()} Infracentra. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs ic-lx-muted">
            <a href="mailto:contact@infracentra.com" className="hover:underline">Privacy</a>
            <a href="mailto:contact@infracentra.com" className="hover:underline">Terms</a>
            <Link to="/demo-request" className="hover:underline">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
