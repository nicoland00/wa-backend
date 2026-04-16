import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { serializeUser } from "@/lib/server/serializers";
import { adminUserCreateSchema } from "@/lib/validators/users";
import type { UserDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(user)) {
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
  return NextResponse.json(
    {
      error: "Manual user creation is disabled. Users are created automatically the first time they sign in with Google.",
      suggestedRole: parsed.data.role,
    },
    { status: 410 },
  );
}
