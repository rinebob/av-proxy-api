import { NavItem } from '../models/nav-item.model';

export const NAV_ITEMS: NavItem[] = [
  {
    displayName: 'Data Collections',
    iconName: 'admin_panel_settings',
    route: '/admin',
    exact: false,
    requiredRole: 'user',
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
    displayName: 'Charts',
    iconName: 'show_chart',
    route: '/charts',
    exact: false,
    requiredRole: 'admin',
    tooltip: 'View time series charts'
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
    displayName: 'System Health',
    iconName: 'monitor_heart',
    route: '/system-health',
    exact: false,
    requiredRole: 'admin',
    tooltip: 'Health metrics and request logs'
  },
  {
    displayName: 'Storage Viewer',
    iconName: 'folder_open',
    route: '/storage-viewer',
    exact: false,
    requiredRole: 'admin',
    tooltip: 'Browse and read GCS options files'
  }
];
