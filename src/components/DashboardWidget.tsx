import React, { createContext, useContext, useEffect, useState } from 'react';
import { GripVertical, Plus, X, RotateCcw } from 'lucide-react';
import { isDemoMode } from '../services/demoMode';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Lazy registry for the <CatalogEntry/> component defined in WidgetCatalog.tsx.
// A static `import { CatalogEntry }` here would create an import cycle
// (WidgetCatalog already imports from this module), so WidgetCatalog registers
// its component reference at load time and we compare against it via `any`
// (React element `type` identity comparison is not expressible in TS).
export const CATALOG_ENTRY_REF: { current: any } = { current: null };

/* ------------------------------------------------------------------ */
/* Layout state — shared per page via context so widgets can reorder,  */
/* resize and collapse. Persisted in localStorage per client.          */
/* ------------------------------------------------------------------ */

export interface WidgetLayoutEntry {
  id: string;
  colSpan: number; // 1..3 (on lg screens); auto-clamped on smaller ones
  collapsed: boolean;
  /** Free height in pixels when the user has edge-resized this widget. */
  heightPx?: number;
}

/** Grid slot sizes, smallest → largest. `colSpan` values are 1..3 thirds. */
const SPAN_SIZES = [1, 2, 3] as const;
const MIN_HEIGHT_PX = 140;
const MAX_HEIGHT_PX = 1600;

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
/* Server-side slot placement (backend parity for drag & drop)         */
/* ------------------------------------------------------------------ */

/** Slot arrangement stored alongside the layout on the backend. */
const slotsOf = (layout: WidgetLayoutEntry[]): (string | null)[] | undefined => {
  const raw = (layout as any).slots;
  return Array.isArray(raw) ? (raw as (string | null)[]) : undefined;
};

