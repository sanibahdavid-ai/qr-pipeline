import { NextRequest } from "next/server";

export const DIRECTOR_COOKIE = "dav_director";

// The cookie value is an HMAC keyed with a server-only secret, so it cannot be
// forged from the client bundle. No new env var needed: it reuses the director
// ElevenLabs key already present on the server.
export async function directorToken(): Promise<string | null> {
  const secret = process.env.ELEVENLABS_API_KEY_DIRECTOR ?? process.env.ELEVENLABS_API_KEY;
  if (!secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("dav-director-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isDirector(req: NextRequest): Promise<boolean> {
  const token = await directorToken();
  const cookie = req.cookies.get(DIRECTOR_COOKIE)?.value;
  return !!token && !!cookie && cookie === token;
}

// Returns a 403 Response when the caller is not the director, otherwise null.
export async function requireDirector(req: NextRequest): Promise<Response | null> {
  if (await isDirector(req)) return null;
  return Response.json({ error: "Génération audio réservée au directeur." }, { status: 403 });
}
