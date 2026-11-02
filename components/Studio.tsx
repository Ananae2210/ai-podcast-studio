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

  const minutes = Math.max(1, Math.round(words / 150));
  const hostColor = (idx: number) => ["bg-host-1", "bg-host-2", "bg-host-3"][idx % 3];

  return (
    <div className="min-h-screen">
      <audio ref={audioRef} hidden />

      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-accent text-white">
              <WaveIcon />
            </span>
            <span className="font-display text-[19px] font-semibold tracking-tight">
              Podcast Studio <span className="ml-1 rounded border border-line-strong px-1.5 py-0.5 align-middle font-sans text-[11px] font-semibold text-muted">AI</span>
            </span>
          </a>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#studio" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-fg sm:block">Studio</a>
            <a href="#how-it-works" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted hover:text-fg sm:block">How it works</a>
            <a
              href="https://github.com/Ananae2210/ai-podcast-studio"
              target="_blank"
              rel="noreferrer"
              className="grid h-9 w-9 place-items-center rounded-md text-muted hover:text-fg"
              aria-label="Source code on GitHub"
              title="Source code on GitHub"
            >
              <GitHubIcon />
            </a>
            <button className="btn-ghost btn-sm" onClick={() => setShowSettings(true)}>
              <KeyIcon /> API keys
            </button>
          </nav>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="hero-glow">
          <div className="mx-auto max-w-6xl px-5 pb-10 pt-14 md:pb-14 md:pt-20">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[13px] font-medium text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI script writing · Multi-voice text-to-speech
            </p>
            <h1 className="mt-5 max-w-4xl font-display text-[40px] font-semibold leading-[1.05] tracking-tight md:text-[64px]">
              Turn any idea into a <span className="text-accent">podcast episode</span>.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
              Start from a topic, an article link or your own notes. An AI model writes a natural conversation between your hosts, and AI
              voices perform it as an episode you can play, edit and download.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#studio" className="btn-primary">Open the studio</a>
              <button className="btn-ghost" onClick={() => { loadSample(); document.getElementById("studio")?.scrollIntoView(); }}>
                <PlayIcon /> Hear a sample
              </button>
            </div>
          </div>
        </section>

        {/* ---------- Studio ---------- */}
        <section id="studio" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16">
          {status && !canWrite && (
            <div className="mb-6 flex gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-sm">
              <span className="mt-0.5 text-accent"><InfoIcon /></span>
              <p className="leading-relaxed text-muted">
                <span className="font-semibold text-fg">Demo mode.</span> To write new episodes, get a free Gemini API key from{" "}
                <a className="text-fg underline underline-offset-2" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>{" "}
                (no card needed) and add it under{" "}
                <button className="text-fg underline underline-offset-2" onClick={() => setShowSettings(true)}>API keys</button>
                {status.accessCode && (status.gemini || status.claude) ? ", or enter the access code" : ""}. You can also{" "}
                <button className="text-fg underline underline-offset-2" onClick={loadSample}>load the sample episode</button> to try the player.
              </p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* ---------- 1. Setup ---------- */}
            <section className="card h-fit">
              <div className="card-head">
                <StepTitle n={1} title="Episode setup" subtitle="Source, hosts and style" />
              </div>

              <div className="space-y-6 p-5">
                <div>
                  <p className="label">Source</p>
                  <div className="seg mt-2 w-full">
                    {MODES.map((m) => (
                      <button key={m.id} className={`seg-item flex-1 ${mode === m.id ? "seg-on" : ""}`} onClick={() => setMode(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {mode === "url" ? (
                    <input className="field mt-3" value={input} onChange={(e) => setInput(e.target.value)} placeholder={MODES[1].placeholder} />
                  ) : (
                    <textarea
                      className="field mt-3 resize-y leading-relaxed"
                      rows={mode === "text" ? 8 : 3}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={MODES.find((m) => m.id === mode)!.placeholder}
                      maxLength={40000}
                    />
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <p className="label">Hosts</p>
                    <div className="seg">
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          className={`seg-item px-2.5 py-1 ${hostCount === n ? "seg-on" : ""}`}
                          onClick={() => setHostCount(n)}
                          aria-label={`${n} host${n > 1 ? "s" : ""}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {activeHosts.map((h, i) => (
                      <div key={i} className="rounded-lg border border-line bg-panel-2/60 p-3">
                        <div className="flex items-center gap-2">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold text-ink ${hostColor(i)}`}>
                            {(h.name.trim()[0] ?? "?").toUpperCase()}
                          </span>
                          <input
                            className="field min-w-0"
                            value={h.name}
                            maxLength={30}
                            onChange={(e) => setHosts(hosts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            aria-label={`Host ${i + 1} name`}
                          />
                          {engine === "browser" ? (
                            <span className="field w-36 shrink-0 truncate text-muted" title="Switch to Gemini or OpenAI voices to pick a voice">
                              Browser voice
                            </span>
                          ) : (
                            <select
                              className="field w-36 shrink-0"
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
                          className="field mt-2 text-[13px]"
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

                <div>
                  <p className="label">Tone</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TONES.map((t) => (
                      <button key={t.id} className={`chip ${tone === t.id ? "chip-on" : ""}`} onClick={() => setTone(t.id)}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                  <div>
                    <p className="label">Length</p>
                    <div className="seg mt-2">
                      {LENGTHS.map((l) => (
                        <button key={l.id} className={`seg-item whitespace-nowrap ${length === l.id ? "seg-on" : ""}`} onClick={() => setLength(l.id)}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="label">Audience</p>
                    <input
                      className="field mt-2 h-[42px]"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="Optional, e.g. beginners"
                      maxLength={120}
                    />
                  </div>
                </div>

                <div>
                  <p className="label">Script writer</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <WriterOption
                      active={writer === "gemini"}
                      onClick={() => setWriter("gemini")}
                      name="Gemini"
                      badge="Free tier"
                      detail={status?.models?.gemini ?? "gemini-3.8-flash"}
                      available={canGemini}
                    />
                    <WriterOption
                      active={writer === "claude"}
                      onClick={() => setWriter("claude")}
                      name="Claude"
                      detail={status?.models?.claude ?? "claude-opus-5-5"}
                      available={canClaude}
                    />
                  </div>
                  {status && !canWrite && (
                    <p className="mt-2 text-[13px] text-muted">
                      {writer === "gemini" ? "Add a free Gemini key" : "Add an Anthropic key"} under{" "}
                      <button className="text-fg underline underline-offset-2" onClick={() => setShowSettings(true)}>API keys</button> to use this writer.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-line p-5">
                <button className="btn-primary flex-1" onClick={writeScript} disabled={writing || !canWrite}>
                  {writing ? <><Eq /> {progressNote || "Writing…"}</> : <><SparkIcon /> Write the episode</>}
                </button>
                {writing ? (
                  <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>Stop</button>
                ) : (
                  <button className="btn-ghost" onClick={loadSample}>Try a sample</button>
                )}
                {error && (
                  <p className="flex w-full gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
                    <span className="mt-0.5 shrink-0"><InfoIcon /></span> {error}
                  </p>
                )}
              </div>
            </section>

            {/* ---------- 2. Script & audio ---------- */}
            <section className="card flex min-h-[34rem] flex-col">
              <div className="card-head">
                <StepTitle n={2} title="Script & audio" subtitle="Edit lines, choose voices, listen" />
                {episode && lineCount > 0 && (
                  <div className="hidden gap-4 text-right sm:flex">
                    <Stat value={lineCount} label="lines" />
                    <Stat value={words} label="words" />
                    <Stat value={`~${minutes}`} label="min" />
                  </div>
                )}
              </div>

              {!episode ? (
                <EmptyState writing={writing} onSample={loadSample} />
              ) : (
                <div className="flex flex-1 flex-col p-5">
                  <div>
                    <h2 className={`font-display text-[26px] font-semibold leading-tight ${writing && !episode.summary ? "cursor" : ""}`}>
                      {episode.title || " "}
                    </h2>
                    {episode.summary && <p className="mt-1.5 leading-relaxed text-muted">{episode.summary}</p>}
                    {meta && <p className="mt-2 font-mono text-[11px] text-muted/80">{meta}</p>}
                  </div>

                  {/* Player */}
                  <div className="mt-5 rounded-lg border border-line bg-panel-2/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {playing === null ? (
                        <button className="btn-primary w-full sm:w-auto" onClick={() => play(0)} disabled={writing || !lineCount || !!rendering}>
                          <PlayIcon /> Play episode
                        </button>
                      ) : (
                        <button className="btn-primary w-full sm:w-auto" onClick={stopPlayback}>
                          <StopIcon /> Stop
                        </button>
                      )}
                      <div className="seg">
                        {([
                          { id: "gemini", label: "Gemini", ok: canGemini, tip: "Gemini TTS (free tier)", need: "Add a free Gemini key under API keys" },
                          { id: "openai", label: "OpenAI", ok: canOpenAI, tip: "OpenAI gpt-4o-mini-tts", need: "Add an OpenAI key under API keys" },
                          { id: "browser", label: "Browser", ok: true, tip: "Your browser's built-in voices (free)", need: "" },
                        ] as const).map((o) => (
                          <button
                            key={o.id}
                            className={`seg-item px-2.5 text-[13px] ${engine === o.id ? "seg-on" : ""}`}
                            onClick={() => { stopPlayback(); setEngine(o.id); setEnginePinned(true); }}
                            disabled={!o.ok}
                            title={o.ok ? o.tip : o.need}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      <div className="ml-auto flex gap-2">
                        <button className="btn-ghost btn-sm" onClick={downloadScript} disabled={writing || !lineCount} title="Download the script as Markdown">
                          <DownloadIcon /> Script
                        </button>
                        {engine !== "browser" && (
                          <button
                            className="btn-ghost btn-sm"
                            onClick={downloadAudio}
                            disabled={writing || !lineCount || !!rendering}
                            title={allClipsReady ? "Download the episode audio" : "Generate every voice line, then download"}
                          >
                            <DownloadIcon /> {allClipsReady ? "Audio" : "Render audio"}
                          </button>
                        )}
                      </div>
                    </div>
                    {rendering && (
                      <div className="mt-3">
                        <div className="h-1 overflow-hidden rounded-full bg-line">
                          <div className="h-full bg-accent transition-all" style={{ width: `${(rendering.done / rendering.total) * 100}%` }} />
                        </div>
                        <p className="mt-1.5 text-[13px] text-muted">Recording voices · {rendering.done} of {rendering.total} lines</p>
                      </div>
                    )}
                  </div>

                  {/* Script lines */}
                  <ol className="mt-4 max-h-[38rem] flex-1 space-y-2 overflow-y-auto pr-1">
                    {episode.lines.map((line, i) => {
                      const idx = Math.max(0, speakers.indexOf(line.speaker));
                      const active = playing === i;
                      return (
                        <li
                          key={i}
                          id={`line-${i}`}
                          className={`group relative rounded-lg border px-4 py-3 transition ${
                            active ? "border-accent/60 bg-accent/[0.06]" : "border-line bg-ink/40 hover:border-line-strong"
                          }`}
                        >
                          {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${hostColor(idx)}`} />
                            <select
                              className="bg-transparent text-[13px] font-semibold text-fg/90 outline-none"
                              value={line.speaker}
                              onChange={(e) => updateLine(i, { speaker: e.target.value })}
                              disabled={writing}
                              aria-label="Speaker"
                            >
                              {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            {active && <span className="text-accent"><Eq /></span>}
                            <div className="ml-auto flex gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <IconButton label="Play from here" onClick={() => play(i)} disabled={writing}><PlayIcon /></IconButton>
                              <IconButton label="Add line below" onClick={() => addLine(i)} disabled={writing}><PlusIcon /></IconButton>
                              <IconButton label="Delete line" onClick={() => removeLine(i)} disabled={writing}><TrashIcon /></IconButton>
                            </div>
                          </div>
                          <textarea
                            className="mt-1 w-full resize-none bg-transparent text-[15px] leading-relaxed text-fg/90 outline-none field-sizing-content"
                            value={line.text}
                            rows={Math.max(1, Math.ceil(line.text.length / 72))}
                            onChange={(e) => updateLine(i, { text: e.target.value })}
                            readOnly={writing}
                            aria-label={`Line ${i + 1}`}
                          />
                        </li>
                      );
                    })}
                    {writing && <li className="cursor px-4 text-sm text-muted">{lineCount ? "" : "Drafting the opening hook"}</li>}
                  </ol>
                </div>
              )}
            </section>
          </div>
        </section>

        <HowItWorks />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>AI Podcast Studio · a portfolio project by Ananae</p>
          <div className="flex gap-5">
            <a className="hover:text-fg" href="https://github.com/Ananae2210/ai-podcast-studio" target="_blank" rel="noreferrer">GitHub</a>
            <a className="hover:text-fg" href="#how-it-works">How it works</a>
            <button className="hover:text-fg" onClick={() => setShowSettings(true)}>API keys</button>
          </div>
        </div>
      </footer>

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

function StepTitle({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-panel-2 font-display text-sm font-semibold text-muted">
        {String(n).padStart(2, "0")}
      </span>
      <div>
        <h2 className="font-display text-[17px] font-semibold leading-tight">{title}</h2>
        <p className="text-[13px] text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="font-display text-lg font-semibold leading-none">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted">{label}</p>
    </div>
  );
}

function WriterOption({
  active, onClick, name, detail, badge, available,
}: { active: boolean; onClick: () => void; name: string; detail: string; badge?: string; available: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${active ? "border-accent/70 bg-accent/[0.07]" : "border-line bg-ink hover:border-line-strong"}`}
      aria-pressed={active}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-accent" : "border-line-strong"}`}>
          {active && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className="font-semibold">{name}</span>
        {badge && <span className="whitespace-nowrap rounded bg-host-3/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-host-3">{badge}</span>}
      </span>
      <span className="mt-1 block truncate font-mono text-[11px] text-muted">{detail}</span>
      {!available && <span className="mt-0.5 block text-[11px] text-muted">Needs an API key</span>}
    </button>
  );
}

function EmptyState({ writing, onSample }: { writing: boolean; onSample: () => void }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div className="max-w-xs">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl border border-line bg-panel-2 text-muted">
          {writing ? <span className="text-accent"><Eq /></span> : <WaveIcon size={22} />}
        </div>
        <p className="mt-4 font-display text-lg font-semibold">{writing ? "Writing your episode…" : "No episode yet"}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {writing
            ? "Lines will appear here as they're written."
            : "Set up your episode on the left and press Write. The script streams in here, ready to edit and play."}
        </p>
        {!writing && (
          <button className="btn-ghost btn-sm mt-5" onClick={onSample}>
            <PlayIcon /> Load a sample episode
          </button>
        )}
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { t: "Source", d: "A topic, pasted text, or a link. Links are fetched server-side and cleaned with Mozilla Readability, with SSRF checks." },
    { t: "Script", d: "Gemini or Claude writes the episode as JSON that must match a strict schema. It streams in and is parsed live, line by line." },
    { t: "Voices", d: "Each line goes to steerable text-to-speech with its host's voice and delivery style. Browser voices are the free fallback." },
    { t: "Episode", d: "Clips play back in order with the current line highlighted, and export as one audio file plus a Markdown script." },
  ];
  const stack = ["Next.js 16", "TypeScript", "Tailwind CSS", "Gemini API", "Claude API", "OpenAI TTS", "Zod"];
  return (
    <section id="how-it-works" className="scroll-mt-20 border-t border-line bg-panel/40">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <p className="label">How it works</p>
        <h2 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">From an idea to a finished episode in four steps</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.t} className="card p-5">
              <p className="font-display text-sm font-semibold text-accent">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-2 font-display text-lg font-semibold">{s.t}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted">Built with</span>
          {stack.map((s) => (
            <span key={s} className="rounded-md border border-line bg-panel px-2.5 py-1 text-[13px] font-medium text-fg/85">{s}</span>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">
          API keys you add stay in your browser and are only sent with your own requests.
        </p>
      </div>
    </section>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Eq() {
  return <span className="eq inline-flex items-end" aria-hidden><span /><span /><span /><span /></span>;
}

const svg = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4.5v15l13-7.5z" /></svg>;
}

function StopIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
}

function WaveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svg} strokeWidth={2.2} aria-hidden>
      <path d="M3 12h1M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...svg} aria-hidden>
      <circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M16 7l3 3" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...svg} aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...svg} aria-hidden>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svg} aria-hidden><path d="M12 5v14M5 12h14" /></svg>;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...svg} aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...svg} aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.86v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}
