"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Avatar } from "@/lib/client/api";
import { Recorder, toWav } from "@/lib/client/audio";
import { Button, Card, cx, Notice, Segmented, Spinner } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import type { StepProps } from "./CreateFlow";

const SCRIPT =
  "Hi there! Thanks for stopping by. I love meeting new people and hearing what they're working on. " +
  "On a typical day you'll find me juggling a few projects, grabbing a coffee, and probably talking a little too fast. " +
  "Ask me anything you like, and I'll do my best to answer just the way I would in person.";

const PRESETS = [
  { id: "Friendly_Person", label: "Friendly" },
  { id: "Calm_Woman", label: "Calm (female)" },
  { id: "Casual_Guy", label: "Casual (male)" },
  { id: "Wise_Woman", label: "Wise (female)" },
  { id: "Deep_Voice_Man", label: "Deep (male)" },
  { id: "Lively_Girl", label: "Lively (female)" },
  { id: "Patient_Man", label: "Patient (male)" },
  { id: "Elegant_Man", label: "Elegant (male)" },
];

const MIN_SECONDS = 10;
const MAX_SECONDS = 60;

function play(url: string) {
  const a = new Audio(url);
  a.play().catch(() => {});
  return a;
}

export function VoiceStep({ avatar, token, onChange, goTo }: StepProps) {
  const [mode, setMode] = useState<"record" | "preset">(avatar.voice?.mode === "preset" ? "preset" : "record");
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <p className="text-sm font-medium text-accent-600">Step 3</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Give it your voice</h1>
        <p className="mt-2 max-w-xl text-ink-600">
          Read a short script and your avatar will speak in a clone of your voice. Prefer not to? Pick a stock voice.
        </p>
        <div className="mt-6">
          <Segmented
            value={mode}
            options={[
              { id: "record", label: "My voice" },
              { id: "preset", label: "Stock voice" },
            ]}
            onChange={setMode}
          />
        </div>
        <div className="mt-6">
          {mode === "record" ? (
            <RecordVoice avatar={avatar} token={token} onChange={onChange} />
          ) : (
            <PresetVoices avatar={avatar} token={token} onChange={onChange} />
          )}
        </div>
        <div className="mt-8 flex gap-3">
          <Button size="lg" disabled={!avatar.voice} onClick={() => goTo("persona")}>
            Continue
          </Button>
          {!avatar.voice && (
            <Button size="lg" variant="ghost" onClick={() => goTo("persona")}>
              Skip for now
            </Button>
          )}
        </div>
      </section>
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <BuildCard avatar={avatar} />
        <Card className="p-4 text-sm text-ink-600">
          <p className="font-medium text-ink-900">Tips for a great clone</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Find a quiet room without echo.</li>
            <li>Speak naturally, as you would to a friend.</li>
            <li>15 to 30 seconds is plenty.</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function RecordVoice({ avatar, token, onChange }: { avatar: Avatar; token: string; onChange: (a: Avatar) => void }) {
  const recorder = useRef<Recorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    let raf = 0;
    const tick = () => {
      const r = recorder.current;
      if (r) {
        setLevel(r.level());
        const s = r.elapsed();
        setSeconds(s);
        if (s >= MAX_SECONDS) void stop();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording]);

  useEffect(() => () => recorder.current?.cancel(), []);

  async function start() {
    setError(null);
    setTake(null);
    try {
      const r = new Recorder();
      await r.start();
      recorder.current = r;
      setRecording(true);
    } catch {
      setError("We couldn't access your microphone. Check your browser permissions.");
    }
  }

  async function stop() {
    const r = recorder.current;
    if (!r) return;
    recorder.current = null;
    setRecording(false);
    const raw = await r.stop();
    try {
      const { wav, seconds } = await toWav(raw);
      if (seconds < MIN_SECONDS) return setError(`That was ${Math.round(seconds)} seconds. Record at least ${MIN_SECONDS}.`);
      setTake({ blob: wav, url: URL.createObjectURL(wav), name: "voice.wav" });
    } catch {
      setError("We couldn't process that recording. Please try again.");
    }
  }

  async function upload(file: File) {
    setError(null);
    try {
      const { wav, seconds } = await toWav(file);
      if (seconds < MIN_SECONDS) return setError(`That clip is ${Math.round(seconds)} seconds. Use at least ${MIN_SECONDS}.`);
      setTake({ blob: wav, url: URL.createObjectURL(wav), name: "voice.wav" });
    } catch {
      setError("We couldn't read that audio file. Try an MP3, WAV or M4A.");
    }
  }

  async function clone() {
    if (!take) return;
    setBusy(true);
    setError(null);
    try {
      const { avatar: next } = await api.cloneVoice(avatar.id, token, take.blob, take.name);
      onChange(next);
      setTake(null);
      if (next.voice?.previewUrl) play(next.voice.previewUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasClone = avatar.voice?.mode === "clone";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Read this aloud</p>
        <p className="mt-2 text-lg leading-relaxed text-ink-800">{SCRIPT}</p>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <Button size="lg" variant="dark" onClick={stop}>
            <span className="size-2.5 animate-pulse rounded-sm bg-red-500" /> Stop ({Math.floor(seconds)}s)
          </Button>
        ) : (
          <Button size="lg" onClick={start}>
            <span className="size-2.5 rounded-full bg-white" /> {take || hasClone ? "Record again" : "Start recording"}
          </Button>
        )}
        {!recording && (
          <Button size="lg" variant="ghost" onClick={() => fileRef.current?.click()}>
            Upload audio instead
          </Button>
        )}
        <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>

      {recording && (
        <div className="flex items-center gap-3">
          <div className="flex h-8 flex-1 items-end gap-0.5">
            {Array.from({ length: 40 }, (_, i) => (
              <span
                key={i}
                className="flex-1 rounded-full bg-accent-400 transition-[height] duration-75"
                style={{ height: `${Math.max(8, Math.min(100, level * 100 * (0.6 + 0.4 * Math.sin(i * 1.7 + seconds * 9))))}%` }}
              />
            ))}
          </div>
          <span className={cx("text-sm tabular-nums", seconds < MIN_SECONDS ? "text-ink-400" : "text-emerald-600")}>
            {seconds < MIN_SECONDS ? `${Math.ceil(MIN_SECONDS - seconds)}s to go` : "Sounds good"}
          </span>
        </div>
      )}

      {take && (
        <Card className="space-y-3 p-4">
          <audio controls src={take.url} className="w-full" />
          <label className="flex items-start gap-3 text-sm text-ink-700">
            <input type="checkbox" className="mt-0.5 size-4 accent-accent-500" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>This is my voice, or I have the speaker&apos;s permission to clone it.</span>
          </label>
          <Button onClick={clone} loading={busy} disabled={!consent}>
            {busy ? "Cloning your voice…" : "Clone my voice"}
          </Button>
        </Card>
      )}

      {hasClone && !take && (
        <Notice>
          <span className="flex flex-wrap items-center gap-3">
            Your voice is cloned.
            <VoicePreviewButton avatar={avatar} token={token} />
          </span>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

function VoicePreviewButton({ avatar, token }: { avatar: Avatar; token: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.previewVoice(avatar.id, token, {});
          play(r.url);
        } finally {
          setBusy(false);
        }
      }}
    >
      Play a sample
    </Button>
  );
}

function PresetVoices({ avatar, token, onChange }: { avatar: Avatar; token: string; onChange: (a: Avatar) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const current = avatar.voice?.mode === "preset" ? avatar.voice.voiceId : null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PRESETS.map((v) => (
        <div
          key={v.id}
          className={cx(
            "flex items-center justify-between gap-2 rounded-2xl border bg-card p-3",
            current === v.id ? "border-accent-500 ring-2 ring-accent-100" : "border-ink-100",
          )}
        >
          <span className="text-sm font-medium">{v.label}</span>
          <span className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setPlaying(v.id);
                try {
                  const r = await api.previewVoice(avatar.id, token, { preset: v.id });
                  play(r.url).onended = () => setPlaying(null);
                } catch {
                  setPlaying(null);
                }
              }}
            >
              {playing === v.id ? <Spinner className="size-3.5" /> : "Play"}
            </Button>
            <Button
              size="sm"
              variant={current === v.id ? "primary" : "secondary"}
              loading={saving === v.id}
              onClick={async () => {
                setSaving(v.id);
                try {
                  const { avatar: next } = await api.patch(avatar.id, token, { voicePreset: v.id });
                  onChange(next);
                } finally {
                  setSaving(null);
                }
              }}
            >
              {current === v.id ? "Selected" : "Use"}
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}
