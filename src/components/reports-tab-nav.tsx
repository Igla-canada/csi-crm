import Link from "next/link";

import { cn } from "@/lib/crm-shared";

export type ReportsTab = "overview" | "deposits" | "bookings";

export function ReportsTabNav({ active }: { active: ReportsTab }) {
  const base =
    "inline-flex items-center gap-2 border-b-2 px-4 pb-2.5 pt-1 text-sm font-semibold transition sm:px-5";
  const activeCls = "border-[#1e5ea8] text-slate-900";
  const idle = "border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800";

  return (
    <nav className="-mb-px flex flex-wrap gap-1 border-b border-slate-200/90" aria-label="Report sections">
      <Link href="/reports" className={cn(base, active === "overview" ? activeCls : idle)} scroll={false}>
        Overview
      </Link>
      <Link
        href="/reports?tab=deposits"
        className={cn(base, active === "deposits" ? activeCls : idle)}
        scroll={false}
      >
        Deposits & payments
      </Link>
      <Link
        href="/reports?tab=bookings"
        className={cn(base, active === "bookings" ? activeCls : idle)}
        scroll={false}
      >
        Bookings ↔ calls
      </Link>
    </nav>
  );
}
