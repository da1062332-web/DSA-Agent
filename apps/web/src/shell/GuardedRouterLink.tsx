// A react-router Link that renders nothing when the user may not open its target (owner: Dev 1; audit F-07). A drop-in for
// `import { Link as RouterLink } from 'react-router-dom'` where the link is used as a MUI `component`: the button or card that wraps
// it disappears with it, instead of leading to "You do not have permission".
import { forwardRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useRouteAllowed } from './RouteAccess';

export const GuardedRouterLink = forwardRef<HTMLAnchorElement, LinkProps>(function GuardedRouterLink(
  { to, ...rest },
  ref,
) {
  const allowed = useRouteAllowed();
  const target = typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}`;
  if (!allowed(target)) return null;
  return <Link ref={ref} to={to} {...rest} />;
});
