import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";

const schema = z.object({
  decision: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.farmId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid farm id" }, { status: 400 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection("farms").findOne({ _id });

  const now = new Date();
  const update = parsed.data.decision === "approved"
    ? {
        status: "approved",
        approvedAt: now,
        approvedByUserId: new ObjectId(actor.userId),
        rejectedAt: null,
        rejectedByUserId: null,
        rejectionReason: null,
        updatedAt: now,
      }
    : {
        status: "rejected",
        rejectedAt: now,
        rejectedByUserId: new ObjectId(actor.userId),
        rejectionReason: parsed.data.rejectionReason ?? "Rejected by admin",
        approvedAt: null,
        approvedByUserId: null,
        updatedAt: now,
      };

  const result = await db.collection("farms").updateOne({ _id, status: "pending" }, { $set: update });
  if (!result.matchedCount) {
    return NextResponse.json({ error: "Pending farm not found" }, { status: 404 });
  }

  const after = await db.collection("farms").findOne({ _id });
  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: `admin.farm.${parsed.data.decision}`,
    target: { type: "farm", id: parsedId.data },
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
