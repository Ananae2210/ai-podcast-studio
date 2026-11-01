"use client";

export type Settings = { geminiKey: string; anthropicKey: string; openaiKey: string; accessCode: string };
export const EMPTY_SETTINGS: Settings = { geminiKey: "", anthropicKey: "", openaiKey: "", accessCode: "" };
const STORAGE_KEY = "podcast-studio-settings";

export function loadSettings(): Settings {
  try {
    return { ...EMPTY_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function authHeaders(s: Settings): Record<string, string> {
  const h: Record<string, string> = {};
  if (s.geminiKey) h["x-gemini-key"] = s.geminiKey;
  if (s.anthropicKey) h["x-anthropic-key"] = s.anthropicKey;
  if (s.openaiKey) h["x-openai-key"] = s.openaiKey;
  if (s.accessCode) h["x-access-code"] = s.accessCode;
  return h;
}

/** Reads an NDJSON response stream and calls onEvent for each parsed line. */
export async function readNdjson(res: Response, onEvent: (e: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

/** Runs async tasks with a concurrency limit, preserving order of results. */
export async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "episode";
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
