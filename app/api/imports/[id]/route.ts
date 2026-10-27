import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { canViewAdminScreens } from "@/lib/permissions";
import { deleteStoredFile, getSignedDownloadUrl } from "@/lib/storage";
import { lockVideoImport, preserveVideoWeight, removeAnimalVideoReferences, unlockVideoImport } from "@/lib/server/animal-updates";
import { logAudit } from "@/lib/server/audit";
import { enrichImports } from "@/lib/server/import-history";
import { objectIdSchema } from "@/lib/validators/common";
import type { ImportDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  }

  const db = await getDb();
  const item = await db.collection<ImportDoc>("imports").findOne({ _id: new ObjectId(parsedId.data) });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: item.ranchId ?? item.farmId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const owns = ranch.ownerUserId.toString() === user.userId;
  if (!canViewAdminScreens(user) && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const downloadUrl = await getSignedDownloadUrl(item.storage);

  return NextResponse.json({
    ...(await enrichImports(db, [item]))[0],
    downloadUrl,
  });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
  const db = await getDb();
  const importId = new ObjectId(id);
  const existing = await db.collection<ImportDoc>("imports").findOne({ _id: importId });
  if (!existing) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  const lock = await lockVideoImport(db, importId);
  if (!lock) return NextResponse.json({ error: "Este vídeo se está actualizando. Inténtalo de nuevo." }, { status: 409 });
  try {
    // Do not remove shared bytes while another import still references them.
    const sharedFile = await db.collection<ImportDoc>("imports").findOne({
      _id: { $ne: importId }, "storage.key": existing.storage.key, "storage.provider": existing.storage.provider,
    });
    if (!sharedFile) await deleteStoredFile(existing.storage);
    await removeAnimalVideoReferences(db, lock.item);
    await preserveVideoWeight(db, lock.item);
    await db.collection<ImportDoc>("imports").deleteOne({ _id: importId, mutationToken: lock.token });
    await logAudit({ actorUserId: user.userId, actorRole: user.role, action: "admin.video.delete", target: { type: "import", id }, before: existing });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se ha podido eliminar el vídeo. Inténtalo de nuevo." }, { status: 500 });
  } finally {
    await unlockVideoImport(db, importId, lock.token);
  }
}
