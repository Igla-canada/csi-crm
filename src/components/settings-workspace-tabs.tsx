"use client";

import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";

type TabId = "general" | "team" | "status" | "booking-types" | "products" | "lead-sources";

function TabButton({
  id,
  controlsId,
  active,
  children,
  onClick,
}: {
  id: string;
  controlsId: string;
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-controls={controlsId}
      tabIndex={active ? 0 : -1}
      className={clsx(
        "rounded-xl px-5 py-2.5 text-sm font-semibold transition",
        active
          ? "bg-white text-[#1e5ea8] shadow-sm ring-1 ring-slate-200/90"
          : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function normalizeWorkspaceTab(t: TabId | undefined): TabId {
  if (t === "team" || t === "status" || t === "booking-types" || t === "products" || t === "lead-sources") return t;
  return "general";
}

export function SettingsWorkspaceTabs({
  initialTab = "general",
  generalPanel,
  teamPanel,
  statusPanel,
  bookingTypesPanel,
  productsPanel,
  leadSourcesPanel,
}: {
  initialTab?: TabId;
  generalPanel: ReactNode;
  teamPanel: ReactNode;
  statusPanel: ReactNode;
  bookingTypesPanel: ReactNode;
  productsPanel: ReactNode;
  leadSourcesPanel: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>(() => normalizeWorkspaceTab(initialTab));

  useEffect(() => {
    setTab(normalizeWorkspaceTab(initialTab));
  }, [initialTab]);

  return (
    <div>
      <div
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-slate-100/50 p-1.5"
        role="tablist"
        aria-label="Workspace sections"
      >
        <TabButton
          id="settings-tab-general"
          controlsId="settings-panel-general"
          active={tab === "general"}
          onClick={() => setTab("general")}
        >
          General
        </TabButton>
        <TabButton
          id="settings-tab-team"
          controlsId="settings-panel-team"
          active={tab === "team"}
          onClick={() => setTab("team")}
        >
          Team
        </TabButton>
        <TabButton
          id="settings-tab-status"
          controlsId="settings-panel-status"
          active={tab === "status"}
          onClick={() => setTab("status")}
        >
          Status
        </TabButton>
        <TabButton
          id="settings-tab-booking-types"
          controlsId="settings-panel-booking-types"
          active={tab === "booking-types"}
          onClick={() => setTab("booking-types")}
        >
          Booking types
        </TabButton>
        <TabButton
          id="settings-tab-products"
          controlsId="settings-panel-products"
          active={tab === "products"}
          onClick={() => setTab("products")}
        >
          Products / services
        </TabButton>
        <TabButton
          id="settings-tab-lead-sources"
          controlsId="settings-panel-lead-sources"
          active={tab === "lead-sources"}
          onClick={() => setTab("lead-sources")}
        >
          Lead sources
        </TabButton>
      </div>

      <div
        id="settings-panel-general"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-general"
        hidden={tab !== "general"}
      >
        {generalPanel}
      </div>
      <div
        id="settings-panel-team"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-team"
        hidden={tab !== "team"}
      >
        {teamPanel}
      </div>
      <div
        id="settings-panel-status"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-status"
        hidden={tab !== "status"}
      >
        {statusPanel}
      </div>
      <div
        id="settings-panel-booking-types"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-booking-types"
        hidden={tab !== "booking-types"}
      >
        {bookingTypesPanel}
      </div>
      <div
        id="settings-panel-products"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-products"
        hidden={tab !== "products"}
      >
        {productsPanel}
      </div>
      <div
        id="settings-panel-lead-sources"
        className="mt-6"
        role="tabpanel"
        aria-labelledby="settings-tab-lead-sources"
        hidden={tab !== "lead-sources"}
      >
        {leadSourcesPanel}
      </div>
    </div>
  );
}
