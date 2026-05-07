import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_KEY = process.env.MINIMAX_API_KEY;

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  const apiKey = req.nextUrl.searchParams.get("apiKey") ?? API_KEY ?? "";

  if (!taskId) {
    return Response.json({ error: "taskId manquant" }, { status: 400 });
  }

  const res = await fetch(`https://api.ai33.pro/v1/task/${taskId}`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) {
    return Response.json(
      { error: `Erreur polling : ${res.status}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  console.log("POLL RESPONSE:", JSON.stringify(data));
  return Response.json(data);
}
