import { BookingTypesSettings } from "@/components/booking-types-settings";
import { CallResultsSettings } from "@/components/call-results-settings";
import { Card, SectionHeading } from "@/components/app-shell";
import { GoogleCalendarSettingsCard } from "@/components/google-calendar-settings-card";
import { RingCentralSettingsCard } from "@/components/ringcentral-settings-card";
import { LiveUiSyncSettingsCard } from "@/components/live-ui-sync-settings-card";
import { LeadSourcesSettings } from "@/components/lead-sources-settings";
import { ProductServicesSettings } from "@/components/product-services-settings";
import { ShopCalendarDefaultsForm } from "@/components/shop-calendar-defaults-form";
import { SettingsWorkspaceTabs } from "@/components/settings-workspace-tabs";
import { WorkspaceUsersSettings } from "@/components/workspace-users-settings";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointmentsOverview,
  getBookingTypeOptions,
  getCallResultOptions,
  getLeadSourceOptions,
  getProductServiceOptions,
  getUserCapabilities,
} from "@/lib/crm";
import {
  isCallResultAccentKey,
  normalizeStoredAccentHex,
  type CallResultAccentKey,
} from "@/lib/call-result-accents";
import { getSupabaseAdmin, tables } from "@/lib/db";
import { isRingCentralConfigured } from "@/lib/ringcentral/env";

type WorkspaceTab = "general" | "team" | "status" | "booking-types" | "products" | "lead-sources";

