import { z } from "zod";
import { VOICE_IDS } from "@/lib/voices";
import { clientIp, rateLimit, resolveKey } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().min(1).max(1200),
  voice: z.enum(VOICE_IDS),
  style: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const key = resolveKey(req, "x-openai-key", process.env.OPENAI_API_KEY);
  if ("error" in key) return Response.json({ error: key.error }, { status: key.status });
  if (!key.own && !rateLimit(`tts:${clientIp(req)}`, 150, 60 * 60 * 1000)) {
    return Response.json({ error: "Hourly voice limit reached for the shared demo key." }, { status: 429 });
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: parsed.data.voice,
      input: parsed.data.text,
      // Steerable TTS: describe how the line should be delivered.
      instructions: parsed.data.style || "Speak like a natural, engaged podcast host.",
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok || !res.body) {
    const message = res.status === 401 ? "That OpenAI API key was rejected." : `Voice generation failed (${res.status}).`;
    return Response.json({ error: message }, { status: res.status === 401 ? 401 : 502 });
  }
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
