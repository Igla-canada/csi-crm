import { UserRole } from "@/lib/db";

export const PRIVILEGE_KEYS = ["bookings", "calls", "clients", "tasks", "imports", "reports"] as const;
export type PrivilegeKey = (typeof PRIVILEGE_KEYS)[number];
export type AccessLevel = "none" | "read" | "write";

export type PrivilegeOverrides = Partial<Record<PrivilegeKey, AccessLevel>>;

export const PRIVILEGE_LABELS: Record<PrivilegeKey, string> = {
  bookings: "Bookings (calendar)",
  calls: "Log a Call & call history",
  clients: "Clients",
  tasks: "Tasks",
  imports: "Imports",
  reports: "Reports",
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  none: "No access",
  read: "View only",
  write: "View & edit",
};

const ALL_WRITE: Record<PrivilegeKey, AccessLevel> = {
  bookings: "write",
  calls: "write",
  clients: "write",
  tasks: "write",
  imports: "write",
  reports: "write",
};

/** Role defaults before any per-user overrides (matches previous sidebar + capability behavior). */
export function getRolePrivilegeDefaults(role: UserRole): Record<PrivilegeKey, AccessLevel> {
  switch (role) {
    case UserRole.ADMIN:
    case UserRole.MANAGER:
      return { ...ALL_WRITE };
    case UserRole.SALES:
      return { ...ALL_WRITE, imports: "none" };
    case UserRole.TECH:
      return {
        bookings: "read",
        calls: "none",
        clients: "read",
        tasks: "read",
        imports: "none",
        reports: "none",
      };
    default:
      return { ...ALL_WRITE };
  }
}

export function parsePrivilegeOverrides(raw: unknown): PrivilegeOverrides {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: PrivilegeOverrides = {};
  for (const key of PRIVILEGE_KEYS) {
    const v = src[key];
    if (v === "none" || v === "read" || v === "write") {
      out[key] = v;
    }
  }
  return out;
}

export function mergePrivileges(role: UserRole, overrides: unknown): Record<PrivilegeKey, AccessLevel> {
  if (role === UserRole.ADMIN) {
    return { ...ALL_WRITE };
  }
  const base = getRolePrivilegeDefaults(role);
  const parsed = parsePrivilegeOverrides(overrides);
  return { ...base, ...parsed };
}

export function compactPrivilegeOverrides(
  role: UserRole,
  desired: Record<PrivilegeKey, AccessLevel>,
): PrivilegeOverrides | null {
  if (role === UserRole.ADMIN) {
    return null;
  }
  const base = getRolePrivilegeDefaults(role);
  const diff: PrivilegeOverrides = {};
  for (const k of PRIVILEGE_KEYS) {
    if (desired[k] !== base[k]) {
      diff[k] = desired[k];
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

export function hasCustomPrivilegeOverrides(raw: unknown): boolean {
  return Object.keys(parsePrivilegeOverrides(raw)).length > 0;
}

export type UserCapabilitySnapshot = {
  privileges: Record<PrivilegeKey, AccessLevel>;
  canConfigure: boolean;
  canViewBookings: boolean;
  canCreateAppointments: boolean;
  canEditAppointments: boolean;
  canViewCallsSection: boolean;
  canLogCalls: boolean;
  canEditCallLogs: boolean;
  canViewClients: boolean;
  canEditClients: boolean;
  canViewTasks: boolean;
  canEditTasks: boolean;
  canViewImports: boolean;
  canRunImports: boolean;
  canViewReports: boolean;
  /** @deprecated use canRunImports */
  canImport: boolean;
  /** @deprecated use canViewReports */
  canSeeReports: boolean;
};

export function getUserCapabilities(user: { role: UserRole; privilegeOverrides?: unknown }): UserCapabilitySnapshot {
  const p = mergePrivileges(user.role, user.privilegeOverrides);
  const canConfigure = user.role === UserRole.ADMIN;
  return {
    privileges: p,
    canConfigure,
    canViewBookings: p.bookings !== "none",
    canCreateAppointments: p.bookings === "write",
    canEditAppointments: p.bookings === "write",
    canViewCallsSection: p.calls !== "none",
    canLogCalls: p.calls === "write",
    canEditCallLogs: p.calls === "write",
    canViewClients: p.clients !== "none",
    canEditClients: p.clients === "write",
    canViewTasks: p.tasks !== "none",
    canEditTasks: p.tasks === "write",
    canViewImports: p.imports !== "none",
    canRunImports: p.imports === "write",
    canViewReports: p.reports !== "none",
    canImport: p.imports === "write",
    canSeeReports: p.reports !== "none",
  };
}

export function parseAccessLevel(raw: string): AccessLevel | null {
  const t = raw.trim();
  if (t === "none" || t === "read" || t === "write") return t;
  return null;
}

/** Read `priv_<key>` from FormData; invalid values fall back to role default for that key. */
export function parsePrivilegeFieldsFromForm(
  formData: FormData,
  role: UserRole,
): Record<PrivilegeKey, AccessLevel> {
  const base = getRolePrivilegeDefaults(role);
  if (role === UserRole.ADMIN) {
    return { ...base };
  }
  const out = { ...base };
  for (const k of PRIVILEGE_KEYS) {
    const parsed = parseAccessLevel(String(formData.get(`priv_${k}`) ?? ""));
    if (parsed != null) {
      out[k] = parsed;
    }
  }
  return out;
}
