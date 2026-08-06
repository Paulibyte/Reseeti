// The one place the role → permission matrix is defined. Every page that
// needs to gate a feature imports `can(role, permission)` from here rather
// than checking `role === 'owner'` (or worse, re-deriving its own rule) —
// so there is exactly one table to update if a role's abilities change,
// and the README's printed table below can never drift from what the
// app actually enforces, because it's generated from the same object.

export const ROLES = ['owner', 'manager', 'cashier', 'salesperson', 'accountant'];

export const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  salesperson: 'Salesperson',
  accountant: 'Accountant',
};

// Roles an owner or manager is allowed to assign when inviting someone,
// or changing an existing member's role. 'owner' is never assignable —
// there is exactly one owner per business, set at signup — and only the
// literal owner can hand out the 'manager' role (see the invite/role-change
// UI in team/page.js, backed by a DB trigger of the same rule — see
// schema_stage18.sql — so this isn't just a client-side suggestion).
export const ASSIGNABLE_ROLES = ['manager', 'cashier', 'salesperson', 'accountant'];

// Every permission flag maps to one real, checkable feature in the app —
// deliberately not a longer, more "complete-looking" list, since a
// permission with no actual enforcement point anywhere is just a label.
export const PERMISSION_LABELS = {
  createInvoice: 'Create invoice',
  deleteInvoice: 'Delete invoice',
  markInvoicePaid: 'Mark invoice paid',
  manageCustomers: 'Manage customers',
  manageInventory: 'Manage inventory',
  manageExpenses: 'Manage expenses',
  manageCashbook: 'Manage cashbook',
  viewAnalytics: 'View analytics',
  viewReports: 'View reports',
  manageTeam: 'Manage team',
  manageSettings: 'Manage business settings',
  manageSubscription: 'Manage subscription',
};

export const PERMISSION_ORDER = Object.keys(PERMISSION_LABELS);

// The matrix itself. Owner is always true across the board — it isn't
// spelled out as an explicit permission set below because "the owner can
// do everything" is a rule, not a list that needs maintaining in sync
// with every new permission this table might grow.
const ROLE_PERMISSIONS = {
  manager: {
    createInvoice: true,
    deleteInvoice: true,
    markInvoicePaid: true,
    manageCustomers: true,
    manageInventory: true,
    manageExpenses: true,
    manageCashbook: true,
    viewAnalytics: true,
    viewReports: true,
    manageTeam: true,
    manageSettings: false,
    manageSubscription: false,
  },
  // Front-till role: sells, collects payment, handles the day's cash —
  // but can't erase a financial record, and has no visibility into
  // business-wide figures (that's Manager/Accountant/Owner territory).
  cashier: {
    createInvoice: true,
    deleteInvoice: false,
    markInvoicePaid: true,
    manageCustomers: true,
    manageInventory: false,
    manageExpenses: false,
    manageCashbook: true,
    viewAnalytics: false,
    viewReports: false,
    manageTeam: false,
    manageSettings: false,
    manageSubscription: false,
  },
  // Sales-focused: writes invoices and manages the customer relationships
  // behind them — but doesn't touch cash/payment collection (Cashier's
  // job) or see business-wide figures.
  salesperson: {
    createInvoice: true,
    deleteInvoice: false,
    markInvoicePaid: false,
    manageCustomers: true,
    manageInventory: false,
    manageExpenses: false,
    manageCashbook: false,
    viewAnalytics: false,
    viewReports: false,
    manageTeam: false,
    manageSettings: false,
    manageSubscription: false,
  },
  // Financial oversight and bookkeeping — sees everything money-related
  // (analytics, reports, expenses, cashbook) and can record that an
  // invoice was paid (e.g. confirming a bank transfer landed), but
  // doesn't create sales and — deliberately — can't delete an invoice
  // either: separating "who reconciles the books" from "who can erase
  // what's in them" is a basic accounting control, not an oversight.
  accountant: {
    createInvoice: false,
    deleteInvoice: false,
    markInvoicePaid: true,
    manageCustomers: false,
    manageInventory: false,
    manageExpenses: true,
    manageCashbook: true,
    viewAnalytics: true,
    viewReports: true,
    manageTeam: false,
    manageSettings: false,
    manageSubscription: false,
  },
};

// `overrides` is the member's own permission_overrides jsonb (Stage 28) —
// a sparse map of permission -> true/false for the flags an owner has
// explicitly pulled away from that person's role default. Its absence
// (undefined, or a key simply not present in it) falls through to the
// role template exactly as before, so every existing call site that
// still only passes (role, permission) keeps working unchanged. Owner is
// never subject to overrides — there's no UI path to set any for an
// owner, and this keeps it that way even if one were ever written by
// mistake.
export function can(role, permission, overrides) {
  if (role === 'owner') return true;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, permission)) {
    return !!overrides[permission];
  }
  return !!ROLE_PERMISSIONS[role]?.[permission];
}

// For rendering a full permission table (e.g. in the Team page, so an
// owner can see at a glance what each role/member can and can't do
// before assigning it). Pass a member's overrides to see their actual
// effective permissions rather than just the bare role template.
export function permissionsFor(role, overrides) {
  if (role === 'owner') {
    return Object.fromEntries(PERMISSION_ORDER.map((p) => [p, true]));
  }
  return Object.fromEntries(PERMISSION_ORDER.map((p) => [p, can(role, p, overrides)]));
}
