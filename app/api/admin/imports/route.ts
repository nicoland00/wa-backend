import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { uploadBufferToStorage } from "@/lib/storage";
import { objectIdSchema } from "@/lib/validators/common";
import type { ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const lotId = formData.get("lotId");
  if (!lotId || typeof lotId !== "string" || !objectIdSchema.safeParse(lotId).success) {
    return NextResponse.json({ error: "Valid lotId required" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(lotId) });
  if (!lot) return NextResponse.json({ error: "Lot not found" }, { status: 404 });

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  const files = formData.getAll("files");
  const videoFiles = files.filter((f): f is File => f instanceof File && f.size > 0);
  if (!videoFiles.length) return NextResponse.json({ error: "No video files provided" }, { status: 400 });

  const now = new Date();
  const created: string[] = [];

  for (const file of videoFiles) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const existing = await db.collection<ImportDoc>("imports").findOne({ sha256, lotId: new ObjectId(lotId) });
    if (existing) continue;

    const stored = await uploadBufferToStorage({
      filename: file.name,
      buffer,
      contentType: file.type || "video/mp4",
    });

    const result = await db.collection<ImportDoc>("imports").insertOne({
      _id: new ObjectId(),
      ranchId: ranch._id,
      lotId: new ObjectId(lotId),
      animalId: null,
      source: "manual_upload",
      filename: file.name,
      mimeType: file.type || "video/mp4",
      sizeBytes: file.size,
      sha256,
      storage: stored,
      artifacts: [],
      status: "stored",
      error: null,
      createdAt: now,
      assignedAt: null,
      processedAt: null,
      updatedAt: now,
    } as ImportDoc);

    created.push(result.insertedId.toString());
  }

  return NextResponse.json({ ok: true, created: created.length, skipped: videoFiles.length - created.length });
}
