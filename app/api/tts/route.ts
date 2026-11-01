import { z } from "zod";
import { isValidVoice } from "@/lib/voices";
import { wavHeader } from "@/lib/wav";
import { clientIp, rateLimit, resolveKey } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";

const Body = z.object({
  provider: z.enum(["gemini", "openai"]).default("openai"),
  text: z.string().min(1).max(1200),
  voice: z.string().max(40),
  style: z.string().max(200).optional(),
});

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Invalid request.", 400);
  const { provider, text, voice, style } = parsed.data;
  if (!isValidVoice(provider, voice)) return fail("Unknown voice.", 400);

  const key =
    provider === "gemini"
      ? resolveKey(req, "x-gemini-key", process.env.GEMINI_API_KEY)
      : resolveKey(req, "x-openai-key", process.env.OPENAI_API_KEY);
  if ("error" in key) return fail(key.error, key.status);
  if (!key.own && !rateLimit(`tts:${clientIp(req)}`, 150, 60 * 60 * 1000)) {
    return fail("Hourly voice limit reached for the shared demo key.", 429);
  }

  const delivery = style || "Speak like a natural, engaged podcast host.";
  return provider === "gemini" ? geminiSpeech(key.key, text, voice, delivery) : openaiSpeech(key.key, text, voice, delivery);
}

/** OpenAI gpt-4o-mini-tts: returns an MP3 clip. */
async function openaiSpeech(apiKey: string, text: string, voice: string, style: string) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: style, response_format: "mp3" }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok || !res.body) {
    if (res.status === 401) return fail("That OpenAI API key was rejected.", 401);
    if (res.status === 429) return fail("OpenAI rate limit reached. Try again shortly.", 429);
    return fail(`Voice generation failed (${res.status}).`, 502);
  }
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}

/** Gemini TTS (free tier available) via the Interactions API: raw PCM, wrapped as WAV. */
async function geminiSpeech(apiKey: string, text: string, voice: string, style: string) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }] }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice }] },
      store: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const detail = await res.text().catch(() => "");
      if (/api key/i.test(detail) || res.status !== 400) return fail("That Gemini API key was rejected.", 401);
      return fail("Gemini couldn't voice that line.", 400);
    }
    if (res.status === 429) return fail("Gemini's free-tier voice limit was reached. Wait a minute and try again.", 429);
    return fail(`Voice generation failed (${res.status}).`, 502);
  }

  const data = findAudioData(await res.json());
  if (!data) return fail("Gemini returned no audio for that line.", 502);
  const pcm = Buffer.from(data, "base64");
  const wav = Buffer.concat([Buffer.from(wavHeader(pcm.byteLength)), pcm]);
  return new Response(wav, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
}

/** Finds the base64 audio payload in the response (documented at steps[].content[].data). */
function findAudioData(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findAudioData(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.data === "string" && obj.data.length > 64) return obj.data;
  for (const value of Object.values(obj)) {
    const found = findAudioData(value);
    if (found) return found;
  }
  return null;
}
