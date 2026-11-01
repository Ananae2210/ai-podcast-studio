import { RequestSchema } from "@/lib/schema";
import { buildUserPrompt } from "@/lib/prompts";
import { extractArticle } from "@/lib/extract";
import { clientIp, rateLimit, resolveKey } from "@/lib/guard";
import { WriterError, writeWithClaude, writeWithGemini, type WriterEvent } from "@/lib/writers";

export const runtime = "nodejs";
export const maxDuration = 120;

type Event =
  | WriterEvent
  | { type: "status"; message: string }
  | { type: "source"; title: string; chars: number }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;
  const isGemini = body.provider === "gemini";

  const key = isGemini
    ? resolveKey(req, "x-gemini-key", process.env.GEMINI_API_KEY)
    : resolveKey(req, "x-anthropic-key", process.env.ANTHROPIC_API_KEY);
  if ("error" in key) return Response.json({ error: key.error }, { status: key.status });
  if (!key.own && !rateLimit(`script:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
    return Response.json(
      { error: "Hourly limit reached for the shared demo key. Add your own key in Settings to keep going." },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        let sourceText: string | undefined;
        if (body.mode === "url") {
          send({ type: "status", message: "Reading the article…" });
          const article = await extractArticle(body.input);
          sourceText = `${article.title}\n\n${article.text}`;
          send({ type: "source", title: article.title, chars: article.text.length });
        }

        send({ type: "status", message: `${isGemini ? "Gemini" : "Claude"} is writing the script…` });
        const prompt = buildUserPrompt(body, sourceText);
        const writer = isGemini ? writeWithGemini(key.key, prompt) : writeWithClaude(key.key, prompt);
        for await (const event of writer) send(event);
      } catch (err) {
        const message =
          err instanceof WriterError || err instanceof Error ? err.message : "Something went wrong while writing the script.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
