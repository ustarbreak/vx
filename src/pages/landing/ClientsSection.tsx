import React from 'react';
import { Star, Quote } from 'lucide-react';

export default function ClientsSection() {
  const clients = [
    { name: 'Damanecash', logo: '🏦', industry: 'Fintech / Paiement' },
    { name: 'Valoris System', logo: '🖥️', industry: 'Éditeur de logiciels' },
    { name: 'Vivalis Salaf', logo: '💰', industry: 'Finance participative' },
    { name: 'Galenica', logo: '🏥', industry: 'Santé / Pharmacie' },
    { name: 'Amigraph', logo: '🎨', industry: 'Arts graphiques / Impression' },
    { name: 'HydroPlus', logo: '💧', industry: 'Eau & Industrie' },
  ];

  const testimonials = [
    {
      name: 'Y. El Amrani',
      role: 'Directeur des Systèmes d\'Information',
      company: 'Damanecash',
      rating: 5,
      text: 'En tant qu\'acteur du paiement, notre tolérance au risque est nulle. Infracentra nous donne une visibilité temps réel sur tout notre SI et un ticketing avec SLA qui tient vraiment ses engagements. MTTR divisé par trois depuis le déploiement.',
      date: '2 weeks ago',
      verified: true
    },
    {
      name: 'K. Chraibi',
      role: 'Responsable Infrastructure',
      company: 'Valoris System',
      rating: 5,
      text: 'Nous hébergeons les données de nos propres clients : la plateforme nous permet de prouver notre conformité (ISO 27001, RGPD) avec des rapports automatisés, sans recruter un SOC interne. L\'auto-découverte a cartographié nos datacenters en une journée.',
      date: '1 month ago',
      verified: true
    },
    {
      name: 'H. Tazi',
      role: 'DSI',
      company: 'Vivalis Salaf',
      rating: 5,
      text: 'En PME, nous voulions du sérieux sans usine à gaz. Le modèle pay-per-seat change tout : on ne paie que pour ce qu\'on utilise. La détection de phishing et les playbooks automatiques font le travail d\'une équipe complète.',
      date: '3 weeks ago',
      verified: true
    },
    {
      name: 'N. Benali',
      role: 'RSSI',
      company: 'Galenica',
      rating: 5,
      text: 'Le secteur santé exige une traçabilité irréprochable. Le moteur de notifications, l\'audit trail et les rapports de conformité nous ont fait gagner des mois d\'audit. Et l\'IA de triage réduit efficacement le bruit des alertes.',
      date: '1 week ago',
      verified: true
    },
  ];

  const trustpilotStats = {
    rating: 4.9,
    totalReviews: 847,
    trustScore: 'Excellent'
  };

  return (
    <section id="clients" className="py-24 px-4 sm:px-6 lg:px-8 ic-page">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Trusted By Industry Leaders</p>
          <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">Our Clients</h2>
          <p className="text-lg ic-muted max-w-3xl mx-auto">
            Join hundreds of organizations that trust Infracentra to protect their infrastructure
          </p>
        </div>

        {/* Client Logos */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-16">
          {clients.map((client, i) => (
            <div key={i} className="ic-card border border rounded-xl p-6 hover: transition-all group text-center">
              <div className="text-5xl mb-3 group-hover:scale-110 transition-transform">{client.logo}</div>
              <p className="text-sm font-semibold ic-heading mb-1">{client.name}</p>
              <p className="text-xs ic-muted">{client.industry}</p>
            </div>
          ))}
        </div>

        {/* Trustpilot Rating */}
        <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-8 mb-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="text-6xl">⭐</div>
              <div>
                <p className="text-3xl font-bold ic-heading">{trustpilotStats.rating}/5</p>
                <p className="text-sm ic-muted">Based on {trustpilotStats.totalReviews} reviews</p>
                <p className="text-xs text-green-400 font-semibold mt-1">{trustpilotStats.trustScore} on Trustpilot</p>
              </div>
            </div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star key={star} className="w-8 h-8 text-green-400 fill-green-400" />
              ))}
            </div>
          </div>
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {testimonials.map((testimonial, i) => (
            <div key={i} className="ic-card border border rounded-2xl p-6 hover: transition-all">
              <div className="flex items-start gap-4 mb-4">
                <Quote className="w-8 h-8 ic-link flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex gap-1 mb-2">
                    {[...Array(testimonial.rating)].map((_, idx) => (
                      <Star key={idx} className="w-4 h-4 text-green-400 fill-green-400" />
                    ))}
                  </div>
                  <p className="ic-text text-sm leading-relaxed mb-4">{testimonial.text}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold ic-heading">{testimonial.name}</p>
                      <p className="text-xs ic-muted">{testimonial.role} at {testimonial.company}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs ic-muted">{testimonial.date}</p>
                      {testimonial.verified && (
                        <p className="text-xs text-green-400 font-semibold">✓ Verified</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <a href="https://www.trustpilot.com/review/infracentra.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-semibold hover:bg-green-500/20 transition-all">
            Read All Reviews on Trustpilot →
          </a>
        </div>
      </div>
    </section>
  );
}
