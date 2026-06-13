import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const HF_BASE = "https://neuralfalcon-remove-silence-from-audio.hf.space";

function mkHash(): string {
  return Math.random().toString(36).slice(2, 12);
}

export async function POST(req: NextRequest) {
  // Accept {audioBase64, mimeType} JSON
  let audioBase64: string | undefined;
  let mimeType = "audio/mpeg";

  try {
    const body = await req.json();
    audioBase64 = body?.audioBase64;
    if (body?.mimeType) mimeType = body.mimeType;
  } catch (e) {
    console.error("[remove-silence] json parse error:", e);
    return Response.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (!audioBase64) {
    return Response.json({ error: "audioBase64 manquant" }, { status: 400 });
  }

  // Decode base64 → File
  const buf = Buffer.from(audioBase64, "base64");
  const audioFile = new File([buf], "audio.mp3", { type: mimeType });
  console.log(`[remove-silence] decoded file: size=${audioFile.size} type=${mimeType}`);

  // Step 0: Wake up HF Space with a GET ping
  console.log("[remove-silence] pinging HF Space...");
  const pingRes = await fetch(`${HF_BASE}/`, { method: "GET" }).catch((e) => {
    console.warn("[remove-silence] ping failed (continuing anyway):", e);
    return null;
  });
  console.log(`[remove-silence] ping status: ${pingRes?.status ?? "failed"}`);

  // Step 1: Upload to HF gradio_api/upload
  const uploadForm = new FormData();
  uploadForm.append("files", audioFile);

  console.log("[remove-silence] uploading to HF...");
  const uploadRes = await fetch(`${HF_BASE}/gradio_api/upload`, {
    method: "POST",
    body: uploadForm,
  }).catch((e) => { console.error("[remove-silence] upload error:", e); return null; });

  if (!uploadRes?.ok) {
    const txt = await uploadRes?.text().catch(() => "");
    console.error(`[remove-silence] upload failed: status=${uploadRes?.status} body=${txt}`);
    return Response.json({ error: `Upload HF échoué (${uploadRes?.status ?? "network"})` }, { status: 502 });
  }

  const uploadData = await uploadRes.json().catch(() => null);
  console.log("[remove-silence] upload response:", JSON.stringify(uploadData));

  const serverPath: string | undefined = uploadData?.[0]?.path ?? uploadData?.[0]?.name;
  if (!serverPath) {
    console.error("[remove-silence] no path in upload response:", uploadData);
    return Response.json({ error: "Chemin HF manquant dans la réponse upload" }, { status: 502 });
  }

  // Step 2: Join queue with seconds=0.05
  const hash = mkHash();
  const joinBody = {
    data: [
      { path: serverPath, orig_name: "audio.mp3", mime_type: mimeType, meta: { _type: "gradio.FileData" } },
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
  }).catch((e) => { console.error("[remove-silence] join error:", e); return null; });

  if (!joinRes?.ok) {
    const txt = await joinRes?.text().catch(() => "");
    console.error(`[remove-silence] queue join failed: status=${joinRes?.status} body=${txt}`);
    return Response.json({ error: `Queue join échoué (${joinRes?.status ?? "network"})` }, { status: 502 });
  }

  const joinData = await joinRes.json().catch(() => null);
  console.log("[remove-silence] join response:", JSON.stringify(joinData));

  // Step 3: Poll SSE /gradio_api/queue/data until process_completed
  console.log(`[remove-silence] connecting SSE session_hash=${hash}`);
  const sseRes = await fetch(
    `${HF_BASE}/gradio_api/queue/data?session_hash=${hash}`
  ).catch((e) => { console.error("[remove-silence] SSE error:", e); return null; });

  if (!sseRes?.ok || !sseRes.body) {
    console.error(`[remove-silence] SSE connection failed: status=${sseRes?.status}`);
    return Response.json({ error: `Connexion SSE échouée (${sseRes?.status ?? "network"})` }, { status: 502 });
  }

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  let fileUrl: string | null = null;
  let duration: string | null = null;

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) { console.log("[remove-silence] SSE stream ended"); break; }
    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split("\n");
    sseBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        console.log("[remove-silence] SSE event:", ev.msg);
        if (ev.msg === "process_completed") {
          console.log("[remove-silence] output:", JSON.stringify(ev.output));
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
          return Response.json({ error: `Erreur HF: ${ev.output?.error ?? "inconnu"}` }, { status: 502 });
        }
      } catch { /* skip malformed line */ }
    }
  }

  if (!fileUrl) {
    console.error("[remove-silence] no fileUrl after SSE");
    return Response.json({ error: "Aucun fichier traité reçu" }, { status: 502 });
  }

  console.log(`[remove-silence] success, processedUrl=${fileUrl} duration=${duration}`);
  return Response.json({ processedUrl: fileUrl, duration });
}
