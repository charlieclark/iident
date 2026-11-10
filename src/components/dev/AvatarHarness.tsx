"use client";

import { useRef, useState } from "react";
import { AvatarStage } from "@/components/AvatarStage";
import type { AvatarPlayer } from "@/lib/avatar/player";
import type { FaceRig } from "@/lib/avatar/types";
import { useClientValue } from "@/lib/client/useClientValue";

/**
 * The mouth shapes the live lip sync would produce for a clip, worked out
 * ahead of time so a test can render the clip frame by frame.
 */
async function mouthTrack(url: string, fps = 60) {
  const { LipSync } = await import("@/lib/avatar/lipsync");
  const data = await (await fetch(url)).arrayBuffer();
  const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * 44100), 44100);
  const lip = new LipSync(ctx as unknown as AudioContext);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(lip.analyser);
  lip.analyser.connect(ctx.destination);
  source.start(0);
  const track: ReturnType<typeof lip.sample>[] = [];
  for (let i = 1; i < Math.floor(buffer.duration * fps); i++) {
    void ctx.suspend(i / fps).then(() => {
      track.push(lip.sample((i / fps) * 1000));
      void ctx.resume();
    });
  }
  await ctx.startRendering();
  return { duration: buffer.duration, fps, track };
}

/** Puts a value on `window` for browser tests and the console. */
function expose(key: string, value: unknown) {
  (window as unknown as Record<string, unknown>)[key] = value;
}

/**
 * Developer harness for the avatar runtime: loads a local GLB (`?model=`,
 * a full-body character or a head-and-shoulders bust), runs the face rigger
 * and exposes manual controls. Not linked from the app.
 */
export function AvatarHarness() {
  const modelUrl = useClientValue(() => new URLSearchParams(window.location.search).get("model") ?? "/dev/sample.glb", "");
  const playerRef = useRef<AvatarPlayer | null>(null);
  const [status, setStatus] = useState("loading");
  const [rig, setRig] = useState<FaceRig | null>(null);
  const [framing, setFraming] = useState<"full" | "portrait">("portrait");

  async function onReady(player: AvatarPlayer) {
    playerRef.current = player;
    expose("__player", player);
    setStatus("rigging face");
    const { computeFaceRig } = await import("@/lib/avatar/faceRigger");
    const root = player.character!;
    const result = await computeFaceRig(root, player.withRestPose);
    player.applyFaceRig(result.rig);
    expose("__rig", result.rig);
    setRig(result.rig);
    player.setMood("idle", true);
    setStatus(result.rig.detected ? "ready (detected)" : "ready (fallback)");
    expose("__mouthTrack", mouthTrack);
    expose("__ready", true);
  }

  if (!modelUrl) return null;
  const pose = (p: AvatarPlayer["debugPose"]) => {
    if (playerRef.current) playerRef.current.debugPose = p;
  };

  return (
    <main className="grid h-dvh grid-cols-[1fr_320px]">
      <AvatarStage
        modelUrl={modelUrl}
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
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["free", null],
              ["smile", { smile: 1 }],
              ["brows", { brow: 1 }],
              ["turn", { yaw: 0.3 }],
              ["nod", { pitch: -0.2 }],
              ["tilt", { roll: 0.2 }],
            ] as const
          ).map(([label, p]) => (
            <button key={label} className="rounded bg-ink-100 px-2 py-1" onClick={() => pose(p)}>
              {label}
            </button>
          ))}
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
