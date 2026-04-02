import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { objectIdSchema } from "@/lib/validators/common";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  ixorigueLotId: z.string().min(1).optional(),
  geometry: z.any().nullable().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ lotId: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedLot = objectIdSchema.safeParse(params.lotId);
  if (!parsedLot.success) {
    return NextResponse.json({ error: "Invalid lot id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedLot.data);
  const before = await db.collection("lots").findOne({ _id });

  await db.collection("lots").updateOne(
    { _id },
    {
      $set: {
        ...parsed.data,
        updatedAt: new Date(),
      },
    },
  );

  const after = await db.collection("lots").findOne({ _id });

  await logAudit({
    actorUserId: user.userId,
    actorRole: user.role,
    action: "admin.lot.patch",
    target: { type: "lot", id: parsedLot.data },
    before,
    after,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ lotId: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedLot = objectIdSchema.safeParse(params.lotId);
  if (!parsedLot.success) {
    return NextResponse.json({ error: "Invalid lot id" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedLot.data);
  const before = await db.collection("lots").findOne({ _id });
  await db.collection("lots").deleteOne({ _id });

  await logAudit({
    actorUserId: user.userId,
    actorRole: user.role,
    action: "admin.lot.delete",
    target: { type: "lot", id: parsedLot.data },
    before,
  });

  return NextResponse.json({ ok: true });
}
