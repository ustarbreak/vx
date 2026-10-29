// ---------------------------------------------------------------------------
// SmartLink — fixes the "clicking Pricing / MSSP stays on home" bug.
// The app is served under HashRouter: window.location.hash IS the router
// location, so a raw <a href="/pricing"> makes the browser navigate to the
// server path (e.g. http://host/pricing) which 404s or reloads the SPA at "/"
// and lands back on the landing page. Anchors like "/#about" are equally
// wrong under HashRouter (they should be "#/#about").
// This component routes every navigation through react-router's navigate()
// when the target matches a real route, and falls back to scroll-to-section
// behaviour for in-page anchors. `legacyHashTargets` lists targets that were
// written as "#/route" raw anchors; they map to the same router routes.
// ---------------------------------------------------------------------------
import React from 'react';
import { useNavigate } from 'react-router-dom';

const ROUTED_PREFIXES = [
  '/pricing', '/mssp', '/demo-request', '/login', '/demo', '/service/',
  '/coming-soon/', '/health-check', '/academy', '/dashboard', '/admin/',
  '/partner/', '/client-admin/', '/portal', '/reports', '/settings',
  // Company / "Why Infracentra" pages (real routes registered in App.tsx)
  '/about', '/recognition', '/customer-stories', '/find-a-partner', '/compare/',
];

/** Normalise any href ("#/pricing", "/pricing", "/#about") to a router path
 * + optional hash section. Returns null when it is an external URL. */
export function parseLandingHref(href: string): { path: string; section?: string } | null {
  if (!href || href === '#') return null;
  if (/^(https?:|mailto:|tel:)/i.test(href)) return null; // external — leave alone
  let h = href.trim();
  // "#/pricing" style (legacy raw-hash anchors) → router path "/pricing"
  if (h.startsWith('#/')) {
    const inner = h.slice(1); // "/pricing..."
    const [path, ...rest] = inner.split('#');
    return { path, section: rest.join('#') || undefined };
  }
  // "/#about" style → stay on "/" and scroll to #about
  if (h.startsWith('/#')) return { path: '/', section: h.slice(2) || undefined };
  // "#about" pure anchor → stay on current page, scroll
  if (h.startsWith('#')) return { path: '', section: h.slice(1) };
  // plain path
  const [path, ...rest] = h.split('#');
  return { path, section: rest.join('#') || undefined };
}

export default function SmartLink({
  href, className, children, onClick, ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const parsed = parseLandingHref(href);
    if (!parsed) return; // external link: normal browser behaviour

    e.preventDefault();
    const isRoute = parsed.path !== '' && ROUTED_PREFIXES.some(p => parsed.path === p || parsed.path.startsWith(p.replace(/\/$/, '') + '/') || parsed.path === p.replace(/\/$/, ''));

    if (parsed.path === '' ) {
      // pure in-page anchor (#about) — just scroll
      scrollToSection(parsed.section);
      return;
    }
    if (isRoute) {
      navigate(parsed.path);
      if (parsed.section) requestAnimationFrame(() => scrollToSection(parsed.section));
      else window.scrollTo({ top: 0 });
      return;
    }
    // Non-route path (e.g. "/#about" meaning the landing page's about section)
    if (parsed.path === '/' && parsed.section) {
      navigate('/');
      requestAnimationFrame(() => setTimeout(() => scrollToSection(parsed.section), 60));
      return;
    }
    navigate(parsed.path);
  };

  return (
    <a href={href} className={className} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

function scrollToSection(id?: string) {
  if (!id) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
