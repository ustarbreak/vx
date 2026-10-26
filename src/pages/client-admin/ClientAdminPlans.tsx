import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
// Single source of truth — mirrors backend/app/core/pricing.py
// (STARTER 450 DH · PRO 450 DH · SOUVERAIN 350 DH per managed asset / month HT)
import {
  TIER_LIMITS, unitPrice, computeInvoice, formatMoney, resolveCurrency,
  type PlanTier, type BillingCycle, type Invoice,
} from '../../config/pricing';
import {
  CreditCard, CheckCircle, XCircle, MessageCircle, Send, Bot, Crown,
  Star, Server, Zap, Calculator, ArrowRight,
} from 'lucide-react';

interface Message { id: string; role: 'user' | 'bot'; content: string; timestamp: Date }

const TIER_META: Record<PlanTier, { name: string; blurb: string; features: string[] }> = {
  STARTER: {
    name: 'Starter',
    blurb: 'The full Bundle All-in-One for small estates. All 16 modules, billed per managed asset.',
    features: [
      'All 16 security & infrastructure modules',
      'goinfra collection agents (Linux & Windows)',
      'Auto-discovery + SNMP network mapping',
      'SIEM: 10 GB/day ingestion included',
      '3 technician seats included (+250 DH/extra seat/mo)',
      'Standard support',
    ],
  },
  PRO: {
    name: 'Pro',
    blurb: 'Everything in Starter with more SIEM headroom and a bigger operations team.',
    features: [
      'Everything in Starter',
      'SIEM: 50 GB/day ingestion included',
      '20 technician seats included (+250 DH/extra seat/mo)',
      'Multi-site dashboards & unlimited reports',
      'Automation playbooks + full API access',
      'Priority support',
    ],
  },
  SOUVERAIN: {
    name: 'Souverain',
    blurb: 'Sovereign on-premise deployment at the best rate — unlimited technician seats.',
    features: [
      'Everything in Pro',
      'On-premise / sovereign deployment at your premises',
      'SIEM: 150 GB/day ingestion included',
      'Unlimited technician seats (no overage)',
      'Data export & regulatory compliance',
      'Dedicated CSM + guaranteed SLA',
    ],
  },
};

