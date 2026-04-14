import { redirect } from "next/navigation";

import { SectionHeading } from "@/components/app-shell";
import { BookingsCalendar, type BookingsCalendarAppointment } from "@/components/bookings-calendar";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointmentFormClients,
  getAppointmentsOverview,
  getBookingTypeOptions,
  getProductServiceOptions,
  getUserCapabilities,
} from "@/lib/crm";
import { normalizeStoredAccentHex, resolveBookingTypeDisplayHex } from "@/lib/call-result-accents";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const currentUser = await getCurrentUser();
  const caps = getUserCapabilities(currentUser);
  if (!caps.canViewBookings) {
    redirect("/");
  }
  const [{ appointments, config, slotUsage }, formClients, bookingTypeOptionsAll, productRows] = await Promise.all([
    getAppointmentsOverview(),
    getAppointmentFormClients(),
    getBookingTypeOptions(false),
    getProductServiceOptions(false),
  ]);
  const productServiceOptionsForBooking = (productRows ?? []).map((o) => ({
    code: String(o.code),
    label: String(o.label),
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(o.active),
  }));

  const typeMeta = new Map<
    string,
    { accentHex: string | null; accentKey: string | null; label: string }
  >();
  for (const o of bookingTypeOptionsAll) {
    const code = o.code as string;
    const rawKey = (o as { accentKey?: string | null }).accentKey;
    typeMeta.set(code, {
      accentHex: normalizeStoredAccentHex((o as { accentHex?: string | null }).accentHex),
      accentKey: rawKey != null && String(rawKey).trim() !== "" ? String(rawKey).trim() : null,
      label: String(o.label),
    });
  }

  const bookingTypeFormOptions = bookingTypeOptionsAll
    .filter((o) => Boolean(o.active))
    .map((o) => ({ code: o.code as string, label: String(o.label) }));

  const rows: BookingsCalendarAppointment[] = appointments.map((a) => {
    const code = a.type as string;
    const meta = typeMeta.get(code);
    const typeColorHex = resolveBookingTypeDisplayHex(
      meta?.accentHex,
      meta?.accentKey,
      code,
    );
    return {
      id: a.id as string,
      clientId: a.clientId as string,
      title: a.title as string,
      type: code,
      typeLabel: meta?.label ?? code,
      typeColorHex,
      status: a.status as string,
      resourceKey: a.resourceKey as string,
      googleSyncStatus: a.googleSyncStatus as string,
      capacitySlot: (a.capacitySlot as string | null) ?? "",
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      clientName: a.client.displayName,
      clientPhone: a.clientPhone ?? null,
      createdByName: a.createdBy.name,
      googleEventId: (a.googleEventId as string | null) ?? null,
      notes: (a.notes as string | null) ?? null,
      depositText: ((a as { depositText?: string | null }).depositText as string | null) ?? null,
      callLogId: ((a as { callLogId?: string | null }).callLogId as string | null) ?? null,
    };
  });

  const googleConnected = Boolean(currentUser.googleRefreshToken?.trim());
  const defaultDurationMins = config?.defaultDurationMins ?? 60;

  return (
    <div className="crm-grid">
      <SectionHeading
        eyebrow="Bookings"
        title="Day, week, and month — CRM + your Google Calendar"
        text="Switch views with Day / Week / Month. Day and week show a full 24-hour grid (scroll for overnight slots). Book like Google Calendar: click or drag on the time grid, then confirm details. CRM blocks use each booking type’s color from Workspace → Booking types; Google-only events keep their Google Calendar colors. Slot load uses the max parallel setting below."
        aside={
          <div className="crm-badge">
            Max parallel bookings: {config?.maxParallelBookings ?? 0}
          </div>
        }
      />

      <BookingsCalendar
        appointments={rows}
        bookingTypeFormOptions={bookingTypeFormOptions}
        slotUsage={slotUsage}
        maxParallelBookings={config?.maxParallelBookings ?? 1}
        googleConnected={googleConnected}
        defaultDurationMins={defaultDurationMins}
        canCreate={caps.canCreateAppointments}
        canEditAppointments={caps.canEditAppointments}
        formClients={formClients}
        productServiceOptionsForBooking={productServiceOptionsForBooking}
      />
    </div>
  );
}
