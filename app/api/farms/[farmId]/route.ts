import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  ixorigueRanchId: z.string().min(1).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected"]).optional(),
  rejectionReason: z.string().nullable().optional(),
});

export async function GET(_: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.farmId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid farm id" }, { status: 400 });
  }

  const db = await getDb();
  const farm = await db.collection("farms").findOne({ _id: new ObjectId(parsedId.data) });
  if (!farm) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const owns = farm.ownerUserId.toString() === user.userId;
  if (!isAdmin(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ...farm,
    _id: farm._id.toString(),
    ownerUserId: farm.ownerUserId.toString(),
  });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.farmId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid farm id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection("farms").findOne({ _id });

  await db.collection("farms").updateOne({ _id }, { $set: { ...parsed.data, updatedAt: new Date() } });
  const after = await db.collection("farms").findOne({ _id });

  await logAudit({
    actorUserId: user.userId,
    actorRole: user.role,
    action: "admin.farm.patch",
    target: { type: "farm", id: parsedId.data },
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}
