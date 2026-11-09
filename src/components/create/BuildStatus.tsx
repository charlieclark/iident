"use client";

import { useEffect, useState } from "react";
import type { Avatar } from "@/lib/client/api";
import { cx, Spinner } from "@/components/ui";

export const STAGE_COPY: Record<string, { label: string; detail: string }> = {
  queued: { label: "Getting started", detail: "Your character is in line for the 3D studio." },
  sculpting: { label: "Sculpting in 3D", detail: "Turning your character sheet into a textured 3D body." },
  rigging: { label: "Adding a skeleton", detail: "Rigging the body and teaching it to wave, talk and think." },
  finishing: { label: "Final touches", detail: "Packing the model and its animations." },
  ready: { label: "3D ready", detail: "Your character is built." },
  failed: { label: "Build failed", detail: "Something went wrong while building the 3D model." },
};

export function useElapsed(since: number | null | undefined, until?: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since || until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since, until]);
  if (!since) return "";
  const s = Math.max(0, Math.round(((until ?? now) - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Header pill showing the background 3D build. */
export function BuildStatus({ avatar, onOpen }: { avatar: Avatar; onOpen: () => void }) {
  const m = avatar.model;
  const elapsed = useElapsed(m?.startedAt, m?.finishedAt);
  if (!m) return null;
  const copy = STAGE_COPY[m.status] ?? STAGE_COPY.queued;
  const active = m.status !== "ready" && m.status !== "failed";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active && "border-accent-200 bg-accent-50 text-accent-800",
        m.status === "ready" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        m.status === "failed" && "border-red-200 bg-red-50 text-red-800",
      )}
    >
      {active ? <Spinner className="size-3.5" /> : <span className={cx("size-2 rounded-full", m.status === "ready" ? "bg-emerald-500" : "bg-red-500")} />}
      <span className="font-medium">{copy.label}</span>
      {active && <span className="tabular-nums text-accent-600/80">{elapsed}</span>}
    </button>
  );
}

/** Larger progress card used inside steps while the build runs. */
export function BuildCard({ avatar, compact }: { avatar: Avatar; compact?: boolean }) {
  const m = avatar.model;
  const elapsed = useElapsed(m?.startedAt, m?.finishedAt);
  if (!m) return null;
  const order = ["queued", "sculpting", "rigging", "finishing", "ready"];
  const idx = order.indexOf(m.status);
  const copy = STAGE_COPY[m.status] ?? STAGE_COPY.queued;
  return (
    <div className={cx("rounded-3xl border border-ink-100 bg-card p-4", compact ? "" : "shadow-soft")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-900">{copy.label}</p>
          <p className="text-xs text-ink-500">{m.status === "failed" ? m.error || copy.detail : copy.detail}</p>
        </div>
        {m.status !== "failed" && <span className="font-mono text-xs tabular-nums text-ink-500">{elapsed}</span>}
      </div>
      <div className="mt-3 flex gap-1.5">
        {order.slice(1).map((s, i) => (
          <span
            key={s}
            className={cx(
              "h-1.5 flex-1 rounded-full transition-colors",
              m.status === "failed" ? "bg-red-200" : i + 1 < idx || m.status === "ready" ? "bg-accent-500" : i + 1 === idx ? "animate-pulse bg-accent-300" : "bg-ink-100",
            )}
          />
        ))}
      </div>
      {m.status !== "ready" && m.status !== "failed" && (
        <p className="mt-2 text-xs text-ink-400">Usually 3 to 10 minutes. Keep going: we build in the background.</p>
      )}
    </div>
  );
}
