export interface NavItem {
  /** Display text for the navigation item */
  displayName: string;
  
  /** Material icon name */
  iconName: string;
  
  /** Route path */
  route: string;
  
  /** Whether the route should be an exact match */
  exact: boolean;
  
  /** Required user role to see this item */
  requiredRole: 'user' | 'admin';
  
  /** Tooltip text shown on hover */
  tooltip: string;
  
  /** Whether this is a debug-only menu item */
  isDebug?: boolean;
}
