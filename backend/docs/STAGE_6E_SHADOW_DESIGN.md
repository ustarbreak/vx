# INFRACENTRA — Stage 6E: Shadow-Mode ML Design (DESIGN ONLY)

Status: DESIGN DOCUMENT. No model is trained, deployed, or wired into any
decision path. Production triage scoring (`app/services/triage.py`) is and
remains rules-only; this file changes nothing.

## 0. Entry condition (must be re-checked before ANY implementation)

This design may only be *implemented* after `GET /api/triage/labels/ml-feasibility`
returns `verdict == "READY_FOR_SHADOW_DESIGN"` (all gates G1–G7 passing on real
data). As of this writing the verdict on production data is **NOT_READY**:
measured live run against an empty migrated DB returned
`VERDICT: NOT_READY`, `FAILING GATES: [G1_volume, G2_balance, G3_diversity,
G4_time_span, G5_label_noise, G6_measurable_baseline, G7_leakage_integrity]`,
`G1 measured volume: 0 / 300`. Stage 6E therefore stays a DESIGN DOCUMENT —
no shadow scorer code, no migration, and no table are created in this stage.
The gate engine itself (`app/services/ml_feasibility.py`, 8/8 unit tests
passing, including a fixture-corpus test that measures NOT_READY honestly) is
the verified artifact of Stage 6D; this document is the verified artifact of
6E design. Gate thresholds (N_MIN_VALIDATED=300, N_MIN_MINORITY=50,
TIME_SPAN_MIN_DAYS=60, MAX_UNKNOWN_RATE=0.25, MAX_CORRECTION_RATE=0.15,
CI_HALF_WIDTH_MAX=0.15, MIN_TENANTS=2, MIN_CATEGORIES=4) are conservative
policy choices flagged as estimates in code, not automatic proof of readiness.

## 1. Prediction target (frozen from Stage 6D)

- Task: binary classification — band A = {p1, p2} vs band B = {p3, p4}.
- Label source: append-only `OutcomeLabel` head rows joined to the incident's
  at-intake `TriageEvaluation` snapshot (see §3 for the join contract).
- Positive class definition follows the 6C confusion convention
  (`app/services/baseline_eval.py`): TP = true_positive ∧ judged too_low
  (rule under-prioritized a real incident that needed escalation).
- NOT targets: raw score regression, disposition prediction alone, or anything
  derived from post-close state.

## 2. Model form (when, and only when, gates pass)

- Candidate: regularized logistic regression on ~15–25 engineered at-intake
  features (feature list must be frozen in a versioned spec before training).
  Chosen over gradient boosting initially because it is auditable per-token,
  cheap to retrain, and easier to calibrate on small corpora.
- Training cadence: monthly walk-forward refresh, manual trigger required.
- Runtime: separate inference service/container; NEVER inside the request path
  of `/api/triage/incidents/{uid}/evaluate`.

## 3. Leakage prevention (hard rules)

1. Features may come ONLY from the frozen `TriageEvaluation.breakdown` snapshot
   taken at first evaluation, plus immutable event fields available at intake.
2. Forbidden inputs: `priority_labeled_at` (it embeds analyst overrides — it is
   the judged target context, never a feature); any field mutated after close
   or reopen (`resolved_at`, `closed_at`, final status); mutable enrichment
   joined after the fact.
3. Recurrence lineage: incidents linked via `recurrence_of_uid` / `dedup_key`
   must land entirely on one side of every split (group-aware splitting).
4. `policy_version` drift must be stratified or excluded from train windows
   older than the current rule semantics.
5. The shadow scorer recomputes features from the same snapshot row it joins
   (single read), not from live incident state.

## 4. Data splits & temporal validation

- Primary: walk-forward (expanding window) with ≥3 folds; train strictly on
  incidents whose `created_at < fold_start`, evaluate on `[fold_start,
  fold_end)`; label timestamp (`created_at` of head label) must also precede
  fold_start for a row to be eligible in training.
- Group keys: org_id and recurrence lineage (no group crosses a boundary).
- Holdout: final contiguous 30-day window never used for any tuning.
- Minimum per-fold positives enforced by gate G2 semantics; if unmet, folds
  collapse and evaluation is declared unreliable (mirrors 6C `reliable=false`).

## 5. Metrics & acceptance criteria (shadow phase)

Measured against the SAME labeled heads as the 6C baseline report
(`/api/triage/labels/baseline-report`), never against unlabeled traffic:

- Recall on critical-band true positives: MUST be ≥ rules-baseline recall −
  0 (i.e., no regression), CI-aware: lower Wilson bound of model recall ≥
  point estimate of rules recall is the *promotion* bar; the *shadow-health*
  bar is simply non-inferiority within CIs.
- Precision: report both; expected to trade against recall — flag if precision
  < rules precision − 10pp (estimate-based threshold, policy choice).
- FPR / false-negative counts listed explicitly; every FN in p1/p2 truth is a
  review item regardless of aggregate metrics.
- Calibration: reliability diagram + ECE ≤ 0.05 (threshold is an estimate/policy
  choice) before any score is shown in UI, even advisory.
- Per-tenant and per-category slices reported; a global pass with a failing
  tenant slice does not count.

## 6. Critical-severity safeguards (preserved unconditionally)

- `CS_CRITICAL_FLOOR` (score floor 90 → p1 for critical-severity signals)
  remains a hard post-processing rule in the RULES path. Shadow output can
  never raise or lower it; it is compared against, not merged with.
- Shadow predictions have zero write authority: they cannot set priority,
  suppress alerts, mutate tickets, or trigger response actions. Autonomous
  response actions are explicitly out of scope for shadow AND for any future
  promotion without a separate safety review.

## 7. Storage & versioning (uses existing structures only)

- New table `shadow_predictions` (one Alembic migration when/if implemented):
  id, org_id (FK, indexed), incident_uid, model_version, features_hash,
  p_escalation (float 0..1), predicted_band, rules_priority (copied at
  evaluation time for agreement stats), created_at. Append-only; no UPDATE/
  DELETE endpoints.
- `model_version` string mirrors the `policy_version` discipline already used
  by TriageEvaluation; each training run mints a new immutable version.
- Tenant isolation: reads/writes scoped by org_id exactly like OutcomeLabel;
  platform_admin rollup is read-only aggregation only.

## 8. Drift monitoring

Weekly job (read-only queries) comparing:
- Feature distributions (PSI per feature) vs training window; PSI > 0.2 flags.
- Score distribution vs calibration curve (ECE rolling 30 days).
- Agreement rate with rules band; sudden ±10pp shifts page the on-call owner.
- Label pipeline health via existing `/labels/quality-report` (unknown rate,
  correction rate, coverage) — degradation pauses promotion reviews.

## 9. Rollback

Shadow mode has zero blast radius by construction: rollback = stop writing
`shadow_predictions` (config flag `SHADOW_SCORING_ENABLED=false`). No consumer
of shadow output exists in any decision path, so no partial-state cleanup is
ever required. Promotion to advisory UI display would be a separate stage with
its own rollback (hide column) and its own approval.

## 10. Operational cost (estimates, clearly flagged)

- Dominant cost is labeling labor (analyst time at close), not compute.
- Retraining: logistic regression on ≤10⁵ rows — minutes, single core (est.).
- Inference: negligible (<1ms per incident, est.); dual-path maintenance and
  review overhead are the real recurring costs (est.).

## 11. Explicit non-goals

No LLM integration. No production scoring change. No autonomous response.
No promotion to advisory or auto-action within this stage.
