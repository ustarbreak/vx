import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getServiceById } from '../data/servicesData';
import {
  ArrowLeft, Shield, Target, Database, Network, Server,
  CheckCircle2, Zap, Cpu, Eye, Workflow, Lock, Globe,
  BarChart3, Cloud, Activity, AlertTriangle, TrendingUp,
  Layers, Radio, HardDrive, Mail
} from 'lucide-react';
import ServiceVisuals from '../components/ServiceVisuals';

// Service-specific themes
const serviceThemes: Record<string, {
  gradient: string;
  accent: string;
  bgPattern: string;
  icon: any;
  layout: 'horizontal' | 'vertical' | 'grid' | 'showcase';
}> = {
  'threat-intel': {
    gradient: 'from-red-500 via-orange-500 to-yellow-500',
    accent: 'text-red-400',
    bgPattern: 'radial-gradient(circle at 20% 50%, rgba(239,68,68,0.1) 0%, transparent 50%)',
    icon: Target,
    layout: 'showcase'
  },
  'compliance': {
    gradient: 'from-green-500 via-emerald-500 to-teal-500',
    accent: 'text-green-400',
    bgPattern: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, transparent 50%)',
    icon: Shield,
    layout: 'horizontal'
  },
  'incident-response': {
    gradient: 'from-purple-500 via-pink-500 to-rose-500',
    accent: 'text-purple-400',
    bgPattern: 'radial-gradient(ellipse at top, rgba(168,85,247,0.1) 0%, transparent 50%)',
    icon: AlertTriangle,
    layout: 'vertical'
  },
  'analytics': {
    gradient: 'from-blue-500 via-cyan-500 to-teal-500',
    accent: 'text-blue-400',
    bgPattern: 'linear-gradient(to right, rgba(59,130,246,0.1) 0%, transparent 50%)',
    icon: BarChart3,
    layout: 'grid'
  },
  'network-monitoring': {
    gradient: 'from-indigo-500 via-purple-500 to-pink-500',
    accent: 'text-indigo-400',
    bgPattern: 'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.1) 0%, transparent 50%)',
    icon: Network,
    layout: 'showcase'
  },
  'patch-management': {
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    accent: 'text-amber-400',
    bgPattern: 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, transparent 50%)',
    icon: HardDrive,
    layout: 'horizontal'
  },
  'endpoint-protection': {
    gradient: 'from-cyan-500 via-blue-500 to-indigo-500',
    accent: 'text-cyan-400',
    bgPattern: 'radial-gradient(circle at 50% 50%, rgba(6,182,212,0.1) 0%, transparent 50%)',
    icon: Shield,
    layout: 'vertical'
  },
  'email-security': {
    gradient: 'from-pink-500 via-rose-500 to-red-500',
    accent: 'text-pink-400',
    bgPattern: 'linear-gradient(to bottom, rgba(236,72,153,0.1) 0%, transparent 50%)',
    icon: Mail,
    layout: 'grid'
  },
  'cloud-security': {
    gradient: 'from-sky-500 via-blue-500 to-indigo-500',
    accent: 'text-sky-400',
    bgPattern: 'radial-gradient(ellipse at bottom, rgba(14,165,233,0.1) 0%, transparent 50%)',
    icon: Cloud,
    layout: 'showcase'
  }
};

