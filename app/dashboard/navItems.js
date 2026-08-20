// Every item maps to the one permission that governs it — Dashboard/
// Invoices has none, since every role lands somewhere and the invoice
// list itself is everyone's home view (individual buttons within it are
// what's actually gated — see dashboard/page.js).
//
// `module`, where present, ties an item to a business-level toggle in
// businesses.enabled_modules (schema_stage58.sql) — Sidebar.jsx and
// MobileNavDrawer.jsx both filter on it, so a non-school business can
// hide the 4 School items instead of seeing them permanently. Tagged
// on Construction/Clinic/Lab too even though only School and Hotel
// have an actual toggle exposed yet (app/dashboard/modules/page.js) —
// costs nothing to tag now, and means adding a toggle for any of the
// other three later is a one-line addition, not a re-plumb.
//
// Shared between Sidebar.jsx (desktop) and MobileNavDrawer.jsx (mobile)
// so the two never drift out of sync with each other.
export const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', permission: null },
  { href: '/dashboard#invoices', label: 'Invoices', icon: '🧾', permission: null },
  { href: '/dashboard/customers', label: 'Customers', icon: '👥', permission: 'manageCustomers' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '📦', permission: 'manageInventory' },
  { href: '/dashboard/catalogue', label: 'Catalogue', icon: '🛍️', permission: 'manageInventory' },
  { href: '/dashboard/school/students', label: 'Students', icon: '🎓', permission: 'manageInventory', module: 'school' },
  { href: '/dashboard/school/fees', label: 'Fees', icon: '💰', permission: 'manageInventory', module: 'school' },
  { href: '/dashboard/school/classes', label: 'Classes', icon: '🏫', permission: 'manageInventory', module: 'school' },
  { href: '/dashboard/school/sessions', label: 'Sessions & Terms', icon: '📅', permission: 'manageInventory', module: 'school' },
  { href: '/dashboard/invoice-fields', label: 'Invoice Fields', icon: '🏷️', permission: 'manageSettings' },
  { href: '/dashboard/recurring-invoices', label: 'Recurring Invoices', icon: '🔁', permission: 'manageSettings' },
  { href: '/dashboard/construction', label: 'Construction Projects', icon: '🏗️', permission: 'manageSettings', module: 'construction' },
  { href: '/dashboard/hotel/bookings', label: 'Hotel Bookings', icon: '🛏️', permission: 'manageSettings', module: 'hotel' },
  { href: '/dashboard/hotel/rooms', label: 'Hotel Rooms', icon: '🚪', permission: 'manageSettings', module: 'hotel' },
  { href: '/dashboard/clinic', label: 'Clinic Visits', icon: '🩺', permission: 'manageSettings', module: 'clinic' },
  { href: '/dashboard/lab', label: 'Lab Orders', icon: '🧪', permission: 'manageSettings', module: 'lab' },
  { href: '/dashboard/expenses', label: 'Expenses', icon: '🧾', permission: 'manageExpenses' },
  { href: '/dashboard/cashbook', label: 'Cashbook', icon: '📒', permission: 'manageCashbook' },
  { href: '/dashboard/payments', label: 'Payments', icon: '💳', permission: 'manageSubscription' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '📊', permission: 'viewAnalytics' },
  { href: '/dashboard/reports', label: 'Reports', icon: '📁', permission: 'viewReports' },
  { href: '/dashboard/team', label: 'Team', icon: '🧑\u200d🤝\u200d🧑', permission: 'manageTeam' },
  { href: '/dashboard/backups', label: 'Backups', icon: '☁️', permission: 'manageSettings' },
  { href: '/dashboard/security', label: 'Security', icon: '🔒', permission: null },
  { href: '/dashboard/modules', label: 'Modules', icon: '🧩', permission: 'manageSettings' },
  { href: '/help', label: 'Help & FAQ', icon: '❓', permission: null },
  { href: '/dashboard/activity', label: 'Activity Log', icon: '📜', permission: 'manageSettings' },
  { href: '/dashboard/diagnostics', label: 'Diagnostics', icon: '🛠️', permission: 'manageSettings' },
];
