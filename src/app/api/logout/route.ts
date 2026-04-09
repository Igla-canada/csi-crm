import { NextResponse } from "next/server";

import { CRM_USER_COOKIE } from "@/lib/crm-user-constants";

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(CRM_USER_COOKIE);
  return res;
}
