# AI Podcast Studio

Turn a topic, an article link or your own notes into a multi-host podcast episode. **Gemini or Claude** writes a natural conversation between your hosts and streams it in live. **AI voices** then perform it, and you can play the episode in the browser or download it.

> Portfolio project by [@Ananae2210](https://github.com/Ananae2210). Built with Next.js, the Gemini API, the Claude API and OpenAI text-to-speech. Deployable to Vercel in a few minutes.

**Runs for free:** one free Gemini API key (no credit card) powers both the scripts and the voices. Claude and OpenAI are optional paid upgrades.

## Features

- **Three ways in:** a one-line idea, an article URL, or pasted text (blog posts, notes, transcripts).
- **1 to 3 hosts**, each with a name, a voice and a delivery style ("warm and curious", "fast and nerdy").
- **Five tones:** friendly chat, deep dive, funny, debate, storytelling. **Three lengths:** about 3, 6 or 10 minutes.
- **Live streaming script:** lines appear as Claude writes them.
- **Editable script:** change any line, reassign speakers, add or delete lines, then re-render only what changed.
- **Player** with line-by-line highlighting, "play from here", and **audio (WAV/MP3) + Markdown export**.
- **Free to run:** Gemini's free tier covers scripts and voices. With no key at all, a sample episode and browser voices still work.
- **Pick your providers:** Gemini or Claude for the script; Gemini, OpenAI or browser voices for audio.
- **Bring your own key:** visitors can paste their own keys, which stay in their browser.

## AI engineering skills shown

| Skill | Where |
|---|---|
| **Multi-provider LLM integration:** one JSON schema, two writers (Gemini and Claude) behind the same streaming interface | `lib/writers.ts` |
| **Structured outputs:** a strict JSON schema guarantees a valid episode (Claude `output_config.format`, Gemini `responseJsonSchema`) | `lib/writers.ts`, `lib/schema.ts` |
| **Streaming + incremental JSON parsing:** NDJSON stream from the server, partial-JSON parser on the client | `lib/partialJson.ts`, `components/Studio.tsx` |
| **Prompt engineering for audio:** a system prompt tuned for spoken dialogue and TTS-friendly text | `lib/prompts.ts` |
| **Prompt caching:** the stable system prompt is cached, and cached tokens are shown in the UI | `lib/writers.ts` |
| **Model safety handling:** refusal / safety stop reasons, Claude's server-side refusal fallbacks, length limits | `lib/writers.ts` |
| **Content ingestion (light RAG):** URL fetch + Mozilla Readability extraction, grounded in the source | `lib/extract.ts` |
| **Steerable text-to-speech:** per-host voice + natural-language delivery style (Gemini TTS or OpenAI) | `app/api/tts/route.ts` |
| **Audio processing:** raw PCM wrapped as WAV, clips joined in the browser with gaps between lines | `lib/wav.ts` |
| **Working within free-tier limits:** lower concurrency and retry with backoff on HTTP 429 | `components/Studio.tsx` |
| **Shipping an AI app safely in public:** SSRF protection, input limits, rate limiting, access code, BYOK | `lib/extract.ts`, `lib/guard.ts` |

## How it works

```
Idea / URL / text
      │
      ▼
/api/script ──► (URL? fetch + Readability) ──► Gemini or Claude (JSON schema output, streamed)
      │                                              │
      │◄────────────── NDJSON stream of deltas ──────┘
      ▼
Browser: partial-JSON parse → live script → user edits
      │
      ▼
/api/tts (one request per line) ──► Gemini TTS (WAV) or OpenAI gpt-4o-mini-tts (MP3)
      │
      ▼
Player plays clips in order · clips are joined into one file for download
```

## Run locally

```bash
npm install
cp .env.example .env.local   # add your keys (all optional, see below)
npm run dev                  # http://localhost:3000
```

| Variable | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | Recommended (free) | Scripts **and** voices. Free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), no card needed. |
| `GEMINI_MODEL` / `GEMINI_TTS_MODEL` | No | Default `gemini-3.8-flash` and `gemini-3.8-flash-tts`. |
| `ANTHROPIC_API_KEY` | No (paid) | Claude as the script writer. Get one at [platform.claude.com](https://platform.claude.com). |
| `CLAUDE_MODEL` | No | Defaults to `claude-opus-5-5`. Set `claude-sonnet-5-5` or `claude-haiku-5-5` for lower cost. |
| `OPENAI_API_KEY` | No (paid) | OpenAI voices. Gemini or browser voices work without it. |
| `ACCESS_CODE` | No | If set, visitors need this code to use *your* keys. They can still use their own. |

With no keys at all, the app runs in demo mode (sample episode + browser voices).

## Deploy to Vercel

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com/new), choose **Import Project** and pick the repo. The defaults for Next.js are correct.
3. Under **Environment Variables**, add the keys from the table above.
   - Easiest free setup: add only **`GEMINI_API_KEY`**. Add an **`ACCESS_CODE`** too if you don't want strangers using up your free quota.
   - Or leave the keys empty: visitors paste their own free Gemini key in Settings.
4. Click **Deploy**.

The script route can run for up to 2 minutes (`maxDuration = 120`), which fits Vercel's default limits.

## Cost notes

**Gemini free tier:** $0. It has per-minute and per-day request limits (check yours in AI Studio). Voices are generated 2 lines at a time and retried automatically when the limit is hit. Note that Google may use free-tier prompts to improve its products, so don't paste anything private.

**Paid providers:** a ~3 minute episode is roughly 500 words: a few cents of Claude tokens and a few cents of OpenAI TTS. The shared-key rate limits (8 scripts and 150 voice lines per IP per hour) are in-memory per server instance, so treat them as a speed bump. For real protection, use an access code, or swap `lib/guard.ts` for a Redis-backed limiter such as Upstash.

## Ideas for next steps

- ElevenLabs voices and voice cloning
- Background music and intro/outro stingers mixed with ffmpeg
- Save episodes to a database and publish a podcast RSS feed
- Audiogram video export (waveform + captions) for social clips
- Multi-language episodes

## Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · `@google/genai` · `@anthropic-ai/sdk` · Zod · Mozilla Readability · linkedom
