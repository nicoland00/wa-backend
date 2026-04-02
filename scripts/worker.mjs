import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient, ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

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

async function readLocalStorageBuffer(key) {
  const baseDir = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "tmp-storage");
  return fs.promises.readFile(path.join(baseDir, key));
}

async function processImportJob(db, job) {
  const importId = job.payload?.importId;
  if (!importId || !ObjectId.isValid(importId)) {
    throw new Error("Invalid importId payload");
  }

  const imp = await db.collection("imports").findOne({ _id: new ObjectId(importId) });
  if (!imp) {
    throw new Error("Import not found");
  }

  if (imp.status === "processed") {
    return;
  }

  await db.collection("imports").updateOne(
    { _id: imp._id },
    {
      $set: {
        status: "processing",
        error: null,
      },
    },
  );

  let zipBuffer;
  if (imp.storage.provider === "local") {
    zipBuffer = await readLocalStorageBuffer(imp.storage.key);
  } else {
    throw new Error("MVP worker supports local storage processing only");
  }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const txtArtifacts = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const name = entry.entryName;
    const data = entry.getData();

    if (name.endsWith(".txt") || name.endsWith(".json")) {
      const hash = createHash("sha256").update(data).digest("hex");
      txtArtifacts.push({
        kind: name.endsWith(".json") ? "messages_json" : "txt",
        key: `${imp.storage.key}::${name}::${hash}`,
        createdAt: new Date(),
      });
    }
  }

  await db.collection("imports").updateOne(
    { _id: imp._id },
    {
      $set: {
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      },
      $addToSet: {
        artifacts: { $each: txtArtifacts },
      },
    },
  );
}

async function workerLoop() {
  loadEnvLocal();

  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  const dbName = process.env.MONGODB_DB || "wa-backend";
  await client.connect();

  const db = client.db(dbName);

  console.log("Worker running...");

  while (true) {
    const now = new Date();

    const job = await db.collection("jobs").findOneAndUpdate(
      {
        status: "queued",
        runAt: { $lte: now },
      },
      {
        $set: { status: "running", updatedAt: now },
        $inc: { attempts: 1 },
      },
      {
        sort: { runAt: 1, createdAt: 1 },
        returnDocument: "after",
      },
    );

    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    try {
      if (job.type === "process_import") {
        await processImportJob(db, job);
      }

      await db.collection("jobs").updateOne(
        { _id: job._id },
        {
          $set: {
            status: "done",
            updatedAt: new Date(),
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = Number(job.attempts ?? 0) + 1;
      const shouldRetry = attempts < 5;

      await db.collection("jobs").updateOne(
        { _id: job._id },
        {
          $set: {
            status: shouldRetry ? "queued" : "failed",
            lastError: message,
            runAt: new Date(Date.now() + attempts * 60_000),
            updatedAt: new Date(),
          },
        },
      );

      if (!shouldRetry) {
        const importId = job.payload?.importId;
        if (importId && ObjectId.isValid(importId)) {
          await db.collection("imports").updateOne(
            { _id: new ObjectId(importId) },
            {
              $set: {
                status: "failed",
                error: message,
                updatedAt: new Date(),
              },
            },
          );
        }
      }
    }
  }
}

workerLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
