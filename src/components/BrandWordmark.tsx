// ---------------------------------------------------------------------------
// BrandWordmark — the "Infracentra" name rendered as Infra + Centra.
// Per brand direction: "Infra" always uses the heading colour (white on the
// dark landing / dark app theme, deep navy in light mode) and "Centra" uses
// the blue accent, so the word stays legible on every page and in BOTH themes.
// The mark itself comes from CSS variables (--ic-heading / --ic-primary),
// which themes.css already flips for light/dark — no JS theme detection needed.
// ---------------------------------------------------------------------------
import React from 'react';

export default function BrandWordmark({
  className = '', prefix = 'Infra', suffix = 'Centra', title,
}: {
  className?: string;
  prefix?: string;
  suffix?: string;
  /** aria-label override (defaults to the full brand name). */
  title?: string;
}) {
  return (
    <span className={className} aria-label={title ?? `${prefix}${suffix}`}>
      <span style={{ color: 'var(--ic-heading)' }}>{prefix}</span>
      <span style={{ color: 'var(--ic-primary)' }}>{suffix}</span>
    </span>
  );
}
