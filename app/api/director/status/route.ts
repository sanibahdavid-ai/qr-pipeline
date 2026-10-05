import { NextRequest } from "next/server";
import { isDirector } from "@/lib/director-auth";

export async function GET(req: NextRequest) {
  return Response.json({ ok: await isDirector(req) });
}
