import { NextRequest } from "next/server";
import { DIRECTOR_COOKIE, directorToken } from "@/lib/director-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body?.code !== "0506") {
    return Response.json({ ok: false }, { status: 403 });
  }
  const token = await directorToken();
  if (!token) return Response.json({ ok: false, error: "Serveur non configuré" }, { status: 500 });
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${DIRECTOR_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 180}`
  );
  return res;
}
