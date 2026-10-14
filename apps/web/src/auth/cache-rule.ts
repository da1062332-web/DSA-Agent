// When the signed-in user changes, cached data from the previous session must go, or the next user sees the previous
// user's name and records. `undefined` means the provider has not yet read a session; `null` means signed out.
export function shouldClearCache(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && previous !== next;
}

/** One signed-in user replaced by another without a sign-out in this tab (for example, a sign-in in another tab).
 *  The page reloads so nothing held in memory for the previous user survives. */
export function isUserSwitch(previous: string | null | undefined, next: string | null): boolean {
  return typeof previous === 'string' && next !== null && previous !== next;
}
