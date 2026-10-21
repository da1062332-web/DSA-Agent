// apps/api/src/modules/security/report-policy.ts — Module 39: Security (MOD-SEC)
// What a security event filed over HTTP (POST /v1/security/events) may say, and what the server decides itself.
//
// The security event log is evidence (it feeds the SIEM and the critical-event alert). A person or API caller who files an event is a
// REPORTER, not the system: the server states who reported it (the signed-in principal), from where (the request address) and how
// serious it is (by event type). Anything the caller says about those is kept for the investigator under details.claimed and is
// never used as a trusted field. Events detected by the system itself are recorded in-process with SecurityService.recordSecurityEvent,
// which is not reachable from the HTTP surface.
import type { SecurityEventSeverity, SecurityEventType } from '@dsa/contracts';

/**
 * The event types a reporter may file over HTTP: what a person can observe and report. The other types (failed sign-ins, denied
 * permissions, rate limits, exports, configuration changes, integrity violations) are facts the system itself detects, so a caller
 * cannot assert them. Widening this list is a security decision (docs/PERMISSION_UI_VISIBILITY_AUDIT.md, F-04).
 */
export const REPORTABLE_EVENT_TYPES = ['SUSPICIOUS_ACCESS'] as const satisfies readonly SecurityEventType[];
export type ReportableEventType = (typeof REPORTABLE_EVENT_TYPES)[number];

/** Severity of a reported event, chosen by the server. HIGH and CRITICAL raise the alert, so a reporter cannot trigger it. */
export const REPORTED_SEVERITY: Record<ReportableEventType, SecurityEventSeverity> = {
  SUSPICIOUS_ACCESS: 'MEDIUM',
};

/** Upper bound for the (redacted) details a reporter may attach, in characters of JSON. */
export const MAX_REPORT_DETAILS_CHARS = 8192;

/** Longest caller-claimed principal or address kept under details.claimed. */
export const MAX_CLAIMED_VALUE_CHARS = 128;

export function isReportableEventType(type: string): type is ReportableEventType {
  return (REPORTABLE_EVENT_TYPES as readonly string[]).includes(type);
}
