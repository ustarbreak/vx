import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { getComingSoonById } from '../data/comingSoonServices';
import { ArrowLeft, Calendar, Users, CheckCircle } from 'lucide-react';

export default function ComingSoonPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const service = getComingSoonById(serviceId || '');

  if (!service) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">Service Not Found</h1>
          <Link to="/" className="text-cyan-400 hover:text-cyan-300">← Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-b border-cyan-500/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">IC</span>
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Infracentra
              </span>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
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
            
            <p className="text-lg text-slate-400 max-w-3xl mx-auto leading-relaxed">
              {service.description}
            </p>
          </div>

          {/* Features Grid */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 mb-8">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Expected Features</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {service.expectedFeatures.map((feature, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-slate-800/30 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Target Audience & Launch Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-cyan-400" />
                <h3 className="text-xl font-bold text-white">Target Audience</h3>
              </div>
              <p className="text-slate-400">{service.targetAudience}</p>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Calendar className="w-6 h-6 text-cyan-400" />
                <h3 className="text-xl font-bold text-white">Expected Launch</h3>
              </div>
              <p className="text-2xl font-bold text-purple-400">{service.estimatedLaunch}</p>
            </div>
          </div>

          {/* CTA Section */}
          <div className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/20 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">Interested in this service?</h2>
            <p className="text-slate-400 mb-6">
              Join our waitlist to be notified when this service launches, or explore our current offerings.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/30">
                Join Waitlist
              </button>
              <Link
                to="/"
                className="px-6 py-3 bg-slate-800 text-white font-semibold rounded-lg hover:bg-slate-700 transition-all"
              >
                Explore Current Services
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center text-slate-500 text-sm">
          © 2027 Infracentra. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
