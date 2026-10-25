import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Shield, Award, Target, Zap, 
  Calendar, DollarSign, CheckCircle, Clock
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, AreaChart, Area
} from 'recharts';

export default function CustomerValueDashboard() {
  const [customerData, setCustomerData] = useState({
    startDate: '2026-06-15',
    contractDuration: 12,
    currentMonth: 8,
    monthlySpend: 2999,
    totalInvestment: 23992,
    valueGenerated: 156000,
    roi: 550,
    loyaltyDiscount: 15,
    nextRenewal: '2027-06-15',
  });

  // Données simulées pour les graphiques
  const valueOverTime = [
    { month: 'Mois 1', threats: 45, incidents: 12, value: 15000 },
    { month: 'Mois 2', threats: 67, incidents: 18, value: 22000 },
    { month: 'Mois 3', threats: 89, incidents: 24, value: 31000 },
    { month: 'Mois 4', threats: 112, incidents: 31, value: 42000 },
    { month: 'Mois 5', threats: 134, incidents: 38, value: 55000 },
    { month: 'Mois 6', threats: 156, incidents: 45, value: 69000 },
    { month: 'Mois 7', threats: 178, incidents: 52, value: 84000 },
    { month: 'Mois 8', threats: 201, incidents: 58, value: 101000 },
  ];

  const loyaltyProgress = [
    { year: 1, discount: 0, label: 'Année 1' },
    { year: 2, discount: 10, label: 'Année 2' },
    { year: 3, discount: 15, label: 'Année 3' },
    { year: 4, discount: 20, label: 'Année 4' },
    { year: 5, discount: 25, label: 'Année 5+' },
  ];

  const achievements = [
    { id: 1, title: 'First Blood', description: 'Première menace détectée', icon: '🎯', earned: true, date: '2026-06-16' },
    { id: 2, title: 'Shield Master', description: '100 attaques bloquées', icon: '🛡️', earned: true, date: '2026-08-20' },
    { id: 3, title: 'Speed Demon', description: 'Temps de réponse < 5 min', icon: '⚡', earned: true, date: '2026-09-15' },
    { id: 4, title: 'Compliance Champion', description: '100% NIST CSF compliance', icon: '🏆', earned: true, date: '2026-10-01' },
    { id: 5, title: 'Zero Breach', description: '90 jours sans incident', icon: '🔒', earned: false, progress: 67 },
    { id: 6, title: 'Threat Hunter', description: '50 menaces proactives', icon: '🔍', earned: false, progress: 34 },
  ];

  const stats = {
    threatsBlocked: 201,
    incidentsResolved: 58,
    avgResponseTime: '3.2 min',
    complianceScore: 94,
    costSaved: 156000,
    roi: 550,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Value & Loyalty Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Track the value Infracentra delivers and your loyalty benefits
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-lg">
          <TrendingUp className="w-5 h-5 text-green-400" />
          <span className="text-green-400 font-semibold">+{stats.roi}% ROI</span>
        </div>
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <Shield className="w-8 h-8 text-blue-400" />
            <span className="text-3xl font-bold text-white">{stats.threatsBlocked}</span>
          </div>
          <p className="text-blue-300 text-sm">Threats Blocked</p>
          <p className="text-gray-400 text-xs mt-1">Since {customerData.startDate}</p>
        </div>

        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <DollarSign className="w-8 h-8 text-green-400" />
            <span className="text-3xl font-bold text-white">${(stats.costSaved / 1000).toFixed(0)}k</span>
          </div>
          <p className="text-green-300 text-sm">Cost Saved</p>
          <p className="text-gray-400 text-xs mt-1">Estimated breach prevention</p>
        </div>

        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <Clock className="w-8 h-8 text-purple-400" />
            <span className="text-3xl font-bold text-white">{stats.avgResponseTime}</span>
          </div>
          <p className="text-purple-300 text-sm">Avg Response Time</p>
          <p className="text-gray-400 text-xs mt-1">Industry avg: 15 min</p>
        </div>

        <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <Award className="w-8 h-8 text-orange-400" />
            <span className="text-3xl font-bold text-white">{stats.complianceScore}%</span>
          </div>
          <p className="text-orange-300 text-sm">Compliance Score</p>
          <p className="text-gray-400 text-xs mt-1">NIST CSF 2.0</p>
        </div>
      </div>

      {/* Value Over Time Chart */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Value Generated Over Time</h2>
            <p className="text-gray-400 text-sm mt-1">Cumulative value delivered by Infracentra</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-green-400">${(customerData.valueGenerated / 1000).toFixed(0)}k</p>
            <p className="text-gray-400 text-sm">Total Value</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={valueOverTime}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="month" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1e293b', 
                border: '1px solid #334155',
                borderRadius: '8px'
              }}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#10b981" 
              fillOpacity={1} 
              fill="url(#colorValue)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Loyalty Program */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Loyalty Program</h2>
            <p className="text-gray-400 text-sm mt-1">The longer you stay, the more you save</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-cyan-400">{customerData.loyaltyDiscount}%</p>
            <p className="text-gray-400 text-sm">Current Discount</p>
          </div>
        </div>
        
        <div className="grid grid-cols-5 gap-4">
          {loyaltyProgress.map((level) => (
            <div 
              key={level.year}
              className={`p-4 rounded-lg border-2 transition-all ${
                level.year <= customerData.currentMonth / 12 + 1
                  ? 'bg-cyan-500/20 border-cyan-500/50'
                  : 'bg-slate-800/50 border-slate-700'
              }`}
            >
              <div className="text-center">
                <p className="text-2xl font-bold text-white mb-1">{level.discount}%</p>
                <p className="text-xs text-gray-400">{level.label}</p>
                {level.year === Math.ceil(customerData.currentMonth / 12) && (
                  <div className="mt-2 px-2 py-1 bg-cyan-500/30 rounded text-xs text-cyan-400 font-semibold">
                    YOU ARE HERE
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-semibold">Next Loyalty Milestone</p>
              <p className="text-gray-400 text-sm">
                {12 - customerData.currentMonth} months until {customerData.loyaltyDiscount + 5}% discount
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-cyan-400">
                ${((customerData.monthlySpend * (1 - (customerData.loyaltyDiscount + 5) / 100))).toFixed(0)}/mo
              </p>
              <p className="text-gray-400 text-xs">Projected monthly cost</p>
            </div>
          </div>
        </div>
      </div>

      {/* Achievements */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-bold text-white mb-6">Security Achievements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {achievements.map((achievement) => (
            <div 
              key={achievement.id}
              className={`p-4 rounded-lg border-2 transition-all ${
                achievement.earned
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-slate-800/50 border-slate-700'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl">{achievement.icon}</span>
                <div className="flex-1">
                  <h3 className="text-white font-semibold mb-1">{achievement.title}</h3>
                  <p className="text-gray-400 text-sm mb-2">{achievement.description}</p>
                  {achievement.earned ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      <span className="text-green-400 text-xs">
                        Earned on {achievement.date ? new Date(achievement.date).toLocaleDateString('en-US') : 'N/A'}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Progress</span>
                        <span>{achievement.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-2">
                        <div 
                          className="bg-cyan-500 h-2 rounded-full transition-all"
                          style={{ width: `${achievement.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contract Info */}
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6">
        <h2 className="text-xl font-bold text-white mb-6">Contract Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span className="text-gray-400">Contract Start</span>
              <span className="text-white font-semibold">{customerData.startDate}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span className="text-gray-400">Contract Duration</span>
              <span className="text-white font-semibold">{customerData.contractDuration} months</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span className="text-gray-400">Current Month</span>
              <span className="text-white font-semibold">{customerData.currentMonth} of {customerData.contractDuration}</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span className="text-gray-400">Monthly Investment</span>
              <span className="text-white font-semibold">${customerData.monthlySpend}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span className="text-gray-400">Total Investment</span>
              <span className="text-white font-semibold">${customerData.totalInvestment}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-lg">
              <span className="text-green-300">Next Renewal</span>
              <span className="text-green-400 font-semibold">{customerData.nextRenewal}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-semibold mb-1">Automatic Renewal Notice</p>
              <p className="text-gray-400 text-sm">
                Your contract will automatically renew on {customerData.nextRenewal}. 
                To prevent renewal, please provide written notice 90 days before the renewal date.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