export default function ServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const service = getServiceById(serviceId || '');
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [serviceId]);

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

  const theme = serviceThemes[service.id] || {
    gradient: 'from-cyan-500 to-blue-500',
    accent: 'text-cyan-400',
    bgPattern: 'radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 50%)',
    icon: Shield,
    layout: 'horizontal'
  };

  const ServiceIcon = theme.icon;

  return (
    <div className="min-h-screen bg-slate-950 text-white" style={{ backgroundImage: theme.bgPattern }}>
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Infracentra
              </span>
            </Link>
            <Link to="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to Services
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section - Unique per service */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${theme.gradient} opacity-5`} />
        
        <div className="relative max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Left - Content */}
            <div className="flex-1 text-center lg:text-left">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r ${theme.gradient} bg-opacity-10 border border-current/20 mb-6`}>
                <ServiceIcon className={`w-4 h-4 ${theme.accent}`} />
                <span className={`text-sm font-medium ${theme.accent}`}>
                  {service.category.toUpperCase()}
                </span>
              </div>

              <h1 className={`text-5xl sm:text-6xl lg:text-7xl font-black mb-6 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
                {service.name}
              </h1>

              <p className={`text-2xl ${theme.accent} font-medium mb-6`}>
                {service.tagline}
              </p>

              <p className="text-lg text-slate-400 leading-relaxed mb-8">
                {service.longDescription}
              </p>

              <div className="flex flex-wrap gap-4 justify-center lg:justify-start">
                <button className={`px-8 py-3 rounded-xl bg-gradient-to-r ${theme.gradient} text-white font-semibold hover:opacity-90 transition-all shadow-lg`}>
                  Request Demo
                </button>
                <button className="px-8 py-3 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800/50 transition-all">
                  Documentation
                </button>
              </div>
            </div>

            {/* Right - Visual */}
            <div className="flex-1 relative">
              <div className={`w-80 h-80 mx-auto rounded-full bg-gradient-to-br ${theme.gradient} opacity-20 blur-3xl`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <ServiceIcon className={`w-32 h-32 ${theme.accent} opacity-50`} />
              </div>
            </div>
          </div>

          {/* Metrics - Unique layout per service */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16">
            {service.metrics.map((metric, i) => (
              <div key={i} className={`bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-6 hover:border-current/30 transition-all group`} style={{ borderColor: `rgba(var(--accent-rgb), 0.2)` }}>
                <p className={`text-4xl font-black bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent mb-2`}>
                  {metric.value}
                </p>
                <p className="text-sm font-medium text-slate-300 mb-1">{metric.label}</p>
                <p className="text-xs text-slate-500">{metric.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service Visuals - Images and Attack Scenarios */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <ServiceVisuals serviceId={service.id} />
        </div>
      </section>

      {/* Features Section - Different layouts */}
      {theme.layout === 'showcase' && (
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className={`text-4xl font-bold mb-4 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
                Key Capabilities
              </h2>
              <p className="text-lg text-slate-400">Discover what makes {service.name} unique</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {service.features.map((feature, i) => (
                <div key={i} className={`relative group bg-slate-900/50 border border-slate-800 rounded-2xl p-8 hover:border-current/30 transition-all overflow-hidden`} style={{ borderColor: `rgba(var(--accent-rgb), 0.2)` }}>
                  <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${theme.gradient} opacity-5 rounded-full blur-2xl group-hover:opacity-10 transition-opacity`} />
                  <div className="relative">
                    <span className="text-5xl mb-4 block">{feature.icon}</span>
                    <h3 className="text-2xl font-bold text-white mb-3">{feature.title}</h3>
                    <p className="text-slate-400 leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {theme.layout === 'horizontal' && (
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className={`text-4xl font-bold mb-4 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
                How It Works
              </h2>
              <p className="text-lg text-slate-400">Step-by-step process</p>
            </div>

            <div className="space-y-6">
              {service.features.map((feature, i) => (
                <div key={i} className="flex items-start gap-6 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-current/30 transition-all">
                  <div className={`flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-3xl`}>
                    {feature.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                    <p className="text-slate-400">{feature.description}</p>
                  </div>
                  <div className={`flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-xl font-bold`}>
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {theme.layout === 'vertical' && (
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className={`text-4xl font-bold mb-4 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
                Architecture
              </h2>
              <p className="text-lg text-slate-400">Understanding the flow</p>
            </div>

            <div className="relative">
              <div className={`absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b ${theme.gradient} opacity-20`} />
              
              {service.architecture.map((step, i) => (
                <div key={i} className="relative flex items-start gap-8 mb-12 last:mb-0">
                  <div className={`flex-shrink-0 w-16 h-16 rounded-full bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-2xl font-bold relative z-10`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-current/30 transition-all">
                    <h3 className="text-xl font-bold text-white mb-2">{step.step}</h3>
                    <p className="text-slate-400">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {theme.layout === 'grid' && (
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className={`text-4xl font-bold mb-4 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
                Features Overview
              </h2>
              <p className="text-lg text-slate-400">Everything you need</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {service.features.map((feature, i) => (
                <div key={i} className={`bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-current/30 transition-all group hover:scale-105`}>
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-slate-400">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Integrations Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-900/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Integrations</h2>
            <p className="text-lg text-slate-400">Works seamlessly with your existing tools</p>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            {service.integrations.map((integration, i) => (
              <div key={i} className={`px-6 py-3 bg-slate-900/50 border border-slate-800 rounded-xl hover:border-current/30 transition-all`} style={{ borderColor: `rgba(var(--accent-rgb), 0.2)` }}>
                <span className="text-sm font-medium text-slate-300">{integration}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Use Cases</h2>
            <p className="text-lg text-slate-400">Real-world scenarios</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {service.useCases.map((useCase, i) => (
              <div key={i} className={`bg-gradient-to-br ${theme.gradient} bg-opacity-5 border border-current/20 rounded-2xl p-6`} style={{ borderColor: `rgba(var(--accent-rgb), 0.2)` }}>
                <CheckCircle2 className={`w-8 h-8 ${theme.accent} mb-4`} />
                <h3 className="text-xl font-bold text-white mb-2">{useCase.title}</h3>
                <p className="text-slate-400">{useCase.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className={`text-4xl font-bold mb-6 bg-gradient-to-r ${theme.gradient} bg-clip-text text-transparent`}>
            Ready to Get Started?
          </h2>
          <p className="text-lg text-slate-400 mb-8">
            Try {service.name} in our live demo environment
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button className={`px-8 py-4 rounded-xl bg-gradient-to-r ${theme.gradient} text-white font-semibold hover:opacity-90 transition-all shadow-2xl flex items-center gap-3 text-lg`}>
              Launch Live Demo
            </button>
            <Link to="/" className="px-8 py-4 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800/50 transition-all text-lg">
              Explore All Services
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">© 2027 Infracentra. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-xs text-slate-600 hover:text-cyan-400">Home</Link>
            <span className="text-xs text-slate-600">SOC 2 Type II</span>
            <span className="text-xs text-slate-600">ISO 27001</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
