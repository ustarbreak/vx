import React, { createContext, useContext, useEffect, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { isDemoMode } from '../services/demoMode';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/* ------------------------------------------------------------------ */
/* Layout state — shared per page via context so widgets can reorder,  */
/* resize and collapse. Persisted in localStorage per client.          */
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

/** Non-throwing accessor — used by catalog widgets that may render outside a provider. */
export function useOptionalLayoutCtx(): LayoutCtx | null {
  return useContext(LayoutContext);
}

/** Scope saved layouts per logged-in user so every account keeps its own dashboard. */
let cachedScope = { key: '', scope: '' };
function userScope(): string {
  try {
    const raw = localStorage.getItem('ic_demo_session');
    if (raw) {
      const u = JSON.parse(raw);
      const id = u?.id ?? u?.email;
      if (id) return String(id);
    }
  } catch {
    /* ignore */
  }
  return 'anon';
}

export function widgetStorageKey(pageKey: string): string {
  // Memoize per pageKey while the same session is active (scope is stable
  // across a render pass; changes only on login/logout → remount).
  const scope = userScope();
  if (cachedScope.key === pageKey && cachedScope.scope === scope) return `ic-widget-layout:${pageKey}:${scope}`;
  cachedScope = { key: pageKey, scope };
  return `ic-widget-layout:${pageKey}:${scope}`;
}

/** Companion key tracking which catalog widgets (`cat-*`) the user added. */
export function widgetAddedCatalogKey(pageKey: string): string {
  return `ic-widget-added:${pageKey}:${userScope()}`;
}

/* ------------------------------------------------------------------ */
/* Layout persistence — localStorage cache + backend sync              */
/* ------------------------------------------------------------------ */

/** Server-side layout payload (see backend/app/routers/dashboard_layout.py). */
export interface DashboardLayoutDto {
  page_key: string;
  layout: WidgetLayoutEntry[];
  updated_at?: string | null;
}

async function loadSavedLayout(pageKey: string): Promise<WidgetLayoutEntry[] | null> {
  // 1) Instant local cache (offline / first paint), 2) authoritative server copy.
  const storageKey = widgetStorageKey(pageKey);
  let cached: WidgetLayoutEntry[] | null = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) cached = parsed as WidgetLayoutEntry[];
    }
  } catch { /* ignore */ }

  if (!isDemoMode()) {
    try {
      const { dashboardLayoutApi } = await import('../services/api');
      const dto = await dashboardLayoutApi.get(pageKey);
      if (Array.isArray(dto?.layout) && dto.layout.length) return dto.layout;
    } catch {
      /* 404 (never saved) or backend unreachable → fall back to cache/defaults */
    }
  }
  return cached;
}

function saveLayoutToBackend(pageKey: string, layout: WidgetLayoutEntry[]) {
  if (isDemoMode()) return; // Demo Mode persists through localStorage only
  import('../services/api')
    .then(({ dashboardLayoutApi }) => dashboardLayoutApi.put(pageKey, layout))
    .catch(() => { /* offline — localStorage cache stays authoritative until next change */ });
}

function deleteLayoutOnBackend(pageKey: string) {
  if (isDemoMode()) return;
  import('../services/api')
    .then(({ dashboardLayoutApi }) => dashboardLayoutApi.del(pageKey))
    .catch(() => { /* ignore */ });
}

