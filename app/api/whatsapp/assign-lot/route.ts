import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser, isAdmin } from "@/lib/server/auth";
import { enqueueJob } from "@/lib/server/jobs";

const schema = z.object({
  importId: z.string().regex(/^[a-f\d]{24}$/i),
  lotId: z.string().regex(/^[a-f\d]{24}$/i),
});

export async function POST(request: NextRequest) {
  const sessionUser = await requireSessionUser();
  const internalToken = request.headers.get("x-internal-token");
  const isInternal = Boolean(process.env.INTERNAL_API_TOKEN) && internalToken === process.env.INTERNAL_API_TOKEN;

  if (!isInternal) {
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdmin(sessionUser)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection("lots").findOne({ _id: new ObjectId(parsed.data.lotId) });

  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }

  const result = await db.collection("imports").updateOne(
    { _id: new ObjectId(parsed.data.importId), status: { $in: ["stored", "awaiting_lot"] } },
    {
      $set: {
        lotId: lot._id,
        ranchId: lot.ranchId ?? lot.farmId,
        farmId: lot.ranchId ?? lot.farmId,
        status: "assigned",
        assignedAt: new Date(),
      },
    },
  );

  if (!result.matchedCount) {
    return NextResponse.json({ error: "Import not assignable" }, { status: 400 });
  }

  await enqueueJob("process_import", { importId: parsed.data.importId });

  return NextResponse.json({ ok: true });
}
