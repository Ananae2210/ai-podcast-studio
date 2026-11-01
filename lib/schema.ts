import { z } from "zod";

export const HostSchema = z.object({
  name: z.string(),
  persona: z.string(),
});

export const LineSchema = z.object({
  speaker: z.string(),
  text: z.string(),
});

export const EpisodeSchema = z.object({
  title: z.string(),
  summary: z.string(),
  hosts: z.array(HostSchema),
  lines: z.array(LineSchema),
});

export type Host = z.infer<typeof HostSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;

// JSON Schema sent to Claude's structured outputs (output_config.format).
// Key order matters for the live preview: title -> summary -> hosts -> lines.
export const episodeJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Catchy episode title, under 70 characters" },
    summary: { type: "string", description: "Two-sentence show notes summary" },
    hosts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          persona: { type: "string", description: "One short phrase, e.g. 'curious generalist'" },
        },
        required: ["name", "persona"],
        additionalProperties: false,
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", description: "Exactly one of the host names" },
          text: { type: "string", description: "What the host says, written to be spoken aloud" },
        },
        required: ["speaker", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "summary", "hosts", "lines"],
  additionalProperties: false,
} as const;

export const RequestSchema = z.object({
  mode: z.enum(["topic", "url", "text"]),
  input: z.string().min(3).max(40_000),
  hostNames: z.array(z.string().min(1).max(30)).min(1).max(3),
  tone: z.enum(["friendly", "insightful", "funny", "debate", "storytelling"]),
  length: z.enum(["short", "medium", "long"]),
  audience: z.string().max(120).optional(),
});

export type ScriptRequest = z.infer<typeof RequestSchema>;
