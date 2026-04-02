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
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
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
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("Usage: node scripts/makeAdmin.mjs someone@gmail.com");
    process.exit(1);
  }

  loadEnvLocal();

  const mongoUri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "wa-backend";

  if (!mongoUri) {
    console.error("Missing MONGODB_URI. Add it to .env.local or environment.");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();

    const db = client.db(dbName);
    const now = new Date();

    const result = await db.collection("users").updateOne(
      { email },
      {
        $set: {
          role: "admin",
          updatedAt: now,
        },
        $setOnInsert: {
          email,
          name: null,
          phoneE164: null,
          phoneStatus: "none",
          createdAt: now,
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      console.log(`Created and promoted admin: ${email}`);
    } else {
      console.log(`Promoted existing user to admin: ${email}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
