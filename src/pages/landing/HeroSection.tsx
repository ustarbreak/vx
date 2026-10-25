import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Play, Eye, Layers, Shield, Target, Zap, Sparkles, ArrowRight } from 'lucide-react';
import ImageSlider from '../../components/ImageSlider';

export default function HeroSection() {
  const navigate = useNavigate();
  const { loginAsDemo } = useAuth();

  const handleDemoLogin = async () => {
    await loginAsDemo('platform-admin');
    navigate('/admin/dashboard');
  };

  const sliderImages = [
    {
      url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=600&fit=crop',
      title: 'Advanced Threat Detection',
      description: 'AI-powered security operations center with real-time threat intelligence'
    },
    {
      url: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=1200&h=600&fit=crop',
      title: 'Unified Security Platform',
      description: '16 integrated services for complete infrastructure protection'
    },
    {
      url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&h=600&fit=crop',
      title: 'Network Security Monitoring',
      description: '24/7 network visibility with intelligent monitoring and policy enforcement'
    },
    {
      url: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1200&h=600&fit=crop',
      title: 'Automated Response',
      description: 'SOAR-powered incident response with machine speed'
    }
  ];

  return (
    <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8">
      <div className="relative max-w-7xl mx-auto">
        {/* Hero Content */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full ic-chip-ok border mb-8" style={{ borderColor: 'var(--ic-border)' }}>
            <Sparkles className="w-4 h-4" style={{ color: 'var(--ic-primary)' }} />
            <span className="text-sm font-medium ic-heading">The Complete Security &amp; Infrastructure Platform</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
            <span className="ic-hero-title">You're being looked after.</span>
          </h1>

          <p className="text-xl max-w-3xl mx-auto mb-10 leading-relaxed ic-muted">
            Infracentra delivers a complete <span className="font-semibold ic-heading">Integrated Security Operations Center (ISOC)</span> through
            a unified platform that connects security data, detection, investigation, and response — so your teams can focus on what matters.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={handleDemoLogin}
              className="group ic-btn-primary px-8 py-4 flex items-center gap-3 text-lg"
            >
              <Play className="w-5 h-5" />
              Request Platform Demo
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <Link
              to="/login"
              className="ic-btn-outline px-8 py-4 flex items-center gap-3 text-lg"
            >
              <Eye className="w-5 h-5" />
              Explore Platform
            </Link>
          </div>
        </div>

        {/* Image Slider */}
        <div className="mb-16">
          <ImageSlider images={sliderImages} autoPlay={true} interval={5000} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {[
            { value: '16', label: 'Integrated Services', icon: Layers },
            { value: '94%', label: 'Threat Block Rate', icon: Shield },
            { value: '14m', label: 'Mean Time to Detect', icon: Target },
            { value: '2.4h', label: 'Mean Time to Respond', icon: Zap },
          ].map((stat, i) => (
            <div key={i} className="ic-card p-6 text-center">
              <stat.icon className="w-6 h-6 mx-auto mb-3" style={{ color: 'var(--ic-primary)' }} />
              <p className="text-3xl font-bold ic-heading mb-1">{stat.value}</p>
              <p className="text-xs ic-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
