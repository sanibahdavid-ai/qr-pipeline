import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PASSTHROUGH_PARAMS = ["threshold_db", "min_silence_ms", "keep_silence_ms"];

export async function POST(req: NextRequest) {
  const flaskUrl = process.env.FLASK_INTERNAL_URL ?? "http://localhost:5757";

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "Corps multipart invalide" }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: "Fichier audio manquant (champ 'audio')" }, { status: 400 });
  }

  const params = new URLSearchParams();
  for (const key of PASSTHROUGH_PARAMS) {
    const val = req.nextUrl.searchParams.get(key);
    if (val) params.set(key, val);
  }

  try {
    const res = await fetch(`${flaskUrl}/remove-silence?${params}`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Flask error ${res.status}` })) as { error?: string };
      return Response.json({ error: err.error ?? "Suppression des silences échouée" }, { status: res.status });
    }

    const buffer = await res.arrayBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Duration-Before": res.headers.get("X-Duration-Before") ?? "",
        "X-Duration-After": res.headers.get("X-Duration-After") ?? "",
        "X-Silence-Removed-Ms": res.headers.get("X-Silence-Removed-Ms") ?? "",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Erreur réseau" }, { status: 502 });
  }
}
