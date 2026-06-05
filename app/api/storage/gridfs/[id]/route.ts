import { NextRequest, NextResponse } from "next/server";
import { GridFSBucket, ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const { id } = params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  const db = await getDb();
  const bucket = new GridFSBucket(db, { bucketName: "media" });
  const fileId = new ObjectId(id);

  const files = await bucket.find({ _id: fileId }).toArray();
  if (!files.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = files[0];
  const fileSize = file.length;
  const contentType = (file.metadata?.["contentType"] as string | undefined) ?? "application/octet-stream";
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = bucket.openDownloadStream(fileId, { start, end: end + 1 });
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    return new NextResponse(Buffer.concat(chunks), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
      },
    });
  }

  const stream = bucket.openDownloadStream(fileId);
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  return new NextResponse(Buffer.concat(chunks), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${file.filename}"`,
    },
  });
}
