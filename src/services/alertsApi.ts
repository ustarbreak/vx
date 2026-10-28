// ---------------------------------------------------------------------------
// Dedicated alerts / notifications API module (Phase 5).
//
// The typed implementation lives in src/services/api.ts alongside the other
// domain APIs (repo architecture convention). This file is the standalone
// entry point requested by Phase 5: a thin re-export wrapper so consumers can
// import from 'services/alertsApi' without pulling the whole api surface.
// There is exactly ONE source of truth for alert/notification state — no
// frontend-only duplicate store.
// ---------------------------------------------------------------------------
export {
  alertsApi,
  ApiError,
  ticketsApi,
  type AlertRow,
  type AlertPage,
  type AlertDetail,
  type AlertSummary,
  type AlertListParams,
  type AlertUpdateIn,
  type AlertNoteRow,
  type AlertEventRow,
  type BulkAlertResult,
  type NotificationRow,
  type NotificationRetryResult,
  type NotifRule,
} from './api';
