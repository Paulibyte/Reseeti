// Every item maps to the one permission that governs it — Dashboard/
// Invoices has none, since every role lands somewhere and the invoice
// list itself is everyone's home view (individual buttons within it are
// what's actually gated — see dashboard/page.js).
//
// Shared between Sidebar.jsx (desktop) and MobileNavDrawer.jsx (mobile)
// so the two never drift out of sync with each other.
export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', permission: null },
  { href: '/dashboard#invoices', label: 'Invoices', icon: '🧾', permission: null },
  { href: '/dashboard/customers', label: 'Customers', icon: '👥', permission: 'manageCustomers' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '📦', permission: 'manageInventory' },
  { href: '/dashboard/expenses', label: 'Expenses', icon: '🧾', permission: 'manageExpenses' },
  { href: '/dashboard/cashbook', label: 'Cashbook', icon: '📒', permission: 'manageCashbook' },
  { href: '/dashboard/payments', label: 'Payments', icon: '💳', permission: 'manageSubscription' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '📊', permission: 'viewAnalytics' },
  { href: '/dashboard/reports', label: 'Reports', icon: '📁', permission: 'viewReports' },
  { href: '/dashboard/team', label: 'Team', icon: '🧑\u200d🤝\u200d🧑', permission: 'manageTeam' },
  { href: '/dashboard/backups', label: 'Backups', icon: '☁️', permission: 'manageSettings' },
  { href: '/dashboard/security', label: 'Security', icon: '🔒', permission: null },
  { href: '/help', label: 'Help & FAQ', icon: '❓', permission: null },
  { href: '/dashboard/activity', label: 'Activity Log', icon: '📜', permission: 'manageSettings' },
  { href: '/dashboard/diagnostics', label: 'Diagnostics', icon: '🛠️', permission: 'manageSettings' },
];
