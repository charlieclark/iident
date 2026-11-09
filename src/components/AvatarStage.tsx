"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FaceRig } from "@/lib/avatar/types";
import type { AvatarPlayer, Framing } from "@/lib/avatar/player";

type Props = {
  modelUrl: string;
  faceRig?: FaceRig | null;
  framing?: Framing;
  controls?: boolean;
  blinks?: boolean;
  autoRotate?: boolean;
  className?: string;
  /** Called once the character is loaded (before a face rig is applied, if none was given). */
  onReady?: (player: AvatarPlayer) => void;
  onError?: (error: Error) => void;
};

/** Mounts an AvatarPlayer and loads a character into it. */
export function AvatarStage({
  modelUrl,
  faceRig,
  framing = "full",
  controls = true,
  blinks = true,
  autoRotate = false,
  className,
  onReady,
  onError,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const playerRef = useRef<AvatarPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const callbacks = useRef({ onReady, onError });
  useLayoutEffect(() => {
    callbacks.current = { onReady, onError };
  });

  useEffect(() => {
    let cancelled = false;
    let player: AvatarPlayer | null = null;
    (async () => {
      const { AvatarPlayer } = await import("@/lib/avatar/player");
      if (cancelled || !ref.current) return;
      player = new AvatarPlayer(ref.current, { framing, controls, blinks, autoRotate });
      playerRef.current = player;
      // Handy for debugging and browser tests; not exposed in production builds.
      if (process.env.NODE_ENV === "development") {
        (window as unknown as { __iidentPlayer?: AvatarPlayer }).__iidentPlayer = player;
      }
      try {
        await player.load(modelUrl, { faceRig: faceRig ?? null });
        if (cancelled) return;
        setLoading(false);
        callbacks.current.onReady?.(player);
      } catch (err) {
        if (!cancelled) callbacks.current.onError?.(err as Error);
      }
    })();
    return () => {
      cancelled = true;
      player?.dispose();
      playerRef.current = null;
    };
    // faceRig/framing changes are applied imperatively below; reload only on a new model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  useEffect(() => {
    playerRef.current?.setFraming(framing);
  }, [framing]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={ref} className="absolute inset-0" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-ink-500">
            <span className="size-10 animate-spin rounded-full border-2 border-ink-200 border-t-accent-500" />
            Loading character…
          </div>
        </div>
      )}
    </div>
  );
}