export default function ClientAdminPlans() {
  const { user, organization, backendMode } = useAuth();
  const [billingInterval, setBillingInterval] = useState<BillingCycle>('MONTHLY');
  const [chatOpen, setChatOpen] = useState(false);
  const [invoice, setInvoice] = useState<(Invoice & { billable_endpoints?: number; live_asset_count?: number }) | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1', role: 'bot',
      content: "Hello! I'm your Infracentra assistant. Ask me anything about your per-asset subscription or billing.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');

  // Current tier/cycle come from the tenant record; fall back to STARTER/MONTHLY.
  const currentTier: PlanTier = (organization?.planTier as PlanTier) || 'STARTER';
  const storedCycle: BillingCycle = (organization?.billingCycle as BillingCycle) || 'MONTHLY';
  const country = organization?.country ?? 'ma';
  const currency = resolveCurrency(country);
  // In the per-asset model, "assets under management" == monitored devices.
  // Demo orgs expose assetCount; endpointCount mirrors it when absent.
  const assetCount = organization?.assetCount ?? organization?.endpointCount ?? 0;
  const memberCount = organization?.memberCount ?? 0;

  useEffect(() => { setBillingInterval(storedCycle); }, [storedCycle]);

  // Live invoice: real mode → GET /api/pricing/invoice (computed server-side
  // against the actual managed-asset count). Demo mode → shared pricing engine.
  useEffect(() => {
    let alive = true;
    if (backendMode) {
      api.get<any>('/pricing/invoice')
        .then((d) => { if (alive) setInvoice(d as any); })
        .catch(() => { if (alive) setInvoice(null); });
    } else {
      const inv = computeInvoice({
        planTier: currentTier, billingCycle: billingInterval,
        endpointCount: Math.max(organization?.endpointCount ?? 0, assetCount),
        seatsUsed: memberCount, siemGbDayUsed: 0, country,
      });
      setInvoice({ ...inv, billable_endpoints: Math.max(organization?.endpointCount ?? 0, assetCount), live_asset_count: assetCount } as any);
    }
    return () => { alive = false; };
  }, [backendMode, currentTier, billingInterval, assetCount, memberCount, country, organization?.endpointCount]);

  // Local preview of what switching tier/cycle would cost (same engine as checkout).
  const previewFor = (tier: PlanTier, cycle: BillingCycle) => computeInvoice({
    planTier: tier, billingCycle: cycle,
    endpointCount: (invoice as any)?.billable_endpoints ?? Math.max(organization?.endpointCount ?? 0, assetCount),
    seatsUsed: memberCount, siemGbDayUsed: 0, country,
  });

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: inputMessage, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'bot',
        content: getBotResponse(inputMessage), timestamp: new Date(),
      }]);
    }, 800);
  };

  const getBotResponse = (message: string): string => {
    const m = message.toLowerCase();
    const unit = unitPrice(currentTier, billingInterval);
    if (m.includes('price') || m.includes('tarif') || m.includes('cost') || m.includes('combien')) {
      return `You are on the ${TIER_META[currentTier].name} bundle: ${unit} DH per managed asset per month (HT)${billingInterval === 'ANNUAL' ? ', annual rate −12%' : ''}. With ${assetCount} assets under management your base is ${formatMoney(assetCount * unit, currency)}/month.`;
    }
    if (m.includes('upgrade') || m.includes('change') || m.includes('switch')) {
      return 'You can switch bundles from the cards above — the change is prorated on your next invoice. Souverain moves you to an on-premise deployment at 350 DH/asset/month.';
    }
    if (m.includes('billing') || m.includes('payment') || m.includes('invoice') || m.includes('facture')) {
      return 'Your invoices are generated monthly from the exact count of managed assets (agents + discovered devices). We accept credit card, bank transfer, and you can download every invoice below.';
    }
    if (m.includes('seat') || m.includes('technician') || m.includes('siège')) {
      const l = TIER_LIMITS[currentTier];
      return l.seatLimit === 0
        ? 'The Souverain bundle includes unlimited technician seats — no extra fees.'
        : `${TIER_META[currentTier].name} includes ${l.seatLimit} technician seats. Each extra seat costs ${l.extraSeatMad} DH/month, added automatically to your invoice.`;
    }
    if (m.includes('agent') || m.includes('deploy')) {
      return 'Deploy goinfra collection agents from Asset Inventory → Collection Agents: one copy-paste command per machine, remote install, zero site visits needed.';
    }
    return "I've noted your question — let me connect you with our support team. Meanwhile, is there anything else I can help with?";
  };

  const tiers: PlanTier[] = ['STARTER', 'PRO', 'SOUVERAIN'];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Subscription &amp; Billing</h1>
          <p className="text-gray-400 mt-1">
            Per-asset pricing — every managed device is billed at a flat monthly rate, all modules included.
          </p>
        </div>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white flex items-center gap-2"
        >
          <MessageCircle className="w-5 h-5" /> Chat with Support
        </button>
      </div>

      {/* Current Subscription Summary */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-6 h-6" />
              <span className="text-blue-100 text-sm">Current Bundle · {billingInterval === 'ANNUAL' ? 'Annual (−12%)' : 'Monthly'}</span>
            </div>
            <h2 className="text-3xl font-bold">{TIER_META[currentTier].name}</h2>
            <p className="text-blue-100 mt-2 flex items-center gap-2 flex-wrap">
              <Server className="w-4 h-4" />
              {unitPrice(currentTier, billingInterval)} DH / managed asset / month HT
              <ArrowRight className="w-4 h-4" />
              <span className="font-semibold">
                {invoice ? formatMoney(invoice.totalDisplay, invoice.currency) : '…'} /month
              </span>
            </p>
            {invoice && (invoice as any).billable_endpoints !== undefined && (
              <p className="text-blue-100 text-sm mt-1">
                {(invoice as any).billable_endpoints} billable assets
                {(invoice as any).live_asset_count !== undefined && ` (${(invoice as any).live_asset_count} currently under management)`}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-blue-100 text-sm">Next billing date</p>
            <p className="text-2xl font-bold">
              {new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-blue-100 text-sm mt-2">{assetCount} devices monitored</p>
          </div>
        </div>
        {invoice && invoice.lines.length > 1 && (
          <div className="mt-4 border-t border-white/20 pt-3 grid gap-1 text-sm">
            {invoice.lines.map((ln, i) => (
              <div key={i} className="flex justify-between text-blue-50">
                <span>{ln.label} × {ln.qty}</span>
                <span>{formatMoney(ln.totalMad, invoice.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setBillingInterval('MONTHLY')}
          className={`px-6 py-2 rounded-lg font-medium transition-all ${
            billingInterval === 'MONTHLY' ? 'bg-blue-600 text-white' : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingInterval('ANNUAL')}
          className={`px-6 py-2 rounded-lg font-medium transition-all ${
            billingInterval === 'ANNUAL' ? 'bg-blue-600 text-white' : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
          }`}
        >
          Annual
          <span className="ml-2 text-xs bg-green-500 text-white px-2 py-1 rounded-full">Save 12%</span>
        </button>
      </div>

      {/* Plans Grid — prices straight from the shared pricing engine */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => {
          const meta = TIER_META[tier];
          const limits = TIER_LIMITS[tier];
          const price = unitPrice(tier, billingInterval);
          const isCurrent = tier === currentTier;
          const preview = previewFor(tier, billingInterval);
          return (
            <div
              key={tier}
              className={`rounded-xl p-6 border-2 transition-all ${
                isCurrent ? 'bg-blue-600/10 border-blue-500' : 'bg-[var(--ic-surface)] border-[var(--ic-border)] hover:border-blue-400'
              }`}
            >
              {tier === 'PRO' && !isCurrent && (
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-yellow-500 text-sm font-semibold">RECOMMENDED</span>
                </div>
              )}
              <h3 className="text-2xl font-bold text-[var(--ic-heading)] mb-1">{meta.name}</h3>
              <p className="text-gray-400 text-xs mb-4">{meta.blurb}</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-[var(--ic-heading)]">{price} DH</span>
                <span className="text-gray-400 ml-2">/ asset / month HT</span>
                {billingInterval === 'ANNUAL' && (
                  <div className="text-[11px] text-emerald-400 mt-1">Annual rate — save 12% vs {limits.unitPriceMad} DH monthly</div>
                )}
              </div>
              <ul className="space-y-3 mb-6">
                {meta.features.map((f, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm">{f}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
                <Calculator className="w-4 h-4" />
                Your estate ({preview.lines[0]?.qty ?? 0} assets{memberCount > 0 && limits.seatLimit !== 0 ? `, ${memberCount} seats` : ''}) →{' '}
                <span className="text-[var(--ic-heading)] font-semibold">{formatMoney(preview.totalDisplay, preview.currency)}/mo</span>
              </div>
              {isCurrent ? (
                <button className="w-full bg-[var(--ic-surface-2)] text-gray-400 py-3 rounded-lg font-medium cursor-not-allowed flex items-center justify-center gap-2">
                  <Zap className="w-4 h-4" /> Current Plan
                </button>
              ) : (
                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition-all">
                  Switch to {meta.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Billing History */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <h2 className="text-xl font-bold text-[var(--ic-heading)] mb-4">Billing History</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ic-border)]">
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Date</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Description</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Assets</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Amount</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((back) => {
                const d = new Date(); d.setMonth(d.getMonth() - back - 1);
                const total = invoice?.totalMad ?? 0;
                return (
                  <tr key={back} className="border-b border-[var(--ic-border)]">
                    <td className="py-3 px-4 text-gray-300">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="py-3 px-4 text-gray-300">{TIER_META[currentTier].name} Bundle — Per-Asset ({billingInterval === 'ANNUAL' ? 'Annual' : 'Monthly'})</td>
                    <td className="py-3 px-4 text-gray-300">{(invoice as any)?.billable_endpoints ?? organization?.endpointCount ?? '—'}</td>
                    <td className="py-3 px-4 text-[var(--ic-heading)] font-semibold">{invoice ? formatMoney(total, invoice.currency) : '—'}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">Paid</span>
                    </td>
                    <td className="py-3 px-4"><button className="text-blue-400 hover:text-blue-300 text-sm">Download</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Payment Methods</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm font-medium">
            Add Payment Method
          </button>
        </div>
        <div className="space-y-3">
          <div className="bg-[var(--ic-surface-2)] rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-[var(--ic-heading)] font-medium">•••• •••• •••• 4242</p>
                <p className="text-gray-400 text-sm">Expires 12/2027</p>
              </div>
            </div>
            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">Default</span>
          </div>
        </div>
      </div>

      {/* Chat Widget */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] shadow-2xl flex flex-col z-50">
          <div className="bg-blue-600 rounded-t-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">Infracentra Support</p>
                <p className="text-blue-100 text-xs">Online</p>
              </div>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-white hover:bg-white/20 p-1 rounded">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-[var(--ic-surface-2)] text-gray-300'
                }`}>
                  <p className="text-sm">{message.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--ic-border)] p-4">
            <div className="flex gap-2">
              <input
                type="text" value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask about pricing, billing, plans..."
                className="flex-1 bg-[var(--ic-surface-2)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={handleSendMessage} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
