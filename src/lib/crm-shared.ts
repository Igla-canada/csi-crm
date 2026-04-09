/**
 * UI-only constants (safe for client components). Keep heavy server imports out of this file.
 */
import { UserRole } from "@/lib/db";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type NavigationItem = {
  href: string;
  label: string;
  roles: UserRole[];
};

export const navigation: NavigationItem[] = [
  { href: "/", label: "Overview", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES, UserRole.TECH] },
  { href: "/calls/history", label: "Call history", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES] },
  { href: "/calls", label: "Log a Call", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES] },
  { href: "/clients", label: "Clients", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES, UserRole.TECH] },
  { href: "/tasks", label: "Tasks", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES, UserRole.TECH] },
  { href: "/appointments", label: "Bookings", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES, UserRole.TECH] },
  { href: "/imports", label: "Imports", roles: [UserRole.ADMIN, UserRole.MANAGER] },
  { href: "/reports", label: "Reports", roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.SALES] },
  { href: "/settings", label: "Workspace", roles: [UserRole.ADMIN, UserRole.MANAGER] },
];

export const roleCopy: Record<UserRole, string> = {
  ADMIN: "Owns configuration, imports, reporting, and permissions.",
  MANAGER: "Runs operations, scheduling, team visibility, and imports.",
  SALES: "Handles client intake, call notes, quotes, and booking.",
  TECH: "Views jobs, client context, and internal service notes.",
};

export const roleColors: Record<UserRole, string> = {
  ADMIN: "bg-blue-50 text-blue-700 ring-blue-200",
  MANAGER: "bg-slate-100 text-slate-700 ring-slate-200",
  SALES: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  TECH: "bg-sky-50 text-sky-700 ring-sky-200",
};

export const chartColors = ["#1e5ea8", "#4c86c6", "#8db5df", "#c5d9ef", "#dfeaf7"];
