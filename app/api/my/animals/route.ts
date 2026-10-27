import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireSessionUser } from "@/lib/server/auth";
import { enrichAnimals } from "@/lib/server/animal-history";
import type { AnimalDoc, RanchDoc } from "@/lib/db/types";

export async function GET() {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ ownerUserId: new ObjectId(user.userId) });
  if (!ranch) {
    return NextResponse.json({ animals: [] });
  }

  const animals = await db.collection<AnimalDoc>("animals").find({ ranchId: ranch._id }).sort({ createdAt: -1 }).toArray();

  const enriched = await enrichAnimals(db, animals);

  return NextResponse.json({ animals: enriched });
}
