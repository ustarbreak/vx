import React from 'react';
import { BookOpen, Award, Users } from 'lucide-react';

export default function AcademySection() {
  const items = [
    { icon: BookOpen, title: 'Training Courses', desc: 'Self-paced and instructor-led training' },
    { icon: Award, title: 'Certifications', desc: 'Validate your expertise with certifications' },
    { icon: Users, title: 'Community', desc: 'Connect with other security professionals' },
  ];

  return (
    <section id="academy" className="py-24 px-4 sm:px-6 lg:px-8 ic-page">
      <div className="max-w-7xl mx-auto text-center">
        <p className="text-sm ic-link font-semibold uppercase tracking-widest mb-3">Education</p>
        <h2 className="text-4xl sm:text-5xl font-bold ic-heading mb-6">Infracentra Academy</h2>
        <p className="text-lg ic-muted max-w-3xl mx-auto mb-12">
          Master the platform with comprehensive training, certifications, and resources.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {items.map((item, i) => (
            <div key={i} className="ic-card border border rounded-2xl p-8 hover: transition-all">
              <item.icon className="w-12 h-12 ic-link mx-auto mb-4" />
              <h3 className="text-xl font-bold ic-heading mb-2">{item.title}</h3>
              <p className="ic-muted">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
