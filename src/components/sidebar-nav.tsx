"use client";

import type { UserCapabilitySnapshot } from "@/lib/user-privileges";
import type { UserRole } from "@/lib/db";
import { UserRole as UserRoleEnum } from "@/lib/db";
import {
  Bell,
  CalendarClock,
  DatabaseZap,
  History,
  LayoutGrid,
  ListTodo,
  PhoneCall,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn, navigation } from "@/lib/crm-shared";

const navIcons = {
  "/": LayoutGrid,
  "/calls/history": History,
  "/calls": PhoneCall,
  "/tasks": ListTodo,
  "/appointments": CalendarClock,
  "/imports": DatabaseZap,
  "/reports": Bell,
  "/settings": ShieldCheck,
  "/clients": Search,
} as const;

function navItemVisible(href: string, role: UserRole, caps: UserCapabilitySnapshot): boolean {
  switch (href) {
    case "/":
      return true;
    case "/calls/history":
    case "/calls":
      return caps.canViewCallsSection;
    case "/clients":
      return caps.canViewClients;
    case "/tasks":
      return caps.canViewTasks;
    case "/appointments":
      return caps.canViewBookings;
    case "/imports":
      return caps.canViewImports;
    case "/reports":
      return caps.canViewReports;
    case "/settings":
      return role === UserRoleEnum.ADMIN || role === UserRoleEnum.MANAGER;
    default:
      return true;
  }
}

type SidebarNavProps = {
  role: UserRole;
  caps: UserCapabilitySnapshot;
};

export function SidebarNav({ role, caps }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav className="space-y-2">
      {navigation
        .filter((item) => item.roles.includes(role) && navItemVisible(item.href, role, caps))
        .map((item) => {
          const Icon = navIcons[item.href as keyof typeof navIcons] ?? LayoutGrid;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : item.href === "/calls"
                ? pathname === "/calls"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "bg-[#eaf2fb] text-slate-900 shadow-sm"
                  : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
              )}
            >
              <Icon className={cn("h-4 w-4", isActive ? "text-[#1e5ea8]" : "text-slate-400")} />
              {item.label}
            </Link>
          );
        })}
    </nav>
  );
}
