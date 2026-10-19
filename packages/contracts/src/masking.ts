// Display masking for S2 contact data (Contracts §12: lists mask mobile and email). Owner: Dev 1. Added 2026-10-19
// (additive): one shared copy for modules that list people, instead of each keeping its own.

/** "+919876543210" → "+91 ****** 3210". */
export function maskMobile(mobileE164?: string | null): string | null {
  if (!mobileE164) return null;
  if (mobileE164.length < 8) return '******';
  return `${mobileE164.slice(0, 3)} ****** ${mobileE164.slice(-4)}`;
}

/** "john.doe@example.com" → "j***e@example.com". */
export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return '******';
  const name = parts[0] ?? '';
  const domain = parts[1] ?? '';
  if (name.length <= 2) return `${name.charAt(0)}***@${domain}`;
  return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
}
