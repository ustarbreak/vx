import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Zap, Eye, EyeOff, Loader2, Lock, Mail, ArrowRight, Building2, Users, Crown } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginAsDemo, isLoading, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'demo' | 'login'>('demo');

  const handleDemoLogin = async (key: string) => {
    const loggedInUser = await loginAsDemo(key);
    if (!loggedInUser) return;
    
    // Redirect based on role immediately
    if (loggedInUser.role === 'platform_admin') {
      navigate('/admin/dashboard');
    } else if (loggedInUser.role === 'client_admin') {
      navigate('/client-admin/dashboard');
    } else {
      navigate('/dashboard');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const loggedInUser = await login(email, password);
    if (!loggedInUser) return;
    
    // Redirect based on role immediately
    if (loggedInUser.role === 'platform_admin') {
      navigate('/admin/dashboard');
    } else if (loggedInUser.role === 'client_admin') {
      navigate('/client-admin/dashboard');
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: 'linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)',
        backgroundSize: '60px 60px'
      }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/20 mb-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-2">Infracentra</h1>
          <p className="text-slate-500 text-sm">Unified Infrastructure & Security Orchestration</p>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-xl border border-cyan-500/10 rounded-2xl p-8 shadow-2xl">
          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('demo')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'demo'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/30 border border-slate-700/30'
              }`}
            >
              Quick Demo
            </button>
            <button
              onClick={() => setActiveTab('login')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'login'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-800/30 border border-slate-700/30'
              }`}
            >
              Sign In
            </button>
          </div>

          {activeTab === 'demo' ? (
            <>
              <h2 className="text-xl font-semibold text-white mb-1">Try the Platform</h2>
              <p className="text-slate-500 text-sm mb-6">Select a role to explore Infracentra</p>

              <div className="space-y-3">
                {/* Platform Admin */}
                <button
                  onClick={() => handleDemoLogin('platform-admin')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-purple-500/5 border border-purple-500/20 hover:border-purple-500/40 hover:bg-purple-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                      <Crown className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Platform Admin</p>
                      <p className="text-[10px] text-slate-500">ops@infracentra.io</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-purple-400 transition-colors" />
                </button>

                {/* Client Admin */}
                <button
                  onClick={() => handleDemoLogin('client-admin-enterprise')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Client Admin (Enterprise)</p>
                      <p className="text-[10px] text-slate-500">sarah.chen@infracentracorp.io</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                </button>

                {/* Client User */}
                <button
                  onClick={() => handleDemoLogin('client-user')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-green-500/5 border border-green-500/20 hover:border-green-500/40 hover:bg-green-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Client User</p>
                      <p className="text-[10px] text-slate-500">marcus.j@infracentracorp.io</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-green-400 transition-colors" />
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-500 text-center">
                  Need a partner or super admin account?{' '}
                  <a href="#" className="text-cyan-400 hover:text-cyan-300">Contact sales</a>
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-white mb-1">Welcome back</h2>
              <p className="text-slate-500 text-sm mb-6">Sign in to your operations center</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50"
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-slate-200 text-sm focus:outline-none focus:border-cyan-500/50"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium text-sm hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-500 text-center">
                  Don't have an account?{' '}
                  <a href="#" className="text-cyan-400 hover:text-cyan-300">Request access</a>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          <Link to="/" className="text-cyan-500 hover:text-cyan-400">← Back to landing page</Link>
        </p>
      </div>
    </div>
  );
}
