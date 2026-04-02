import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { serializeUser } from "@/lib/server/serializers";
import { adminUserCreateSchema } from "@/lib/validators/users";
import type { UserDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDb();
  const users = await db.collection<UserDoc>("users").find({}).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ users: users.map(serializeUser) });
}

export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = adminUserCreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date();
  const result = await db.collection<UserDoc>("users").insertOne({
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    phoneE164: parsed.data.phoneE164 ?? null,
    phoneStatus: parsed.data.phoneE164 ? "approved" : "none",
    ixorigueUserId: null,
    createdAt: now,
    updatedAt: now,
  } as UserDoc);

  const created = await db.collection<UserDoc>("users").findOne({ _id: result.insertedId });
  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.user.create",
    target: { type: "user", id: result.insertedId.toString() },
    after: created,
  });

  return NextResponse.json({ user: created ? serializeUser(created) : null }, { status: 201 });
}