async function loadSavedSlots(pageKey: string): Promise<(string | null)[] | null> {
  if (isDemoMode()) return null;
  try {
    const { dashboardLayoutApi } = await import('../services/api');
    const dto = await dashboardLayoutApi.get(pageKey);
    const slots = slotsOf((dto?.layout ?? []) as any) ?? ((dto as any)?.slots);
    return Array.isArray(slots) && slots.some((s) => typeof s === 'string') ? (slots as (string | null)[]) : null;
  } catch {
    /* 404 / offline → localStorage cache stays authoritative */
    return null;
  }
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
    saveTimerRef.current = setTimeout(() => {
      const board = boardRef.current;
      const payload: any = layout.map((w) => ({ ...w }));
      // Persist the slot arrangement alongside the layout so drag & drop,
      // edge-resize and add/remove all round-trip through the backend.
      if (board) (payload as any).slots = board.placements;
      saveLayoutToBackend(pageKey, payload);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [storageKey, pageKey, layout]);

  /** Live slot-board state, registered by <SlotBoard>, for backend sync. */
  const boardRef = React.useRef<{ placements: (string | null)[]; setPlacements: (p: (string | null)[]) => void } | null>(null);

  // Hydrate the slot arrangement from the server once per mount (the PUT
  // payload carries `slots`, so drag & drop positions have backend parity).
  useEffect(() => {
    let cancelled = false;
    loadSavedSlots(pageKey).then((saved) => {
      if (cancelled || !saved) return;
      const b = boardRef.current;
      if (b) b.setPlacements(saved);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  // Widget ids declared by the <WidgetGrid> children — scanned once per mount
  // so the slot board knows which widgets exist even before they render.
  const declaredIds = React.useMemo(() => collectDeclaredWidgetIds(children), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageKeyContext.Provider value={pageKey}>
      <LayoutContext.Provider value={{ layout, setLayout }}>
        <BoardRefContext.Provider value={boardRef}>
          <SlotBoard declaredIds={declaredIds}>{children}</SlotBoard>
        </BoardRefContext.Provider>
      </LayoutContext.Provider>
    </PageKeyContext.Provider>
  );
}

/** Ref to the live slot board, registered by <SlotBoard> for backend sync. */
const BoardRefContext = createContext<React.MutableRefObject<{ placements: (string | null)[]; setPlacements: (p: (string | null)[]) => void } | null> | null>(null);

/** Walk a page tree and gather every DashboardWidget / CatalogEntry id found. */
function collectDeclaredWidgetIds(node: React.ReactNode): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id?: string) => {
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
  };
  const walk = (n: React.ReactNode, depth: number) => {
    if (depth > 6 || n == null) return;
    React.Children.forEach(n, (child) => {
      if (!React.isValidElement(child)) return;
      const t = child.type as unknown;
      if (t === DashboardWidget || t === CatalogEntryPlaceholder || t === CATALOG_ENTRY_REF.current) {
        push((child.props as { id?: string }).id);
      } else if (typeof t !== 'string' && depth < 6) {
        walk((child.props as { children?: React.ReactNode }).children, depth + 1);
      }
    });
  };
  walk(node, 0);
  return ids;
}

function useLayoutCtx(): LayoutCtx {
  const ctx = useContext(LayoutContext);
  if (!ctx) {
    throw new Error('DashboardWidget must be used inside a <WidgetLayoutProvider>');
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Draggable widget card (fixed-size slots)                            */
/* ------------------------------------------------------------------ */

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Slot system (fixed-size cells): every widget occupies exactly ONE slot and
 * keeps its size at all times — resizing widgets is what used to reflow the
 * whole grid ("one row works, everything under it collapses"). Slots instead
 * resize per breakpoint:
 *   mobile  → 1 slot per row · tablet → 2 slots per row · desktop → 3 slots/row.
 */
export const GRID_COLS = 3;

/* ------------------------------------------------------------------ */
/* Free-flow ordering — widgets keep whatever size they want and flow   */
/* into a responsive masonry board. Dragging reorders; there are NO      */
/* fixed slots and NO empty "+" placeholder cells inside the board.      */
/* ------------------------------------------------------------------ */

interface PlacementCtx {
  /** Ordered list of widget ids by visual position (free-flow order). */
  placements: (string | null)[];
  setPlacements: React.Dispatch<React.SetStateAction<(string | null)[]>>;
}

/** Responsive column counts for the masonry board (mirrors MASONRY_CLASSES). */
function viewportCols(): number {
  if (typeof window === 'undefined') return 3;
  if (window.matchMedia('(min-width: 1280px)').matches) return 3;
  if (window.matchMedia('(min-width: 768px)').matches) return 2;
  return 1;
}

/** Track the current breakpoint so wide widgets clamp to available columns. */
export function useMasonryCols(): number {
  const [cols, setCols] = useState<number>(() => viewportCols());
  useEffect(() => {
    const update = () => setCols(viewportCols());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return cols;
}

/** Normalize an order list: strip nulls/empties/duplicates, keep sequence. */
function normalizeOrder(list: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    if (p && p !== '' && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

/** Build the widget order, honoring a saved arrangement when present. */
export function buildPlacements(ids: string[], saved?: (string | null)[] | null): (string | null)[] {
  const base = normalizeOrder(ids);
  if (saved && saved.some((s) => typeof s === 'string')) {
    const known = new Set(base);
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const s of saved) {
      if (s && known.has(s) && !seen.has(s)) { seen.add(s); ordered.push(s); }
    }
    for (const id of base) if (!seen.has(id)) ordered.push(id);
    return ordered;
  }
  return base;
}

function loadSavedPlacements(pageKey: string): (string | null)[] | null {
  try {
    const raw = localStorage.getItem(`${widgetStorageKey(pageKey)}:order`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as (string | null)[]) : null;
  } catch {
    return null;
  }
}

function savePlacements(pageKey: string, placements: (string | null)[]) {
  try {
    localStorage.setItem(`${widgetStorageKey(pageKey)}:order`, JSON.stringify(normalizeOrder(placements)));
  } catch { /* ignore */ }
}

const btn =
  'p-1 rounded-md text-[var(--ic-muted)] hover:text-cyan-400 hover:bg-[var(--ic-surface-2)] transition-colors disabled:hover:text-[var(--ic-muted)]';

/** Presentational card chrome shared by slot mode + static fallback modes. */
function WidgetCard({
  entry,
  title,
  subtitle,
  headerExtra,
  removable,
  className,
  children,
  dragHandleProps,
  isDragging,
  isOver,
}: {
  entry: WidgetLayoutEntry;
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  /** Show an ✕ remove button (catalog widgets added via "Add widget"). */
  removable?: boolean;
  className: string;
  children: React.ReactNode;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  isOver?: boolean;
}) {
  const { setLayout } = useLayoutCtx();

  const update = (patch: Partial<WidgetLayoutEntry>) =>
    setLayout((prev) => {
      // If this widget isn't in the live layout yet (fallback render), join it.
      if (!prev.some((w) => w.id === entry.id)) return [...prev, { ...entry, ...patch }];
      return prev.map((w) => (w.id === entry.id ? { ...w, ...patch } : w));
    });

  /* ---- Edge resizing ------------------------------------------------
     Height: drag the top/bottom edge (free pixel height, persisted).
     Width:  drag the left/right edges to grow/shrink the card's width in
             thirds of the board (1→2→3 columns). The direction sign makes
             the left edge feel natural (drag left = wider). */
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [resizing, setResizing] = useState<null | 'h' | 'w'>(null);
  const resizeStart = React.useRef<{ y: number; h: number; x: number; span: number; dir: number }>({ y: 0, h: 0, x: 0, span: 1, dir: 1 });

  const beginResize = (mode: 'h' | 'w', dir = 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = cardRef.current;
    if (!el) return;
    resizeStart.current = {
      y: e.clientY,
      h: entry.heightPx ?? el.getBoundingClientRect().height,
      x: e.clientX,
      span: clamp(entry.colSpan || 1, 1, SPAN_SIZES.length),
      dir,
    };
    setResizing(mode);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const moveResize = (e: React.PointerEvent) => {
    if (!resizing) return;
    if (resizing === 'h') {
      // Top edge drags up to grow; bottom edge drags down to grow.
      const dh = resizeStart.current.dir * (e.clientY - resizeStart.current.y);
      update({ heightPx: clamp(Math.round(resizeStart.current.h + dh), MIN_HEIGHT_PX, MAX_HEIGHT_PX) });
    } else {
      const el = cardRef.current;
      const colW = el && el.parentElement ? el.parentElement.getBoundingClientRect().width / GRID_COLS : 360;
      const dx = resizeStart.current.dir * (e.clientX - resizeStart.current.x);
      const target = clamp(
        resizeStart.current.span + Math.round(dx / Math.max(colW, 80)),
        SPAN_SIZES[0], SPAN_SIZES[SPAN_SIZES.length - 1],
      );
      if (target !== entry.colSpan) update({ colSpan: target });
    }
  };

  const endResize = () => setResizing(null);

  const edgeBase = 'absolute z-20 touch-none';
  const style: React.CSSProperties = entry.heightPx && !entry.collapsed
    ? { height: entry.heightPx }
    : {};

  // Slot board: every widget lives in a resizable cell. Dragging swaps
  // slots; edge handles change this widget's width/size only.
  return (
    <div
      ref={cardRef}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      style={style}
      className={`relative min-w-0 max-w-full ${entry.heightPx && !entry.collapsed ? '' : 'h-full '}flex flex-col overflow-hidden bg-[var(--ic-surface)] border rounded-xl p-4 sm:p-6 transition-shadow duration-150 ${
        resizing ? 'ring-2 ring-cyan-400/50' : ''
      } ${
        isOver
          ? 'border-cyan-400 ring-2 ring-cyan-400/40'
          : isDragging
          ? 'border-cyan-400/60 shadow-lg shadow-cyan-500/20 z-10 relative'
          : 'border-[var(--ic-border)]'
      } ${className}`}
    >
      {/* Header row: drag handle + title + controls */}
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <button
          type="button"
          {...(dragHandleProps ?? {})}
          className={`${btn} cursor-grab active:cursor-grabbing touch-none -ml-1 flex-shrink-0 select-none`}
          title="Drag to place this widget in another slot"
          aria-label={`Drag to move ${title}`}
        >
          <GripVertical className="w-4 h-4 pointer-events-none" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider truncate">
            {title}
          </h3>
          {subtitle && <p className="text-[11px] normal-case tracking-normal text-[var(--ic-muted)] mt-0.5 truncate">{subtitle}</p>}
        </div>
        {headerExtra}
        <div className="flex items-center gap-0.5 flex-shrink-0">
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
      {!entry.collapsed && <div className="min-w-0 flex-1 overflow-x-auto">{children}</div>}

      {/* Hint shown only while collapsed */}
      {entry.collapsed && (
        <p className="text-[11px] text-[var(--ic-muted)] italic">Widget collapsed — press “+” to expand.</p>
      )}

      {/* Edge resize handles — all four edges (hidden when collapsed).
          Left/right drag horizontally to grow/shrink the card's width in
          thirds of the board; top/bottom drag vertically for free height. */}
      {!entry.collapsed && (
        <>
          <div
            role="separator" aria-orientation="horizontal" title="Drag to resize height"
            onPointerDown={beginResize('h')}
            className={`${edgeBase} left-2 right-2 -top-1 h-2 cursor-ns-resize rounded-full hover:bg-cyan-400/30`}
          />
          <div
            role="separator" aria-orientation="horizontal" title="Drag to resize height"
            onPointerDown={beginResize('h')}
            className={`${edgeBase} left-2 right-2 -bottom-1 h-2 cursor-ns-resize rounded-full hover:bg-cyan-400/30`}
          />
          <div
            role="separator" aria-orientation="vertical" title="Drag to resize width"
            onPointerDown={beginResize('w', -1)}
            className={`${edgeBase} top-2 bottom-2 -left-1 w-2 cursor-ew-resize rounded-full hover:bg-cyan-400/30`}
          />
          <div
            role="separator" aria-orientation="vertical" title="Drag to resize width"
            onPointerDown={beginResize('w', 1)}
            className={`${edgeBase} top-2 bottom-2 -right-1 w-2 cursor-ew-resize rounded-full hover:bg-cyan-400/30`}
          />
          <div
            role="separator" title="Drag to resize both ways"
            onPointerDown={(e) => { beginResize('h')(e); }}
            className={`${edgeBase} -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize rounded-full hover:bg-cyan-400/40`}
          />
        </>
      )}
    </div>
  );
}

/**
 * A single dashboard widget. It is a *declaration*: the surrounding slot
 * board (<WidgetGrid>, backed by <SlotGrid>) renders it inside its assigned
 * fixed-size slot where it can be dragged (⠿) to another slot, collapsed or
 * removed. Dragging swaps slots — sizes never change, so rows never collapse.
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
  /** Allowed widths, in thirds of the row (legacy variable-width mode). */
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
      <div className="min-w-0 max-w-full overflow-hidden bg-[var(--ic-surface)] border border-[var(--ic-border)] rounded-xl p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-[var(--ic-text)] uppercase tracking-wider mb-4">{title}</h3>
        <div className="min-w-0 overflow-x-auto">{children}</div>
      </div>
    );
  }
  // Inside a provider: the slot board renders this element via SlotWidgetCell.
  // Declaring it here directly would double-render, so render nothing.
  return null;
}

/**
 * Placeholder marker declared inside a <WidgetGrid> for catalog widgets that
 * the user added ("Add widget" button or clicking an empty slot). Like
 * DashboardWidget it is only a declaration — the slot board renders its card
 * when the id is part of the current layout (nothing otherwise).
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
  if (!ctx) return null;
  if (!ctx.layout.some((w) => w.id === id)) return null;
  // The slot board renders this element via SlotWidgetCell — render nothing
  // here to avoid double-rendering the same widget.
  return null;
}

/* ------------------------------------------------------------------ */
/* Grid host — owns the DndContext so drag & drop actually works       */
/* ------------------------------------------------------------------ */

/**
 * Wrap your DashboardWidgets in <SlotGrid> (preferred) or <WidgetGrid>.
 * Both provide the responsive masonry board AND the dnd-kit drag-and-drop
 * context. Widgets flow freely into the columns — a wide widget can take a
 * whole row, small ones share rows side by side. There are no fixed slots
 * and no empty placeholder cells; new widgets always land at the end of the
 * board (right after the last visible widget).
 */
export function WidgetGrid({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <SlotGrid className={className}>{children}</SlotGrid>;
}

/* ------------------------------------------------------------------ */
/* SlotGrid — free-flow masonry board                                  */
/* ------------------------------------------------------------------ */

/** Page key of the active layout provider — used to persist widget order. */
export const PageKeyContext = createContext<string | null>(null);

/** Default layout of the active provider — fallback for catalogue helpers. */
export const DefaultLayoutContext = createContext<WidgetLayoutEntry[]>([]);

/** Responsive masonry board: 1 col (mobile) → 2 cols (md) → 3 cols (xl+). */
const MASONRY_CLASSES = 'columns-1 md:columns-2 xl:columns-3 gap-4 lg:gap-6 space-y-4 lg:space-y-6';

/** Column span classes for edge-resized widgets at each breakpoint. */
const SPAN_CLASS: Record<number, string[]> = {
  1: ['w-full'],
  2: ['md:w-[calc(50%-0.75rem)]', 'xl:w-[calc((100%-3rem)/3*2+1.5rem)]'],
  3: ['w-full'],
};

type BoardCtx = PlacementCtx;

const BoardContext = createContext<BoardCtx | null>(null);

/** Non-throwing accessor for the shared board (pages without <SlotGrid> get null). */
export function useOptionalPlacementCtx(): BoardCtx | null {
  return useContext(BoardContext);
}

/** Reorder the free-flow list on drag end: move `activeId` to `overId`'s position. */
function relayoutFromOrder(prev: (string | null)[], activeId: string, overId: string): (string | null)[] {
  const order = normalizeOrder(prev);
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return prev;
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
}

/**
 * The board owns the single widget-order array shared by every <SlotGrid>
 * on the page and persists it per user/page (localStorage + backend). Drag &
 * drop reorders widgets; each keeps its own size and the masonry board adapts
 * automatically — no fixed slots, no holes, no row collapse.
 */
function SlotBoard({
  children,
  declaredIds,
}: {
  children: React.ReactNode;
  /** Widget ids declared by the grids under this board (stable signature). */
  declaredIds: string[];
}) {
  const ctx = useContext(LayoutContext);
  const pageKey = useContext(PageKeyContext);
  const liveIds = ctx?.layout.map((w) => w.id) ?? [];
  const renderedSig = [...declaredIds].sort().join(',');
  const liveSig = liveIds.join(',');

  const [placements, setPlacementsRaw] = useState<(string | null)[]>(() =>
    buildPlacements(declaredIds, loadSavedPlacements(pageKey ?? ''))
  );

  const setPlacements: BoardCtx['setPlacements'] = (next) =>
    setPlacementsRaw((prev) => normalizeOrder(typeof next === 'function' ? next(prev) : next));

  /** Latest placements, readable inside callbacks without stale closures. */
  const placementsRef = React.useRef(placements);
  useEffect(() => { placementsRef.current = placements; }, [placements]);

  // Register with the provider so backend sync can read/write widget order.
  const boardRef = useContext(BoardRefContext);
  useEffect(() => {
    if (!boardRef) return;
    boardRef.current = { placements, setPlacements };
    return () => { if (boardRef.current?.placements === placements) boardRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, boardRef]);

  // Keep the order consistent with the widgets that exist on the page:
  // append missing ones (declared defaults + newly added catalog widgets —
  // they always land at the END of the board, right after the last visible
  // widget), drop stale ones (removed widgets) — preserving the user's order.
  useEffect(() => {
    if (!ctx) return;
    const current = new Set([...declaredIds, ...liveIds]);
    const placed = normalizeOrder(placements);
    const placedSet = new Set(placed);
    const missing = [...current].filter((id) => !placedSet.has(id));
    const hasStale = placed.some((p) => !current.has(p));
    if (!missing.length && !hasStale) return;
    setPlacements((prev) => {
      const order = normalizeOrder(prev).filter((id) => current.has(id));
      for (const id of missing) if (!order.includes(id)) order.push(id);
      return order;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedSig, liveSig, placements, ctx]);

  // Persist the widget order.
  useEffect(() => {
    if (pageKey) savePlacements(pageKey, placements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, pageKey]);

  // Reorder on drop — each widget keeps its size; the masonry re-flows itself.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setPlacements((prev) => relayoutFromOrder(prev, activeId, overId));
  };

  const sensors = useSensors(
    // activationConstraint lets ordinary clicks (buttons, charts) pass through;
    // dragging starts after 6px of pointer movement on the ⠿ handle.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  return (
    <BoardContext.Provider value={{ placements, setPlacements }}>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {children}
      </DndContext>
    </BoardContext.Provider>
  );
}

/** Renders one placed widget (sortable card) in the free-flow order. */
function SlotWidgetCell({ index, widgetId, span }: { index: number; widgetId: string; span: number }) {
  const ctx = useContext(LayoutContext);
  const el = useContext(SlotCellElementContext).get(widgetId);
  const { setNodeRef, listeners, attributes, transform, transition, isDragging, isOver } = useSortable({ id: widgetId });

  if (!ctx || !el) return null;
  const entry = ctx.layout.find((w) => w.id === widgetId) ?? { id: widgetId, colSpan: 1, collapsed: false };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 50, position: 'relative' as const } : {}),
  };

  const props = el.props as any;
  const isPlainWidget = el.type === DashboardWidget;
  const cp = isPlainWidget
    ? props
    : { title: props.title ?? widgetId, subtitle: props.subtitle, spanOptions: props.spanOptions ?? [1], headerExtra: undefined, className: '', children: props.children };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-slot-index={index}
      className={`min-w-0 break-inside-avoid mb-0 ${(SPAN_CLASS[span] ?? SPAN_CLASS[1]).join(' ')}`}
    >
      <WidgetCard
        entry={entry}
        title={cp.title ?? widgetId}
        subtitle={cp.subtitle}
        headerExtra={cp.headerExtra}
        removable={isPlainWidget ? cp.removable ?? widgetId.startsWith('cat-') : true}
        className=""
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        isOver={isOver && isDragging}
      >
        {cp.children}
      </WidgetCard>
    </div>
  );
}

// Bridge so SlotWidgetCell can find the React element declared for a widget id.
const SlotCellElementContext = createContext<Map<string, React.ReactElement>>(new Map());

/**
 * "Add widget" card that always sits immediately after the last visible
 * widget on the board — the only way to append new widgets (no empty "+"
 * placeholder cells are scattered inside the dashboard anymore). Clicking it
 * opens the catalogue modal.
 */
function AddWidgetCell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 break-inside-avoid mb-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a widget after the last one"
        title="Add a widget here"
        className="flex flex-col items-center justify-center gap-2 min-h-[120px] h-full w-full rounded-xl border border-dashed transition-colors text-[var(--ic-muted)] hover:border-cyan-400/60 hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 border-[var(--ic-border)] bg-[var(--ic-surface)]/40"
      >
        <Plus className="w-6 h-6" />
        <span className="text-xs font-medium">Add widget</span>
      </button>
      {open && <AddWidgetModal onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Public slot grid: declares which widget elements belong to this board and
 * renders the free-flow masonry. All grids under one provider share one board.
 */
function SlotGrid({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(LayoutContext);
  const board = useContext(BoardContext);

  const byId = new Map<string, React.ReactElement>();
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    // DashboardWidget / CatalogEntryPlaceholder are declared directly in the
    // page tree. <CatalogEntry/> (defined in WidgetCatalog.tsx, which imports
    // this module — a static import back would be a cycle) is recognized via
    // the CATALOG_ENTRY_REF registry and collected when it renders.
    if (child.type === DashboardWidget || (child.type as any) === CatalogEntryPlaceholder || (child.type as any) === CATALOG_ENTRY_REF.current) {
      const cid = (child.props as { id?: string }).id;
      if (cid) byId.set(cid, child);
    }
  });

  const gridClasses = `${className}`.trim();

  /** Width per widget for this board (colSpan 1..3). */
  const gridSpans: Record<string, number> = {};
  for (const w of ctx?.layout ?? []) gridSpans[w.id] = clamp(w.colSpan || 1, 1, GRID_COLS);

  // No provider/board: static masonry (no dnd, no add cell).
  if (!ctx || !board) {
    return (
      <div className={`${MASONRY_CLASSES} ${gridClasses}`.trim()}>
        {React.Children.map(children, (child) =>
          React.isValidElement(child) && child.type === CatalogEntryPlaceholder ? null : child
        )}
      </div>
    );
  }

  const order = normalizeOrder(board.placements);
  const sortableIds = order;

  return (
    <SlotCellElementContext.Provider value={byId}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className={`${MASONRY_CLASSES} ${gridClasses}`.trim()}>
          {order.map((id, i) => (
            <SlotWidgetCell key={id} index={i} widgetId={id} span={clamp(gridSpans[id] ?? 1, 1, GRID_COLS)} />
          ))}
          {/* The add-widget card is forced to be the LAST item on the board,
              right after the last shown widget. */}
          <AddWidgetCell />
        </div>
      </SortableContext>
    </SlotCellElementContext.Provider>
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
  const board = useContext(BoardContext);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(widgetStorageKey(pageKey));
          localStorage.removeItem(widgetAddedCatalogKey(pageKey));
          localStorage.removeItem(`${widgetStorageKey(pageKey)}:slots`);
        } catch {
          /* ignore */
        }
        deleteLayoutOnBackend(pageKey);
        // Forget the saved slot arrangement, then re-place widgets in order.
        if (board) board.setPlacements(defaultLayout.map((d) => d.id));
        setLayout(defaultLayout.map((d) => ({ ...d, colSpan: 1 })));
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
      Drag ⠿ to place a widget in any slot · click an empty “+” slot to add one
    </span>
  );
}
