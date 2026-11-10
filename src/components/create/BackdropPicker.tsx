"use client";

import { useRef, useState } from "react";
import { BACKDROP_PRESETS } from "@/lib/avatar/backdrop";
import { api, type Avatar, type BackdropChoice } from "@/lib/client/api";
import { Button, Card, cx, inputClass, Notice } from "@/components/ui";

const IDEAS = ["a sunlit design studio with plants", "a cozy cafe in the evening", "a mountain trail at golden hour", "a neon-lit city street at night"];

/**
 * Lets the creator choose what sits behind their avatar: a gradient, a color
 * of their own, a picture they upload, or a scene drawn from a description.
 * Every choice saves right away and shows on the stage next to it.
 */
export function BackdropPicker({ avatar, token, onChange }: { avatar: Avatar; token: string; onChange: (a: Avatar) => void }) {
  const current = avatar.backdrop;
  const [busy, setBusy] = useState<"choice" | "upload" | "scene" | null>(null);
  const [scene, setScene] = useState(current.prompt ?? "");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  async function apply(kind: NonNullable<typeof busy>, work: () => Promise<{ avatar: Avatar }>) {
    setBusy(kind);
    setError(null);
    try {
      onChange((await work()).avatar);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const choose = (backdrop: BackdropChoice) => apply("choice", () => api.patch(avatar.id, token, { backdrop }));

  return (
    <Card className="space-y-3 p-4 text-sm">
      <p className="font-medium">Background</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Background">
        {BACKDROP_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={current.kind === "preset" && current.id === p.id}
            title={p.label}
            aria-label={p.label}
            disabled={busy === "upload" || busy === "scene"}
            onClick={() => choose({ kind: "preset", id: p.id })}
            className={cx(
              "size-9 rounded-full border transition-transform hover:scale-110",
              current.kind === "preset" && current.id === p.id ? "ring-2 ring-accent-500 ring-offset-2" : "border-black/10",
            )}
            style={{ background: p.css }}
          />
        ))}
        <label
          title="Your own color"
          className={cx(
            "relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border text-xs text-ink-600 transition-transform hover:scale-110",
            current.kind === "color" ? "ring-2 ring-accent-500 ring-offset-2" : "border-dashed border-ink-300",
          )}
          style={current.kind === "color" ? { background: current.color } : undefined}
        >
          {current.kind !== "color" && <span aria-hidden>+</span>}
          <input
            type="color"
            aria-label="Your own color"
            className="absolute inset-0 cursor-pointer opacity-0"
            defaultValue={current.color ?? "#6c4dfa"}
            onChange={(e) => {
              // The picker reports every drag; save once it settles.
              const color = e.target.value;
              clearTimeout(colorTimer.current);
              colorTimer.current = setTimeout(() => void choose({ kind: "color", color }), 350);
            }}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <input
          className={inputClass}
          value={scene}
          maxLength={200}
          placeholder="Describe a scene…"
          onChange={(e) => setScene(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && scene.trim().length >= 3 && apply("scene", () => api.generateBackdrop(avatar.id, token, scene.trim()))}
        />
        <Button
          variant="secondary"
          loading={busy === "scene"}
          disabled={busy !== null || scene.trim().length < 3}
          onClick={() => apply("scene", () => api.generateBackdrop(avatar.id, token, scene.trim()))}
        >
          Create
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((idea) => (
          <button key={idea} type="button" className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-200" onClick={() => setScene(idea)}>
            {idea}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
        <p className="text-xs text-ink-500">Or use a picture of your own.</p>
        <Button size="sm" variant="secondary" loading={busy === "upload"} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void apply("upload", () => api.uploadBackdrop(avatar.id, token, file));
          }}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  );
}
