// Per-session screen preferences (owner: Dev 1). A person who holds several roles can pick which dashboard they are looking at; that
// choice belongs to one sign-in, not to the browser. It is cleared when a sign-in starts or ends, so every sign-in begins on the
// person's own home (their highest-priority role's dashboard) and never inherits the previous person's view.

/** localStorage key of the dashboard role picked in the role switcher (see features/dashboard/RoleDashboardRouter.tsx). */
export const ACTIVE_ROLE_KEY = 'qloax_active_dashboard_role';

/** Where every sign-in lands. `/` shows the dashboard of the signed-in person's own role. */
export const HOME_PATH = '/';

export function clearSessionPreferences(): void {
  try {
    localStorage.removeItem(ACTIVE_ROLE_KEY);
  } catch {
    // Storage can be blocked; the preference is then simply not remembered either.
  }
}
