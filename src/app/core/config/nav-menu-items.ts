import { NavItem } from '../models/nav-item.model';

export const NAV_ITEMS: NavItem[] = [
  {
    displayName: 'Admin',
    iconName: 'show_chart',
    route: '/admin',
    exact: true,
    requiredRole: 'user', // Basic user role can access
    tooltip: 'Admin Dashboard'
  },
  {
    displayName: 'Calendars',
    iconName: 'event',
    route: '/calendars',
    exact: false,
    requiredRole: 'user',
    tooltip: 'View and manage calendars'
  },
  {
    displayName: 'Data Maintainer',
    iconName: 'storage',
    route: '/data-maintainer',
    exact: false,
    requiredRole: 'admin', // Only admin can access
    tooltip: 'Data maintenance tools'
  },
  {
    displayName: 'Symbol Manager',
    iconName: 'list_alt',
    route: '/symbol-manager',
    exact: false,
    requiredRole: 'admin',
    tooltip: 'Manage stock symbols'
  },
  {
    displayName: 'Company Logos',
    iconName: 'image',
    route: '/logos',
    exact: false,
    requiredRole: 'admin',
    tooltip: 'Manage company logos'
  },
  {
    displayName: 'Debug',
    iconName: 'bug_report',
    route: '/fs-debug',
    exact: false,
    requiredRole: 'admin', // Only admin can see debug
    tooltip: 'Debug tools',
    isDebug: true
  }
];