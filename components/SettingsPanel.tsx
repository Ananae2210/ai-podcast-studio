"use client";

import { useState } from "react";
import type { Settings } from "@/lib/client";

type Status = { claude: boolean; tts: boolean; accessCode: boolean; model: string } | null;

export default function SettingsPanel({
  value, status, onSave, onClose,
}: { value: Settings; status: Status; onSave: (s: Settings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value.trim() });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <h2 className="font-display text-2xl">Settings</h2>
        <p className="mt-1 text-sm text-muted">
          Keys are saved only in this browser (localStorage) and sent with your own requests. They're never stored on the server.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="Anthropic API key (scripts)" hint={status?.claude ? "Optional: this site has a shared key." : "Required to write new episodes."}>
            <input className="field" type="password" placeholder="sk-ant-…" value={draft.anthropicKey} onChange={set("anthropicKey")} autoComplete="off" />
          </Field>
          <Field label="OpenAI API key (voices)" hint={status?.tts ? "Optional: this site has a shared key." : "Optional: without it, browser voices are used."}>
            <input className="field" type="password" placeholder="sk-…" value={draft.openaiKey} onChange={set("openaiKey")} autoComplete="off" />
          </Field>
          {status?.accessCode && (
            <Field label="Access code" hint="Unlocks the site owner's shared keys.">
              <input className="field" value={draft.accessCode} onChange={set("accessCode")} autoComplete="off" />
            </Field>
          )}
        </div>

        {status && <p className="mt-4 font-mono text-[11px] text-muted">Script model: {status.model}</p>}

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
