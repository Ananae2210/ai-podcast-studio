"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/client";
import type { Status as AppStatus } from "./Studio";

type Status = AppStatus | null;

export default function SettingsPanel({
  value, status, onSave, onClose,
}: { value: Settings; status: Status; onSave: (s: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value.trim() });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="API keys">
        <h2 className="font-display text-2xl font-semibold">API keys</h2>
        <p className="mt-1 text-sm text-muted">
          Keys are saved only in this browser (localStorage) and sent with your own requests. They're never stored on the server.
        </p>

        <div className="mt-5 space-y-4">
          <Field
            label="Gemini API key (scripts + voices, free)"
            hint={status?.gemini ? "Optional: this site has a shared key." : "Recommended. Free at aistudio.google.com/apikey, no card needed."}
          >
            <input className="field" type="password" placeholder="AIza…" value={draft.geminiKey} onChange={set("geminiKey")} autoComplete="off" />
          </Field>
          <Field label="Anthropic API key (Claude scripts)" hint={status?.claude ? "Optional: this site has a shared key." : "Optional: paid, pay-as-you-go."}>
            <input className="field" type="password" placeholder="sk-ant-…" value={draft.anthropicKey} onChange={set("anthropicKey")} autoComplete="off" />
          </Field>
          <Field label="OpenAI API key (voices)" hint={status?.tts ? "Optional: this site has a shared key." : "Optional: paid. Gemini or browser voices work without it."}>
            <input className="field" type="password" placeholder="sk-…" value={draft.openaiKey} onChange={set("openaiKey")} autoComplete="off" />
          </Field>
          {status?.accessCode && (
            <Field label="Access code" hint="Unlocks the site owner's shared keys.">
              <input className="field" value={draft.accessCode} onChange={set("accessCode")} autoComplete="off" />
            </Field>
          )}
        </div>

        {status?.models && (
          <p className="mt-4 font-mono text-[11px] text-muted">
            Models: {status.models.gemini} · {status.models.claude}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      <span className="mt-1 block text-xs text-muted">{hint}</span>
    </label>
  );
}
