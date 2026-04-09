import Image from "next/image";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";

import { getCurrentUser, hasAnyRole } from "@/lib/auth";
import { LiveUiSyncProvider } from "@/components/live-ui-sync";
import { LiveWorkspaceHeader } from "@/components/live-workspace-header";
import { HeaderClientSearch, HeaderClientSearchSkeleton } from "@/components/header-client-search";
import { getUserCapabilities } from "@/lib/user-privileges";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";
import { roleColors, roleCopy } from "@/lib/crm-shared";
import { type UserRole } from "@/lib/db";
import { SidebarNav } from "@/components/sidebar-nav";

export async function AppShell({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const currentUser = await getCurrentUser();
  const caps = getUserCapabilities(currentUser);
  const ringCentralConfigured = isRingCentralConfigured();

  return (
    <div className="min-h-screen text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1520px] gap-6 px-4 py-5 lg:px-6">
        <aside className="crm-soft-panel hidden w-72 shrink-0 rounded-[28px] p-6 xl:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-[18px] bg-white p-2 shadow-sm">
              <Image
                src="/brand/logo.png"
                alt="Car Systems logo"
                width={42}
                height={42}
                style={{ width: "auto", height: "auto" }}
                priority
              />
            </div>
            <div>
              <p className="text-lg font-bold tracking-[0.16em] text-slate-900 uppercase">Car Systems</p>
              <p className="text-sm text-slate-500">Installation workspace</p>
            </div>
          </div>

          <div className="mb-8 rounded-[22px] bg-white/72 p-4 shadow-sm">
            <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${roleColors[currentUser.role]}`}>
              {currentUser.role}
            </div>
            <p className="mt-3 text-lg font-semibold text-slate-900">{currentUser.name}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{roleCopy[currentUser.role]}</p>
          </div>

          <SidebarNav role={currentUser.role} caps={caps} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <LiveUiSyncProvider
            ringCentralConfigured={ringCentralConfigured}
            canLogCalls={caps.canLogCalls}
            canViewCallsSection={caps.canViewCallsSection}
          >
            <header className="border-b border-[#e3ebf5] px-1 pb-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Car Systems CRM</p>
                  <h1 className="mt-1 text-[2rem] font-semibold tracking-tight text-slate-900">Clean client history and simple scheduling.</h1>
                </div>

                <div className="flex w-full flex-col items-stretch gap-3 lg:flex-row lg:items-end lg:justify-end">
                  <LiveWorkspaceHeader />
                  {caps.canViewClients ? (
                    <Suspense fallback={<HeaderClientSearchSkeleton />}>
                      <HeaderClientSearch />
                    </Suspense>
                  ) : null}
                  <Link
                    href="/api/logout"
                    className="shrink-0 self-end rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-center text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:self-auto"
                  >
                    Sign out
                  </Link>
                </div>
              </div>
            </header>

            <main className="flex-1">{children}</main>
          </LiveUiSyncProvider>
        </div>
      </div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  text,
  aside,
}: {
  eyebrow: string;
  title: string;
  text: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{text}</p>
      </div>
      {aside}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`crm-soft-panel rounded-[28px] p-6 ${className}`}>
      {children}
    </section>
  );
}

export function RoleGate({
  role,
  allow,
  children,
  fallback,
}: {
  role: UserRole;
  allow: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (!hasAnyRole(role, allow)) {
    return fallback ?? null;
  }

  return children;
}
