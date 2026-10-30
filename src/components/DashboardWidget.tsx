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

  // Widget ids declared by the <WidgetGrid> children — scanned once per mount
  // so the slot board knows which widgets exist even before they render.
  const declaredIds = React.useMemo(() => collectDeclaredWidgetIds(children), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageKeyContext.Provider value={pageKey}>
      <LayoutContext.Provider value={{ layout, setLayout }}>
        <SlotBoard declaredIds={declaredIds}>{children}</SlotBoard>
      </LayoutContext.Provider>
    </PageKeyContext.Provider>
  );
}

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
      if (t === DashboardWidget || t === CatalogEntryPlaceholder) {
        push((child.props as { id?: string }).id);
      } else if (t === CatalogEntry) {
        // <CatalogEntry id="cat-…"/> wraps a placeholder with the same id.
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
/* Slot placement — widgets keep their size; only their slot index     */
/* changes on drag & drop. Empty slots stay visible as "+" placeholders */
/* you can click to add a widget from the catalogue.                   */
/* ------------------------------------------------------------------ */

interface PlacementCtx {
  /** Ordered list of widget ids by slot position (null = empty slot). */
  placements: (string | null)[];
  setPlacements: React.Dispatch<React.SetStateAction<(string | null)[]>>;
}

/** How many slots fit per row at each breakpoint (mirrors SLOT_GRID_CLASSES). */
const COLS_PER_ROW: Record<'base' | 'md' | 'lg', number> = { base: 1, md: 2, lg: 3 };

function viewportCols(): 'base' | 'md' | 'lg' {
  if (typeof window === 'undefined') return 'lg';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'lg';
  if (window.matchMedia('(min-width: 768px)').matches) return 'md';
  return 'base';
}

/** Track the current breakpoint so placeholder rows adapt live on resize. */
export function useViewportCols(): 'base' | 'md' | 'lg' {
  const [cols, setCols] = useState<'base' | 'md' | 'lg'>(() => viewportCols());
  useEffect(() => {
    const update = () => setCols(viewportCols());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return cols;
}

/** Rows fully occupied by real widgets (trailing empty slots don't count). */
function filledRows(placements: (string | null)[], cols: number): number {
  let lastReal = -1;
  placements.forEach((p, i) => { if (p) lastReal = i; });
  if (lastReal < 0) return 0;
  return Math.floor(lastReal / cols) + 1;
}

/** First empty slot index, or -1 when every slot holds a widget. */
function firstEmptyIndex(placements: (string | null)[]): number {
  return placements.findIndex((p) => p === null);
}

/** Grow the slot array so it always covers every placed widget + one free row. */
function normalizePlacements(list: (string | null)[]): (string | null)[] {
  let lastReal = -1;
  list.forEach((p, i) => { if (p) lastReal = i; });
  const rows = Math.max(filledRows(list, GRID_COLS) + 1, Math.ceil((lastReal + 1) / GRID_COLS));
  const out = list.slice();
  while (out.length < rows * GRID_COLS) out.push(null);
  // Trim trailing empties beyond one full free row.
  while (out.length > rows * GRID_COLS && !out[out.length - 1]) out.pop();
  return out;
}

/** Compact list of widget ids into a slot array with one spare row of holes. */
export function buildPlacements(ids: string[], saved?: (string | null)[] | null): (string | null)[] {
  if (saved && saved.some((s) => typeof s === 'string')) {
    const known = new Set(ids);
    const seen = new Set<string>();
    const list: (string | null)[] = [];
    for (const s of saved) {
      if (s === null) { list.push(null); continue; }
      if (known.has(s) && !seen.has(s)) { seen.add(s); list.push(s); }
    }
    for (const id of ids) if (!seen.has(id)) list.push(id);
    return normalizePlacements(list);
  }
  return normalizePlacements([...ids]);
}

function loadSavedPlacements(pageKey: string): (string | null)[] | null {
  try {
    const raw = localStorage.getItem(`${widgetStorageKey(pageKey)}:slots`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as (string | null)[]) : null;
  } catch {
    return null;
  }
}

function savePlacements(pageKey: string, placements: (string | null)[]) {
  try {
    localStorage.setItem(`${widgetStorageKey(pageKey)}:slots`, JSON.stringify(placements));
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

  // Slot board: every widget lives in one fixed-size slot. Dragging swaps
  // slots — sizes never change and rows never collapse/reflow. The old
  // resize / move controls are gone on purpose: they were what made the
  // grid reflow ("one row fits, everything under it collapses").
  return (
    <div
      className={`min-w-0 max-w-full h-full flex flex-col overflow-hidden bg-[var(--ic-surface)] border rounded-xl p-4 sm:p-6 transition-shadow duration-150 ${
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
 * Both provide the responsive CSS Grid AND the dnd-kit drag-and-drop context.
 *
 * <WidgetGrid> is now a thin alias of <SlotGrid>: widgets live in fixed-size
 * slots (3 per row on desktop, 2 on tablet, 1 on mobile), each widget keeps
 * its size at all times, and empty slots render as clickable “+” placeholders
 * that open the catalogue. The legacy variable-width behaviour is available
 * via `<VariableWidthGrid>` if ever needed.
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
/* SlotGrid — fixed-size slots + click-empty-to-add                    */
/* ------------------------------------------------------------------ */

/** Page key of the active layout provider — used to persist slot placement. */
const PageKeyContext = createContext<string | null>(null);

/** Responsive slot grid: 1 col (mobile) → 2 cols (tablet+) → 3 cols (desktop). */
const SLOT_GRID_CLASSES = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 items-stretch';

interface BoardCtx extends PlacementCtx {
  /** Pending target slot for the next widget added from the catalogue (-1 = none). */
  pendingSlotRef: React.MutableRefObject<number>;
}

const BoardContext = createContext<BoardCtx | null>(null);

/** Non-throwing accessor for the shared slot board (pages without <SlotGrid> get null). */
export function useOptionalPlacementCtx(): BoardCtx | null {
  return useContext(BoardContext);
}

/**
 * The slot board owns the single placements array shared by every <SlotGrid>
 * on the page and persists it per user/page in localStorage. Drag & drop only
 * swaps slot positions — widget sizes never change, so no reflow/collapse.
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
    setPlacementsRaw((prev) => normalizePlacements(typeof next === 'function' ? next(prev) : next));

  // Where the next catalog widget should land (set by clicking an empty slot).
  const pendingSlotRef = React.useRef(-1);

  // Keep placements consistent with the widgets that exist on the page:
  // append missing ones (declared defaults + newly added catalog widgets),
  // blank out stale ones (removed widgets) — preserving the user's chosen
  // order and holes.
  useEffect(() => {
    if (!ctx) return;
    const current = new Set([...declaredIds, ...liveIds]);
    const placed = new Set(placements.filter(Boolean) as string[]);
    const missing = [...current].filter((id) => !placed.has(id));
    const stale = new Set(placements.filter((p) => p && !current.has(p)) as string[]);
    if (!missing.length && !stale.size) return;
    const pending = pendingSlotRef.current;
    setPlacements((prev) => {
      let list = prev.map((p) => (p && stale.has(p) ? null : p));
      for (const id of missing) {
        // Land the newly added widget exactly in the clicked empty slot…
        if (pending >= 0 && !list[pending]) {
          list[pending] = id;
          pendingSlotRef.current = -1;
          continue;
        }
        // …otherwise take the first free hole or grow the board.
        const hole = list.findIndex((p) => p === null);
        if (hole >= 0) list[hole] = id;
        else list.push(id);
      }
      return list;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedSig, liveSig, placements, ctx]);

  // Persist the slot arrangement.
  useEffect(() => {
    if (pageKey) savePlacements(pageKey, placements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, pageKey]);

  // Swap two slots on drop — sizes never change, only positions.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setPlacements((prev) => {
      const from = prev.indexOf(activeId);
      if (from === -1) return prev;
      let to = -1;
      if (overId.startsWith('slot:')) to = parseInt(overId.slice(5), 10);
      else to = prev.indexOf(overId);
      if (Number.isNaN(to) || to < 0 || to >= prev.length || to === from) return prev;
      const list = prev.slice();
      if (list[to]) {
        // Occupied target → swap the two widgets.
        const tmp = list[from];
        list[from] = list[to];
        list[to] = tmp;
      } else {
        list[to] = list[from];
        list[from] = null;
      }
      return list;
    });
  };

  const sensors = useSensors(
    // activationConstraint lets ordinary clicks (buttons, charts) pass through;
    // dragging starts after 6px of pointer movement on the ⠿ handle.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  return (
    <BoardContext.Provider value={{ placements, setPlacements, pendingSlotRef }}>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {children}
      </DndContext>
    </BoardContext.Provider>
  );
}

/**
 * One CSS-Grid row band of the board. Widgets keep their fixed slot size;
 * empty slots render as clickable “+” placeholders. `colsNow` adapts the
 * filler logic when the breakpoint shows fewer columns than GRID_COLS.
 */
function SlotRowBand({
  list,
  startIdx,
  count,
  colsNow,
}: {
  list: (string | null)[];
  startIdx: number;
  count: number;
  colsNow: number;
}) {
  const body: React.ReactNode[] = [];
  const slice = list.slice(startIdx, startIdx + count);
  const emptiesCount = slice.filter((p) => p === null).length;
  // Invisible fillers so placeholder "+" cells always form complete rows.
  const trailingEmpties = ((Math.ceil(emptiesCount / colsNow) * colsNow - emptiesCount) % colsNow + colsNow) % colsNow;
  for (let t = 0; t < trailingEmpties; t++) body.push(<TrailingSpacer key={`trail-${t}`} />);
  slice.forEach((p, i) => {
    const slotIndex = startIdx + i;
    if (p) body.push(<SlotWidgetCell key={`w-${p}`} slotIndex={slotIndex} widgetId={p} />);
    else body.push(<EmptySlotCell key={`empty-${slotIndex}`} slotIndex={slotIndex} />);
  });
  return <div className={SLOT_GRID_CLASSES}>{body}</div>;
}

/** Renders one placed widget (sortable card) inside its slot. */
function SlotWidgetCell({ slotIndex, widgetId }: { slotIndex: number; widgetId: string }) {
  const ctx = useContext(LayoutContext);
  const el = useContext(SlotCellElementContext).get(widgetId);
  const { setNodeRef, listeners, attributes, transform, transition, isDragging, isOver } = useSortable({ id: widgetId });

  if (!ctx || !el) return null;
  const index = ctx.layout.findIndex((w) => w.id === widgetId);
  const entry = index >= 0 ? ctx.layout[index] : { id: widgetId, colSpan: 1, collapsed: false };

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
    <div ref={setNodeRef} style={style} data-slot-index={slotIndex} className="min-w-0">
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

/** Dashed placeholder cell shown for empty slots; click opens the catalogue. */
function EmptySlotCell({ slotIndex }: { slotIndex: number }) {
  const { setNodeRef, isOver } = useSortable({ id: `slot:${slotIndex}` });
  const board = useOptionalPlacementCtx();
  const placeHere = () => {
    if (!board) return;
    board.pendingSlotRef.current = slotIndex; // next added widget lands here
    window.dispatchEvent(new CustomEvent('ic-widget-slot-request', { detail: { slotIndex } }));
  };
  return (
    <div ref={setNodeRef} data-slot-index={slotIndex} className="min-w-0">
      <button
        type="button"
        onClick={placeHere}
        aria-label="Add a widget to this empty slot"
        title="Click to add a widget here"
        className={`flex flex-col items-center justify-center gap-2 min-h-[120px] h-full w-full rounded-xl border border-dashed transition-colors text-[var(--ic-muted)] hover:border-cyan-400/60 hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
          isOver ? 'border-cyan-400 bg-cyan-400/5 text-cyan-300' : 'border-[var(--ic-border)] bg-[var(--ic-surface)]/40'
        }`}
      >
        <Plus className="w-6 h-6" />
        <span className="text-xs font-medium">Add widget</span>
      </button>
    </div>
  );
}

/** Invisible filler that keeps placeholder rows aligned across breakpoints. */
function TrailingSpacer() {
  return <div aria-hidden className="hidden sm:block" style={{ minHeight: 0 }} />;
}

/**
 * Public slot grid: declares which widget elements belong to this band and
 * renders the board rows. All grids under one provider share one board.
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
    if (child.type === DashboardWidget || (child.type as any) === CatalogEntryPlaceholder) {
      const cid = (child.props as { id?: string }).id;
      if (cid) byId.set(cid, child);
    }
  });

  const gridClasses = `${className}`.trim();

  // No provider/board: static slot grid (no dnd, no placeholders).
  if (!ctx || !board) {
    return (
      <div className={`${SLOT_GRID_CLASSES} ${gridClasses}`.trim()}>
        {React.Children.map(children, (child) =>
          React.isValidElement(child) && child.type === CatalogEntryPlaceholder ? null : child
        )}
      </div>
    );
  }

  const { placements } = board;
  const colsKind = useViewportCols();
  const colsNow = COLS_PER_ROW[colsKind];
  const rowsNow = Math.max(filledRows(placements, GRID_COLS) + 1, 1);
  const totalSlots = rowsNow * GRID_COLS;
  const list = placements.slice(0, totalSlots);
  while (list.length < totalSlots) list.push(null);

  const bands: React.ReactNode[] = [];
  for (let r = 0; r < rowsNow; r++) {
    bands.push(
      <SlotRowBand key={`band-${r}`} list={list} startIdx={r * GRID_COLS} count={GRID_COLS} colsNow={colsNow} />
    );
  }

  const sortableIds = [...list.map((p) => p ?? '').filter(Boolean), ...list.map((_, i) => `slot:${i}`)];

  return (
    <SlotCellElementContext.Provider value={byId}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className={`space-y-4 lg:space-y-6 ${gridClasses}`.trim()}>{bands}</div>
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
