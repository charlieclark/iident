"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Card, cx, Spinner } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import type { StepProps } from "./CreateFlow";

type Voice = { id: string; label: string };

/** The voices on offer come from the server, so they match the speech provider in use. */
function useVoices() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/voices")
      .then((r) => r.json())
      .then((d: { voices: Voice[] }) => alive && setVoices(d.voices))
      .catch(() => alive && setVoices([]));
    return () => {
      alive = false;
    };
  }, []);
  return voices;
}

/**
 * The creator picks the voice their avatar speaks with from a set of
 * ready-made voices. "Play" says the avatar's greeting in that voice.
 */
export function VoiceStep({ avatar, token, onChange, goTo }: StepProps) {
  const voices = useVoices();
  const [playing, setPlaying] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = avatar.voice?.voiceId ?? null;

  async function play(id: string) {
    setPlaying(id);
    setError(null);
    try {
      const { url } = await api.previewVoice(avatar.id, token, { preset: id });
      const audio = new Audio(url);
      audio.onended = () => setPlaying((p) => (p === id ? null : p));
      await audio.play();
    } catch {
      setPlaying(null);
      setError("That voice couldn't be played just now. Try again in a moment.");
    }
  }

  async function use(id: string) {
    setSaving(id);
    setError(null);
    try {
      onChange((await api.patch(avatar.id, token, { voicePreset: id })).avatar);
    } catch {
      setError("That voice couldn't be saved. Try again in a moment.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section>
        <p className="text-sm font-medium text-accent-600">Step 3</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Pick a voice</h1>
        <p className="mt-2 max-w-xl text-ink-600">Choose the voice your avatar speaks with. Tap Play to hear it say your greeting.</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          {voices === null && (
            <p className="flex items-center gap-2 text-sm text-ink-500">
              <Spinner className="size-4" /> Loading voices…
            </p>
          )}
          {voices?.length === 0 && <p className="text-sm text-ink-500">No voices are available right now. You can carry on and pick one later.</p>}
          {voices?.map((v) => (
            <div
              key={v.id}
              className={cx(
                "flex items-center justify-between gap-2 rounded-2xl border bg-card p-3",
                current === v.id ? "border-accent-500 ring-2 ring-accent-100" : "border-ink-100",
              )}
            >
              <span className="text-sm font-medium">{v.label}</span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" aria-label={`Play ${v.label}`} onClick={() => play(v.id)}>
                  {playing === v.id ? <Spinner className="size-3.5" /> : "Play"}
                </Button>
                <Button
                  size="sm"
                  variant={current === v.id ? "primary" : "secondary"}
                  loading={saving === v.id}
                  aria-label={current === v.id ? `${v.label}, selected` : `Use ${v.label}`}
                  onClick={() => use(v.id)}
                >
                  {current === v.id ? "Selected" : "Use"}
                </Button>
              </span>
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
          <p className="font-medium text-ink-900">About voices</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>These are ready-made voices. Your own voice is never recorded or copied.</li>
            <li>You can switch any time, and your live page updates right away.</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
