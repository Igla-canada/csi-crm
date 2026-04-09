/** Active line from GET /api/ringcentral/active-calls (live dock). */
export type ActiveDockCallSnapshot = {
  key: string;
  direction: string;
  phoneDigits: string;
  phoneDisplay: string;
  callerName: string | null;
};
