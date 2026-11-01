import Anthropic from "@anthropic-ai/sdk";
import { RequestSchema, episodeJsonSchema } from "@/lib/schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/prompts";
import { extractArticle } from "@/lib/extract";
import { clientIp, rateLimit, resolveKey } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Models that accept server-side refusal fallbacks with `fallbacks: "default"`.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

type Event =
  | { type: "status"; message: string }
  | { type: "source"; title: string; chars: number }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; model: string; usage: { input: number; output: number; cached: number } }
  | { type: "error"; message: string };

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const body = parsed.data;

  const key = resolveKey(req, "x-anthropic-key", process.env.ANTHROPIC_API_KEY);
  if ("error" in key) return json({ error: key.error }, key.status);
  if (!key.own && !rateLimit(`script:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
    return json({ error: "Hourly limit reached for the shared demo key. Add your own key in Settings to keep going." }, 429);
  }

  const client = new Anthropic({ apiKey: key.key });
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

        send({ type: "status", message: "Writing the script…" });
        const useFallbacks = FALLBACK_MODELS.has(MODEL);
        const claude = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          // Stable system prompt, cached across requests.
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          // Structured outputs: the response is guaranteed to match the episode schema.
          // Low effort keeps the script fast; raise it for more polished writing.
          output_config: { effort: "low", format: { type: "json_schema", schema: episodeJsonSchema } },
          messages: [{ role: "user", content: buildUserPrompt(body, sourceText) }],
        });

        for await (const event of claude) {
          if (event.type === "content_block_start" && event.content_block.type === "fallback") {
            // Another model took over mid-response: the client starts its buffer again.
            send({ type: "reset" });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "delta", text: event.delta.text });
          }
        }

        const final = await claude.finalMessage();
        if (final.stop_reason === "refusal") {
          send({ type: "error", message: "Claude declined to write this episode. Try a different topic." });
        } else if (final.stop_reason === "max_tokens") {
          send({ type: "error", message: "The script ran too long. Try a shorter length." });
        } else {
          send({
            type: "done",
            model: final.model,
            usage: {
              input: final.usage.input_tokens,
              output: final.usage.output_tokens,
              cached: final.usage.cache_read_input_tokens ?? 0,
            },
          });
        }
      } catch (err) {
        let message = "Something went wrong while writing the script.";
        if (err instanceof Anthropic.AuthenticationError) message = "That Anthropic API key was rejected.";
        else if (err instanceof Anthropic.RateLimitError) message = "Claude is rate limited right now. Try again in a minute.";
        else if (err instanceof Anthropic.APIError) message = `Claude API error (${err.status}).`;
        else if (err instanceof Error) message = err.message;
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