type SettingsPageProps = {
  searchParams?: Promise<{ tab?: string; google?: string; message?: string }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const sp = (await searchParams) ?? {};
  const tabParam =
    sp.tab === "team" ||
    sp.tab === "status" ||
    sp.tab === "booking-types" ||
    sp.tab === "products" ||
    sp.tab === "lead-sources"
      ? sp.tab
      : null;
  const initialTab: WorkspaceTab = tabParam ?? "general";
  const googleBanner =
    sp.google === "connected" ? ("connected" as const) : sp.google === "error" ? ("error" as const) : null;
  const googleErrorMessage = typeof sp.message === "string" && sp.message.trim() ? sp.message : null;
  const [
    currentUser,
    usersResult,
    appointments,
    callResultOptions,
    bookingTypeOptions,
    productServiceOptions,
    leadSourceOptions,
  ] = await Promise.all([
    getCurrentUser(),
    getSupabaseAdmin().from(tables.User).select("*").order("role", { ascending: true }),
    getAppointmentsOverview(),
    getCallResultOptions(false),
    getBookingTypeOptions(false),
    getProductServiceOptions(false),
    getLeadSourceOptions(false),
  ]);
  if (usersResult.error) throw usersResult.error;
  const users = usersResult.data ?? [];

  const config = appointments.config;
  const caps = getUserCapabilities(currentUser);
  const workspaceUserRows = users.map((u) => ({
    id: u.id as string,
    name: u.name as string,
    email: u.email as string,
    role: u.role as string,
    team: (u.team as string | null) ?? null,
    privilegeOverrides: (u as { privilegeOverrides?: unknown }).privilegeOverrides ?? null,
  }));
  const usersFingerprint = workspaceUserRows
    .map(
      (u) =>
        `${u.id}\t${u.name}\t${u.email}\t${u.role}\t${u.team ?? ""}\t${JSON.stringify(u.privilegeOverrides ?? null)}`,
    )
    .join("|");

  const statusOptions = callResultOptions.map((o) => {
    const rawKey = (o as { accentKey?: string | null }).accentKey;
    const trimmed = rawKey != null ? String(rawKey).trim() : "";
    const accentKey: CallResultAccentKey | null =
      trimmed !== "" && isCallResultAccentKey(trimmed) ? trimmed : null;
    return {
      code: o.code as string,
      label: o.label as string,
      isBuiltIn: Boolean(o.isBuiltIn),
      active: Boolean(o.active),
      /** Null when unset/invalid so UI uses per-code defaults (same as cards and Log a Call). */
      accentKey,
      accentHex: normalizeStoredAccentHex((o as { accentHex?: string | null }).accentHex),
    };
  });

  const statusOptionsFingerprint = statusOptions
    .map((o) => `${o.code}\t${o.label}\t${o.accentKey ?? ""}\t${o.accentHex ?? ""}`)
    .join("|");

  const bookingTypeRows = bookingTypeOptions.map((o) => {
    const rawKey = (o as { accentKey?: string | null }).accentKey;
    const trimmed = rawKey != null ? String(rawKey).trim() : "";
    const accentKey: CallResultAccentKey | null =
      trimmed !== "" && isCallResultAccentKey(trimmed) ? trimmed : null;
    return {
      code: o.code as string,
      label: o.label as string,
      isBuiltIn: Boolean(o.isBuiltIn),
      active: Boolean(o.active),
      accentKey,
      accentHex: normalizeStoredAccentHex((o as { accentHex?: string | null }).accentHex),
    };
  });

  const bookingTypesFingerprint = bookingTypeRows
    .map((o) => `${o.code}\t${o.label}\t${o.accentKey ?? ""}\t${o.accentHex ?? ""}\t${o.active}`)
    .join("|");

  const productServiceRows = productServiceOptions.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    isBuiltIn: Boolean(o.isBuiltIn),
    active: Boolean(o.active),
  }));

  const productsFingerprint = productServiceRows
    .map((o) => `${o.code}\t${o.label}\t${o.matchTerms}\t${o.active}`)
    .join("|");

  const leadSourceRows = leadSourceOptions.map((o) => ({
    code: o.code as string,
    label: o.label as string,
    isBuiltIn: Boolean(o.isBuiltIn),
    active: Boolean(o.active),
  }));

  const leadSourcesFingerprint = leadSourceRows.map((o) => `${o.code}\t${o.label}\t${o.active}`).join("|");

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Workspace"
        title="Team, calendar, and how the CRM behaves."
        text="General covers shop booking defaults and Google Calendar. Open the Team tab to manage people and roles. Other tabs tune call results, booking types, products, and lead sources for Log a Call and reporting."
      />

      <SettingsWorkspaceTabs
        initialTab={initialTab}
        generalPanel={
          <section className="grid gap-4">
            <Card>
              <h3 className="text-xl font-semibold text-slate-900">Shop booking defaults</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Defaults for new appointments on the calendar. Staff can still pick a different length per booking.
              </p>
              <div className="mt-6">
                <ShopCalendarDefaultsForm
                  calendarId={String(config?.calendarId ?? "")}
                  defaultDurationMins={Number(config?.defaultDurationMins ?? 90)}
                  maxParallelBookings={Number(config?.maxParallelBookings ?? 5)}
                  canEdit={caps.canConfigure}
                />
              </div>
            </Card>
            <GoogleCalendarSettingsCard
              user={currentUser}
              googleBanner={googleBanner}
              googleErrorMessage={googleErrorMessage}
            />
            <RingCentralSettingsCard canConfigure={caps.canConfigure} configured={isRingCentralConfigured()} />
            <LiveUiSyncSettingsCard />
          </section>
        }
        teamPanel={
          <Card>
            <h3 className="text-xl font-semibold text-slate-900">Team directory</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Search, add, and edit workspace accounts. Roles control which pages appear in the sidebar and who can
              configure imports and options. Only ADMIN can change roles or remove users.
            </p>
            <div className="mt-6">
              <WorkspaceUsersSettings
                key={usersFingerprint}
                users={workspaceUserRows}
                currentUserId={currentUser.id}
                canManageUsers={caps.canConfigure}
              />
            </div>
          </Card>
        }
        statusPanel={
          <Card>
            <h3 className="text-xl font-semibold text-slate-900">Call result statuses</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              These labels appear on client call cards and on Log a Call. Pick a color for each result so status is easy
              to scan everywhere (and the same keys can drive a calendar later). Built-in results stay in the database for
              history; you can rename them, change color, hide them from new calls, or add your own. Custom statuses can
              be deleted; if a status is still used on calls, it will be hidden instead of removed.
            </p>
            <div className="mt-6">
              <CallResultsSettings key={statusOptionsFingerprint} options={statusOptions} />
            </div>
          </Card>
        }
        bookingTypesPanel={
          <Card>
            <h3 className="text-xl font-semibold text-slate-900">Booking types</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Types appear in the Add booking dialog on the Bookings calendar. Each type has a color used for CRM event
              blocks (Google events stay green). Rename, recolor, hide from new bookings, or add custom types; unused
              custom types can be removed.
            </p>
            <div className="mt-6">
              <BookingTypesSettings key={bookingTypesFingerprint} options={bookingTypeRows} />
            </div>
          </Card>
        }
        productsPanel={
          <Card>
            <h3 className="text-xl font-semibold text-slate-900">Products / services</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Staff pick from this list (with typing suggestions) on Log a Call. Match terms drive automatic selection
              when the product field is empty and the summary or vehicle text mentions a service.
            </p>
            <div className="mt-6">
              <ProductServicesSettings key={productsFingerprint} options={productServiceRows} />
            </div>
          </Card>
        }
        leadSourcesPanel={
          <Card>
            <h3 className="text-xl font-semibold text-slate-900">Lead sources</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Controls the &quot;Found us through&quot; dropdown when logging or editing calls. Same idea as booking
              types and products: rename, hide, add custom values, or delete unused custom entries.
            </p>
            <div className="mt-6">
              <LeadSourcesSettings key={leadSourcesFingerprint} options={leadSourceRows} />
            </div>
          </Card>
        }
      />
    </div>
  );
}
