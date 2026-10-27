// ---------------------------------------------------------------------------
// Shared landing primitives — reveal-on-scroll wrapper and a couple of tiny
// helpers used by the cinematic landing sections. Pure CSS transitions (see
// landing.css); IntersectionObserver only toggles a class, so content stays
// visible with JS disabled or under prefers-reduced-motion.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
  as?: keyof React.JSX.IntrinsicElements;
}

export function Reveal({ children, className = '', delay = 0, as = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { setVisible(true); io.disconnect(); }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as any;
  return (
    <Tag
      ref={ref}
      className={`ic-lx-reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** Standard section heading block: eyebrow + title + subtitle. */
export function SectionHeading({
  eyebrow, title, subtitle, align = 'center',
}: {
  eyebrow: string; title: React.ReactNode; subtitle?: React.ReactNode;
  align?: 'center' | 'left';
}) {
  return (
    <Reveal className={`mb-14 ${align === 'center' ? 'text-center mx-auto max-w-3xl' : 'max-w-3xl'}`}>
      <p className="ic-lx-eyebrow mb-3">{eyebrow}</p>
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold ic-lx-h leading-tight mb-4">{title}</h2>
      {subtitle && <p className="text-base sm:text-lg ic-lx-text2 leading-relaxed">{subtitle}</p>}
    </Reveal>
  );
}
