import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { serializeDataErrorRequest } from "@/lib/server/serializers";
import type { DataErrorRequestDoc } from "@/lib/db/types";

export async function GET() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDb();
  const requests = await db.collection<DataErrorRequestDoc>("data_error_requests").find({}).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ requests: requests.map(serializeDataErrorRequest) });
}
