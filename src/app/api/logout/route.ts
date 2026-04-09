import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { CRM_USER_COOKIE } from "@/lib/session-cookie";

export async function GET(req: Request) {
  const jar = await cookies();
  jar.delete(CRM_USER_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
