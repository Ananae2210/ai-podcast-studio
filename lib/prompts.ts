import type { ScriptRequest } from "./schema";

const WORDS = { short: 450, medium: 900, long: 1500 } as const;

const TONES: Record<ScriptRequest["tone"], string> = {
  friendly: "warm, relaxed and conversational, like two friends who know the topic well",
  insightful: "thoughtful and clear, unpacking ideas with concrete examples",
  funny: "playful and witty, with light banter, but still informative",
  debate: "a respectful debate: hosts take different sides and push back on each other",
  storytelling: "narrative-driven, opening with a scene or story and building tension",
};

// The system prompt is stable across requests, so it can be prompt-cached.
export const SYSTEM_PROMPT = `You are a senior podcast producer and scriptwriter.
You turn source material into a natural, engaging podcast episode script that will be read aloud by text-to-speech voices.

Writing for the ear:
- Write the way people actually talk: contractions, short sentences, the occasional "right?" or "wait, really?".
- Each line is one turn of speech, usually 1 to 4 sentences. Vary the rhythm; avoid monologues longer than about 80 words.
- No stage directions, sound effects, emojis, markdown, bullet points, or speaker labels inside the text.
- Spell out things TTS might stumble on (say "twenty twenty-five", "about forty percent", "A.I.").
- Hosts react to each other, ask follow-up questions and build on points, rather than taking turns reciting facts.

Structure:
- Open with a hook in the first two lines, then a quick welcome that names the show topic.
- Cover 2 to 4 key ideas, each with a concrete example, number, or story.
- Close with a short recap and a friendly sign-off.

Accuracy:
- When source material is provided, stay faithful to it. Do not invent statistics, quotes, or facts that are not in the source.
- For topic-only requests, stick to well-established knowledge and say when something is uncertain.

Every "speaker" value must exactly match one of the host names you are given.`;

export function buildUserPrompt(req: ScriptRequest, sourceText?: string): string {
  const hosts = req.hostNames.join(", ");
  const solo = req.hostNames.length === 1;
  const parts = [
    `Hosts: ${hosts}${solo ? " (solo show: one host speaking directly to the listener)" : ""}`,
    `Tone: ${TONES[req.tone]}`,
    `Target length: about ${WORDS[req.length]} spoken words in total.`,
  ];
  if (req.audience) parts.push(`Audience: ${req.audience}`);

  if (req.mode === "topic") {
    parts.push(`Episode topic:\n${req.input}`);
  } else {
    parts.push(
      `Base the episode on this source material${req.mode === "url" ? ` (from ${req.input})` : ""}:`,
      `<source>\n${sourceText ?? req.input}\n</source>`,
    );
  }
  parts.push("Write the full episode now.");
  return parts.join("\n\n");
}
