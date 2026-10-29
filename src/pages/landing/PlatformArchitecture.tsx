// ---------------------------------------------------------------------------
// PLATFORM ARCHITECTURE — Flow.jpg (1024×1024 flow artwork) rendered with
// object-fit: contain inside a square-ish framed panel sized to the image so
// the full diagram stays visible without cropping (its dark background matches
// --lx-bg). Below it an SVG-connected component map uses only real platform
// layers.
// ---------------------------------------------------------------------------
import React from 'react';
import { Reveal, SectionHeading } from './lxPrimitives';

const LAYERS = [
  { title: 'Collection layer', items: ['Endpoints', 'Network & firewall', 'Cloud & identity', 'Messagerie'] },
  { title: 'Correlation core', items: ['SIEM engine', 'Threat intel (MISP)', 'Analytics AI', 'Rule engine'] },
  { title: 'Response layer', items: ['SOAR playbooks', 'Auto-ticketing', 'SLA timers', 'Audit vault'] },
];

export default function PlatformArchitecture() {
  return (
    <section id="platform" className="ic-lx-textured py-24 px-4 sm:px-6 lg:px-8" style={{ background: 'var(--lx-bg-2)' }}>
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="Platform Architecture"
          title={<>One hub. <span style={{ color: 'var(--lx-cyan)' }}>Every security signal.</span></>}
          subtitle="All integrated services feed a central correlation hub, so detection, response and infrastructure operations share one context."
        />

        {/* Full diagram preserved with contain rendering — container resized
            to a square aspect ratio to fit Flow.jpg (1024×1024) */}
        <Reveal delay={50}>
          <div className="flex justify-center mb-14">
            <div className="ic-lx-frame ic-lx-img-contain w-full max-w-[640px]">
              <div style={{ aspectRatio: '1 / 1' }}>
                <img
                  src="/Flow.jpg"
                  alt="Infracentra security data flow architecture"
                  width={1024} height={1024} loading="lazy" decoding="async"
                  className="w-full h-full"
                  style={{ objectFit: 'contain', display: 'block' }}
                />
              </div>
            </div>
          </div>
        </Reveal>

        {/* Connected component map — SVG connectors on desktop */}
        <Reveal delay={100}>
          <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-6 items-stretch">
            {/* animated connector line behind columns (desktop only) */}
            <svg className="hidden md:block absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-4 pointer-events-none" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 4">
              <line x1="0" y1="2" x2="100" y2="2" stroke="var(--lx-border)" strokeWidth="0.5" />
              <line x1="0" y1="2" x2="100" y2="2" stroke="var(--lx-cyan)" strokeWidth="0.5" className="ic-lx-flow-line" opacity="0.7" />
            </svg>

            {LAYERS.map((layer, i) => (
              <React.Fragment key={layer.title}>
                <div className="ic-lx-card p-6 relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-2.5 h-2.5 rounded-full ic-lx-node-dot" style={{ fill: 'var(--lx-cyan)', background: 'var(--lx-cyan)' }} />
                    <h3 className="font-bold ic-lx-h text-sm uppercase tracking-wider">{layer.title}</h3>
                  </div>
                  <ul className="space-y-2 list-none">
                    {layer.items.map((it) => (
                      <li key={it} className="text-sm ic-lx-text2 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full" style={{ background: 'var(--lx-blue)' }} />{it}
                      </li>
                    ))}
                  </ul>
                </div>
                {i < LAYERS.length - 1 && (
                  <div className="hidden md:flex items-center justify-center relative z-10" aria-hidden="true">
                    <svg width="28" height="28" viewBox="0 0 28 28" className="rounded-full p-1.5" style={{ background: 'var(--lx-surface)', border: '1px solid var(--lx-border)' }}>
                      <path d="M8 14h12M16 9l5 5-5 5" fill="none" stroke="var(--lx-cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
