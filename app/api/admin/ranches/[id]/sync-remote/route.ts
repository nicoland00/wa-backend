import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";
import { syncRemoteRanchStructure } from "@/lib/server/sync";
import type { RanchDoc } from "@/lib/db/types";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid ranch id" }, { status: 400 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: new ObjectId(parsedId.data) });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  try {
    const summary = await syncRemoteRanchStructure(ranch);
    await logAudit({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "admin.ranch.sync_remote",
      target: { type: "ranch", id: ranch._id.toString() },
      after: summary,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote sync failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
