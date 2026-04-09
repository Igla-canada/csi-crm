import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

import {
  AppointmentStatus,
  CallDirection,
  GoogleSyncStatus,
  ImportRowStatus,
  ImportStatus,
  OpportunityStatus,
  UserRole,
} from "../src/lib/db/enums";
import { tables as T } from "../src/lib/db/tables";

function id() {
  return randomUUID();
}

function now() {
  return new Date().toISOString();
}

async function clearPublicData(supabase: SupabaseClient) {
  const wipeId = async (table: string) => {
    const { error } = await supabase.from(table).delete().neq("id", "");
    if (error) throw error;
  };
  await wipeId(T.ImportRow);
  await wipeId(T.ImportBatch);
  await wipeId(T.PaymentEvent);
  await wipeId(T.Appointment);
  const { error: btoDel } = await supabase.from(T.BookingTypeOption).delete().neq("code", "");
  if (btoDel) throw btoDel;
  const { error: psDel } = await supabase.from(T.ProductServiceOption).delete().neq("code", "");
  if (psDel) throw psDel;
  const { error: lsoDel } = await supabase.from(T.LeadSourceOption).delete().neq("code", "");
  if (lsoDel) throw lsoDel;
  await wipeId(T.Opportunity);
  await wipeId(T.CallLog);
  await wipeId(T.AuditLog);
  await wipeId(T.ContactPoint);
  await wipeId(T.Vehicle);
  await wipeId(T.Client);
  const { error: optDel } = await supabase.from(T.CallResultOption).delete().neq("code", "");
  if (optDel) throw optDel;
  await wipeId(T.CalendarConfig);
  await wipeId(T.User);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  await clearPublicData(supabase);

  const { error: optErr } = await supabase.from(T.CallResultOption).insert([
    { code: "QUOTE_SENT", label: "Quote sent", sortOrder: 10, isBuiltIn: true, active: true, accentKey: "sky", accentHex: null, createdAt: now() },
    { code: "CALLBACK_NEEDED", label: "Callback needed", sortOrder: 20, isBuiltIn: true, active: true, accentKey: "amber", accentHex: null, createdAt: now() },
    { code: "BOOKED", label: "Book", sortOrder: 30, isBuiltIn: true, active: true, accentKey: "cyan", accentHex: null, createdAt: now() },
    { code: "SUPPORT", label: "Support", sortOrder: 40, isBuiltIn: true, active: true, accentKey: "violet", accentHex: null, createdAt: now() },
    { code: "NO_SOLUTION", label: "No solution", sortOrder: 50, isBuiltIn: true, active: true, accentKey: "rose", accentHex: null, createdAt: now() },
    { code: "COMPLETED", label: "Completed", sortOrder: 60, isBuiltIn: true, active: true, accentKey: "emerald", accentHex: null, createdAt: now() },
    { code: "ARCHIVED", label: "Archived", sortOrder: 65, isBuiltIn: true, active: true, accentKey: "slate", accentHex: null, createdAt: now() },
    { code: "FOLLOW_UP", label: "Follow up", sortOrder: 70, isBuiltIn: true, active: true, accentKey: "orange", accentHex: null, createdAt: now() },
  ]);
  if (optErr) throw optErr;

  const { error: btypeErr } = await supabase.from(T.BookingTypeOption).insert([
    { code: "INSTALL", label: "Install", sortOrder: 10, isBuiltIn: true, active: true, accentKey: "indigo", accentHex: null, createdAt: now() },
    { code: "INSPECTION", label: "Inspection", sortOrder: 20, isBuiltIn: true, active: true, accentKey: "sky", accentHex: null, createdAt: now() },
    { code: "SUPPORT", label: "Support", sortOrder: 30, isBuiltIn: true, active: true, accentKey: "violet", accentHex: null, createdAt: now() },
    { code: "QUOTE_VISIT", label: "Quote visit", sortOrder: 40, isBuiltIn: true, active: true, accentKey: "amber", accentHex: null, createdAt: now() },
    { code: "PHONE_CALL", label: "Phone call", sortOrder: 50, isBuiltIn: true, active: true, accentKey: "cyan", accentHex: null, createdAt: now() },
  ]);
  if (btypeErr) throw btypeErr;

  const { error: psErr } = await supabase.from(T.ProductServiceOption).insert([
    { code: "GENERAL", label: "General", matchTerms: "general,general inquiry,inquiry", sortOrder: 5, isBuiltIn: true, active: true, createdAt: now() },
    { code: "IGLA", label: "IGLA", matchTerms: "igla", sortOrder: 10, isBuiltIn: false, active: true, createdAt: now() },
    { code: "DASH_CAM", label: "Dash cam", matchTerms: "dash cam,dashcam,dash-cam", sortOrder: 15, isBuiltIn: false, active: true, createdAt: now() },
  ]);
  if (psErr) throw psErr;

  const { error: lsErr } = await supabase.from(T.LeadSourceOption).insert([
    { code: "GOOGLE", label: "Google", sortOrder: 10, isBuiltIn: true, active: true, createdAt: now() },
    { code: "REFERRAL", label: "Referral", sortOrder: 20, isBuiltIn: true, active: true, createdAt: now() },
    { code: "WALK_IN", label: "Walk-in", sortOrder: 30, isBuiltIn: true, active: true, createdAt: now() },
    { code: "WEBSITE", label: "Website", sortOrder: 40, isBuiltIn: true, active: true, createdAt: now() },
    { code: "SOCIAL", label: "Social media", sortOrder: 50, isBuiltIn: true, active: true, createdAt: now() },
    { code: "BOOKING", label: "Booking / calendar", sortOrder: 55, isBuiltIn: true, active: true, createdAt: now() },
    { code: "OTHER", label: "Other", sortOrder: 60, isBuiltIn: true, active: true, createdAt: now() },
  ]);
  if (lsErr) throw lsErr;

  const adminId = id();
  const managerId = id();
  const salesId = id();
  const techId = id();

  const { error: userErr } = await supabase.from(T.User).insert([
    { id: adminId, name: "Ronen Admin", email: "admin@carsystemscrm.local", role: UserRole.ADMIN, team: "Leadership", createdAt: now(), updatedAt: now() },
    { id: managerId, name: "Maya Manager", email: "manager@carsystemscrm.local", role: UserRole.MANAGER, team: "Operations", createdAt: now(), updatedAt: now() },
    { id: salesId, name: "Sam Sales", email: "sales@carsystemscrm.local", role: UserRole.SALES, team: "Front Desk", createdAt: now(), updatedAt: now() },
    { id: techId, name: "Leo Tech", email: "tech@carsystemscrm.local", role: UserRole.TECH, team: "Install Bay", createdAt: now(), updatedAt: now() },
  ]);
  if (userErr) throw userErr;

  const { error: calErr } = await supabase.from(T.CalendarConfig).insert({
    id: id(),
    calendarId: "shop-schedule@carsystemscrm.local",
    maxParallelBookings: 5,
    defaultDurationMins: 90,
    workingHoursJson: JSON.stringify({
      monday: ["09:00", "18:00"],
      tuesday: ["09:00", "18:00"],
      wednesday: ["09:00", "18:00"],
      thursday: ["09:00", "18:00"],
      friday: ["09:00", "17:00"],
      saturday: ["10:00", "15:00"],
    }),
    createdAt: now(),
    updatedAt: now(),
  });
  if (calErr) throw calErr;

  const zevId = id();
  const derekId = id();
  const satbirId = id();

  const { error: zcErr } = await supabase.from(T.Client).insert({
    id: zevId,
    displayName: "Zev",
    source: "Phone call",
    tags: "priority,new lead,radio issue",
    notes: "Wants clear follow-up notes and quick response times.",
    companyName: null,
    createdAt: now(),
    updatedAt: now(),
  });
  if (zcErr) throw zcErr;

  const zevVehId = id();
  await supabase.from(T.ContactPoint).insert({
    id: id(),
    clientId: zevId,
    kind: "PHONE",
    value: "6472671976",
    normalizedValue: "6472671976",
    isPrimary: true,
    createdAt: now(),
  });
  await supabase.from(T.Vehicle).insert({
    id: zevVehId,
    clientId: zevId,
    label: "2016 Dodge Caravan",
    year: 2016,
    make: "Dodge",
    model: "Caravan",
    trim: null,
    notes: null,
    createdAt: now(),
    updatedAt: now(),
  });
  await supabase.from(T.Opportunity).insert({
    id: id(),
    clientId: zevId,
    vehicleId: null,
    product: "GENERAL",
    status: OpportunityStatus.NEW,
    estimateText: null,
    summary: "Customer called about radio sensor issues.",
    source: "CSV import seed",
    createdAt: now(),
    updatedAt: now(),
  });

  const { error: dcErr } = await supabase.from(T.Client).insert({
    id: derekId,
    displayName: "Derek Chu",
    source: "Referral",
    tags: "vip,high value,igla,dash cam",
    notes: "Prefers texts for appointment reminders.",
    companyName: null,
    createdAt: now(),
    updatedAt: now(),
  });
  if (dcErr) throw dcErr;

  const derekVehId = id();
  await supabase.from(T.ContactPoint).insert([
    {
      id: id(),
      clientId: derekId,
      kind: "PHONE",
      value: "4166248972",
      normalizedValue: "4166248972",
      isPrimary: true,
      createdAt: now(),
    },
    {
      id: id(),
      clientId: derekId,
      kind: "EMAIL",
      value: "derek@example.com",
      normalizedValue: "derek@example.com",
      isPrimary: false,
      createdAt: now(),
    },
  ]);
  await supabase.from(T.Vehicle).insert({
    id: derekVehId,
    clientId: derekId,
    label: "2019 McLaren",
    year: 2019,
    make: "McLaren",
    model: "720S",
    trim: null,
    notes: null,
    createdAt: now(),
    updatedAt: now(),
  });
  await supabase.from(T.Opportunity).insert({
    id: id(),
    clientId: derekId,
    vehicleId: null,
    product: "IGLA",
    status: OpportunityStatus.BOOKED,
    estimateText: "$2000+tax",
    summary: "Interested in combined theft protection and dash cam package.",
    source: "Phone call",
    createdAt: now(),
    updatedAt: now(),
  });

  const { error: scErr } = await supabase.from(T.Client).insert({
    id: satbirId,
    displayName: "Satbir Singh",
    source: "Repeat customer",
    tags: "igla,callback",
    notes: null,
    companyName: null,
    createdAt: now(),
    updatedAt: now(),
  });
  if (scErr) throw scErr;

  const satbirVehId = id();
  await supabase.from(T.ContactPoint).insert([
    {
      id: id(),
      clientId: satbirId,
      kind: "PHONE",
      value: "6478940125",
      normalizedValue: "6478940125",
      isPrimary: true,
      createdAt: now(),
    },
    {
      id: id(),
      clientId: satbirId,
      kind: "EMAIL",
      value: "singh.satbir88@gmail.com",
      normalizedValue: "singh.satbir88@gmail.com",
      isPrimary: false,
      createdAt: now(),
    },
  ]);
  await supabase.from(T.Vehicle).insert({
    id: satbirVehId,
    clientId: satbirId,
    label: "2022 Cadillac Escalade",
    year: 2022,
    make: "Cadillac",
    model: "Escalade",
    trim: null,
    notes: null,
    createdAt: now(),
    updatedAt: now(),
  });
  await supabase.from(T.Opportunity).insert({
    id: id(),
    clientId: satbirId,
    vehicleId: null,
    product: "IGLA",
    status: OpportunityStatus.QUOTED,
    estimateText: "$1199+tax",
    summary: "Will call back to finalize install date.",
    source: "CSV import seed",
    createdAt: now(),
    updatedAt: now(),
  });

  await supabase.from(T.CallLog).insert([
    {
      id: id(),
      clientId: zevId,
      userId: salesId,
      direction: CallDirection.INBOUND,
      happenedAt: "2026-04-01T10:09:52.000Z",
      contactName: "Zev",
      summary: "Initial intake call for 2016 Dodge Caravan radio sensor issue.",
      outcomeCode: "FOLLOW_UP",
      contactPhone: "6472671976",
      vehicleText: "2016 Dodge Caravan",
      product: "GENERAL",
      callbackNotes: "Needs diagnosis slot this week.",
      source: "Phone call",
      internalNotes: "Needs diagnosis slot this week.",
      priceText: null,
      followUpAt: null,
      createdAt: now(),
    },
    {
      id: id(),
      clientId: derekId,
      userId: managerId,
      direction: CallDirection.OUTBOUND,
      happenedAt: "2026-03-23T14:05:14.000Z",
      contactName: "Derek Chu",
      summary: "Quoted IGLA and dash cam bundle, then texted appointment info.",
      outcomeCode: "BOOKED",
      contactPhone: "4166248972",
      vehicleText: "2019 McLaren",
      product: "IGLA",
      priceText: "$2000+tax",
      source: "Referral",
      internalNotes: "Premium install package, keep in concierge flow.",
      callbackNotes: null,
      followUpAt: null,
      createdAt: now(),
    },
    {
      id: id(),
      clientId: satbirId,
      userId: salesId,
      direction: CallDirection.OUTBOUND,
      happenedAt: "2026-03-31T12:52:02.000Z",
      contactName: "Satbir Singh",
      summary: "Sent IGLA pricing and noted customer will call back to book.",
      outcomeCode: "CALLBACK_NEEDED",
      contactPhone: "6478940125",
      vehicleText: "2022 Cadillac Escalade",
      product: "IGLA",
      priceText: "$1199+tax",
      callbackNotes: "Will call to book.",
      source: "Repeat customer",
      followUpAt: "2026-04-02T15:00:00.000Z",
      internalNotes: "Offer first available morning bay.",
      createdAt: now(),
    },
  ]);

  await supabase.from(T.Appointment).insert([
    {
      id: id(),
      clientId: derekId,
      vehicleId: derekVehId,
      createdById: managerId,
      title: "IGLA + Dash Cam Install",
      type: "INSTALL",
      status: AppointmentStatus.CONFIRMED,
      startAt: "2026-04-03T14:00:00.000Z",
      endAt: "2026-04-03T16:00:00.000Z",
      resourceKey: "bay-a",
      capacitySlot: "2026-04-03T14:00",
      googleEventId: "demo-google-event-1",
      googleSyncStatus: GoogleSyncStatus.PENDING,
      notes: "Customer requested premium waiting experience.",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: id(),
      clientId: zevId,
      vehicleId: zevVehId,
      createdById: salesId,
      title: "Vehicle inspection for radio sensor issue",
      type: "INSPECTION",
      status: AppointmentStatus.DRAFT,
      startAt: "2026-04-02T15:00:00.000Z",
      endAt: "2026-04-02T15:45:00.000Z",
      resourceKey: "diagnostics",
      capacitySlot: "2026-04-02T15:00",
      googleEventId: null,
      googleSyncStatus: GoogleSyncStatus.NOT_CONFIGURED,
      notes: "Hold slot until customer confirms.",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: id(),
      clientId: satbirId,
      vehicleId: satbirVehId,
      createdById: salesId,
      title: "Escalade IGLA install callback",
      type: "PHONE_CALL",
      status: AppointmentStatus.CONFIRMED,
      startAt: "2026-04-02T15:00:00.000Z",
      endAt: "2026-04-02T15:20:00.000Z",
      resourceKey: "front-desk",
      capacitySlot: "2026-04-02T15:00",
      googleEventId: null,
      googleSyncStatus: GoogleSyncStatus.NOT_CONFIGURED,
      notes: "Confirm vehicle pickup time and payment.",
      createdAt: now(),
      updatedAt: now(),
    },
  ]);

  const batchId = id();
  const csvText = [
    "Date,Time,Number,Name,Vehicle,Product,Price,Call backs,Extra comments,Found us through",
    "4/1/2026,10:09:52 AM,6472671976,Zev,2016 Dodge caravan,Radio Sensor,,,",
    "3/23/2026,2:05:14 PM,4166248972,DEREK CHU,2019 MCLAREN,IGLA/Dash cam,$2000+tax,,",
    "3/31/2026,12:52:02 PM,6478940125,SATBIR SINGH,2022 Cadillac Escalade,IGLA,$1199+tax,WILL CALL TO BOOK,",
  ].join("\n");

  await supabase.from(T.ImportBatch).insert({
    id: batchId,
    uploadedById: adminId,
    fileName: "Car Systems Calls - New Calls.csv",
    rowCount: 3,
    importedCount: 2,
    reviewCount: 1,
    status: ImportStatus.PARTIAL,
    originalCsvText: csvText,
    createdAt: now(),
  });

  await supabase.from(T.ImportRow).insert([
    {
      id: id(),
      batchId,
      matchedClientId: zevId,
      rowNumber: 1,
      normalizedPhone: "6472671976",
      status: ImportRowStatus.IMPORTED,
      warning: null,
      rawJson: JSON.stringify({ name: "Zev", vehicle: "2016 Dodge caravan", product: "Radio Sensor" }),
      createdAt: now(),
    },
    {
      id: id(),
      batchId,
      matchedClientId: derekId,
      rowNumber: 2,
      normalizedPhone: "4166248972",
      status: ImportRowStatus.IMPORTED,
      warning: null,
      rawJson: JSON.stringify({ name: "DEREK CHU", vehicle: "2019 MCLAREN", product: "IGLA/Dash cam" }),
      createdAt: now(),
    },
    {
      id: id(),
      batchId,
      matchedClientId: satbirId,
      rowNumber: 3,
      normalizedPhone: "6478940125",
      status: ImportRowStatus.REVIEW,
      warning: "Customer exists, but callback details should be reviewed before overwriting.",
      rawJson: JSON.stringify({
        name: "SATBIR SINGH",
        vehicle: "2022 Cadillac Escalade",
        product: "IGLA",
        callback: "WILL CALL TO BOOK",
      }),
      createdAt: now(),
    },
  ]);

  await supabase.from(T.AuditLog).insert([
    {
      id: id(),
      userId: adminId,
      action: "seeded_demo_data",
      targetType: "workspace",
      targetId: null,
      detailsJson: JSON.stringify({ clients: 3, appointments: 3 }),
      createdAt: now(),
    },
    {
      id: id(),
      userId: managerId,
      action: "configured_capacity_rule",
      targetType: "calendar_config",
      targetId: null,
      detailsJson: JSON.stringify({ maxParallelBookings: 5 }),
      createdAt: now(),
    },
  ]);

  console.log("Database seeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
