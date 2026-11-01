export const OPENAI_VOICES = [
  { id: "coral", label: "Coral", vibe: "warm" },
  { id: "ash", label: "Ash", vibe: "upbeat" },
  { id: "sage", label: "Sage", vibe: "calm" },
  { id: "onyx", label: "Onyx", vibe: "deep" },
  { id: "nova", label: "Nova", vibe: "bright" },
  { id: "echo", label: "Echo", vibe: "steady" },
  { id: "shimmer", label: "Shimmer", vibe: "soft" },
  { id: "fable", label: "Fable", vibe: "expressive" },
  { id: "alloy", label: "Alloy", vibe: "neutral" },
] as const;

export type OpenAIVoice = (typeof OPENAI_VOICES)[number]["id"];
export const VOICE_IDS = OPENAI_VOICES.map((v) => v.id) as [OpenAIVoice, ...OpenAIVoice[]];
