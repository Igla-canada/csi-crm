import { updateShopCalendarConfigAction } from "@/app/actions";

type ShopCalendarDefaultsFormProps = {
  calendarId: string;
  defaultDurationMins: number;
  maxParallelBookings: number;
  canEdit: boolean;
};

export function ShopCalendarDefaultsForm({
  calendarId,
  defaultDurationMins,
  maxParallelBookings,
  canEdit,
}: ShopCalendarDefaultsFormProps) {
  if (!canEdit) {
    return (
      <div className="space-y-2 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">Calendar ID:</span> {calendarId || "—"}
        </p>
        <p>
          <span className="font-medium text-slate-800">Default duration:</span> {defaultDurationMins} minutes
        </p>
        <p>
          <span className="font-medium text-slate-800">Parallel bookings per slot:</span> {maxParallelBookings}
        </p>
        <p className="text-xs text-slate-500">Only an administrator can edit these defaults.</p>
      </div>
    );
  }

  return (
    <form action={updateShopCalendarConfigAction} className="space-y-4">
      <div>
        <label htmlFor="shop-calendar-id" className="mb-1 block text-xs font-medium text-slate-600">
          Shop calendar ID
        </label>
        <input
          id="shop-calendar-id"
          name="calendarId"
          type="text"
          required
          minLength={2}
          defaultValue={calendarId}
          placeholder="shop@group.calendar.google.com"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">Used as the default target for CRM bookings when syncing.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="default-duration" className="mb-1 block text-xs font-medium text-slate-600">
            Default duration (minutes)
          </label>
          <input
            id="default-duration"
            name="defaultDurationMins"
            type="number"
            required
            min={15}
            max={480}
            step={5}
            defaultValue={defaultDurationMins}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div>
          <label htmlFor="max-parallel" className="mb-1 block text-xs font-medium text-slate-600">
            Max parallel bookings per slot
          </label>
          <input
            id="max-parallel"
            name="maxParallelBookings"
            type="number"
            required
            min={1}
            max={50}
            defaultValue={maxParallelBookings}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          />
        </div>
      </div>
      <button
        type="submit"
        className="rounded-xl bg-[#1e5ea8] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17497f]"
      >
        Save calendar defaults
      </button>
    </form>
  );
}
