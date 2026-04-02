import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { serializeAnimal, serializeImport, serializeLot } from "@/lib/server/serializers";
import { objectIdSchema } from "@/lib/validators/common";
import type { AnimalDoc, ImportDoc, LotDoc, RanchDoc } from "@/lib/db/types";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const parsedId = objectIdSchema.safeParse(params.id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid lot id" }, { status: 400 });
  }

  const db = await getDb();
  const lot = await db.collection<LotDoc>("lots").findOne({ _id: new ObjectId(parsedId.data) });
  if (!lot) {
    return NextResponse.json({ error: "Lot not found" }, { status: 404 });
  }
  const ranch = await db.collection<RanchDoc>("ranches").findOne({ _id: lot.ranchId });
  if (!ranch) {
    return NextResponse.json({ error: "Ranch not found" }, { status: 404 });
  }
  if (!isAdmin(user) && ranch.ownerUserId.toString() !== user.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [animals, imports] = await Promise.all([
    db.collection<AnimalDoc>("animals").find({ lotId: lot._id }).sort({ createdAt: -1 }).toArray(),
    db.collection<ImportDoc>("imports").find({ lotId: lot._id }).sort({ createdAt: -1 }).toArray(),
  ]);

  return NextResponse.json({
    lot: serializeLot(lot),
    animals: animals.map(serializeAnimal),
    imports: imports.map(serializeImport),
  });
}