/**
 * Wraps a dashboard/page whose widgets should be user-configurable.
 * The layout (order + size + collapse state) is persisted per user on the
 * backend (/api/dashboard/layout/{page_key}) with localStorage kept as a
 * fast offline cache, so each client keeps their own arrangement across
 * devices and logouts.
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
  const storageKey = widgetStorageKey(pageKey);
  // Remember which catalog widgets the user explicitly added — these are not
  // part of any defaultLayout and must survive hydration from a stale cache.
  const addedCatalogKey = widgetAddedCatalogKey(pageKey);
  function readAddedCatalog(): string[] {
    try { return JSON.parse(localStorage.getItem(addedCatalogKey) || '[]'); } catch { return []; }
  }
  function rememberAddedCatalog(ids: string[]) {
    try { localStorage.setItem(addedCatalogKey, JSON.stringify(ids)); } catch { /* ignore */ }
  }

  function mergeWithDefaults(saved: WidgetLayoutEntry[]): WidgetLayoutEntry[] {
    const addedCat = new Set(readAddedCatalog());
    const known = saved.filter(
      (w) => w.id.startsWith('cat-') ? addedCat.has(w.id) : defaultLayout.some((d) => d.id === w.id),
    );
    const added = defaultLayout
      .filter((d) => !known.some((w) => w.id === d.id))
      .map((d) => ({ ...d }));
    return [...known, ...added];
  }

  const [layout, setLayout] = useState<WidgetLayoutEntry[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultLayout;
      const saved: WidgetLayoutEntry[] = JSON.parse(raw);
      // Merge: keep saved order/size for known widgets + catalog widgets the
      // user explicitly added; drop catalog widgets that were removed earlier
      // (stale caches could otherwise resurrect them).
      return mergeWithDefaults(saved);
    } catch {
      return defaultLayout;
    }
  });
  const hydratedRef = React.useRef(false);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from the backend once per mount (server copy wins over cache).
  useEffect(() => {
    let cancelled = false;
    loadSavedLayout(pageKey).then((saved) => {
      if (cancelled || !saved) return;
      hydratedRef.current = true;
      setLayout((prev) => {
        const merged = mergeWithDefaults(saved);
        // Also keep any widget currently rendered on the page that the server
        // copy doesn't know about (e.g. newly added catalog widgets) — never
        // let hydration silently drop visible content.
        for (const p of prev) if (!merged.some((m) => m.id === p.id)) merged.push({ ...p });
        const same = merged.length === prev.length && merged.every((m, i) => m.id === prev[i]?.id && m.colSpan === prev[i]?.colSpan && m.collapsed === prev[i]?.collapsed);
        return same ? prev : merged;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  // Re-read when another tab / component changed the saved layout.
  useEffect(() => {
    const onChanged = () => {
      try {
        const raw = localStorage.getItem(widgetStorageKey(pageKey));
        if (!raw) return;
        const saved: WidgetLayoutEntry[] = JSON.parse(raw);
        setLayout((prev) => {
          const missing = saved.filter((s) => !prev.some((p) => p.id === s.id));
          return missing.length ? [...prev, ...missing] : prev;
        });
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onChanged);
    window.addEventListener('ic-widgets-changed', onChanged);
    return () => {
      window.removeEventListener('storage', onChanged);
      window.removeEventListener('ic-widgets-changed', onChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* storage unavailable (private mode etc.) — layout still works in-session */
    }
    // Track user-added catalog widgets so they survive cache/server merges.
    rememberAddedCatalog(layout.filter((w) => w.id.startsWith('cat-')).map((w) => w.id));
    // Debounced backend sync (skip the very first render's default layout).
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveLayoutToBackend(pageKey, layout), 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [storageKey, pageKey, layout]);

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

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Responsive width classes — the parent grid adapts its column count to the
 * viewport (see `gridClasses` in <WidgetGrid>):
 *   mobile  → 1 column  (every widget stacks full-width, nothing squeezed)
 *   tablet  → 6 columns (span 1 = ½ row, span 2 = ⅔ row, span 3 = full row)
 *   desktop → 12 columns (span 1 = ¼ row, span 2 = ⅔ row, span 3 = full row)
 * A minimum span of 2/6 keeps widgets wide enough for readable KPIs, charts,
 * tables and maps — no narrow slivers. `min-w-0` lets grid children shrink so
 * wide content scrolls inside the card instead of overflowing it.
 */
const SPAN_CLASSES: Record<number, string> = {
  1: 'md:col-span-3 lg:col-span-4',
  2: 'md:col-span-4 lg:col-span-8',
  3: 'md:col-span-6 lg:col-span-12',
};

function spanClassFor(colSpan: number) {
  const n = clamp(Math.round(colSpan), 1, 3);
  return `${SPAN_CLASSES[n]} min-w-0`;
}

const btn =
  'p-1 rounded-md text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-[var(--ic-surface-2)] transition-colors disabled:hover:text-[var(--ic-muted)]';

/** Presentational card chrome shared by sortable + static fallback modes. */
function WidgetCard({
  entry,
  index,
  title,
  subtitle,
  headerExtra,
  spanOptions,
  removable,
  className,
  children,
  dragHandleProps,
  isDragging,
  isOver,
}: {
  entry: WidgetLayoutEntry;
  index: number;
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  spanOptions: number[];
  /** Show an ✕ remove button (catalog widgets added via "Add widget"). */
  removable?: boolean;
  className: string;
  children: React.ReactNode;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isOver?: boolean;
}) {
  const { setLayout } = useLayoutCtx();
  const layoutLen = useContext(LayoutContext)?.layout.length ?? 0;

  const update = (patch: Partial<WidgetLayoutEntry>) =>
    setLayout((prev) => {
      // If this widget isn't in the live layout yet (fallback render), join it.
      if (!prev.some((w) => w.id === entry.id)) return [...prev, { ...entry, ...patch }];
      return prev.map((w) => (w.id === entry.id ? { ...w, ...patch } : w));
    });

  const move = (dir: -1 | 1) =>
    setLayout((prev) => {
      const i = prev.findIndex((w) => w.id === entry.id);
      if (i === -1) return prev;
      const j = dir === -1 ? i - 1 : i + 1;
      if (j < 0 || j >= prev.length) return prev;
      return arrayMove(prev, i, j);
    });

  const cycleSize = () => {
    const opts = spanOptions.filter((s) => s >= 1 && s <= 3);
    const cur = opts.indexOf(entry.colSpan);
    update({ colSpan: opts[(cur + 1) % opts.length] ?? opts[0] ?? 1 });
  };

  const spanClass = spanClassFor(entry.colSpan);

  return (
    <div
      className={`${spanClass} max-w-full overflow-hidden bg-[var(--ic-surface)] border rounded-xl p-4 sm:p-6 transition-shadow duration-150 ${
        isOver
          ? 'border-cyan-400 ring-2 ring-cyan-400/40'
          : isDragging
          ? 'border-cyan-400/60 shadow-lg shadow-cyan-500/20 z-10 relative'
          : 'border-[var(--ic-border)]'
      } ${className}`}
    >
      {/* Header row: drag handle + title + controls */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          {...(dragHandleProps ?? {})}
          className={`${btn} cursor-grab active:cursor-grabbing touch-none -ml-1 flex-shrink-0 select-none`}
          title="Drag to reposition this widget"
          aria-label={`Drag to reorder ${title}`}
        >
          <GripVertical className="w-4 h-4 pointer-events-none" />
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
          <button type="button" className={btn} onClick={() => move(1)} disabled={index >= layoutLen - 1}
            title="Move later" aria-label="Move widget later"
            style={{ opacity: index >= layoutLen - 1 ? 0.3 : 1 }}>
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
          {removable && (
            <button type="button"
              className={`${btn} hover:text-red-400`}
              onClick={() => setLayout((prev) => prev.filter((w) => w.id !== entry.id))}
              title="Remove this widget from the page" aria-label={`Remove ${title}`}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body — hidden when collapsed. `overflow-x-auto` keeps wide content
          (tables, charts, maps) inside the card: it scrolls within the widget
          instead of overflowing the layout or squashing text. */}
      {!entry.collapsed && <div className="min-w-0 overflow-x-auto">{children}</div>}

      {/* Hint shown only while collapsed */}
      {entry.collapsed && (
        <p className="text-[11px] text-[var(--ic-muted)] italic">Widget collapsed — press “+” to expand.</p>
      )}
    </div>
  );
}

/** Sortable wrapper — registered with dnd-kit so the ⠿ handle moves the widget. */
function SortableDashboardWidget(props: {
  id: string;
  title: string;
  subtitle?: string;
  spanOptions: number[];
  className: string;
  headerExtra?: React.ReactNode;
  removable?: boolean;
  children: React.ReactNode;
  entry: WidgetLayoutEntry;
  index: number;
}) {
  const { id, entry, index, ...rest } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Keep the dragged card visible above its siblings.
    ...(isDragging ? { zIndex: 50, position: 'relative' as const } : {}),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <WidgetCard
        entry={entry}
        index={index}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        isOver={isOver && isDragging}
        {...rest}
      />
    </div>
  );
}

/**
 * A single dashboard widget: drag it by the ⠿ handle onto any other widget
 * to reposition it, resize it between column widths, or collapse it.
 * Must be rendered inside <WidgetGrid> (or at least a <WidgetLayoutProvider>).
 */
export default function DashboardWidget({
  id,
  title,
  subtitle,
  spanOptions = [1, 2, 3],
  className = '',
  headerExtra,
  removable,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  /** Allowed widths, in thirds of the row (1–3). */
  spanOptions?: number[];
  className?: string;
  headerExtra?: React.ReactNode;
  /** Show ✕ remove control (defaults on for catalog widgets `cat-*`). */
  removable?: boolean;
  children: React.ReactNode;
}) {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    // Rendered outside a WidgetLayoutProvider — degrade to a plain card so the
    // section is still visible in the grid instead of silently disappearing.
    return (
      <div className={`${spanClassFor(3)} max-w-full overflow-hidden bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 sm:p-6`}>
        <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4">{title}</h3>
        <div className="min-w-0 overflow-x-auto">{children}</div>
      </div>
    );
  }
  const { layout } = ctx;
  const index = layout.findIndex((w) => w.id === id);
  // Not part of this page's saved layout yet (e.g. the server copy was hydrated
  // before this widget existed) → show it at default full width rather than
  // hiding dashboard content. It joins the layout on the next save.
  const fallbackEntry: WidgetLayoutEntry = { id, colSpan: 3, collapsed: false };

  return (
    <WidgetCard
      entry={layout[index] ?? fallbackEntry}
      index={index === -1 ? layout.length : index}
      title={title}
      subtitle={subtitle}
      spanOptions={spanOptions}
      className={className}
      headerExtra={headerExtra}
      removable={removable ?? id.startsWith('cat-')}
    >
      {children}
    </WidgetCard>
  );
}

/**
 * Placeholder marker rendered inside a <WidgetGrid> for catalog widgets that
 * the user added ("Add widget" button). It only shows up when its id is part
 * of the current layout; WidgetGrid upgrades it into a sortable, removable
 * card. The children are the widget body — evaluated lazily by the grid.
 */
export function CatalogEntryPlaceholder({
  id,
  title,
  subtitle,
  spanOptions,
  children,
}: {
  id: string;
  title?: string;
  subtitle?: string;
  spanOptions?: number[];
  children: React.ReactNode;
}) {
  const ctx = useContext(LayoutContext);
  if (!ctx || !ctx.layout.some((w) => w.id === id)) return null;
  // Outside a WidgetGrid (no sortable upgrade) still render as a plain card.
  const index = ctx.layout.findIndex((w) => w.id === id);
  return (
    <DashboardWidget id={id} title={title ?? id} subtitle={subtitle} spanOptions={spanOptions} removable>
      {children}
    </DashboardWidget>
  );
}

/* ------------------------------------------------------------------ */
/* Grid host — owns the DndContext so drag & drop actually works       */
/* ------------------------------------------------------------------ */

/**
 * Wrap your DashboardWidgets in <WidgetGrid> instead of a plain <div className="grid …">.
 * It provides the 12-column responsive grid AND the dnd-kit drag-and-drop context.
 */
export function WidgetGrid({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(LayoutContext);
  const sensors = useSensors(
    // activationConstraint lets ordinary clicks (buttons, charts) pass through;
    // dragging starts after 6px of pointer movement on the ⠿ handle.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const { setLayout } = ctx ?? {};

  // Keep the live layout in sync with the widgets actually rendered on the
  // page: append any missing entry (new default widget or freshly added
  // catalog widget) so it participates in drag & drop and gets persisted.
  const syncedRef = React.useRef('');
  useEffect(() => {
    if (!setLayout || !ctx) return;
    const renderedIds = React.Children.toArray(children)
      .map((child) => {
        if (!React.isValidElement(child)) return null;
        if (child.type === DashboardWidget || (child.type as any) === CatalogEntryPlaceholder) {
          return (child.props as { id?: string }).id ?? null;
        }
        return null;
      })
      .filter((x): x is string => !!x);
    const signature = renderedIds.join(',');
    if (signature === syncedRef.current) return;
    syncedRef.current = signature;
    setLayout((prev) => {
      const missing = renderedIds.filter((rid) => !prev.some((w) => w.id === rid));
      if (!missing.length) return prev;
      return [...prev, ...missing.map((id) => ({ id, colSpan: 3, collapsed: false }))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, ctx]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !setLayout) return;
    setLayout((prev) => {
      const from = prev.findIndex((w) => w.id === active.id);
      const to = prev.findIndex((w) => w.id === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  };

  // Responsive CSS Grid: one column on mobile, adaptive columns on tablet
  // (6-col track), multiple columns on desktop (12-col track). Widgets span
  // 3/4/6/8/12 tracks depending on their size + breakpoint (see spanClassFor).
  const gridClasses = `grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-4 lg:gap-6 items-start ${className}`.trim();

  // Without a provider we can't do drag & drop — render the grid statically.
  if (!ctx) {
    return <div className={gridClasses}>{children}</div>;
  }

  // Sortable ids follow the *rendered* widget order (what the user sees), not
  // the raw layout array, so drag & drop stays consistent even while the
  // layout is being hydrated/synced.
  const renderedIds: string[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === DashboardWidget || (child.type as any) === CatalogEntryPlaceholder) {
      const cid = (child.props as { id?: string }).id;
      if (cid && !renderedIds.includes(cid)) renderedIds.push(cid);
    }
  });
  const extras = ctx.layout.map((w) => w.id).filter((id) => !renderedIds.includes(id));
  const ids = [...renderedIds, ...extras];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={gridClasses}>
          {React.Children.map(children, (child) => {
            if (!React.isValidElement(child)) return child;
            // DashboardWidget children are upgraded to sortable cards…
            if (child.type === DashboardWidget) {
              const childId = (child.props as { id?: string }).id;
              if (!childId) return child;
              const index = ctx.layout.findIndex((w) => w.id === childId);
              if (index === -1) return null;
              return (
                <SortableDashboardWidget
                  key={childId}
                  {...(child.props as any)}
                  id={childId}
                  entry={ctx.layout[index]}
                  index={index}
                />
              );
            }
            // …and <CatalogEntry id="cat-…"> placeholders render their own
            // removable widget when present in the layout (null otherwise).
            if ((child.type as any) === CatalogEntryPlaceholder) {
              const cp = child.props as {
                id?: string;
                title?: string;
                subtitle?: string;
                spanOptions?: number[];
                children: React.ReactNode;
              };
              const childId = cp.id;
              if (!childId) return null;
              const index = ctx.layout.findIndex((w) => w.id === childId);
              if (index === -1) return null;
              return (
                <SortableDashboardWidget
                  key={childId}
                  id={childId}
                  title={cp.title ?? childId}
                  subtitle={cp.subtitle}
                  spanOptions={cp.spanOptions ?? [1, 2, 3]}
                  className=""
                  removable
                  entry={ctx.layout[index]}
                  index={index}
                >
                  {cp.children}
                </SortableDashboardWidget>
              );
            }
            return child;
          })}
        </div>
      </SortableContext>
    </DndContext>
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
          localStorage.removeItem(widgetStorageKey(pageKey));
          localStorage.removeItem(widgetAddedCatalogKey(pageKey));
        } catch {
          /* ignore */
        }
        deleteLayoutOnBackend(pageKey);
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
