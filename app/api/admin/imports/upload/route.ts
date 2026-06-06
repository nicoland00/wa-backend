import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { uploadStreamToStorage } from "@/lib/storage";
import { objectIdSchema } from "@/lib/validators/common";
import type { ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export const runtime = "nodejs";

// Raw streaming upload — no body buffering, no size limit from Next.js.
// Frontend sends one file per request as raw binary body with metadata in query/headers.
export async function POST(request: NextRequest) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = request.nextUrl;
  const lotId = searchParams.get("lotId");
  if (!lotId || !objectIdSchema.safeParse(lotId).success) {
    return NextResponse.json({ error: "Valid lotId required" }, { status: 400 });
  }

  const filename = request.headers.get("x-filename") || "upload.mp4";
  const mimeType = request.headers.get("content-type") || "video/mp4";
  const sizeBytes = Number(request.headers.get("x-file-size") || "0") || null;

  if (!request.body) {
    return NextResponse.json({ error: "No body" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(lotId) });
  if (!lot) return NextResponse.json({ error: "Lot not found" }, { status: 404 });

  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
  if (!ranch) return NextResponse.json({ error: "Ranch not found" }, { status: 404 });

  // Tee the stream: one branch hashes, one branch uploads
  const [hashStream, uploadStream] = request.body.tee();

  // Compute sha256 while uploading
  const [stored, sha256] = await Promise.all([
    uploadStreamToStorage({ filename, stream: uploadStream, contentType: mimeType }),
    (async () => {
      const hash = createHash("sha256");
      const reader = hashStream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
      }
      return hash.digest("hex");
    })(),
  ]);

  const existing = await db.collection<ImportDoc>("imports").findOne({ sha256, lotId: new ObjectId(lotId) });
  if (existing) return NextResponse.json({ ok: true, skipped: true, id: existing._id.toString() });

  const now = new Date();
  const result = await db.collection<ImportDoc>("imports").insertOne({
    _id: new ObjectId(),
    ranchId: ranch._id,
    lotId: new ObjectId(lotId),
    animalId: null,
    source: "manual_upload",
    filename,
    mimeType,
    sizeBytes,
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

  return NextResponse.json({ ok: true, skipped: false, id: result.insertedId.toString() });
}
