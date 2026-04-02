import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/server/audit";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { assignExistingRanchToUser } from "@/lib/server/ranches";
import { serializeRanch } from "@/lib/server/serializers";
import { syncRemoteRanchStructure } from "@/lib/server/sync";
import { ranchAssignSchema } from "@/lib/validators/ranches";

export async function POST(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = ranchAssignSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  try {
    const ranch = await assignExistingRanchToUser({
      ownerUserId: parsed.data.ownerUserId,
      ixorigueRanchId: parsed.data.ixorigueRanchId,
      adminUserId: actor.userId,
    });

    if (!ranch) {
      return NextResponse.json({ error: "Failed to assign ranch" }, { status: 500 });
    }

    await logAudit({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "admin.ranch.assign",
      target: { type: "ranch", id: ranch._id.toString() },
      after: ranch,
    });

    const sync = await syncRemoteRanchStructure(ranch);
    return NextResponse.json({ ranch: serializeRanch(ranch), sync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignment failed";
    const status = /not found/i.test(message) ? 404 : /conflict/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
