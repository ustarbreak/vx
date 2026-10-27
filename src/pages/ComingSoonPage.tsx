import React from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { getComingSoonById } from '../data/comingSoonServices';
import { ArrowLeft, Calendar, Users, CheckCircle } from 'lucide-react';

// Minimal coming-soon fallback used when the route has no registered catalog
// entry (e.g. /academy, legal links added on the landing enhancement branch).
const GENERIC_SOON = {
  name: 'Infracentra Academy',
  tagline: 'Structured learning for security operations teams.',
  description: 'Training courses, certification paths and community resources are being prepared. Join the waitlist to be notified at launch.',
  icon: '🎓',
  category: 'education',
  estimatedLaunch: 'Q1 2027',
  expectedFeatures: ['Self-paced platform courses', 'Instructor-led workshops', 'Certification tracks'],
  targetAudience: 'Security analysts, MSSP operators and IT administrators.',
};

export default function ComingSoonPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  // Route-level "coming soon" pages (like /academy) pass a static fallback via
  // location state; catalog services resolve through comingSoonServices.
  const location = useLocation();
  const service =
    getComingSoonById(serviceId || '') ||
    ((location.state as any)?.generic ? (location.state as any).generic : GENERIC_SOON);

  if (!service) {
    return (
      <div className="min-h-screen ic-page flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-[var(--ic-heading)] mb-4">Service Not Found</h1>
          <Link to="/" className="text-cyan-400 hover:text-cyan-300">← Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen ic-page text-[var(--ic-heading)]">
      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[var(--ic-bg)]/95 backdrop-blur-xl border-b border-[var(--ic-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <span className="text-[var(--ic-heading)] font-bold text-sm">IC</span>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Infracentra
              </span>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-2 text-[var(--ic-muted)] hover:text-[var(--ic-heading)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
              <Calendar className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-purple-400 font-medium">Coming {service.estimatedLaunch}</span>
            </div>
            
            <div className="text-7xl mb-6">{service.icon}</div>
            
            <h1 className="text-5xl sm:text-6xl font-bold mb-6 bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              {service.name}
            </h1>
            
            <p className="text-2xl text-cyan-400 font-medium mb-6">
              {service.tagline}
            </p>
            
            <p className="text-lg text-[var(--ic-muted)] max-w-3xl mx-auto leading-relaxed">
              {service.description}
            </p>
          </div>

          {/* Features Grid */}
          <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-8 mb-8">
            <h2 className="text-2xl font-bold text-[var(--ic-heading)] mb-6 text-center">Expected Features</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {service.expectedFeatures.map((feature, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-[var(--ic-surface)] rounded-lg">
                  <CheckCircle className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span className="text-[var(--ic-text)]">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Target Audience & Launch Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-cyan-400" />
                <h3 className="text-xl font-bold text-[var(--ic-heading)]">Target Audience</h3>
              </div>
              <p className="text-[var(--ic-muted)]">{service.targetAudience}</p>
            </div>

            <div className="bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Calendar className="w-6 h-6 text-cyan-400" />
                <h3 className="text-xl font-bold text-[var(--ic-heading)]">Expected Launch</h3>
              </div>
              <p className="text-2xl font-bold text-purple-400">{service.estimatedLaunch}</p>
            </div>
          </div>

          {/* CTA Section */}
          <div className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-[var(--ic-border)] rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-[var(--ic-heading)] mb-4">Interested in this service?</h2>
            <p className="text-[var(--ic-muted)] mb-6">
              Join our waitlist to be notified when this service launches, or explore our current offerings.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] font-semibold rounded-lg hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/30">
                Join Waitlist
              </button>
              <Link
                to="/"
                className="px-6 py-3 bg-[var(--ic-surface)] text-[var(--ic-heading)] font-semibold rounded-lg hover:bg-[var(--ic-surface-2)] transition-all"
              >
                Explore Current Services
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--ic-border)] py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center text-[var(--ic-muted)] text-sm">
          © 2027 Infracentra. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
