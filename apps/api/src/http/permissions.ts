// Any-of permission checks (owner: Dev 1; sub-permission split, migration M-098).
// A sub-permission guards a feature together with the coarse code that guarded it before the split (withLegacy in
// @dsa/contracts), so a role keeps the feature until the role matrix is applied. These helpers compose the kernel's
// authz.requirePermission, so the error shape (403 FORBIDDEN, PERMISSION_MISSING) and the handling of service principals stay
// exactly what a single-code check gives.
import type { Authz, PermissionCode, RequestContext } from '@dsa/contracts';

/** Passes when the caller holds ANY of the codes; otherwise throws the first code's refusal (the new code, not a legacy parent). */
export function requireAnyPermission(
  authz: Authz,
  ctx: RequestContext,
  codes: readonly PermissionCode[],
): void {
  let refusal: unknown;
  for (const code of codes) {
    try {
      authz.requirePermission(ctx, code);
      return;
    } catch (err) {
      refusal ??= err;
    }
  }
  throw refusal;
}

/** True when the caller holds ANY of the codes. For branching on a permission without refusing the request. */
export function hasAnyPermission(
  authz: Authz,
  ctx: RequestContext,
  codes: readonly PermissionCode[],
): boolean {
  try {
    requireAnyPermission(authz, ctx, codes);
    return true;
  } catch {
    return false;
  }
}
