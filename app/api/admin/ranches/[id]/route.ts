import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { logAudit } from "@/lib/server/audit";
import { deleteLocalRanchCascade, getAdminRanchDetails } from "@/lib/server/ranches";
import { serializeAnimal, serializeImport, serializeLot, serializeRanch, serializeUser } from "@/lib/server/serializers";
import { syncRanchUpdate } from "@/lib/server/sync";
import { objectIdSchema } from "@/lib/validators/common";
import { ranchPatchSchema } from "@/lib/validators/ranches";
import type { RanchDoc } from "@/lib/db/types";

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
    return NextResponse.json({ error: "Invalid ranch id" }, { status: 400 });
  }

  const details = await getAdminRanchDetails(parsedId.data);
  if (!details) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  return NextResponse.json({
    ranch: serializeRanch(details.ranch),
    owner: details.owner ? serializeUser(details.owner) : null,
    lots: details.lots.map(serializeLot),
    animals: details.animals.map(serializeAnimal),
    imports: details.imports.map(serializeImport),
    lotSummaries: details.lotSummaries.map((summary) => ({
      lot: serializeLot(summary.lot),
      animalCount: summary.animalCount,
      animals: summary.animals.map(serializeAnimal),
    })),
  });
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
    return NextResponse.json({ error: "Invalid ranch id" }, { status: 400 });
  }

  const parsed = ranchPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  const db = await getDb();
  const _id = new ObjectId(parsedId.data);
  const before = await db.collection<RanchDoc>("ranches").findOne({ _id });
  if (!before) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  await db.collection<RanchDoc>("ranches").updateOne({ _id }, { $set: { ...parsed.data, updatedAt: new Date() } });
  const after = await db.collection<RanchDoc>("ranches").findOne({ _id });
  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.ranch.update",
    target: { type: "ranch", id: parsedId.data },
    before,
    after,
  });

  if (after) {
    await syncRanchUpdate(after);
  }

  const refreshed = await db.collection<RanchDoc>("ranches").findOne({ _id });
  return NextResponse.json({ ranch: refreshed ? serializeRanch(refreshed) : null });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Invalid ranch id" }, { status: 400 });
  }

  const result = await deleteLocalRanchCascade(parsedId.data);
  if (!result) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  await logAudit({
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: "admin.ranch.delete_local",
    target: { type: "ranch", id: parsedId.data },
    before: result.ranch,
    after: result.summary,
  });

  return NextResponse.json({ ok: true, summary: result.summary });
}
