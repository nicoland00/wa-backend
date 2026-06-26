import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { captureDevicePings } from "@/lib/server/device-pings";
import { objectIdSchema } from "@/lib/validators/common";
import type { RanchDoc } from "@/lib/db/types";

export const maxDuration = 60;

// Manual "capture now" — lets an admin seed/refresh pings immediately so the
// timeline can be verified without waiting for the cron.
export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const parsedRanchId = objectIdSchema.safeParse(searchParams.get("ranchId"));
  if (!parsedRanchId.success) return NextResponse.json({ error: "Invalid ranchId" }, { status: 400 });

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedRanchId.data) });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  try {
    const result = await captureDevicePings(ranch);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
