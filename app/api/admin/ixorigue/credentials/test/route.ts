import { NextResponse } from "next/server";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { getRanches } from "@/lib/ixorigue/client";
import { getIxorigueCredentialStatus } from "@/lib/server/ixorigue-credentials";

export async function POST() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const ranches = await getRanches();
    return NextResponse.json({
      ok: true,
      ranchCount: ranches.length,
      firstRanchName: ranches[0]?.name ?? null,
      status: await getIxorigueCredentialStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ixorigue credential test failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

