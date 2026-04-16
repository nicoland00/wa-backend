import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { normalizeRole } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { e164Schema } from "@/lib/validators/common";

const bodySchema = z.object({
  phoneE164: e164Schema,
});

export async function POST(request: NextRequest) {
  const sessionUser = await requireSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  const db = await getDb();

  await db.collection("users").updateOne(
    { email: sessionUser.email },
    {
      $set: {
        phoneE164: parsed.data.phoneE164,
        phoneStatus: "pending",
        updatedAt: new Date(),
      },
    },
  );

  const updated = await db.collection("users").findOne({ email: sessionUser.email });
  return NextResponse.json({
    userId: updated?._id.toString(),
    email: updated?.email,
    name: updated?.name,
    role: normalizeRole(updated?.role),
    phoneE164: updated?.phoneE164,
    phoneStatus: updated?.phoneStatus,
  });
}
