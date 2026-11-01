"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Episode, ScriptRequest } from "@/lib/schema";
import { parsePartialJson } from "@/lib/partialJson";
import { VOICES } from "@/lib/voices";
import { joinWavs } from "@/lib/wav";
import { SAMPLE_EPISODE } from "@/lib/sample";
import {
  EMPTY_SETTINGS, authHeaders, download, loadSettings, pool, readNdjson, saveSettings, slugify, type Settings,
} from "@/lib/client";
import SettingsPanel from "./SettingsPanel";

type HostConfig = { name: string; voice: string; gVoice: string; style: string };
export type Status = { claude: boolean; gemini: boolean; tts: boolean; accessCode: boolean; models: { claude: string; gemini: string } };
type Writer = "gemini" | "claude";
type Engine = "gemini" | "openai" | "browser";
type Clip = { key: string; url: string; blob: Blob };

const DEFAULT_HOSTS: HostConfig[] = [
  { name: "Maya", voice: "coral", gVoice: "Aoede", style: "Warm and curious, smiling while she talks." },
  { name: "Leo", voice: "ash", gVoice: "Puck", style: "Upbeat and a little nerdy, quick to react." },
  { name: "Ava", voice: "sage", gVoice: "Charon", style: "Calm, thoughtful and measured." },
];

const TONES: { id: ScriptRequest["tone"]; label: string }[] = [
  { id: "friendly", label: "Friendly chat" },
  { id: "insightful", label: "Deep dive" },
  { id: "funny", label: "Funny" },
  { id: "debate", label: "Debate" },
  { id: "storytelling", label: "Storytelling" },
];

const LENGTHS: { id: ScriptRequest["length"]; label: string }[] = [
  { id: "short", label: "~3 min" },
  { id: "medium", label: "~6 min" },
  { id: "long", label: "~10 min" },
];

const MODES: { id: ScriptRequest["mode"]; label: string; placeholder: string }[] = [
  { id: "topic", label: "Idea", placeholder: "e.g. Why sourdough is having a moment, and the science behind the starter" },
  { id: "url", label: "Article link", placeholder: "https://example.com/blog/some-article" },
  { id: "text", label: "Paste text", placeholder: "Paste a blog post, notes, a transcript or a newsletter…" },
];

