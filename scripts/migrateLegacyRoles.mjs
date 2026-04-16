import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
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

  try {
    const db = client.db(dbName);
    const result = await db.collection("users").updateMany(
      { role: "user" },
      {
        $set: {
          role: "retail",
          updatedAt: new Date(),
        },
      },
    );

    console.log(`Migrated ${result.modifiedCount} user records from "user" to "retail".`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
