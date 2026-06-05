/**
 * Uploads the 10 WhatsApp videos from the Desktop folder to MongoDB GridFS
 * and creates ImportDoc entries for the first available lot.
 *
 * Usage: node scripts/uploadVideos.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { createHash } from "node:crypto";
import { MongoClient, ObjectId, GridFSBucket } from "mongodb";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI in .env.local");

  const VIDEOS_DIR = path.join(os.homedir(), "Desktop", "wa-backend-video");

  if (!fs.existsSync(VIDEOS_DIR)) {
    throw new Error(`Videos folder not found: ${VIDEOS_DIR}`);
  }

  const videoFiles = fs.readdirSync(VIDEOS_DIR).filter((f) => f.endsWith(".mp4")).sort();
  if (!videoFiles.length) throw new Error("No .mp4 files found in the videos folder.");

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  // Use the database name from the URI (whatsappDB), or override with MONGODB_DB
  const db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
  const bucket = new GridFSBucket(db, { bucketName: "media" });

  const lot = await db.collection("lots").findOne({}, { sort: { createdAt: 1 } });
  if (!lot) throw new Error("No lots found in database. Create a lot first.");

  const ranch = await db.collection("ranches").findOne({ _id: lot.ranchId ?? lot.farmId });
  if (!ranch) throw new Error("Ranch not found for lot.");

  console.log(`\nUploading videos to MongoDB GridFS`);
  console.log(`Lot  : ${lot.name} (${lot._id})`);
  console.log(`Ranch: ${ranch.name}`);
  console.log(`Found: ${videoFiles.length} videos\n`);

  const now = new Date();
  let created = 0;

  for (const filename of videoFiles) {
    const filePath = path.join(VIDEOS_DIR, filename);
    const buffer = fs.readFileSync(filePath);
    const sizeBytes = buffer.length;
    const sha256 = createHash("sha256").update(buffer).digest("hex");

    const existing = await db.collection("imports").findOne({ sha256, lotId: lot._id });
    if (existing) {
      console.log(`  SKIP  ${filename} (already uploaded)`);
      continue;
    }

    const fileId = new ObjectId();
    await new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStreamWithId(fileId, filename, {
        contentType: "video/mp4",
      });
      uploadStream.on("finish", resolve);
      uploadStream.on("error", reject);
      uploadStream.end(buffer);
    });

    const storage = {
      provider: "gridfs",
      key: fileId.toString(),
      url: `/api/storage/gridfs/${fileId.toString()}`,
    };

    await db.collection("imports").insertOne({
      _id: new ObjectId(),
      ranchId: ranch._id,
      lotId: lot._id,
      animalId: null,
      source: "manual_upload",
      filename,
      mimeType: "video/mp4",
      sizeBytes,
      sha256,
      storage,
      artifacts: [],
      status: "stored",
      error: null,
      createdAt: now,
      assignedAt: null,
      processedAt: null,
      updatedAt: now,
    });

    created++;
    console.log(`  OK    ${filename} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
  }

  await client.close();
  console.log(`\nDone. ${created} video(s) uploaded, ${videoFiles.length - created} skipped.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
