// Role-based Navigation Configuration (owner: Dev 1).
// Dynamically resolves authorized navigation items based on the authenticated user's RBAC grants.
import { hasPermission, type Me } from '../api/useMe';

export interface NavItem {
  to: string;
  label: string;
  testId: string;
  isAllowed: (me: Me | undefined) => boolean;
}

/**
 * Operational modules prominently displayed for day-to-day workflow.
 */
export const OPERATIONAL_NAV: NavItem[] = [
  {
    to: '/leads',
    label: 'Leads',
    testId: 'shell.nav.leads',
    isAllowed: (me) => hasPermission(me, 'lead.read'),
  },
  {
    to: '/tasks',
    label: 'Tasks',
    testId: 'shell.nav.tasks',
    isAllowed: (me) => hasPermission(me, 'task.read'),
  },
  {
    to: '/applications',
    label: 'Applications',
    testId: 'shell.nav.applications',
    isAllowed: (me) => hasPermission(me, 'application.read'),
  },
  {
    to: '/activities',
    label: 'Activities',
    testId: 'shell.nav.activities',
    isAllowed: (me) =>
      hasPermission(me, 'activity.create') ||
      hasPermission(me, 'activity.update') ||
      hasPermission(me, 'lead.read'),
  },
  {
    to: '/verifications',
    label: 'Verifications',
    testId: 'shell.nav.verifications',
    isAllowed: (me) =>
      hasPermission(me, 'verification.read') ||
      hasPermission(me, 'verification.perform'),
  },
  {
    to: '/document-sharing',
    label: 'Document Sharing',
    testId: 'shell.nav.document sharing',
    isAllowed: (me) =>
      hasPermission(me, 'share.create') ||
      hasPermission(me, 'document.upload') ||
      hasPermission(me, 'document.review') ||
      hasPermission(me, 'config.manage'),
  },
  {
    to: '/messaging',
    label: 'Messaging',
    testId: 'shell.nav.messaging',
    isAllowed: (me) =>
      hasPermission(me, 'message.send') ||
      hasPermission(me, 'config.manage'),
  },
];

/**
 * Administrative modules grouped under the Administration menu.
 */
export const ADMINISTRATIVE_NAV: NavItem[] = [
  {
    to: '/users',
    label: 'Users',
    testId: 'shell.nav.users',
    isAllowed: (me) => hasPermission(me, 'user.manage'),
  },
  {
    to: '/roles',
    label: 'Access Control',
    testId: 'shell.nav.access control',
    isAllowed: (me) =>
      hasPermission(me, 'config.manage') ||
      hasPermission(me, 'user.manage'),
  },
  {
    to: '/config',
    label: 'Configuration',
    testId: 'shell.nav.configuration',
    isAllowed: (me) => hasPermission(me, 'config.manage'),
  },
  {
    to: '/rules',
    label: 'Rules',
    testId: 'shell.nav.rules',
    isAllowed: (me) =>
      hasPermission(me, 'rule.author') ||
      hasPermission(me, 'rule.approve') ||
      hasPermission(me, 'rule.publish') ||
      hasPermission(me, 'rule.suspend'),
  },
  {
    to: '/decisions',
    label: 'Decisions',
    testId: 'shell.nav.decisions',
    isAllowed: (me) =>
      hasPermission(me, 'rule.simulate') ||
      hasPermission(me, 'rule.author') ||
      hasPermission(me, 'rule.approve') ||
      hasPermission(me, 'rule.publish'),
  },
  {
    to: '/admin',
    label: 'Platform Admin',
    testId: 'shell.nav.admin',
    isAllowed: (me) =>
      hasPermission(me, 'config.manage') ||
      hasPermission(me, 'user.manage'),
  },
];

export function getOperationalNav(me: Me | undefined): NavItem[] {
  if (!me) return [];
  return OPERATIONAL_NAV.filter((item) => item.isAllowed(me));
}

export function getAdministrativeNav(me: Me | undefined): NavItem[] {
  if (!me) return [];
  return ADMINISTRATIVE_NAV.filter((item) => item.isAllowed(me));
}

export function isNavActive(pathname: string, targetPath: string): boolean {
  if (targetPath === '/') {
    return pathname === '/';
  }
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}
