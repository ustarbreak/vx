// ---------------------------------------------------------------------------
// FINAL CTA — strong dark band with the shared texture layer and clear actions.
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { Reveal } from './lxPrimitives';

export default function FinalCTA() {
  return (
    <section id="cta" className="ic-lx-textured ic-lx-textured-strong py-24 px-4 sm:px-6 lg:px-8 border-y" style={{ borderColor: 'var(--lx-border)', background: 'var(--lx-bg)' }}>
      <Reveal className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl sm:text-5xl font-extrabold ic-lx-h mb-5 leading-tight">
          Ready to Secure Your <span style={{ color: 'var(--lx-cyan)' }}>Infrastructure?</span>
        </h2>
        <p className="text-lg ic-lx-text2 mb-10 max-w-2xl mx-auto">
          See the full platform in action — one demo covers SOC operations, automation,
          infrastructure services and the partner model.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/pricing" className="ic-lx-btn-primary px-8 py-4 text-base">
            Explore the Platform <ArrowRight className="w-5 h-5" />
          </Link>
          <Link to="/demo-request" className="ic-lx-btn-outline px-8 py-4 text-base">
            <Play className="w-5 h-5" style={{ color: 'var(--lx-cyan)' }} /> Book a Demo
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
