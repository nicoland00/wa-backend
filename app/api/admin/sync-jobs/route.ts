import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { serializeSyncJob } from "@/lib/server/serializers";
import type { SyncJobDoc } from "@/lib/db/types";

export async function GET() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDb();
  const jobs = await db.collection<SyncJobDoc>("sync_jobs").find({}).sort({ createdAt: -1 }).limit(200).toArray();
  return NextResponse.json({ syncJobs: jobs.map(serializeSyncJob) });
}
