import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, DEMO_ACCOUNTS, isDemoMode, setDemoMode } from '../context/AuthContext';
import { Shield, Zap, Eye, EyeOff, Loader2, Lock, Mail, ArrowRight, Building2, Users, Crown, Rocket, Briefcase, Ticket, UserCog } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginAsDemo, isLoading, user, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'demo' | 'login'>('demo');
  const [demoMode, setDemoModeState] = useState(() => isDemoMode());

  const toggleDemoMode = (on: boolean) => {
    setDemoModeState(on);
    setDemoMode(on); // single source of truth shared with AuthContext / entitlements
  };

  const handleDemoLogin = async (key: string) => {
    const loggedInUser = await loginAsDemo(key);
    if (!loggedInUser) return;
    
    // Redirect based on role immediately
    if (loggedInUser.role === 'platform_admin') {
      navigate('/admin/dashboard');
    } else if (loggedInUser.role === 'partner_admin') {
      navigate('/partner/dashboard');
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
    } else if (loggedInUser.role === 'partner_admin') {
      navigate('/partner/dashboard');
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
          <Link to="/" className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-[var(--ic-border)] mb-4">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-[var(--ic-heading)]" />
            </div>
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-2">Infracentra</h1>
          <p className="text-[var(--ic-muted)] text-sm">Unified Infrastructure & Security Orchestration</p>
        </div>

        <div className="bg-[var(--ic-bg)]/85 backdrop-blur-xl border border-[var(--ic-border)] rounded-2xl p-8 shadow-2xl">
          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab('demo')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'demo'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]'
                  : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] bg-[var(--ic-surface)] border border-[var(--ic-border)]'
              }`}
            >
              Quick Demo
            </button>
            <button
              onClick={() => setActiveTab('login')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'login'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-[var(--ic-border)]'
                  : 'text-[var(--ic-muted)] hover:text-[var(--ic-heading)] bg-[var(--ic-surface)] border border-[var(--ic-border)]'
              }`}
            >
              Sign In
            </button>
          </div>

          {activeTab === 'demo' ? (
            <>
              <h2 className="text-xl font-semibold text-[var(--ic-heading)] mb-1">Try the Platform</h2>
              <p className="text-[var(--ic-muted)] text-sm mb-4">Select a role to explore Infracentra</p>

              {/* Demo Mode selector: choose what to log into — simulated demo or real backend */}
              <div className={`rounded-xl border p-3 mb-4 ${demoMode ? 'bg-cyan-500/5 border-[var(--ic-primary)]' : 'bg-emerald-500/5 border-emerald-500/30'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--ic-heading)] flex items-center gap-1.5">
                      {demoMode ? <Rocket className="w-3.5 h-3.5 text-cyan-400" /> : <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                      {demoMode ? 'DEMO MODE — Simulated environment' : 'REAL BACKEND — Live API data'}
                    </p>
                    <p className="text-[10px] text-[var(--ic-muted)] mt-1 leading-relaxed">
                      {demoMode
                        ? 'Instant access to ALL 16 services + Advanced Ticketing (Pro & Enterprise feature). No backend needed, nothing is stored on servers.'
                        : 'Demo accounts authenticate against the live FastAPI backend with real entitlements and audit logging.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={demoMode}
                    onClick={() => toggleDemoMode(!demoMode)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${demoMode ? 'bg-cyan-500' : 'bg-emerald-500'}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${demoMode ? 'translate-x-5' : ''}`}
                    />
                  </button>
                </div>
                {demoMode && (
                  <div className="mt-2 pt-2 border-t border-[var(--ic-border)] flex items-center gap-1.5 text-[10px] text-cyan-300">
                    <Ticket className="w-3 h-3" />
                    Demo tenants include all 16 services + Advanced Ticketing unlocked
                  </div>
                )}
              </div>

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
                      <p className="text-sm font-medium text-[var(--ic-heading)]">Platform Admin</p>
                      <p className="text-[10px] text-[var(--ic-muted)]">{DEMO_ACCOUNTS['platform-admin'].email}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ic-muted)] group-hover:text-purple-400 transition-colors" />
                </button>

                {/* Client Admin — Enterprise (all 16 services + Advanced Ticketing) */}
                <button
                  onClick={() => handleDemoLogin('client-admin-enterprise')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-500/5 border border-[var(--ic-border)] hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--ic-heading)]">Client Admin (Enterprise)</p>
                      <p className="text-[10px] text-[var(--ic-muted)]">{DEMO_ACCOUNTS['client-admin-enterprise'].email} · all 16 services + ticketing</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ic-muted)] group-hover:text-cyan-400 transition-colors" />
                </button>

                {/* Client Admin — Pro (all 16 services + Advanced Ticketing included in Pro plan) */}
                <button
                  onClick={() => handleDemoLogin('client-admin-pro')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Briefcase className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--ic-heading)]">Client Admin (Pro)</p>
                      <p className="text-[10px] text-[var(--ic-muted)]">{DEMO_ACCOUNTS['client-admin-pro'].email} · Pro plan + Advanced Ticketing</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ic-muted)] group-hover:text-blue-400 transition-colors" />
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
                      <p className="text-sm font-medium text-[var(--ic-heading)]">Client User</p>
                      <p className="text-[10px] text-[var(--ic-muted)]">{DEMO_ACCOUNTS['client-user'].email}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ic-muted)] group-hover:text-green-400 transition-colors" />
                </button>

                {/* Partner Admin — MSP white-label portal */}
                <button
                  onClick={() => handleDemoLogin('partner-admin')}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/10 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <UserCog className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--ic-heading)]">Partner Admin (MSP)</p>
                      <p className="text-[10px] text-[var(--ic-muted)]">{DEMO_ACCOUNTS['partner-admin'].email} · portail white-label AtlasSOC</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--ic-muted)] group-hover:text-amber-400 transition-colors" />
                </button>
              </div>

              {authError && (
                <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
                  {authError}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-[var(--ic-border)]">
                <p className="text-xs text-[var(--ic-muted)] text-center">
                  Need a partner or super admin account?{' '}
                  <Link to="/demo-request" className="text-cyan-400 hover:text-cyan-300">Contact sales</Link>
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[var(--ic-heading)] mb-1">Welcome back</h2>
              <p className="text-[var(--ic-muted)] text-sm mb-6">Sign in to your operations center</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-heading)] text-sm focus:outline-none focus:border-cyan-500/50"
                      placeholder="you@company.com"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ic-muted)] mb-1.5 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ic-muted)]" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg bg-[var(--ic-surface-2)] border border-[var(--ic-border)] text-[var(--ic-heading)] text-sm focus:outline-none focus:border-cyan-500/50"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ic-muted)] hover:text-[var(--ic-text)]"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-[var(--ic-heading)] font-medium text-sm hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
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

                {authError && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
                    {authError}
                  </div>
                )}

                {/* Demo Mode selector — choose simulated demo vs real backend */}
                <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${demoMode ? 'bg-cyan-500/5 border-[var(--ic-primary)]' : 'bg-emerald-500/5 border-emerald-500/30'}`}>
                  <div>
                    <p className="text-xs font-medium text-[var(--ic-text)]">Demo Mode {demoMode ? '(ON)' : '(OFF)'}</p>
                    <p className="text-[10px] text-[var(--ic-muted)]">
                      {demoMode
                        ? 'Simulated environment — all 16 services + Advanced Ticketing unlocked, no backend calls'
                        : 'Production mode — 100% real backend: live data, entitlements & audit trail'}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={demoMode}
                    onClick={() => toggleDemoMode(!demoMode)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${demoMode ? 'bg-cyan-500' : 'bg-emerald-500'}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${demoMode ? 'translate-x-5' : ''}`}
                    />
                  </button>
                </div>
              </form>

              <div className="mt-6 pt-6 border-t border-[var(--ic-border)]">
                <p className="text-xs text-[var(--ic-muted)] text-center">
                  Don't have an account?{' '}
                  <Link to="/demo-request" className="text-cyan-400 hover:text-cyan-300">Request access</Link>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-[var(--ic-muted)] mt-6">
          <Link to="/" className="text-cyan-500 hover:text-cyan-400">← Back to landing page</Link>
        </p>
      </div>
    </div>
  );
}
