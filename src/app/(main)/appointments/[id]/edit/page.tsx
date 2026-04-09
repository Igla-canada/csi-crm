import { AppointmentFullEditor } from "@/components/appointment-full-editor";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppointmentForEditor,
  getAppointmentFormClients,
  getBookingTypeOptions,
  listPaymentEventsForAppointment,
} from "@/lib/crm";
import { getAppTimezone } from "@/lib/google-calendar/env";
import { getUserCapabilities } from "@/lib/user-privileges";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditAppointmentPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  const caps = getUserCapabilities(user);
  const apt = await getAppointmentForEditor(id);
  if (!caps.canEditAppointments || !apt) {
    notFound();
  }
  const [clients, bookingTypes, paymentEvents] = await Promise.all([
    getAppointmentFormClients(),
    getBookingTypeOptions(true),
    listPaymentEventsForAppointment(id),
  ]);

  const typeOptions = bookingTypes.map((o) => ({ code: o.code as string, label: String(o.label) }));
  const linkedClient = clients.find((c) => c.id === apt.clientId);
  const initialClientPhone = linkedClient?.phones[0]?.value ?? "";

  return (
    <AppointmentFullEditor
      mode="edit"
      appointment={apt}
      initialStart={apt.startAt}
      initialEnd={apt.endAt}
      initialClientPhone={initialClientPhone}
      clients={clients}
      typeOptions={typeOptions}
      googleConnected={Boolean(user.googleRefreshToken?.trim())}
      calendarOwnerLabel={user.name}
      timeZoneLabel={getAppTimezone()}
      paymentEvents={paymentEvents}
      canRecordPayments={caps.canEditAppointments}
    />
  );
}
