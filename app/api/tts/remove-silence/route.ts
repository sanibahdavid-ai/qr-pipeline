import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const HF_BASE = "https://neuralfalcon-remove-silence-from-audio.hf.space";

function mkHash(): string {
  return Math.random().toString(36).slice(2, 12);
}

export async function POST(req: NextRequest) {
  let audioFile: File | null = null;
  try {
    const form = await req.formData();
    audioFile = form.get("audio") as File | null;
  } catch {
    return Response.json({ error: "Impossible de lire le formulaire" }, { status: 400 });
  }

  if (!audioFile) {
    return Response.json({ error: "Fichier audio manquant" }, { status: 400 });
  }

  // 1 — Upload to HF space
  const uploadForm = new FormData();
  uploadForm.append("files", audioFile);

  const uploadRes = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: "POST",
    body: uploadForm,
  }).catch(() => null);

  if (!uploadRes?.ok) {
    return Response.json({ error: "Upload HF échoué" }, { status: 502 });
  }

  const uploadData = await uploadRes.json().catch(() => null);
  const serverPath: string | undefined = uploadData?.[0]?.path;
  if (!serverPath) {
    return Response.json({ error: "Chemin HF manquant" }, { status: 502 });
  }

  // 2 — Join processing queue
  const hash = mkHash();
  const joinRes = await fetch(`${HF_BASE}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        { path: serverPath, orig_name: audioFile.name, meta: { _type: "gradio.FileData" } },
        0.05,
      ],
      fn_index: 0,
      session_hash: hash,
    }),
  }).catch(() => null);

  if (!joinRes?.ok) {
    return Response.json({ error: "Queue join échoué" }, { status: 502 });
  }

  // 3 — Stream SSE until process_completed
  const sseRes = await fetch(
    `${HF_BASE}/gradio_api/queue/data?session_hash=${hash}`
  ).catch(() => null);

  if (!sseRes?.ok || !sseRes.body) {
    return Response.json({ error: "Connexion SSE échouée" }, { status: 502 });
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fileUrl: string | null = null;
  let duration: string | null = null;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.msg === "process_completed") {
          const out = ev.output?.data as unknown[];
          if (Array.isArray(out)) {
            const fd = out[0] as { url?: string; path?: string } | null;
            fileUrl = fd?.url ?? (fd?.path ? `${HF_BASE}/gradio_api/file=${fd.path}` : null);
            duration = typeof out[2] === "string" ? out[2] : null;
          }
          break outer;
        }
        if (ev.msg === "queue_full") {
          return Response.json({ error: "File pleine, réessayez dans quelques secondes" }, { status: 503 });
        }
      } catch { /* malformed SSE line — skip */ }
    }
  }

  if (!fileUrl) {
    return Response.json({ error: "Aucun fichier traité reçu" }, { status: 502 });
  }

  // 4 — Fetch processed audio from HF and stream it back
  const audioRes = await fetch(fileUrl).catch(() => null);
  if (!audioRes?.ok) {
    return Response.json({ error: "Téléchargement du résultat échoué" }, { status: 502 });
  }

  const buffer = await audioRes.arrayBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": audioRes.headers.get("Content-Type") ?? "audio/wav",
      "X-Duration": duration ?? "",
    },
  });
}
