import { NextResponse } from "next/server";
import { getRanches } from "@/lib/ixorigue/client";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";

export async function GET() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ranches = await getRanches();
  return NextResponse.json({ ranches });
}
