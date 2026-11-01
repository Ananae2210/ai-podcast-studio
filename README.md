# AI Podcast Studio

Turn a topic, an article link or your own notes into a multi-host podcast episode. **Claude** writes a natural conversation between your hosts and streams it in live. **AI voices** then perform it, and you can play the episode in the browser or download it as an MP3.

> Portfolio project by [@Ananae2210](https://github.com/Ananae2210). Built with Next.js, the Claude API and OpenAI text-to-speech. Deployable to Vercel in a few minutes.

## Features

- **Three ways in:** a one-line idea, an article URL, or pasted text (blog posts, notes, transcripts).
- **1 to 3 hosts**, each with a name, a voice and a delivery style ("warm and curious", "fast and nerdy").
- **Five tones:** friendly chat, deep dive, funny, debate, storytelling. **Three lengths:** about 3, 6 or 10 minutes.
- **Live streaming script:** lines appear as Claude writes them.
- **Editable script:** change any line, reassign speakers, add or delete lines, then re-render only what changed.
- **Player** with line-by-line highlighting, "play from here", and **MP3 + Markdown export**.
- **Free demo mode:** a sample episode and browser voices let anyone try the app with no API keys.
- **Bring your own key:** visitors can paste their own keys, which stay in their browser.

## AI engineering skills shown

| Skill | Where |
|---|---|
| **Structured outputs:** a strict JSON schema guarantees a valid episode (`output_config.format`) | `app/api/script/route.ts`, `lib/schema.ts` |
| **Streaming + incremental JSON parsing:** NDJSON stream from the server, partial-JSON parser on the client | `lib/partialJson.ts`, `components/Studio.tsx` |
| **Prompt engineering for audio:** a system prompt tuned for spoken dialogue and TTS-friendly text | `lib/prompts.ts` |
| **Prompt caching:** the stable system prompt is cached, and cached tokens are shown in the UI | `app/api/script/route.ts` |
| **Model safety handling:** refusal stop reasons, server-side refusal fallbacks, `max_tokens` handling | `app/api/script/route.ts` |
| **Content ingestion (light RAG):** URL fetch + Mozilla Readability extraction, grounded in the source | `lib/extract.ts` |
| **Steerable text-to-speech:** per-host voice + natural-language delivery instructions | `app/api/tts/route.ts` |
| **Shipping an AI app safely in public:** SSRF protection, input limits, rate limiting, access code, BYOK | `lib/extract.ts`, `lib/guard.ts` |

## How it works

```
Idea / URL / text
      │
      ▼
/api/script ──► (URL? fetch + Readability) ──► Claude (structured output, streamed)
      │                                              │
      │◄────────────── NDJSON stream of deltas ──────┘
      ▼
Browser: partial-JSON parse → live script → user edits
      │
      ▼
/api/tts (one request per line, 4 in parallel) ──► OpenAI gpt-4o-mini-tts ──► MP3 clips
      │
      ▼
Player plays clips in order · clips are concatenated into one MP3 for download
```

## Run locally

```bash
npm install
cp .env.example .env.local   # add your keys (both optional, see below)
npm run dev                  # http://localhost:3000
```

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | For writing new episodes | Claude writes the scripts. Get one at [platform.claude.com](https://platform.claude.com). |
| `CLAUDE_MODEL` | No | Defaults to `claude-opus-5-5`. Set `claude-sonnet-5-5` or `claude-haiku-5-5` for lower cost. |
| `OPENAI_API_KEY` | No | AI voices. Without it, the app falls back to free browser voices. |
| `ACCESS_CODE` | No | If set, visitors need this code to use *your* keys. They can still use their own. |

With no keys at all, the app runs in demo mode (sample episode + browser voices).

## Deploy to Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com/new), choose **Import Project** and pick the repo. The defaults for Next.js are correct.
3. Under **Environment Variables**, add the keys from the table above.
   - For a public portfolio link, the safest setup is to **leave the keys empty** (visitors bring their own), or set an **`ACCESS_CODE`** that you share with recruiters.
4. Click **Deploy**.

The script route can run for up to 2 minutes (`maxDuration = 120`), which fits Vercel's default limits.

## Cost notes

A ~3 minute episode is roughly 500 words: a few cents of Claude tokens and a few cents of TTS. The shared-key rate limits (8 scripts and 150 voice lines per IP per hour) are in-memory per server instance, so treat them as a speed bump. For real protection, use an access code, or swap `lib/guard.ts` for a Redis-backed limiter such as Upstash.

## Ideas for next steps

- ElevenLabs voices and voice cloning
- Background music and intro/outro stingers mixed with ffmpeg
- Save episodes to a database and publish a podcast RSS feed
- Audiogram video export (waveform + captions) for social clips
- Multi-language episodes

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · `@anthropic-ai/sdk` · Zod · Mozilla Readability · linkedom
