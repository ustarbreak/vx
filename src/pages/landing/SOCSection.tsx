// ---------------------------------------------------------------------------
// SECURITY VISIBILITY & SOC — pairs the two verified SOC assets:
//  • /SocCenter.jpg (1200×1201, SOC environment photograph) → cover crop in a
//    wide frame; focal point (bright monitoring wall) centred.
//  • /SOC.png (952×862 illustrative monitoring interface) → contain, clearly
//    labelled as illustrative artwork — NOT a production screenshot.
// Copy describes capabilities that actually exist in the platform (Wazuh SIEM,
// TheHive case management, MISP intel, Shuffle SOAR, incident service).
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { Eye, Brain, Ticket, Archive, Radio, ArrowRight } from 'lucide-react';
import { Reveal, SectionHeading } from './lxPrimitives';

const CAPABILITIES = [
  { icon: Eye, title: 'Unified visibility', desc: 'Security and infrastructure telemetry from every integrated engine consolidated into one operations view.' },
  { icon: Brain, title: 'Correlation & detection', desc: 'Rules and analytics correlate events across endpoints, network, identity and cloud sources.' },
  { icon: Ticket, title: 'Case management', desc: 'Alerts become tracked cases with owners, severity, SLA timers and full audit trail.' },
  { icon: Radio, title: 'Threat intelligence', desc: 'IoC enrichment from integrated threat-intel sources mapped to MITRE ATT&CK.' },
  { icon: Archive, title: 'Audit vault', desc: 'Immutable evidence and response records retained for compliance reporting.' },
];

export default function SOCSection() {
  return (
    <section id="soc" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="Security Operations Center"
          title={<>Visibility that turns noise into <span style={{ color: 'var(--lx-cyan)' }}>decisions</span></>}
          subtitle="Infracentra's ISOC connects detection, investigation and response so your teams act on context — not alerts in isolation."
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          {/* Left: real SOC environment photo (intentional wide crop, centred light wall) */}
          <Reveal>
            <figure className="ic-lx-frame">
              <div style={{ aspectRatio: '16 / 10', overflow: 'hidden' }}>
                <img
                  src="/SocCenter.jpg"
                  alt="Security operations center environment with monitoring screens"
                  width={1200} height={1201} loading="lazy" decoding="async"
                  className="w-full h-full"
                  style={{ objectFit: 'cover', objectPosition: 'center 40%' }}
                />
              </div>
              <figcaption className="px-5 py-3 text-xs ic-lx-muted border-t" style={{ borderColor: 'var(--lx-border)' }}>
                Continuous operational monitoring — the human layer of the Infracentra ISOC.
              </figcaption>
            </figure>

            <figure className="ic-lx-frame mt-6 ic-lx-img-contain">
              <img
                src="/SOC.png"
                alt="Illustrative security monitoring dashboard concept artwork"
                width={952} height={862} loading="lazy" decoding="async"
              />
              <figcaption className="px-5 py-3 text-xs ic-lx-muted border-t" style={{ borderColor: 'var(--lx-border)' }}>
                Illustrative artwork of the monitoring experience — not a production screenshot.
              </figcaption>
            </figure>
          </Reveal>

          {/* Right: capability list backed by real engines */}
          <Reveal delay={100}>
            <ul className="space-y-5 list-none">
              {CAPABILITIES.map((c, i) => (
                <li key={i} className="ic-lx-card p-5 flex items-start gap-4">
                  <span className="p-2.5 rounded-xl flex-shrink-0" style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid var(--lx-border)' }}>
                    <c.icon className="w-5 h-5" style={{ color: 'var(--lx-cyan)' }} />
                  </span>
                  <div>
                    <p className="font-semibold ic-lx-h mb-1">{c.title}</p>
                    <p className="text-sm ic-lx-muted leading-relaxed">{c.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/service/incident-response" className="ic-lx-btn-outline mt-6 px-6 py-3 text-sm w-full sm:w-auto">
              See incident response service <ArrowRight className="w-4 h-4" />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
