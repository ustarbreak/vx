import React, { useState } from 'react';
import { useAuth } from '../../../src/context/AuthContext';
import { 
  CreditCard, CheckCircle, XCircle, MessageCircle, 
  Send, Bot, User, Crown, Zap, Shield, Star
} from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price: number;
  interval: 'monthly' | 'yearly';
  features: string[];
  current: boolean;
  recommended?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

export default function ClientAdminPlans() {
  const { user, organization } = useAuth();
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'bot',
      content: 'Hello! I\'m your Infracentra assistant. How can I help you today?',
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState('');

  const plans: Plan[] = [
    {
      id: 'starter',
      name: 'Starter',
      price: billingInterval === 'monthly' ? 299 : 2990,
      interval: billingInterval,
      features: [
        'Up to 50 devices',
        'Basic monitoring',
        'Email alerts',
        '7-day data retention',
        'Community support',
      ],
      current: false,
    },
    {
      id: 'professional',
      name: 'Professional',
      price: billingInterval === 'monthly' ? 799 : 7990,
      interval: billingInterval,
      features: [
        'Up to 500 devices',
        'Advanced monitoring',
        'SMS & Email alerts',
        '30-day data retention',
        'Priority support',
        'Custom dashboards',
        'API access',
      ],
      current: true,
      recommended: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: billingInterval === 'monthly' ? 1999 : 19990,
      interval: billingInterval,
      features: [
        'Unlimited devices',
        'Enterprise monitoring',
        'All alert channels',
        '365-day data retention',
        '24/7 dedicated support',
        'Custom integrations',
        'SLA guarantee',
        'On-premise deployment',
      ],
      current: false,
    },
  ];

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
    };

    setMessages([...messages, userMessage]);
    setInputMessage('');

    // Simulate bot response
    setTimeout(() => {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'bot',
        content: getBotResponse(inputMessage),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    }, 1000);
  };

  const getBotResponse = (message: string): string => {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('upgrade') || lowerMessage.includes('plan')) {
      return 'I can help you upgrade your plan! You can choose from our Starter, Professional, or Enterprise plans. Would you like me to show you the differences?';
    }
    if (lowerMessage.includes('billing') || lowerMessage.includes('payment')) {
      return 'You can manage your billing information in the Plans & Billing section. We accept credit cards, PayPal, and bank transfers.';
    }
    if (lowerMessage.includes('support') || lowerMessage.includes('help')) {
      return 'Our support team is available 24/7 for Enterprise customers. For Professional plans, we offer priority support during business hours. How can I assist you?';
    }
    if (lowerMessage.includes('feature') || lowerMessage.includes('add')) {
      return 'You can add additional features and services from your service catalog. Each service can be activated independently based on your needs.';
    }
    if (lowerMessage.includes('device') || lowerMessage.includes('monitor')) {
      return 'Your current plan supports monitoring up to 500 devices. You can view and manage all your devices from the Infrastructure Dashboard.';
    }
    
    return 'I understand your question. Let me connect you with our support team who can provide detailed assistance. In the meantime, is there anything else I can help you with?';
  };

  const currentPlan = plans.find(p => p.current);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--ic-heading)]">Plans & Billing</h1>
          <p className="text-gray-400 mt-1">
            Manage your subscription and billing information
          </p>
        </div>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-[var(--ic-heading)] flex items-center gap-2"
        >
          <MessageCircle className="w-5 h-5" />
          Chat with Support
        </button>
      </div>

      {/* Current Plan Summary */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-[var(--ic-heading)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-6 h-6" />
              <span className="text-blue-100 text-sm">Current Plan</span>
            </div>
            <h2 className="text-3xl font-bold">{currentPlan?.name}</h2>
            <p className="text-blue-100 mt-2">
              ${currentPlan?.price} / {currentPlan?.interval === 'monthly' ? 'month' : 'year'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-blue-100 text-sm">Next billing date</p>
            <p className="text-2xl font-bold">Feb 15, 2027</p>
            <p className="text-blue-100 text-sm mt-2">
              {organization?.memberCount || 0} devices monitored
            </p>
          </div>
        </div>
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setBillingInterval('monthly')}
          className={`px-6 py-2 rounded-lg font-medium transition-all ${
            billingInterval === 'monthly'
              ? 'bg-blue-600 text-[var(--ic-heading)]'
              : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingInterval('yearly')}
          className={`px-6 py-2 rounded-lg font-medium transition-all ${
            billingInterval === 'yearly'
              ? 'bg-blue-600 text-[var(--ic-heading)]'
              : 'bg-[var(--ic-surface)] text-gray-400 hover:bg-[var(--ic-surface-2)]'
          }`}
        >
          Yearly
          <span className="ml-2 text-xs bg-green-500 text-[var(--ic-heading)] px-2 py-1 rounded-full">
            Save 17%
          </span>
        </button>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-xl p-6 border-2 transition-all ${
              plan.current
                ? 'bg-blue-600/10 border-blue-500'
                : 'bg-[var(--ic-surface)] border-[var(--ic-border)] hover:border-[var(--ic-border)]'
            }`}
          >
            {plan.recommended && (
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                <span className="text-yellow-500 text-sm font-semibold">RECOMMENDED</span>
              </div>
            )}
            
            <h3 className="text-2xl font-bold text-[var(--ic-heading)] mb-2">{plan.name}</h3>
            <div className="mb-6">
              <span className="text-4xl font-bold text-[var(--ic-heading)]">${plan.price}</span>
              <span className="text-gray-400 ml-2">/ {plan.interval === 'monthly' ? 'month' : 'year'}</span>
            </div>

            <ul className="space-y-3 mb-6">
              {plan.features.map((feature, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-300 text-sm">{feature}</span>
                </li>
              ))}
            </ul>

            {plan.current ? (
              <button className="w-full bg-[var(--ic-surface-2)] text-gray-400 py-3 rounded-lg font-medium cursor-not-allowed">
                Current Plan
              </button>
            ) : (
              <button className="w-full bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] py-3 rounded-lg font-medium transition-all">
                {plans.findIndex(p => p.current) < plans.indexOf(plan) ? 'Upgrade' : 'Downgrade'}
              </button>
            )}
          </div>
        ))}
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
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Amount</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Status</th>
                <th className="text-left py-3 px-4 text-gray-400 font-semibold">Invoice</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--ic-border)]">
                <td className="py-3 px-4 text-gray-300">Jan 15, 2027</td>
                <td className="py-3 px-4 text-gray-300">Professional Plan - Monthly</td>
                <td className="py-3 px-4 text-[var(--ic-heading)] font-semibold">$799.00</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                    Paid
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button className="text-blue-400 hover:text-blue-300 text-sm">Download</button>
                </td>
              </tr>
              <tr className="border-b border-[var(--ic-border)]">
                <td className="py-3 px-4 text-gray-300">Dec 15, 2026</td>
                <td className="py-3 px-4 text-gray-300">Professional Plan - Monthly</td>
                <td className="py-3 px-4 text-[var(--ic-heading)] font-semibold">$799.00</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                    Paid
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button className="text-blue-400 hover:text-blue-300 text-sm">Download</button>
                </td>
              </tr>
              <tr className="border-b border-[var(--ic-border)]">
                <td className="py-3 px-4 text-gray-300">Nov 15, 2026</td>
                <td className="py-3 px-4 text-gray-300">Professional Plan - Monthly</td>
                <td className="py-3 px-4 text-[var(--ic-heading)] font-semibold">$799.00</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                    Paid
                  </span>
                </td>
                <td className="py-3 px-4">
                  <button className="text-blue-400 hover:text-blue-300 text-sm">Download</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-[var(--ic-surface)] rounded-xl p-6 border border-[var(--ic-border)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[var(--ic-heading)]">Payment Methods</h2>
          <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-[var(--ic-heading)] text-sm font-medium">
            Add Payment Method
          </button>
        </div>
        <div className="space-y-3">
          <div className="bg-[var(--ic-surface)] rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="w-8 h-8 text-blue-400" />
              <div>
                <p className="text-[var(--ic-heading)] font-medium">•••• •••• •••• 4242</p>
                <p className="text-gray-400 text-sm">Expires 12/2027</p>
              </div>
            </div>
            <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
              Default
            </span>
          </div>
        </div>
      </div>

      {/* Chat Widget */}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-[var(--ic-surface)] rounded-xl border border-[var(--ic-border)] shadow-2xl flex flex-col">
          <div className="bg-blue-600 rounded-t-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-[var(--ic-heading)]" />
              </div>
              <div>
                <p className="text-[var(--ic-heading)] font-semibold">Infracentra Support</p>
                <p className="text-blue-100 text-xs">Online</p>
              </div>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="text-[var(--ic-heading)] hover:bg-white/20 p-1 rounded"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-[var(--ic-heading)]'
                      : 'bg-[var(--ic-surface)] text-gray-300'
                  }`}
                >
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
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type your message..."
                className="flex-1 bg-[var(--ic-surface)] text-[var(--ic-heading)] rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSendMessage}
                className="bg-blue-600 hover:bg-blue-700 text-[var(--ic-heading)] p-2 rounded-lg transition-all"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
