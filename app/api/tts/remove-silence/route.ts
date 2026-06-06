import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const HF_BASE = "https://neuralfalcon-remove-silence-from-audio.hf.space";

function mkHash(): string {
  return Math.random().toString(36).slice(2, 12);
}

export async function POST(req: NextRequest) {
  let audioFile: File | null = null;
  try {
    const form = await req.formData();
    audioFile = form.get("audio") as File | null;
  } catch (e) {
    console.error("[remove-silence] formData parse error:", e);
    return Response.json({ error: "Impossible de lire le formulaire" }, { status: 400 });
  }

  if (!audioFile) {
    console.error("[remove-silence] no audio file in form");
    return Response.json({ error: "Fichier audio manquant" }, { status: 400 });
  }

  console.log(`[remove-silence] file: name=${audioFile.name} size=${audioFile.size} type=${audioFile.type}`);

  // 1 — Upload to HF space
  const uploadForm = new FormData();
  uploadForm.append("files", audioFile);

  console.log("[remove-silence] uploading to HF...");
  const uploadRes = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: "POST",
    body: uploadForm,
  }).catch((e) => { console.error("[remove-silence] upload fetch error:", e); return null; });

  if (!uploadRes?.ok) {
    const body = await uploadRes?.text().catch(() => "");
    console.error(`[remove-silence] upload failed: status=${uploadRes?.status} body=${body}`);
    return Response.json({ error: `Upload HF échoué (${uploadRes?.status ?? "network"})` }, { status: 502 });
  }

  const uploadData = await uploadRes.json().catch(() => null);
  console.log("[remove-silence] upload response:", JSON.stringify(uploadData));

  const serverPath: string | undefined = uploadData?.[0]?.path ?? uploadData?.[0]?.name;
  if (!serverPath) {
    console.error("[remove-silence] no path in upload response:", uploadData);
    return Response.json({ error: "Chemin HF manquant dans la réponse upload" }, { status: 502 });
  }

  // 2 — Join processing queue
  const hash = mkHash();
  const joinBody = {
    data: [
      { path: serverPath, orig_name: audioFile.name, mime_type: audioFile.type || "audio/mpeg", meta: { _type: "gradio.FileData" } },
      0.05,
    ],
    fn_index: 0,
    session_hash: hash,
  };
  console.log("[remove-silence] joining queue:", JSON.stringify(joinBody));

  const joinRes = await fetch(`${HF_BASE}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(joinBody),
  }).catch((e) => { console.error("[remove-silence] join fetch error:", e); return null; });

  if (!joinRes?.ok) {
    const body = await joinRes?.text().catch(() => "");
    console.error(`[remove-silence] queue join failed: status=${joinRes?.status} body=${body}`);
    return Response.json({ error: `Queue join échoué (${joinRes?.status ?? "network"})` }, { status: 502 });
  }

  const joinData = await joinRes.json().catch(() => null);
  console.log("[remove-silence] join response:", JSON.stringify(joinData));

  // 3 — Stream SSE until process_completed
  console.log(`[remove-silence] connecting SSE session_hash=${hash}`);
  const sseRes = await fetch(
    `${HF_BASE}/gradio_api/queue/data?session_hash=${hash}`
  ).catch((e) => { console.error("[remove-silence] SSE fetch error:", e); return null; });

  if (!sseRes?.ok || !sseRes.body) {
    console.error(`[remove-silence] SSE connection failed: status=${sseRes?.status}`);
    return Response.json({ error: `Connexion SSE échouée (${sseRes?.status ?? "network"})` }, { status: 502 });
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fileUrl: string | null = null;
  let duration: string | null = null;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) { console.log("[remove-silence] SSE stream ended"); break; }
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        console.log("[remove-silence] SSE event:", ev.msg);
        if (ev.msg === "process_completed") {
          console.log("[remove-silence] process_completed output:", JSON.stringify(ev.output));
          const out = ev.output?.data as unknown[];
          if (Array.isArray(out)) {
            const fd = out[0] as { url?: string; path?: string } | null;
            fileUrl = fd?.url ?? (fd?.path ? `${HF_BASE}/gradio_api/file=${fd.path}` : null);
            duration = typeof out[2] === "string" ? out[2] : null;
          }
          break outer;
        }
        if (ev.msg === "queue_full") {
          console.error("[remove-silence] queue_full");
          return Response.json({ error: "File pleine, réessayez dans quelques secondes" }, { status: 503 });
        }
        if (ev.msg === "process_errored") {
          console.error("[remove-silence] process_errored:", JSON.stringify(ev));
          return Response.json({ error: `Erreur traitement HF: ${ev.output?.error ?? "inconnu"}` }, { status: 502 });
        }
      } catch { /* malformed SSE line — skip */ }
    }
  }

  if (!fileUrl) {
    console.error("[remove-silence] no fileUrl after SSE");
    return Response.json({ error: "Aucun fichier traité reçu" }, { status: 502 });
  }

  console.log("[remove-silence] fetching result:", fileUrl);

  // 4 — Fetch processed audio from HF and stream it back
  const audioRes = await fetch(fileUrl).catch((e) => { console.error("[remove-silence] result fetch error:", e); return null; });
  if (!audioRes?.ok) {
    console.error(`[remove-silence] result download failed: status=${audioRes?.status}`);
    return Response.json({ error: `Téléchargement du résultat échoué (${audioRes?.status ?? "network"})` }, { status: 502 });
  }

  const buffer = await audioRes.arrayBuffer();
  console.log(`[remove-silence] success, returning ${buffer.byteLength} bytes duration=${duration}`);
  return new Response(buffer, {
    headers: {
      "Content-Type": audioRes.headers.get("Content-Type") ?? "audio/wav",
      "X-Duration": duration ?? "",
    },
  });
}
