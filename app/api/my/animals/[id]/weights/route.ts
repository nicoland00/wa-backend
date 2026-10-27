import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/server/auth";

export async function POST() {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "El peso debe registrarse junto con un vídeo. Selecciona o sube un registro de vídeo y peso desde la galería." }, { status: 400 });
}
