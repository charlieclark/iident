"use client";

import { useRef, useState } from "react";
import { AvatarStage } from "@/components/AvatarStage";
import type { AvatarPlayer } from "@/lib/avatar/player";
import type { FaceRig } from "@/lib/avatar/types";

/**
 * Developer harness for the avatar runtime: loads a local GLB, runs the face
 * rigger and exposes manual controls. Not linked from the app.
 */
export function AvatarHarness() {
  const playerRef = useRef<AvatarPlayer | null>(null);
  const [status, setStatus] = useState("loading");
  const [rig, setRig] = useState<FaceRig | null>(null);
  const [framing, setFraming] = useState<"full" | "portrait">("portrait");

  async function onReady(player: AvatarPlayer) {
    playerRef.current = player;
    (window as unknown as { __player: AvatarPlayer }).__player = player;
    setStatus("rigging face");
    const { computeFaceRig } = await import("@/lib/avatar/faceRigger");
    const root = player.character!;
    const result = await computeFaceRig(root, player.withRestPose);
    player.applyFaceRig(result.rig);
    (window as unknown as { __rig: unknown }).__rig = result.rig;
    setRig(result.rig);
    player.setMood("idle", true);
    setStatus(result.rig.detected ? "ready (detected)" : "ready (fallback)");
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  return (
    <main className="grid h-dvh grid-cols-[1fr_320px]">
      <AvatarStage
        modelUrl="/dev/sample.glb"
        framing={framing}
        className="stage-bg h-full"
        onReady={onReady}
        onError={(e) => setStatus(`error: ${e.message}`)}
      />
      <aside className="space-y-3 overflow-auto border-l border-ink-100 bg-card p-4 text-sm">
        <p id="status" className="font-mono">{status}</p>
        <div className="flex flex-wrap gap-2">
          {["idle", "listening", "thinking", "talking"].map((m) => (
            <button key={m} className="rounded bg-ink-100 px-2 py-1" onClick={() => playerRef.current?.setMood(m as never)}>
              {m}
            </button>
          ))}
          <button className="rounded bg-ink-100 px-2 py-1" onClick={() => playerRef.current?.wave()}>
            wave
          </button>
          <button className="rounded bg-ink-100 px-2 py-1" onClick={() => setFraming(framing === "full" ? "portrait" : "full")}>
            framing: {framing}
          </button>
        </div>
        <button
          className="rounded bg-accent-500 px-3 py-1.5 text-white"
          onClick={async () => {
            const p = playerRef.current;
            if (!p) return;
            await p.unlockAudio();
            p.beginReply();
            p.enqueueSpeech("https://v3b.fal.media/files/b/0ab1c9f4/Tjl7QaAXX1i9j2NfM0bVl_speech.mp3", 0);
            p.endReply();
          }}
        >
          Play sample speech
        </button>
        {rig && <pre className="max-h-96 overflow-auto rounded bg-ink-50 p-2 text-[10px]">{JSON.stringify({ detected: rig.detected, mouth: rig.mouth.center, skin: rig.skinColor, lip: rig.lipColor }, null, 1)}</pre>}
      </aside>
    </main>
  );
}
