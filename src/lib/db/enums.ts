/** PostgreSQL enum string values used by the CRM schema. */

export const UserRole = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  SALES: "SALES",
  TECH: "TECH",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const CallDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

export const OpportunityStatus = {
  NEW: "NEW",
  QUOTED: "QUOTED",
  BOOKED: "BOOKED",
  WON: "WON",
  LOST: "LOST",
  SUPPORT: "SUPPORT",
} as const;
export type OpportunityStatus = (typeof OpportunityStatus)[keyof typeof OpportunityStatus];

export const AppointmentStatus = {
  DRAFT: "DRAFT",
  CONFIRMED: "CONFIRMED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;

export const GoogleSyncStatus = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
} as const;

export const ImportStatus = {
  DRAFT: "DRAFT",
  IMPORTED: "IMPORTED",
  PARTIAL: "PARTIAL",
} as const;

export const ImportRowStatus = {
  IMPORTED: "IMPORTED",
  SKIPPED: "SKIPPED",
  REVIEW: "REVIEW",
} as const;
