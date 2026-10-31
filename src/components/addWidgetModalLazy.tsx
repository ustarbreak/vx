// ---------------------------------------------------------------------------
// Lazy bridge for <AddWidgetModal/> (defined in WidgetCatalog.tsx).
//
// Why this exists: DashboardWidget.tsx ↔ WidgetCatalog.tsx form an import
// cycle. Under ESM semantics a *static* DashboardWidget → WidgetCatalog edge
// makes the evaluation order matter: if any entry point pulls WidgetCatalog
// first, its top-level `registerCatalogEntryComponent(CatalogEntry)` call runs
// while DashboardWidget.tsx is still mid-evaluation and hits the temporal dead
// zone of `const CATALOG_ENTRY_REF` — "Cannot access 'CATALOG_ENTRY_REF'
// before initialization" — which crashed the whole app bundle and left the
// landing page blank at http://127.0.0.1:5173/.
//
// By loading the modal through import() (deferred to when it is actually
// opened), the cycle disappears at module-evaluation time and WidgetCatalog
// can safely keep its static imports from DashboardWidget.
// ---------------------------------------------------------------------------
import React from 'react';

type ModalProps = { onClose: () => void };

let resolved: React.ComponentType<ModalProps> | null = null;
let pending: Promise<void> | null = null;
// Mounted placeholder instances, notified when the real modal arrives.
const waiters = new Set<() => void>();

/**
 * Returns the AddWidgetModal component once WidgetCatalog has been loaded.
 * On the very first call it kicks off the dynamic import and returns a tiny
 * placeholder component that re-renders itself when the real modal arrives.
 * Subsequent calls return the already-resolved component synchronously.
 */
export function lazyResolveAddWidgetModal(): React.ComponentType<ModalProps> {
  if (resolved) return resolved;
  if (!pending) {
    pending = import('./WidgetCatalog').then((m) => {
      resolved = m.AddWidgetModal;
      // Force any placeholder currently mounted to swap in the real modal.
      waiters.forEach((notify) => notify());
    });
  }
  return LazyAddWidgetModal;
}

function LazyAddWidgetModal({ onClose }: ModalProps) {
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    const notify = () => setTick((t) => t + 1);
    waiters.add(notify);
    // In case the module resolved between render and effect commit.
    if (resolved) notify();
    return () => { waiters.delete(notify); };
  }, []);

  if (resolved) return React.createElement(resolved, { onClose });

  // Trigger load (idempotent) and show a lightweight loading card so the
  // user gets feedback instead of a silent no-op on first click.
  pending?.catch(() => { /* surfaced in console by Vite */ });
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-4">
      <div className="rounded-xl border border-[var(--ic-border)] bg-[var(--ic-surface)] px-8 py-6 text-sm text-[var(--ic-muted)] shadow-xl">
        Loading widget catalogue…
      </div>
    </div>
  );
}