const clipKey = (engine: Engine, speaker: string, text: string, voice: string, style: string) =>
  `${engine}|${voice}|${style}|${speaker}|${text}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Studio() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const [mode, setMode] = useState<ScriptRequest["mode"]>("topic");
  const [input, setInput] = useState("");
  const [hostCount, setHostCount] = useState(2);
  const [hosts, setHosts] = useState<HostConfig[]>(DEFAULT_HOSTS);
  const [tone, setTone] = useState<ScriptRequest["tone"]>("friendly");
  const [length, setLength] = useState<ScriptRequest["length"]>("short");
  const [audience, setAudience] = useState("");

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [writing, setWriting] = useState(false);
  const [progressNote, setProgressNote] = useState("");
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<string>("");

  const [writer, setWriter] = useState<Writer>("gemini");
  const [engine, setEngine] = useState<Engine>("gemini");
  const [enginePinned, setEnginePinned] = useState(false); // true once the user picks a voice engine
  const [clips, setClips] = useState<Record<number, Clip>>({});
  const [rendering, setRendering] = useState<{ done: number; total: number } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playToken = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  const activeHosts = hosts.slice(0, hostCount);
  const unlocked = !status?.accessCode || Boolean(settings.accessCode);
  const canGemini = Boolean(settings.geminiKey || (status?.gemini && unlocked));
  const canClaude = Boolean(settings.anthropicKey || (status?.claude && unlocked));
  const canOpenAI = Boolean(settings.openaiKey || (status?.tts && unlocked));
  const canWrite = writer === "gemini" ? canGemini : canClaude;
  const voiceId = (h: HostConfig) => (engine === "gemini" ? h.gVoice : h.voice);

  useEffect(() => {
    if (playing !== null) document.getElementById(`line-${playing}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing]);

  // Pick the best available providers: free Gemini first, then paid, then browser voices.
  useEffect(() => {
    if (!status) return;
    if (writer === "gemini" && !canGemini && canClaude) setWriter("claude");
    if (writer === "claude" && !canClaude && canGemini) setWriter("gemini");
  }, [status, writer, canGemini, canClaude]);

  useEffect(() => {
    if (!status) return;
    const best: Engine = canGemini ? "gemini" : canOpenAI ? "openai" : "browser";
    const unavailable = (engine === "gemini" && !canGemini) || (engine === "openai" && !canOpenAI);
    if (unavailable || (!enginePinned && engine !== best)) setEngine(best);
  }, [status, engine, enginePinned, canGemini, canOpenAI]);

  // Map each speaker name in the script to a host's voice settings.
  const voiceFor = useCallback(
    (speaker: string): HostConfig => {
      const byName = activeHosts.find((h) => h.name.toLowerCase() === speaker.toLowerCase());
      if (byName) return byName;
      const idx = episode?.hosts.findIndex((h) => h.name === speaker) ?? 0;
      return activeHosts[Math.max(0, idx) % activeHosts.length];
    },
    [activeHosts, episode],
  );

  const stopPlayback = useCallback(() => {
    playToken.current++;
    audioRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setPlaying(null);
  }, []);

  async function writeScript() {
    if (!input.trim()) {
      setError("Add a topic, link or some text first.");
      return;
    }
    stopPlayback();
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError("");
    setMeta("");
    setEpisode(null);
    setClips({});
    setWriting(true);
    setProgressNote(`Connecting to ${writer === "gemini" ? "Gemini" : "Claude"}…`);

    const body: ScriptRequest = {
      provider: writer,
      mode,
      input: input.trim(),
      hostNames: activeHosts.map((h) => h.name.trim() || "Host"),
      tone,
      length,
      audience: audience.trim() || undefined,
    };

    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders(settings) },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      let buffer = "";
      await readNdjson(res, (e) => {
        if (e.type === "status") setProgressNote(String(e.message));
        if (e.type === "source") setMeta(`Source: ${e.title} · ${Number(e.chars).toLocaleString()} characters`);
        if (e.type === "reset") buffer = "";
        if (e.type === "delta") {
          buffer += String(e.text);
          const partial = parsePartialJson<Partial<Episode>>(buffer);
          if (partial) {
            setEpisode({
              title: partial.title ?? "",
              summary: partial.summary ?? "",
              hosts: partial.hosts ?? [],
              lines: (partial.lines ?? []).filter((l) => l && l.speaker && l.text),
            });
          }
        }
        if (e.type === "error") throw new Error(String(e.message));
        if (e.type === "done") {
          const final = JSON.parse(buffer) as Episode;
          setEpisode(final);
          const u = e.usage as { input: number; output: number; cached: number };
          setMeta((m) => [m, `${e.model} · ${u.input + u.cached} in / ${u.output} out tokens${u.cached ? ` (${u.cached} cached)` : ""}`].filter(Boolean).join("  ·  "));
        }
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setWriting(false);
      setProgressNote("");
    }
  }

  function loadSample() {
    stopPlayback();
    setError("");
    setClips({});
    setHostCount(2);
    setEpisode(SAMPLE_EPISODE);
    setMeta("Sample episode · no API calls");
  }

  function updateLine(i: number, patch: Partial<Episode["lines"][number]>) {
    if (!episode) return;
    setEpisode({ ...episode, lines: episode.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  }

  function removeLine(i: number) {
    if (!episode) return;
    stopPlayback();
    setEpisode({ ...episode, lines: episode.lines.filter((_, j) => j !== i) });
    setClips({});
  }

  function addLine(after: number) {
    if (!episode) return;
    const speaker = episode.lines[after]?.speaker ?? activeHosts[0].name;
    const lines = [...episode.lines];
    lines.splice(after + 1, 0, { speaker, text: "" });
    setEpisode({ ...episode, lines });
    setClips({});
  }

  // ---------- Audio ----------

  const speakers = useMemo(() => {
    const names = new Set<string>(activeHosts.map((h) => h.name));
    episode?.lines.forEach((l) => names.add(l.speaker));
    return [...names];
  }, [episode, activeHosts]);

  const allClipsReady =
    !!episode && episode.lines.length > 0 &&
    episode.lines.every((l, i) => {
      const v = voiceFor(l.speaker);
      return clips[i]?.key === clipKey(engine, l.speaker, l.text, voiceId(v), v.style);
    });

  async function renderAudio(): Promise<Record<number, Clip> | null> {
    if (!episode) return null;
    setError("");
    const next: Record<number, Clip> = { ...clips };
    const todo = episode.lines
      .map((l, i) => ({ l, i, v: voiceFor(l.speaker) }))
      .filter(({ l, i, v }) => l.text.trim() && next[i]?.key !== clipKey(engine, l.speaker, l.text, voiceId(v), v.style));

    setRendering({ done: episode.lines.length - todo.length, total: episode.lines.length });
    try {
      // Free tiers have low per-minute limits, so Gemini runs fewer requests at once and retries on 429.
      await pool(todo, engine === "gemini" ? 2 : 4, async ({ l, i, v }) => {
        let res: Response;
        for (let attempt = 0; ; attempt++) {
          res = await fetch("/api/tts", {
            method: "POST",
            headers: { "content-type": "application/json", ...authHeaders(settings) },
            body: JSON.stringify({ provider: engine, text: l.text, voice: voiceId(v), style: v.style }),
          });
          if (res.status !== 429 || attempt >= 3) break;
          await sleep(8000 * (attempt + 1));
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Voice generation failed (${res.status})`);
        }
        const blob = await res.blob();
        next[i] = { key: clipKey(engine, l.speaker, l.text, voiceId(v), v.style), url: URL.createObjectURL(blob), blob };
        setRendering((r) => (r ? { ...r, done: r.done + 1 } : r));
      });
      setClips({ ...next });
      return next;
    } catch (err) {
      setClips({ ...next });
      setError((err as Error).message);
      return null;
    } finally {
      setRendering(null);
    }
  }

  async function play(from = 0) {
    if (!episode) return;
    stopPlayback();
    const token = ++playToken.current;

    if (engine === "browser") {
      const synth = window.speechSynthesis;
      const voices = synth.getVoices().filter((v) => v.lang.startsWith("en"));
      const speak = (i: number) => {
        if (token !== playToken.current || i >= episode.lines.length) return setPlaying(null);
        const line = episode.lines[i];
        const u = new SpeechSynthesisUtterance(line.text);
        const idx = Math.max(0, speakers.indexOf(line.speaker));
        if (voices.length) u.voice = voices[(idx * 3) % voices.length];
        u.pitch = [1, 0.85, 1.15][idx % 3];
        u.rate = 1.03;
        u.onend = () => speak(i + 1);
        setPlaying(i);
        synth.speak(u);
      };
      speak(from);
      return;
    }

    const ready = allClipsReady ? clips : await renderAudio();
    if (!ready || token !== playToken.current) return;
    const audio = audioRef.current!;
    const playLine = (i: number) => {
      if (token !== playToken.current || i >= episode.lines.length) return setPlaying(null);
      if (!ready[i]) return playLine(i + 1);
      setPlaying(i);
      audio.src = ready[i].url;
      audio.onended = () => setTimeout(() => playLine(i + 1), 180);
      audio.play().catch(() => setPlaying(null));
    };
    playLine(from);
  }

  async function downloadAudio() {
    if (!episode) return;
    const ready = allClipsReady ? clips : await renderAudio();
    if (!ready) return;
    const parts = episode.lines.map((_, i) => ready[i]?.blob).filter(Boolean) as Blob[];
    if (engine === "gemini") {
      // Gemini clips are WAV: join their PCM data under one header.
      download(await joinWavs(parts), `${slugify(episode.title)}.wav`);
    } else {
      // MP3 frames can be concatenated directly, so the episode is just the clips in order.
      download(new Blob(parts, { type: "audio/mpeg" }), `${slugify(episode.title)}.mp3`);
    }
  }

  function downloadScript() {
    if (!episode) return;
    const md = [
      `# ${episode.title}`,
      "",
      episode.summary,
      "",
      `Hosts: ${episode.hosts.map((h) => `${h.name} (${h.persona})`).join(", ")}`,
      "",
      ...episode.lines.map((l) => `**${l.speaker}:** ${l.text}\n`),
    ].join("\n");
    download(new Blob([md], { type: "text/markdown" }), `${slugify(episode.title)}.md`);
  }

  const lineCount = episode?.lines.length ?? 0;
  const words = episode?.lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0) ?? 0;

  return (
    <div className="glow min-h-screen">
      <audio ref={audioRef} hidden />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-ink">
            <MicIcon />
          </div>
          <div>
            <p className="font-display text-lg leading-none">AI Podcast Studio</p>
            <p className="text-xs text-muted">AI writes it. AI voices perform it.</p>
          </div>
        </div>
        <button className="btn-ghost" onClick={() => setShowSettings(true)}>
          <KeyIcon /> Settings
        </button>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16">
        <section className="py-8 md:py-12">
          <h1 className="font-display text-4xl leading-tight md:text-6xl">
            Turn any idea into a <span className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-transparent">podcast episode</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-muted">
            Give it a topic, an article link or your own notes. Gemini or Claude writes a natural conversation between your hosts, streamed
            live, and AI voices turn it into an episode you can play and download.
          </p>
          {status && !canWrite && (
            <p className="mt-4 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
              Demo mode: to write new episodes, get a <strong>free</strong> Gemini API key from{" "}
              <a className="underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> (no card
              needed) and paste it in <button className="underline" onClick={() => setShowSettings(true)}>Settings</button>
              {status.accessCode && (status.gemini || status.claude) ? ", or enter the access code" : ""}. Or{" "}
              <button className="underline" onClick={loadSample}>load the sample episode</button> to try the player.
            </p>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ---------- 1. Source ---------- */}
          <section className="card h-fit p-5">
            <StepTitle n={1} title="What's the episode about?" />
            <div className="mt-4 flex gap-2">
              {MODES.map((m) => (
                <button key={m.id} className={`chip ${mode === m.id ? "chip-on" : ""}`} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode === "url" ? (
              <input className="field mt-3" value={input} onChange={(e) => setInput(e.target.value)} placeholder={MODES[1].placeholder} />
            ) : (
              <textarea
                className="field mt-3 resize-y"
                rows={mode === "text" ? 8 : 3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={MODES.find((m) => m.id === mode)!.placeholder}
                maxLength={40000}
              />
            )}

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <p className="label">Hosts</p>
                <div className="flex gap-1">
                  {[1, 2, 3].map((n) => (
                    <button key={n} className={`chip px-2.5 py-1 ${hostCount === n ? "chip-on" : ""}`} onClick={() => setHostCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {activeHosts.map((h, i) => (
                  <div key={i} className="rounded-xl border border-line p-3">
                    <div className="flex gap-2">
                      <input
                        className="field"
                        value={h.name}
                        maxLength={30}
                        onChange={(e) => setHosts(hosts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        aria-label={`Host ${i + 1} name`}
                      />
                      {engine === "browser" ? (
                        <span className="field w-40 truncate text-muted" title="Switch to Gemini or OpenAI voices to pick a voice">Browser voice</span>
                      ) : (
                        <select
                          className="field w-40"
                          value={voiceId(h)}
                          onChange={(e) =>
                            setHosts(hosts.map((x, j) => (j === i ? { ...x, [engine === "gemini" ? "gVoice" : "voice"]: e.target.value } : x)))
                          }
                          aria-label={`Host ${i + 1} voice`}
                        >
                          {VOICES[engine].map((v) => (
                            <option key={v.id} value={v.id}>{v.label} · {v.vibe}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <input
                      className="field mt-2 text-xs"
                      value={h.style}
                      maxLength={200}
                      onChange={(e) => setHosts(hosts.map((x, j) => (j === i ? { ...x, style: e.target.value } : x)))}
                      placeholder="Delivery style, e.g. energetic and fast"
                      aria-label={`Host ${i + 1} delivery style`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="label">Tone</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button key={t.id} className={`chip ${tone === t.id ? "chip-on" : ""}`} onClick={() => setTone(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-[auto_1fr]">
              <div>
                <p className="label">Length</p>
                <div className="mt-2 flex gap-1">
                  {LENGTHS.map((l) => (
                    <button key={l.id} className={`chip whitespace-nowrap px-2.5 ${length === l.id ? "chip-on" : ""}`} onClick={() => setLength(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="label">Audience</p>
                <input className="field mt-2" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="optional" maxLength={120} />
              </div>
            </div>

            <div className="mt-6">
              <p className="label">Script writer</p>
              <div className="mt-2 flex gap-2">
                <button
                  className={`chip ${writer === "gemini" ? "chip-on" : ""}`}
                  onClick={() => setWriter("gemini")}
                  title={canGemini ? `Google ${status?.models.gemini ?? "Gemini"}` : "Add a free Gemini key in Settings"}
                >
                  Gemini <span className="ml-1 rounded bg-emerald-400/15 px-1.5 text-[10px] font-semibold uppercase text-emerald-300">free tier</span>
                </button>
                <button
                  className={`chip ${writer === "claude" ? "chip-on" : ""}`}
                  onClick={() => setWriter("claude")}
                  title={canClaude ? `Anthropic ${status?.models.claude ?? "Claude"}` : "Add an Anthropic key in Settings"}
                >
                  Claude
                </button>
              </div>
              {status && !canWrite && (
                <p className="mt-2 text-xs text-muted">
                  {writer === "gemini" ? "Add a free Gemini key" : "Add an Anthropic key"} in{" "}
                  <button className="underline" onClick={() => setShowSettings(true)}>Settings</button> to use this writer.
                </p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button className="btn-primary flex-1" onClick={writeScript} disabled={writing || !canWrite}>
                {writing ? <><Eq /> {progressNote || "Writing…"}</> : "Write the episode"}
              </button>
              {writing ? (
                <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
              ) : (
                <button className="btn-ghost" onClick={loadSample}>Try a sample</button>
              )}
            </div>
            {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          </section>

          {/* ---------- 2. Script + 3. Listen ---------- */}
          <section className="card flex min-h-[32rem] flex-col p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <StepTitle n={2} title="Script & audio" />
              {episode && lineCount > 0 && (
                <p className="text-xs text-muted">{lineCount} lines · {words} words · ~{Math.max(1, Math.round(words / 150))} min</p>
              )}
            </div>

            {!episode ? (
              <EmptyState writing={writing} />
            ) : (
              <>
                <div className="mt-4">
                  <h2 className={`font-display text-2xl ${writing && !episode.summary ? "cursor" : ""}`}>{episode.title || " "}</h2>
                  {episode.summary && <p className="mt-1 text-sm text-muted">{episode.summary}</p>}
                  {meta && <p className="mt-2 font-mono text-[11px] text-muted/80">{meta}</p>}
                </div>

                {/* Player bar */}
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink/50 p-3">
                  {playing === null ? (
                    <button className="btn-primary" onClick={() => play(0)} disabled={writing || !lineCount || !!rendering}>
                      <PlayIcon /> Play episode
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={stopPlayback}>
                      <Eq /> Stop
                    </button>
                  )}
                  <div className="flex rounded-xl border border-line p-0.5 text-xs">
                    {([
                      { id: "gemini", label: "Gemini voices", ok: canGemini, tip: "Gemini TTS (free tier)", need: "Add a free Gemini key in Settings" },
                      { id: "openai", label: "OpenAI voices", ok: canOpenAI, tip: "OpenAI gpt-4o-mini-tts", need: "Add an OpenAI key in Settings" },
                      { id: "browser", label: "Browser", ok: true, tip: "Your browser's built-in voices (free, no download)", need: "" },
                    ] as const).map((o) => (
                      <button
                        key={o.id}
                        className={`rounded-lg px-2.5 py-1.5 disabled:opacity-40 ${engine === o.id ? "bg-white/10 text-white" : "text-muted"}`}
                        onClick={() => { stopPlayback(); setEngine(o.id); setEnginePinned(true); }}
                        disabled={!o.ok}
                        title={o.ok ? o.tip : o.need}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button className="btn-ghost px-3" onClick={downloadScript} disabled={writing || !lineCount}>Script .md</button>
                    {engine !== "browser" && (
                      <button className="btn-ghost px-3" onClick={downloadAudio} disabled={writing || !lineCount || !!rendering}>
                        {allClipsReady ? "Download audio" : "Render audio"}
                      </button>
                    )}
                  </div>
                  {rendering && (
                    <div className="w-full">
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-gradient-to-r from-accent to-accent-2 transition-all" style={{ width: `${(rendering.done / rendering.total) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted">Recording voices… {rendering.done}/{rendering.total} lines</p>
                    </div>
                  )}
                </div>

                {/* Script lines */}
                <ol className="mt-4 max-h-[36rem] flex-1 space-y-2 overflow-y-auto pr-1">
                  {episode.lines.map((line, i) => {
                    const idx = Math.max(0, speakers.indexOf(line.speaker));
                    return (
                      <li
                        key={i}
                        id={`line-${i}`}
                        className={`group rounded-xl border p-3 transition ${playing === i ? "border-accent bg-accent/10" : "border-line bg-ink/30"}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${["bg-accent", "bg-violet-400", "bg-emerald-400"][idx % 3]}`} />
                          <select
                            className="bg-transparent text-xs font-semibold uppercase tracking-wider text-muted outline-none"
                            value={line.speaker}
                            onChange={(e) => updateLine(i, { speaker: e.target.value })}
                            disabled={writing}
                          >
                            {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {playing === i && <Eq />}
                          <div className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                            <IconButton label="Play from here" onClick={() => play(i)} disabled={writing}><PlayIcon /></IconButton>
                            <IconButton label="Add line below" onClick={() => addLine(i)} disabled={writing}>＋</IconButton>
                            <IconButton label="Delete line" onClick={() => removeLine(i)} disabled={writing}>✕</IconButton>
                          </div>
                        </div>
                        <textarea
                          className="mt-1 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
                          value={line.text}
                          rows={Math.max(1, Math.ceil(line.text.length / 70))}
                          onChange={(e) => updateLine(i, { text: e.target.value })}
                          readOnly={writing}
                        />
                      </li>
                    );
                  })}
                  {writing && <li className="cursor px-3 text-sm text-muted">{lineCount ? "" : "Drafting the opening hook"}</li>}
                </ol>
              </>
            )}
          </section>
        </div>

        <HowItWorks />
      </main>

      {showSettings && (
        <SettingsPanel
          value={settings}
          status={status}
          onClose={() => setShowSettings(false)}
          onSave={(s) => { setSettings(s); saveSettings(s); setShowSettings(false); }}
        />
      )}
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-7 w-7 place-items-center rounded-full border border-accent/60 font-mono text-xs text-accent">{n}</span>
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

function EmptyState({ writing }: { writing: boolean }) {
  return (
    <div className="grid flex-1 place-items-center text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-line">
          {writing ? <Eq /> : <MicIcon />}
        </div>
        <p className="mt-4 font-medium">{writing ? "Warming up the mics…" : "Your script will stream in here"}</p>
        <p className="mt-1 text-sm text-muted">Edit any line, reassign speakers, then press play.</p>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { t: "Source", d: "Topic, pasted text, or a link. Links are fetched server-side and cleaned with Mozilla Readability, with SSRF checks." },
    { t: "Script", d: "Gemini or Claude writes the episode as JSON that must match a strict schema, streamed and parsed live so lines appear as they're written." },
    { t: "Voices", d: "Each line goes to steerable text-to-speech (Gemini or OpenAI) with a per-host voice and delivery style. Browser voices are the free fallback." },
    { t: "Episode", d: "Clips play back in order with line highlighting and export as one audio file plus a Markdown script." },
  ];
  return (
    <section className="mt-14">
      <p className="label">How it works</p>
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.t} className="card p-4">
            <p className="font-mono text-xs text-accent">0{i + 1}</p>
            <p className="mt-1 font-semibold">{s.t}</p>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted">
        Built with Next.js, the Gemini API, the Claude API and OpenAI TTS. Bring your own keys: they stay in your browser and are only sent with your own requests.
      </p>
    </section>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-7 w-7 place-items-center rounded-lg text-xs text-muted hover:bg-white/10 hover:text-white disabled:opacity-40">
      {children}
    </button>
  );
}

function Eq() {
  return <span className="eq inline-flex items-end" aria-hidden><span /><span /><span /><span /></span>;
}

function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4.5v15l13-7.5z" /></svg>;
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M16 7l3 3" />
    </svg>
  );
}
