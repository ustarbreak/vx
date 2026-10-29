// ---------------------------------------------------------------------------
// SOAR v2 API client — talks to the REAL FastAPI SOAR engine
// (backend/app/routers/soar.py, mounted at /api/soar/*) through api.ts.
//
// Honesty contract with the backend:
//  * `preview`   → static plan only, nothing runs (GET .../preview)
//  * `simulate`  → walks steps, ZERO side effects; steps report 'skipped'
//  * `execute`   → real side-effects via existing internal engines ONLY;
//                  terminal status arrives back from the backend after every
//                  step really completed — the UI never fabricates success.
//  * Consequential playbooks (block_ip / isolate_host) require confirm=true;
//    the UI shows a confirmation dialog and surfaces the honest failure when
//    no firewall/EDR connector is wired.
// Demo Mode ON: demoStore simulates the same endpoints/shapes.
// ---------------------------------------------------------------------------
import { api } from './api';

export type RunMode = 'simulate' | 'preview' | 'execute';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial' | 'cancelled';
export type StepStatus = 'completed' | 'failed' | 'skipped' | 'running';

export interface PlaybookStepDef {
  name: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface PlaybookTrigger {
  type?: string;
  [k: string]: unknown;
}

export interface PlaybookRow {
  id: number;
  uid: string | null;              // PBK-000001 — stable identifier
  org_id: number | null;           // null => platform-shared playbook
  name: string;
  description: string;
  category: string;
  steps: PlaybookStepDef[];
  triggers: PlaybookTrigger[];
  enabled: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  consequential?: boolean;         // computed by the backend
  action_summary?: string[];       // computed trigger/action summary
}

export interface PlaybookDetail extends PlaybookRow {
  recent_runs: PlaybookRunRow[];
  run_stats: Record<string, number>;
}

export interface RunStepLog {
  step: number;
  name: string;
  action: string;
  status: StepStatus;
  detail: string;                  // already redacted by the backend
}

export interface PlaybookRunRow {
  id: number;
  uid: string;                     // RUN-000123
  playbook_id: number;
  org_id: number | null;
  incident_uid: string | null;
  mode: RunMode;
  status: RunStatus;
  triggered_by: string;
  cancel_requested?: boolean;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  skipped_steps: number;
  result_log?: RunStepLog[];       // redacted execution log
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  playbook_name?: string | null;
  retry_of?: string | null;        // set on retry responses
}

export interface PreviewPlanEntry {
  step: number; name: string; action: string;
  params: Record<string, unknown>;
  consequential: boolean; requires_confirmation: boolean;
}

export interface PreviewResult {
  playbook_id: number; mode: 'preview'; executed: false;
  requires_confirmation: boolean; plan: PreviewPlanEntry[];
}

export interface RunRequestPayload {
  mode: RunMode;
  incident_uid?: string | null;
  confirm?: boolean;
  idempotency_key?: string | null;
}

export interface RunsListParams {
  playbook_id?: number;
  incident_uid?: string;
  status?: RunStatus | '';
  mode?: RunMode | '';
  page?: number;
  page_size?: number;
}

export const soarApi = {
  listPlaybooks: (page = 1, pageSize = 50) =>
    api.get<{ items: PlaybookRow[]; total: number; page: number; page_size: number }>(
      `/soar/playbooks?page=${page}&page_size=${pageSize}`),

  getPlaybook: (id: number) => api.get<PlaybookDetail>(`/soar/playbooks/${id}`),

  createPlaybook: (p: Partial<PlaybookRow> & { name: string; steps: PlaybookStepDef[] }) =>
    api.post<PlaybookRow>('/soar/playbooks', p),

  updatePlaybook: (id: number, p: Partial<PlaybookRow> & { name: string; steps: PlaybookStepDef[] }) =>
    api.put<PlaybookRow>(`/soar/playbooks/${id}`, p),

  deletePlaybook: (id: number) => api.del<void>(`/soar/playbooks/${id}`),

  /** Static plan — zero side effects, clearly separated from simulate/run. */
  preview: (id: number) => api.get<PreviewResult>(`/soar/playbooks/${id}/preview`),

  /** POST run. Returns {replayed, run}. replayed=true means an idempotent
   *  duplicate request returned the EXISTING run instead of executing twice. */
  run: (id: number, payload: RunRequestPayload) =>
    api.post<{ replayed: boolean; run: PlaybookRunRow }>(`/soar/playbooks/${id}/run`, payload),

  listRuns: (params: RunsListParams = {}) => {
    const sp = new URLSearchParams();
    if (params.playbook_id != null) sp.set('playbook_id', String(params.playbook_id));
    if (params.incident_uid) sp.set('incident_uid', params.incident_uid);
    if (params.status) sp.set('status', params.status);
    if (params.mode) sp.set('mode', params.mode);
    sp.set('page', String(params.page ?? 1));
    sp.set('page_size', String(params.page_size ?? 25));
    return api.get<{ items: PlaybookRunRow[]; total: number; page: number; page_size: number }>(
      `/soar/runs?${sp.toString()}`);
  },

  getRun: (uid: string) => api.get<PlaybookRunRow>(`/soar/runs/${uid}`),

  cancelRun: (uid: string) => api.post<PlaybookRunRow>(`/soar/runs/${uid}/cancel`, {}),

  retryRun: (uid: string, payload: { confirm?: boolean; idempotency_key?: string | null } = {}) =>
    api.post<{ replayed: boolean; run: PlaybookRunRow }>(`/soar/runs/${uid}/retry`, payload),
};

/** Human labels for the three execution modes — the UI must always show
 *  which one produced a given result (simulation ≠ preview ≠ actual run). */
export const MODE_LABELS: Record<RunMode, string> = {
  preview: 'Preview (static plan)',
  simulate: 'Simulation (no side effects)',
  execute: 'Actual execution',
};

export const TERMINAL_RUN_STATUSES: RunStatus[] = ['completed', 'failed', 'partial', 'cancelled'];
