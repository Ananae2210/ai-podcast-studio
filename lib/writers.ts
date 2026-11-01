import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI } from "@google/genai";
import { episodeJsonSchema } from "./schema";
import { SYSTEM_PROMPT } from "./prompts";

/** Events a script writer yields while streaming an episode. */
export type WriterEvent =
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; model: string; usage: { input: number; output: number; cached: number } };

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Claude models that accept server-side refusal fallbacks with `fallbacks: "default"`.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export class WriterError extends Error {}

/** Claude: structured outputs + streaming + prompt caching + refusal fallbacks. */
export async function* writeWithClaude(apiKey: string, prompt: string): AsyncGenerator<WriterEvent> {
  const client = new Anthropic({ apiKey });
  const useFallbacks = FALLBACK_MODELS.has(CLAUDE_MODEL);
  try {
    const stream = client.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      // Stable system prompt, cached across requests.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // Structured outputs: the response is guaranteed to match the episode schema.
      // Low effort keeps the script fast; raise it for more polished writing.
      output_config: { effort: "low", format: { type: "json_schema", schema: episodeJsonSchema } },
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") {
        // Another model took over mid-response: the client starts its buffer again.
        yield { type: "reset" };
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "delta", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new WriterError("Claude declined to write this episode. Try a different topic.");
    if (final.stop_reason === "max_tokens") throw new WriterError("The script ran too long. Try a shorter length.");
    yield {
      type: "done",
      model: final.model,
      usage: { input: final.usage.input_tokens, output: final.usage.output_tokens, cached: final.usage.cache_read_input_tokens ?? 0 },
    };
  } catch (err) {
    if (err instanceof WriterError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new WriterError("That Anthropic API key was rejected.");
    if (err instanceof Anthropic.RateLimitError) throw new WriterError("Claude is rate limited right now. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new WriterError(`Claude API error (${err.status}).`);
    throw err;
  }
}

/** Gemini (free tier available): JSON-schema output + streaming. */
export async function* writeWithGemini(apiKey: string, prompt: string): AsyncGenerator<WriterEvent> {
  const ai = new GoogleGenAI({ apiKey });
  let input = 0;
  let output = 0;
  let cached = 0;
  try {
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: episodeJsonSchema,
        maxOutputTokens: 16000,
      },
    });
    let finish: string | undefined;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { type: "delta", text };
      finish = chunk.candidates?.[0]?.finishReason ?? finish;
      if (chunk.usageMetadata) {
        input = chunk.usageMetadata.promptTokenCount ?? input;
        output = chunk.usageMetadata.candidatesTokenCount ?? output;
        cached = chunk.usageMetadata.cachedContentTokenCount ?? cached;
      }
    }
    if (finish === "MAX_TOKENS") throw new WriterError("The script ran too long. Try a shorter length.");
    if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT") throw new WriterError("Gemini declined to write this episode. Try a different topic.");
    yield { type: "done", model: GEMINI_MODEL, usage: { input: input - cached, output, cached } };
  } catch (err) {
    if (err instanceof WriterError) throw err;
    if (err instanceof ApiError) {
      if (err.status === 400 && /api key/i.test(err.message)) throw new WriterError("That Gemini API key was rejected.");
      if (err.status === 401 || err.status === 403) throw new WriterError("That Gemini API key was rejected.");
      if (err.status === 429) throw new WriterError("Gemini's free-tier limit was reached. Wait a minute and try again.");
      throw new WriterError(`Gemini API error (${err.status}).`);
    }
    throw err;
  }
}
