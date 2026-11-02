// ---------------------------------------------------------------------------
// Thin accessor module: exposes the mutable demo operational arrays that live
// inside demoMode.ts (alerts/tickets/incidents) WITHOUT importing demoMode
// (which would create a cycle with partnerOpsDemo). demoMode.ts assigns these
// bindings once at module init; consumers read through the functions below.
// ---------------------------------------------------------------------------
let _alerts: any[] = [];
let _tickets: any[] = [];
let _incidents: any[] = [];

export function bindDemoOpsFeeds(a: any[], t: any[], i: any[]) {
  _alerts = a; _tickets = t; _incidents = i;
}

export const alerts: any[] = new Proxy([] as any[], {
  get: (_t, k) => (_alerts as any)[k],
  has: (_t, k) => k in _alerts,
});
export const tickets: any[] = new Proxy([] as any[], {
  get: (_t, k) => (_tickets as any)[k],
  has: (_t, k) => k in _tickets,
});
export const incidents: any[] = new Proxy([] as any[], {
  get: (_t, k) => (_incidents as any)[k],
  has: (_t, k) => k in _incidents,
});
