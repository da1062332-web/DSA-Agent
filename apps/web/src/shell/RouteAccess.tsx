// May this user open this link? (owner: Dev 1; audit F-07.) The same rule the sidebar, the route guard and the Home cards use
// (routeAllowed in access.ts), made available to any component under the app layout, so a dashboard card or button never offers a link
// that ends in "You do not have permission". Presentation only: the API enforces every permission itself.
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { hasPermission, type Me } from '../api/useMe';
import { routeAllowed } from './access';

export type RouteAccess = (to: string) => boolean;

/** The path of a link target: `/applications?status=DRAFT` is the `/applications` screen. */
export const pathOf = (to: string): string => to.split(/[?#]/)[0] || '/';

export function routeAccessFor(me: Me | undefined): RouteAccess {
  const platformRealm = me?.tenantId === PLATFORM_TENANT_ID;
  return (to) =>
    routeAllowed(pathOf(to), (code) => hasPermission(me, code), platformRealm, me?.disabledModules);
}

// Outside the app layout (a spec, a story) nothing provides the rule, so every link shows: a component is never blank for lack of a
// provider. Inside the app, AppLayout always provides the real check, and it fails closed until the profile has loaded.
const RouteAccessContext = createContext<RouteAccess>(() => true);

export function RouteAccessProvider({ me, children }: { me: Me | undefined; children: ReactNode }) {
  const value = useMemo(() => routeAccessFor(me), [me]);
  return <RouteAccessContext.Provider value={value}>{children}</RouteAccessContext.Provider>;
}

export const useRouteAllowed = (): RouteAccess => useContext(RouteAccessContext);
