import React, { createContext, useContext, useEffect, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Maximize2, Minimize2, RotateCcw } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Layout state — shared per page via context so widgets can swap      */
/* positions and every sibling re-renders with the new order.          */
/* ------------------------------------------------------------------ */

export interface WidgetLayoutEntry {
  id: string;
  colSpan: number; // 1..3 (on lg screens); auto-clamped on smaller ones
  collapsed: boolean;
}

interface LayoutCtx {
  layout: WidgetLayoutEntry[];
  setLayout: React.Dispatch<React.SetStateAction<WidgetLayoutEntry[]>>;
}

const LayoutContext = createContext<LayoutCtx | null>(null);

/**
 * Wraps a dashboard/page whose widgets should be user-configurable.
 * The layout (order + size + collapse state) is persisted in localStorage
 * under `widget-layout:{pageKey}` so each client keeps their own arrangement.
 */
export function WidgetLayoutProvider({
  pageKey,
  defaultLayout,
  children,
}: {
  pageKey: string;
  defaultLayout: WidgetLayoutEntry[];
  children: React.ReactNode;
}) {
  const storageKey = `ic-widget-layout:${pageKey}`;
  const [layout, setLayout] = useState<WidgetLayoutEntry[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultLayout;
      const saved: WidgetLayoutEntry[] = JSON.parse(raw);
      // Merge: keep saved order/size for known widgets, append brand-new ones.
      const known = saved.filter((w) => defaultLayout.some((d) => d.id === w.id));
      const added = defaultLayout
        .filter((d) => !known.some((w) => w.id === d.id))
        .map((d) => ({ ...d }));
      return [...known, ...added];
    } catch {
      return defaultLayout;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* storage unavailable (private mode etc.) — layout still works in-session */
    }
  }, [storageKey, layout]);

  return <LayoutContext.Provider value={{ layout, setLayout }}>{children}</LayoutContext.Provider>;
}

function useLayoutCtx(): LayoutCtx {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error('DashboardWidget must be used inside a <WidgetLayoutProvider>');
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Draggable / resizable widget card                                   */
/* ------------------------------------------------------------------ */

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export default function DashboardWidget({
  id,
  title,
  subtitle,
  spanOptions = [1, 2, 3],
  className = '',
  headerExtra,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  /** Allowed widths, in grid columns (1–3). */
  spanOptions?: number[];
  className?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { layout, setLayout } = useLayoutCtx();
  const [dragOver, setDragOver] = useState(false);

  const entry = layout.find((w) => w.id === id);
  const index = layout.findIndex((w) => w.id === id);
  if (!entry || index === -1) return null; // not part of this page's layout

  const update = (patch: Partial<WidgetLayoutEntry>) =>
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const move = (dir: -1 | 1) =>
    setLayout((prev) => {
      const next = [...prev];
      const j = dir === -1 ? index - 1 : index + 1;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const cycleSize = () => {
    const opts = spanOptions.filter((s) => s >= 1 && s <= 3);
    const cur = opts.indexOf(entry.colSpan);
    update({ colSpan: opts[(cur + 1) % opts.length] ?? opts[0] ?? 1 });
  };

  const handleDrop = (targetId: string) => {
    if (targetId === id) return;
    setLayout((prev) => {
      const next = [...prev];
      const from = next.findIndex((w) => w.id === id);
      const to = next.findIndex((w) => w.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // Responsive width classes. The parent grid is a 12-column grid, so any
  // widget fits on any page. Tailwind JIT picks up these literal strings.
  const spanClass =
    entry.colSpan === 3
      ? 'sm:col-span-6 lg:col-span-12'
      : entry.colSpan === 2
      ? 'sm:col-span-6 lg:col-span-8'
      : 'sm:col-span-6 lg:col-span-4';

  const btn =
    'p-1 rounded-md text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-[var(--ic-surface-2)] transition-colors';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleDrop(e.dataTransfer.getData('text/plain'));
      }}
      onDragEnd={() => setDragOver(false)}
      className={`${spanClass} bg-[var(--ic-surface)] border rounded-xl p-6 transition-all duration-150 ${
        dragOver ? 'border-cyan-400 ring-2 ring-cyan-400/30 opacity-90' : 'border-[var(--ic-border)]'
      } ${className}`}
    >
      {/* Header row: drag handle + title + controls */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          className={`${btn} cursor-grab active:cursor-grabbing -ml-1 flex-shrink-0`}
          title="Drag onto another widget to swap places"
          aria-label={`Reorder ${title}`}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider truncate">
            {title}
          </h3>
          {subtitle && <p className="text-[11px] normal-case tracking-normal text-[var(--ic-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {headerExtra}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" className={btn} onClick={() => move(-1)} disabled={index === 0}
            title="Move earlier" aria-label="Move widget earlier"
            style={{ opacity: index === 0 ? 0.3 : 1 }}>
            <ChevronUp className="w-4 h-4" />
          </button>
          <button type="button" className={btn} onClick={() => move(1)} disabled={index === layout.length - 1}
            title="Move later" aria-label="Move widget later"
            style={{ opacity: index === layout.length - 1 ? 0.3 : 1 }}>
            <ChevronDown className="w-4 h-4" />
          </button>
          <button type="button" className={btn} onClick={cycleSize}
            title={`Width: ${entry.colSpan}/3 columns — click to resize`}
            aria-label="Resize widget">
            {entry.colSpan > 1 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button type="button" className={btn} onClick={() => update({ collapsed: !entry.collapsed })}
            title={entry.collapsed ? 'Expand' : 'Collapse'} aria-label={entry.collapsed ? 'Expand widget' : 'Collapse widget'}>
            <span className="text-xs font-bold px-1">{entry.collapsed ? '+' : '−'}</span>
          </button>
        </div>
      </div>

      {/* Body — hidden when collapsed */}
      {!entry.collapsed && <div>{children}</div>}

      {/* Hint shown only while collapsed */}
      {entry.collapsed && (
        <p className="text-[11px] text-[var(--ic-muted)] italic">Widget collapsed — press “+” to expand.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reset button for page headers                                       */
/* ------------------------------------------------------------------ */

export function ResetLayoutButton({
  pageKey,
  defaultLayout,
}: {
  pageKey: string;
  defaultLayout: WidgetLayoutEntry[];
}) {
  const { setLayout } = useLayoutCtx();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(`ic-widget-layout:${pageKey}`);
        } catch {
          /* ignore */
        }
        setLayout(defaultLayout.map((d) => ({ ...d })));
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--ic-muted)] border border-[var(--ic-border)] bg-[var(--ic-surface-2)] hover:text-cyan-400 hover:border-cyan-400/40 transition-colors"
      title="Restore the default widget arrangement"
    >
      <RotateCcw className="w-3.5 h-3.5" />
      Reset layout
    </button>
  );
}

/** Small badge reminding users widgets are editable. */
export function CustomizeHint() {
  return (
    <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-[var(--ic-muted)]">
      <GripVertical className="w-3 h-3" />
      Drag ⠿ to reorder · resize &amp; collapse any widget
    </span>
  );
}

export { clamp };
