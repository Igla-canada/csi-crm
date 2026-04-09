import Link from "next/link";

import { cn } from "@/lib/crm-shared";

type Tab = "overview" | "payments";

export function ClientDetailTabNav({
  clientId,
  active,
  paymentsCount = 0,
}: {
  clientId: string;
  active: Tab;
  /** Shown next to tab label when &gt; 0 */
  paymentsCount?: number;
}) {
  const base =
    "inline-flex items-center gap-2 border-b-2 px-4 pb-2.5 pt-1 text-sm font-semibold transition sm:px-5";
  const activeCls = "border-[#1e5ea8] text-slate-900";
  const idle = "border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800";

  return (
    <nav
      className="-mb-px flex flex-wrap gap-1 border-b border-slate-200/90"
      aria-label="Client sections"
    >
      <Link
        href={`/clients/${clientId}`}
        className={cn(base, active === "overview" ? activeCls : idle)}
        scroll={false}
      >
        Overview
      </Link>
      <Link
        href={`/clients/${clientId}?tab=payments`}
        className={cn(base, active === "payments" ? activeCls : idle)}
        scroll={false}
      >
        Deposits & payments
        {paymentsCount > 0 ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-900">
            {paymentsCount}
          </span>
        ) : null}
      </Link>
    </nav>
  );
}
