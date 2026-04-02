import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { objectIdSchema } from "@/lib/validators/common";

export async function POST(_: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isAdmin(user)) {
    return NextResponse.json({ error: "Admins cannot use this endpoint" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.farmId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid farm id" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);

  const result = await db.collection("farms").updateOne(
    {
      _id,
      ownerUserId: new ObjectId(user.userId),
      status: "draft",
      lotsLockedAt: null,
    },
    {
      $set: {
        status: "pending",
        submittedAt: new Date(),
        lotsLockedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );

  if (!result.matchedCount) {
    return NextResponse.json({ error: "Farm not found or not submittable" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
