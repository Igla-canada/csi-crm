import { AppointmentFullEditor } from "@/components/appointment-full-editor";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointmentFormClients,
  getBookingTypeOptions,
  getProductServiceOptions,
  getUserCapabilities,
} from "@/lib/crm";
import { getAppTimezone } from "@/lib/google-calendar/env";
import { notFound } from "next/navigation";

type Props = {
  searchParams?: Promise<{ start?: string; end?: string }>;
};

export default async function NewAppointmentPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  const [clients, bookingTypes, productRows] = await Promise.all([
    getAppointmentFormClients(),
    getBookingTypeOptions(true),
    getProductServiceOptions(false),
  ]);
  const productServiceOptions = productRows.map((o) => ({
    code: String(o.code),
    label: String(o.label),
    matchTerms: String((o as { matchTerms?: string }).matchTerms ?? ""),
    active: Boolean(o.active),
  }));
  if (!caps.canCreateAppointments) {
    notFound();
  }

  const typeOptions = bookingTypes.map((o) => ({ code: o.code as string, label: String(o.label) }));

  let initialStart = new Date();
  let initialEnd = new Date(Date.now() + 60 * 60 * 1000);
  if (sp.start) {
    const s = new Date(sp.start);
    if (!Number.isNaN(s.getTime())) initialStart = s;
  }
  if (sp.end) {
    const e = new Date(sp.end);
    if (!Number.isNaN(e.getTime())) initialEnd = e;
  }

  return (
    <AppointmentFullEditor
      mode="create"
      initialStart={initialStart}
      initialEnd={initialEnd}
      clients={clients}
      typeOptions={typeOptions}
      productServiceOptions={productServiceOptions}
      googleConnected={Boolean(user.googleRefreshToken?.trim())}
      calendarOwnerLabel={user.name}
      timeZoneLabel={getAppTimezone()}
    />
  );
}
