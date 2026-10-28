// Staff invitation rules (owner: platform, API-USR-001). Pure functions, so the rules are tested without a database. The database enforces
// the same facts (one PENDING invitation per user, the status set); the sign-in path enforces expiry (packages/kernel resolve-principal).

/** How long an invitation link stays usable. Shown to the invitee and to the administrator. */
export const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Resends allowed for one invitation before an administrator has to act. */
export const MAX_RESENDS = 5;
/** Minimum time between two sends for the same invitee. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * The subject an invited user holds until the provisioning worker binds it to its Supabase Auth account. No token can carry it: Auth
 * subjects are UUIDs.
 */
export const UNBOUND_SUBJECT_PREFIX = 'invite:';

export function unboundSubject(userId: string): string {
  return `${UNBOUND_SUBJECT_PREFIX}${userId}`;
}

export function isUnboundSubject(subject: string): boolean {
  return subject.startsWith(UNBOUND_SUBJECT_PREFIX);
}

/**
 * A deleted account (POST /v1/users/:id/erasure): the record stays without personal data. Its e-mail becomes a placeholder on the
 * reserved .invalid domain, so it can never match a token or receive mail; its subject is retired once the sign-in account is gone.
 */
export const ERASED_DISPLAY_NAME = 'Deleted user';
export const ERASED_SUBJECT_PREFIX = 'erased:';
export const ERASED_EMAIL_DOMAIN = '@erased.invalid';

export function erasedEmail(userId: string): string {
  return `erased+${userId.toLowerCase()}${ERASED_EMAIL_DOMAIN}`;
}

export function erasedSubject(userId: string): string {
  return `${ERASED_SUBJECT_PREFIX}${userId}`;
}

export function isErased(subject: string, email: string): boolean {
  return subject.startsWith(ERASED_SUBJECT_PREFIX) || email.toLowerCase().endsWith(ERASED_EMAIL_DOMAIN);
}

export type InvitationState = 'NONE' | 'PENDING' | 'EXPIRED' | 'ACCEPTED';

export interface InvitationRecord {
  status: string;
  sentAt: Date;
  expiresAt: Date;
  resendCount: number;
}

export function invitationExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + INVITATION_TTL_MS);
}

/** The state a person sees. A PENDING invitation past its expiry is EXPIRED, even before the sign-in path has recorded it. */
export function invitationState(record: InvitationRecord | undefined, now: Date): InvitationState {
  if (!record || record.status === 'REVOKED') return 'NONE';
  if (record.status === 'ACCEPTED') return 'ACCEPTED';
  if (record.status === 'EXPIRED' || record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

/** Why a new invitation cannot be sent now, or null when it can. With no earlier invitation, the first send is allowed. */
export function resendRefusal(record: InvitationRecord | undefined, now: Date): string | null {
  if (!record) return null;
  if (record.status === 'ACCEPTED')
    return 'This person has already set a password. Their invitation is complete.';
  if (record.resendCount >= MAX_RESENDS) {
    return 'This invitation has been sent the maximum number of times. Contact your system administrator.';
  }
  if (now.getTime() - record.sentAt.getTime() < RESEND_COOLDOWN_MS) {
    return 'A new invitation was sent a moment ago. Wait a minute and try again.';
  }
  return null;
}
