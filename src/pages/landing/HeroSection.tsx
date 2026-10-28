// ---------------------------------------------------------------------------
// HERO — cinematic full-viewport opener.
// Per design direction the hero background is /datacenter.jpg (2000×1200
// datacenter photograph). It is used as a cover background with a controlled
// dark-navy overlay for text contrast; the focal aisle sits slightly left of
// centre, matching the left-aligned copy column (see landing.css
// .ic-lx-hero-bg).
// The former Unsplash image slider was removed (no remote images).
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Play, ArrowRight, Radar, ShieldCheck, Workflow, Building2 } from 'lucide-react';

export default function HeroSection() {
  return (
    <section id="hero" className="ic-lx-hero px-4 sm:px-6 lg:px-8 pt-28 pb-20">
      {/* datacenter.jpg background + navy overlay layers (styled in landing.css) */}
      <div className="ic-lx-hero-bg" aria-hidden="true" />
      <div className="ic-lx-hero-overlay" aria-hidden="true" />

      <div className="relative z-10 max-w-7xl mx-auto w-full">
        <span className="ic-lx-chip mb-8">
          <Radar className="w-3.5 h-3.5" />
          Cybersecurity Infrastructure Platform
        </span>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] mb-6 tracking-tight">
          <span className="ic-lx-h block">Your Security.</span>
          <span className="ic-lx-h block">Your Infrastructure.</span>
          <span className="ic-lx-hero-title block">One Intelligent Platform.</span>
        </h1>

        <p className="text-lg sm:text-xl max-w-2xl mb-10 leading-relaxed ic-lx-text2">
          Infracentra unifies security visibility, detection, response and
          infrastructure protection through one intelligent platform — built for
          modern organizations and the managed security providers who serve them.
        </p>

        <div className="flex flex-col sm:flex-row items-start gap-4 mb-14">
          {/* "Explore the Platform" goes to the sign-in page (the product
              itself is what you explore once inside) — previously /pricing. */}
          <Link to="/login" className="ic-lx-btn-primary px-8 py-4 text-base">
            Explore the Platform
            <ArrowRight className="w-5 h-5" />
          </Link>
          {/* "Book a Demo" opens the demo-request form — it used to silently
              sign the visitor into the platform-admin demo dashboard. */}
          <Link to="/demo-request" className="ic-lx-btn-outline px-8 py-4 text-base">
            <Play className="w-5 h-5" style={{ color: 'var(--lx-cyan)' }} />
            Book a Demo
          </Link>
        </div>

        {/* Capability indicators — all backed by real platform components */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl text-left">
          {[
            { icon: ShieldCheck, title: 'Integrated SOC', desc: 'Detection, investigation & response in one operations center' },
            { icon: Workflow, title: 'Automation & SOAR', desc: 'Rule engine, auto-ticketing and playbooks at machine speed' },
            { icon: Building2, title: 'MSSP-Ready', desc: 'Multi-tier, multi-tenant, multi-site white-label architecture' },
          ].map((c, i) => (
            <div key={i} className="ic-lx-card p-5 flex items-start gap-4">
              <c.icon className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: 'var(--lx-cyan)' }} />
              <div>
                <p className="font-semibold ic-lx-h text-sm mb-1">{c.title}</p>
                <p className="text-xs ic-lx-muted leading-relaxed">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <a href="#platform" className="inline-flex mt-12 items-center gap-2 text-xs uppercase tracking-widest ic-lx-muted hover:underline">
          Scroll to explore <ArrowRight className="w-4 h-4 rotate-90" />
        </a>
      </div>
    </section>
  );
}
