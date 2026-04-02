import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";

const schema = z.object({
  userId: objectIdSchema,
  decision: z.enum(["approved", "rejected"]),
});

export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const targetId = new ObjectId(parsed.data.userId);

  const before = await db.collection("users").findOne({ _id: targetId });

  const result = await db.collection("users").updateOne(
    { _id: targetId, phoneStatus: "pending" },
    { $set: { phoneStatus: parsed.data.decision, updatedAt: new Date() } },
  );

  if (!result.matchedCount) {
    return NextResponse.json({ error: "Pending phone request not found" }, { status: 404 });
  }

  const after = await db.collection("users").findOne({ _id: targetId });

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: `admin.phone.${parsed.data.decision}`,
    target: { type: "user", id: parsed.data.userId },
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
