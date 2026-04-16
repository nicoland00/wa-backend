import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { canViewAdminScreens } from "@/lib/permissions";
import { requireSessionUser } from "@/lib/server/auth";
import { serializeRanch } from "@/lib/server/serializers";
import type { AnimalDoc, LotDoc, RanchDoc, UserDoc } from "@/lib/db/types";

export async function GET() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = await getDb();
  const ranches = await db.collection<RanchDoc>("ranches").find({}).sort({ updatedAt: -1 }).toArray();
  const ranchIds = ranches.map((ranch) => ranch._id);

  const [users, lots, animals] = await Promise.all([
    db.collection<UserDoc>("users").find({ _id: { $in: ranches.map((ranch) => ranch.ownerUserId) } }).toArray(),
    ranchIds.length ? db.collection<LotDoc>("lots").find({ ranchId: { $in: ranchIds } }).toArray() : Promise.resolve([] as LotDoc[]),
    ranchIds.length ? db.collection<AnimalDoc>("animals").find({ ranchId: { $in: ranchIds } }).toArray() : Promise.resolve([] as AnimalDoc[]),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const lotCounts = new Map<string, number>();
  const animalCounts = new Map<string, number>();

  for (const lot of lots) {
    const key = lot.ranchId.toString();
    lotCounts.set(key, (lotCounts.get(key) ?? 0) + 1);
  }

  for (const animal of animals) {
    const key = animal.ranchId.toString();
    animalCounts.set(key, (animalCounts.get(key) ?? 0) + 1);
  }

  return NextResponse.json({
    ranches: ranches.map((ranch) => ({
      ...serializeRanch(ranch),
      owner: userById.get(ranch.ownerUserId.toString())
        ? {
            _id: userById.get(ranch.ownerUserId.toString())?._id.toString(),
            email: userById.get(ranch.ownerUserId.toString())?.email ?? null,
            name: userById.get(ranch.ownerUserId.toString())?.name ?? null,
          }
        : null,
      lotCount: lotCounts.get(ranch._id.toString()) ?? 0,
      animalCount: animalCounts.get(ranch._id.toString()) ?? 0,
    })),
  });
}
