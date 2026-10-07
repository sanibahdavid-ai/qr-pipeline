import { DIRECTOR_COOKIE } from "@/lib/director-auth";

// Leaving the director profile (or opening the site under another profile)
// must drop the audio right that came with it on this browser.
export async function POST() {
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${DIRECTOR_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
  return res;
}
