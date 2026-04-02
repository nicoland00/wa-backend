import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(_: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const user = await requireSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const key = params.key.join("/");

  const baseDir = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "tmp-storage");
  const filePath = path.join(baseDir, key);

  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
