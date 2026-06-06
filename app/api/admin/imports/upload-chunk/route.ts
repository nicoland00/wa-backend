import { NextRequest, NextResponse } from "next/server";
import { Binary, ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { uploadBufferToStorage } from "@/lib/storage";
import { objectIdSchema } from "@/lib/validators/common";
import type { ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";
import type { Collection } from "mongodb";

export const runtime = "nodejs";

// Receives one small chunk of a video at a time so each HTTP request stays well
// under any proxy/platform body-size limit (Vercel 4.5MB, nginx default 1MB).
// Chunks are buffered in a temp collection and assembled into GridFS once the
// final chunk arrives. This is the only way to push large files through hosts
// that cap request bodies upstream of the app.

type ChunkDoc = {
  _id: ObjectId;
  uploadId: string;
  index: number;
  total: number;
  data: Binary;
  createdAt: Date;
};

let indexesEnsured = false;
async function ensureIndexes(chunks: Collection<ChunkDoc>) {
  if (indexesEnsured) return;
  // Abandoned uploads self-clean after an hour; index speeds assembly/dedupe.
  await chunks.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  await chunks.createIndex({ uploadId: 1, index: 1 }, { unique: true });
  indexesEnsured = true;
}

export async function POST(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = request.nextUrl;
  const uploadId = searchParams.get("uploadId") ?? "";
  const lotId = searchParams.get("lotId") ?? "";
  const index = Number(searchParams.get("index"));
  const total = Number(searchParams.get("total"));

  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId)) {
    return NextResponse.json({ error: "Invalid uploadId" }, { status: 400 });
  }
  if (!objectIdSchema.safeParse(lotId).success) {
    return NextResponse.json({ error: "Valid lotId required" }, { status: 400 });
  }
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total <= 0 || index >= total) {
    return NextResponse.json({ error: "Invalid chunk index/total" }, { status: 400 });
  }

  const filename = decodeURIComponent(request.headers.get("x-filename") || "upload.mp4");
  const mimeType = request.headers.get("x-file-type") || "video/mp4";
  const fileSize = Number(request.headers.get("x-file-size") || "0") || null;

  const body = Buffer.from(await request.arrayBuffer());
  if (!body.length) return NextResponse.json({ error: "Empty chunk" }, { status: 400 });

  const db = await getDb();
  const chunks = db.collection<ChunkDoc>("upload_chunks");
  await ensureIndexes(chunks);

  await chunks.updateOne(
    { uploadId, index },
    { $set: { uploadId, index, total, data: new Binary(body), createdAt: new Date() } },
    { upsert: true },
  );

  // More chunks still coming — just acknowledge this one.
  if (index < total - 1) {
    return NextResponse.json({ ok: true, completed: false });
  }

  // Final chunk: make sure every piece arrived before assembling.
  const have = await chunks.countDocuments({ uploadId });
  if (have < total) {
    return NextResponse.json({ ok: true, completed: false, waiting: total - have });
  }

  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(lotId) });
  if (!lot) {
    await chunks.deleteMany({ uploadId });
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
  if (!ranch) {
    await chunks.deleteMany({ uploadId });
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }

  const all = await chunks.find({ uploadId }).sort({ index: 1 }).toArray();
  const buffer = Buffer.concat(all.map((c) => Buffer.from(c.data.buffer)));
  await chunks.deleteMany({ uploadId });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const existing = await db.collection<ImportDoc>("imports").findOne({ sha256, lotId: new ObjectId(lotId) });
  if (existing) {
    return NextResponse.json({ ok: true, completed: true, skipped: true, id: existing._id.toString() });
  }

  const stored = await uploadBufferToStorage({ filename, buffer, contentType: mimeType });

  const now = new Date();
  const result = await db.collection<ImportDoc>("imports").insertOne({
    _id: new ObjectId(),
    ranchId: ranch._id,
    lotId: new ObjectId(lotId),
    animalId: null,
    source: "manual_upload",
    filename,
    mimeType,
    sizeBytes: fileSize ?? buffer.length,
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

  return NextResponse.json({ ok: true, completed: true, skipped: false, id: result.insertedId.toString() });
}
