// ---------------------------------------------------------------------------
// SECURITY WORKFLOW — the platform's real response pipeline:
// Alert → Correlation → Rule Engine → Notification → Auto-Ticket → SLA Timer
// → Audit Vault. Horizontal flow on desktop, vertical on mobile (CSS grid).
// Pure SVG/CSS — no extra dependencies.
// ---------------------------------------------------------------------------
import React from 'react';
import { BellRing, GitMerge, SlidersHorizontal, Send, Ticket, Timer, Archive } from 'lucide-react';
import { Reveal, SectionHeading } from './lxPrimitives';

const STEPS = [
  { icon: BellRing, label: 'Alert', desc: 'Raw signals from every integrated engine' },
  { icon: GitMerge, label: 'Correlation', desc: 'Events grouped into meaningful incidents' },
  { icon: SlidersHorizontal, label: 'Rule Engine', desc: 'Deterministic rules score & route' },
  { icon: Send, label: 'Notification', desc: 'Right team, right channel, instantly' },
  { icon: Ticket, label: 'Auto-Ticket', desc: 'Case created with full context attached' },
  { icon: Timer, label: 'SLA Timer', desc: 'Response clocks tracked per severity' },
  { icon: Archive, label: 'Audit Vault', desc: 'Immutable evidence retained for compliance' },
];

export default function SecurityWorkflow() {
  return (
    <section id="workflow" className="py-24 px-4 sm:px-6 lg:px-8 ic-lx-grid border-y" style={{ borderColor: 'var(--lx-border)' }}>
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="Security Workflow"
          title={<>From alert to audit trail — <span style={{ color: 'var(--lx-cyan)' }}>automatically</span></>}
          subtitle="Every step of the pipeline runs inside the platform, so nothing gets lost between detection and proof."
        />

        <Reveal>
          {/* Desktop: horizontal 7-step flow */}
          <ol className="hidden md:grid list-none grid-cols-[repeat(13,auto)] justify-center items-start gap-0">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.label}>
                <li className="flex flex-col items-center text-center w-32">
                  <span className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 ic-lx-card" style={{ padding: 0 }}>
                    <s.icon className="w-6 h-6" style={{ color: 'var(--lx-cyan)' }} />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-wider ic-lx-h mb-1">{s.label}</p>
                  <p className="text-[10px] ic-lx-muted leading-snug">{s.desc}</p>
                </li>
                {i < STEPS.length - 1 && (
                  <li aria-hidden="true" className="pt-7 px-1">
                    <svg width="36" height="12" viewBox="0 0 36 12"><line x1="0" y1="6" x2="30" y2="6" stroke="var(--lx-cyan)" strokeWidth="1.5" className="ic-lx-flow-line" /><path d="M30 2l6 4-6 4z" fill="var(--lx-cyan)" /></svg>
                  </li>
                )}
              </React.Fragment>
            ))}
          </ol>

          {/* Mobile: vertical flow */}
          <ol className="md:hidden list-none space-y-0 max-w-sm mx-auto">
            {STEPS.map((s, i) => (
              <li key={s.label} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="w-11 h-11 rounded-xl flex items-center justify-center ic-lx-card" style={{ padding: 0 }}>
                    <s.icon className="w-5 h-5" style={{ color: 'var(--lx-cyan)' }} />
                  </span>
                  {i < STEPS.length - 1 && <span className="w-px flex-1 my-1" style={{ background: 'linear-gradient(var(--lx-cyan), var(--lx-border))' }} />}
                </div>
                <div className="pb-8">
                  <p className="text-sm font-bold uppercase tracking-wider ic-lx-h">{s.label}</p>
                  <p className="text-xs ic-lx-muted mt-1">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
