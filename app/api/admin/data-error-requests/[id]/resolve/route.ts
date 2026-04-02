import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";
import { resolveDataErrorRequestSchema } from "@/lib/validators/data-error-requests";
import type { DataErrorRequestDoc } from "@/lib/db/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }

  const parsed = resolveDataErrorRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection<DataErrorRequestDoc>("data_error_requests").findOne({ _id });
  if (!before) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db.collection<DataErrorRequestDoc>("data_error_requests").updateOne(
    { _id },
    {
      $set: {
        status: parsed.data.status,
        resolvedByAdminUserId: new ObjectId(actor.userId),
        resolvedAt: new Date(),
      },
    },
  );

  const after = await db.collection<DataErrorRequestDoc>("data_error_requests").findOne({ _id });
  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.data_error_request.resolve",
    target: { type: "data_error_request", id: parsedId.data },
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
