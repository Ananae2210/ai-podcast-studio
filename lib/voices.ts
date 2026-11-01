export type VoiceProvider = "gemini" | "openai";

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

// A curated subset of Gemini's 30 prebuilt voices.
export const GEMINI_VOICES = [
  { id: "Aoede", label: "Aoede", vibe: "breezy" },
  { id: "Puck", label: "Puck", vibe: "upbeat" },
  { id: "Charon", label: "Charon", vibe: "informative" },
  { id: "Kore", label: "Kore", vibe: "firm" },
  { id: "Sulafat", label: "Sulafat", vibe: "warm" },
  { id: "Fenrir", label: "Fenrir", vibe: "excitable" },
  { id: "Leda", label: "Leda", vibe: "youthful" },
  { id: "Achird", label: "Achird", vibe: "friendly" },
  { id: "Zephyr", label: "Zephyr", vibe: "bright" },
  { id: "Algieba", label: "Algieba", vibe: "smooth" },
] as const;

export const VOICES: Record<VoiceProvider, readonly { id: string; label: string; vibe: string }[]> = {
  gemini: GEMINI_VOICES,
  openai: OPENAI_VOICES,
};

export function isValidVoice(provider: VoiceProvider, voice: string) {
  return VOICES[provider].some((v) => v.id === voice);
}
