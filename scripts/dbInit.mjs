import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";

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

  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI");
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  const dbName = process.env.MONGODB_DB || "wa-backend";

  await client.connect();
  const db = client.db(dbName);
  const animalIndexes = await db.collection("animals").indexes();
  const legacyAnimalRemoteIndex = animalIndexes.find((index) => index.name === "ixorigueAnimalId_1");
  if (legacyAnimalRemoteIndex) {
    await db.collection("animals").dropIndex("ixorigueAnimalId_1");
  }

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ phoneE164: 1 }, { unique: true, partialFilterExpression: { phoneE164: { $type: "string" } } });

  await db.collection("ranches").createIndex({ ownerUserId: 1 }, { unique: true });
  await db.collection("ranches").createIndex({ ixorigueRanchId: 1 }, { unique: true, partialFilterExpression: { ixorigueRanchId: { $type: "string" } } });

  await db.collection("lots").createIndex({ ranchId: 1, name: 1 }, { unique: true });
  await db.collection("lots").createIndex({ ranchId: 1, ixorigueLotId: 1 }, { unique: true, partialFilterExpression: { ixorigueLotId: { $type: "string" } } });

  await db.collection("animals").createIndex({ ranchId: 1, ixorigueAnimalId: 1 }, { unique: true, partialFilterExpression: { ixorigueAnimalId: { $type: "string" } } });
  await db.collection("animals").createIndex({ lotId: 1 });
  await db.collection("animals").createIndex({ ranchId: 1 });

  await db.collection("animal_weights").createIndex({ animalId: 1, measuredAt: -1 });

  await db.collection("imports").createIndex({ lotId: 1, createdAt: -1 });
  await db.collection("imports").createIndex({ status: 1, createdAt: -1 });
  await db.collection("imports").createIndex({ "wa.waMessageId": 1 }, { unique: true, partialFilterExpression: { "wa.waMessageId": { $type: "string" } } });

  await db.collection("wa_sessions").createIndex({ phoneE164: 1 }, { unique: true });
  await db.collection("wa_sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  await db.collection("data_error_requests").createIndex({ reportedByUserId: 1, createdAt: -1 });
  await db.collection("sync_jobs").createIndex({ status: 1, createdAt: 1 });
  await db.collection("audit_logs").createIndex({ actorUserId: 1, createdAt: -1 });
  await db.collection("audit_logs").createIndex({ "target.type": 1, "target.id": 1, createdAt: -1 });

  await db.collection("integration_credentials").createIndex({ key: 1 }, { unique: true });
  await db.collection("jobs").createIndex({ status: 1, runAt: 1 });

  console.log("Indexes initialized");
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
