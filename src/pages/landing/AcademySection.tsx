// ---------------------------------------------------------------------------
// ACADEMY — learning hub teaser. Kept intentionally generic (no fabricated
// courses/certifications). "Open Academy" routes to /academy (registered in
// App.tsx on this branch; currently renders the coming-soon experience).
// ---------------------------------------------------------------------------
import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Award, Users, ArrowRight } from 'lucide-react';
import { Reveal, SectionHeading } from './lxPrimitives';

const items = [
  { icon: BookOpen, title: 'Training Courses', desc: 'Self-paced and instructor-led training on the Infracentra platform.' },
  { icon: Award, title: 'Certifications', desc: 'Validate your team\u2019s expertise with structured certification paths.' },
  { icon: Users, title: 'Community', desc: 'Connect with other security professionals and MSSP operators.' },
];

export default function AcademySection() {
  return (
    <section id="academy" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="Education"
          title={<>Infracentra <span style={{ color: 'var(--lx-cyan)' }}>Academy</span></>}
          subtitle="Master the platform with comprehensive training, certifications, and resources."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={i * 90}>
              <div className="ic-lx-card p-8 text-center h-full">
                <item.icon className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--lx-cyan)' }} />
                <h3 className="text-xl font-bold ic-lx-h mb-2">{item.title}</h3>
                <p className="text-sm ic-lx-muted">{item.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="text-center">
          <Link to="/academy" className="ic-lx-btn-outline px-7 py-3 text-sm">
            Open Academy <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
