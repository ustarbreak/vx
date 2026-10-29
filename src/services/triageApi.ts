// ---------------------------------------------------------------------------
// STAGE 6A/6B — Triage outcome-labeling API client.
//
// Thin typed wrappers around the REAL FastAPI triage endpoints
// (backend/app/routers/triage.py) through src/services/api.ts:
//   GET  /api/triage/incidents/{uid}/outcome-labels   -> immutable history
//   POST /api/triage/incidents/{uid}/outcome-label     -> append label/correction
//
// Vocabulary constants mirror backend/app/services/outcomes.py exactly;
// the backend re-validates both via Pydantic patterns (422 on mismatch).
// Demo Mode has NO simulated triage store, so these calls always hit the
// real backend — callers must surface ApiError (incl. 403 read-only and
// backend-down) instead of pretending data exists.
// ---------------------------------------------------------------------------
import { api } from './api';

export const OUTCOME_DISPOSITIONS = [
  'true_positive', 'false_positive', 'benign_duplicate', 'unknown',
] as const;
export const PRIORITY_CORRECTNESS_VALUES = [
  'correct', 'too_high', 'too_low', 'unknown',
] as const;

export type OutcomeDisposition = (typeof OUTCOME_DISPOSITIONS)[number];
export type PriorityCorrectness = (typeof PRIORITY_CORRECTNESS_VALUES)[number];

/** One immutable label row — mirrors label_out() in outcomes.py. */
export interface OutcomeLabelRow {
  id: number;
  incident_uid: string;
  disposition: OutcomeDisposition;
  priority_correctness: PriorityCorrectness;
  /** Effective priority frozen at labeling time (null if never triaged). */
  priority_labeled_at: string | null;
  rationale: string | null;
  reviewer: string | null;
  labeled_by: string;
  /** Set when this row corrects a previous one; prior rows are never edited. */
  supersedes_id: number | null;
  created_at: string | null;
}

export interface OutcomeLabelHistoryResponse {
  incident_uid: string;
  latest: OutcomeLabelRow | null;
  history: OutcomeLabelRow[]; // newest first
  vocabularies: {
    disposition: string[];
    priority_correctness: string[];
  };
}

export interface OutcomeLabelPayload {
  disposition: OutcomeDisposition;
  priority_correctness: PriorityCorrectness;
  rationale?: string | null;
  reviewer?: string | null;
  /** Explicit correction of a specific past row (auditable chain). */
  supersedes_id?: number | null;
  /** Reopen relabel: appends a new head replacing the previous one.
   *  Mutually exclusive with supersedes_id (backend enforces 422). */
  relabel_previous?: boolean;
}

export const triageApi = {
  /** Full immutable label history for one incident (newest first). */
  getOutcomeLabels: (uid: string) =>
    api.get<OutcomeLabelHistoryResponse>(`/triage/incidents/${uid}/outcome-labels`),

  /** Append an outcome label, correction (supersedes_id) or reopen relabel
   *  (relabel_previous). Returns the persisted immutable row (HTTP 201). */
  postOutcomeLabel: (uid: string, payload: OutcomeLabelPayload) =>
    api.post<OutcomeLabelRow>(`/triage/incidents/${uid}/outcome-label`, payload),
};
