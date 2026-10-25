import React from 'react';
import { useTheme, setPlatformDefaultTheme, getPlatformDefaultTheme, Theme } from '../../context/ThemeContext';
import { Sun, Moon, Check, Eye, RotateCcw } from 'lucide-react';

/**
 * Platform Admin → "Infracentra Themes"
 * --------------------------------------
 * Lets the platform owner decide how the world sees Infracentra:
 *  - "Calm Operations" (light)  : current product theme (default)
 *  - "Cyber Modern"    (dark)   : legacy neon SOC theme, kept on standby
 *
 * The chosen theme becomes the platform-wide default for every new
 * visitor / user who hasn't made a personal choice yet. A live preview
 * shows both palettes side by side.
 */

interface ThemeMeta {
  key: Theme;
  name: string;
  tagline: string;
  palette: { label: string; hex: string }[];
}

const THEMES: ThemeMeta[] = [
  {
    key: 'light',
    name: 'Calm Operations',
    tagline: 'A light, quiet interface that says “you’re being looked after” before it says “here are the threats.”',
    palette: [
      { label: 'Page background', hex: '#F7F9FB' },
      { label: 'Cards', hex: '#FFFFFF' },
      { label: 'Borders', hex: '#E2E8F0' },
      { label: 'Headings / sidebar', hex: '#0B2545' },
      { label: 'Primary buttons & links', hex: '#0E7490' },
      { label: 'Body text', hex: '#1E293B' },
      { label: 'Muted text', hex: '#64748B' },
      { label: 'Protected / healthy', hex: '#15803D' },
      { label: 'Needs attention', hex: '#B45309' },
      { label: 'Action required', hex: '#B91C1C' },
    ],
  },
  {
    key: 'dark',
    name: 'Cyber Modern (legacy)',
    tagline: 'The original neon SOC look — deep navy, cyan glows, high contrast for long night shifts.',
    palette: [
      { label: 'Page background', hex: '#0B1120' },
      { label: 'Cards', hex: '#151E31' },
      { label: 'Borders', hex: '#26334D' },
      { label: 'Headings / sidebar', hex: '#E6EDF7' },
      { label: 'Primary buttons & links', hex: '#22D3EE' },
      { label: 'Body text', hex: '#CBD5E1' },
      { label: 'Muted text', hex: '#8FA3C4' },
      { label: 'Protected / healthy', hex: '#34D399' },
      { label: 'Needs attention', hex: '#FBBF24' },
      { label: 'Action required', hex: '#FB7185' },
    ],
  },
];

export default function InfracentraThemesPage() {
  const { theme, setTheme } = useTheme();
  const platformDefault = getPlatformDefaultTheme();
  const [, force] = React.useState(0);

  React.useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('infracentra-theme-default-changed', h);
    return () => window.removeEventListener('infracentra-theme-default-changed', h);
  }, []);

  const activate = (t: Theme) => {
    setPlatformDefaultTheme(t); // new visitors inherit this
    setTheme(t);                // apply immediately for the admin too
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold ic-heading">Infracentra Themes</h1>
        <p className="ic-muted text-sm mt-1">
          Choose how the world sees our platform. The active theme becomes the default for all new
          users and visitors; each logged-in user can still toggle their own preference later.
        </p>
      </div>

      {/* Status bar */}
      <div className="ic-card p-4 mb-6 flex flex-wrap items-center gap-4">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${theme === 'light' ? 'ic-chip-ok' : 'ic-chip-warn'}`}>
          Currently rendering: {theme === 'light' ? 'Calm Operations (light)' : 'Cyber Modern (dark)'}
        </span>
        <span className="text-sm ic-muted">
          Platform default: <b className="ic-heading">{platformDefault === 'light' ? 'Calm Operations' : 'Cyber Modern'}</b>
        </span>
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="ml-auto ic-btn-outline px-4 py-2 text-sm inline-flex items-center gap-2"
          title="Preview the other theme instantly (personal choice only)"
        >
          <RotateCcw className="w-4 h-4" /> Try the other one
        </button>
      </div>

      {/* Theme cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {THEMES.map((t) => {
          const isActiveDefault = platformDefault === t.key;
          return (
            <div key={t.key} className={`ic-card p-5 ${isActiveDefault ? 'ring-2 ring-[var(--ic-primary)]' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold ic-heading flex items-center gap-2">
                    {t.key === 'light' ? <Sun className="w-5 h-5" style={{ color: 'var(--ic-warn)' }} /> : <Moon className="w-5 h-5" style={{ color: 'var(--ic-primary)' }} />}
                    {t.name}
                  </h2>
                  <p className="text-sm ic-muted mt-1">{t.tagline}</p>
                </div>
                {isActiveDefault && (
                  <span className="ic-chip-ok px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Active
                  </span>
                )}
              </div>

              {/* Palette swatches */}
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                {t.palette.map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-md border" style={{ background: c.hex, borderColor: '#94a3b8' }} />
                    <span className="ic-muted">{c.label}</span>
                    <code className="ml-auto ic-heading">{c.hex}</code>
                  </div>
                ))}
              </div>

              {/* Mini mock preview rendered with that theme's raw colors */}
              <div
                className="mt-4 rounded-xl p-4 border"
                style={{ background: t.palette[0].hex, borderColor: t.palette[2].hex }}
              >
                <div className="rounded-lg p-3 border" style={{ background: t.palette[1].hex, borderColor: t.palette[2].hex }}>
                  <div className="text-sm font-semibold" style={{ color: t.palette[3].hex }}>
                    Infrastructure status
                  </div>
                  <div className="text-xs mt-1" style={{ color: t.palette[5].hex }}>
                    24 devices monitored · last scan 2 min ago
                  </div>
                  <div className="flex gap-2 mt-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: t.palette[7].hex, color: t.key === 'light' ? '#fff' : '#052e16' }}>
                      Protected
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: t.palette[8].hex, color: t.key === 'light' ? '#fff' : '#451a03' }}>
                      2 need attention
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: t.palette[9].hex, color: '#fff' }}>
                      1 action required
                    </span>
                  </div>
                  <button
                    className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: t.palette[4].hex, color: t.key === 'light' ? '#fff' : '#083344' }}
                  >
                    View dashboard
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => activate(t.key)}
                  disabled={isActiveDefault}
                  className="ic-btn-primary px-4 py-2 text-sm disabled:opacity-40"
                >
                  {isActiveDefault ? 'Already the platform default' : `Set ${t.name} as default`}
                </button>
                <button
                  onClick={() => setTheme(t.key)}
                  className="ic-btn-outline px-4 py-2 text-sm inline-flex items-center gap-2"
                >
                  <Eye className="w-4 h-4" /> Preview now
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs ic-muted mt-6">
        Note: partners keep their white-label branding regardless of theme; only colors adapt.
        This setting is stored per-browser today — Phase 2 will sync it to the backend settings API
        (<code>PUT /api/settings/theme-default</code>) so every tenant inherits it globally.
      </p>
    </div>
  );
}
