import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canViewAdminScreens } from "@/lib/permissions";
import { isAdmin, requireSessionUser } from "@/lib/server/auth";
import { getIxorigueCredentialStatus, upsertIxorigueCredential } from "@/lib/server/ixorigue-credentials";

const bodySchema = z.object({
  refreshToken: z.string().trim().min(10),
  clientId: z.string().trim().min(1).optional().or(z.literal("")),
  tokenUrl: z.string().trim().url().optional().or(z.literal("")),
});

export async function GET() {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canViewAdminScreens(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(await getIxorigueCredentialStatus());
}

export async function PATCH(request: NextRequest) {
  const actor = await requireSessionUser();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
  }

  try {
    const status = await upsertIxorigueCredential({
      refreshToken: parsed.data.refreshToken,
      clientId: parsed.data.clientId || null,
      tokenUrl: parsed.data.tokenUrl || null,
      updatedByUserId: actor.userId,
    });

    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save Ixorigue credential";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

