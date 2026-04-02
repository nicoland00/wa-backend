import { getDb } from "@/lib/mongodb";

export async function enqueueJob(type: string, payload: Record<string, unknown>, delayMs = 0) {
  const db = await getDb();
  const now = new Date();

  await db.collection("jobs").insertOne({
    type,
    payload,
    status: "queued",
    runAt: new Date(now.getTime() + delayMs),
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}
