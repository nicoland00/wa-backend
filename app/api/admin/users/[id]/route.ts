import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { serializeUser } from "@/lib/server/serializers";
import { adminUserPatchSchema } from "@/lib/validators/users";
import { objectIdSchema } from "@/lib/validators/common";
import type { UserDoc } from "@/lib/db/types";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = await getDb();
  const user = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(parsedId.data) });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ user: serializeUser(user) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const parsed = adminUserPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection<UserDoc>("users").findOne({ _id });
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.role && parsedId.data === actor.userId) {
    return NextResponse.json({ error: "Admins cannot change their own role." }, { status: 400 });
  }

  const patch = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  await db.collection<UserDoc>("users").updateOne({ _id }, { $set: patch });
  const after = await db.collection<UserDoc>("users").findOne({ _id });

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.user.patch",
    target: { type: "user", id: parsedId.data },
    before,
    after,
  });

  return NextResponse.json({ ok: true, user: after ? serializeUser(after) : null });
}
