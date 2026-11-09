"use client";

import Link from "next/link";
import { useState } from "react";
import type { AvatarPlayer } from "@/lib/avatar/player";
import type { PublicAvatar } from "@/lib/avatar/types";
import { AvatarChat } from "@/components/AvatarChat";
import { AvatarStage } from "@/components/AvatarStage";

/** The shareable page: a full-screen stage with the avatar and a chat dock. */
export function PublicAvatarView({ avatar }: { avatar: PublicAvatar }) {
  const [player, setPlayer] = useState<AvatarPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const { persona } = avatar;
  return (
    <main className="stage-bg-dark relative h-dvh overflow-hidden text-white">
      <div className="absolute inset-0">
        <AvatarStage
          modelUrl={avatar.modelUrl}
          faceRig={avatar.faceRig}
          framing="portrait"
          controls
          className="size-full"
          onReady={async (p) => {
            // Avatars published before their face was rigged get one on the fly.
            if (!avatar.faceRig) {
              try {
                const { computeFaceRig } = await import("@/lib/avatar/faceRigger");
                const { rig } = await computeFaceRig(p.character!, p.withRestPose);
                p.applyFaceRig(rig);
              } catch (err) {
                console.warn("Face rigging failed", err);
              }
            }
            setPlayer(p);
          }}
          onError={() => setFailed(true)}
        />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-md">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{persona.name}</h1>
            <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/80">
              AI avatar
            </span>
          </div>
          {persona.tagline && <p className="mt-1 text-sm text-white/70">{persona.tagline}</p>}
        </div>
        <Link href="/" className="pointer-events-auto shrink-0 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition hover:bg-white/20">
          Make your own
        </Link>
      </header>

      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-white/80">
          This avatar couldn&apos;t load. Try refreshing the page.
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#121117] via-[#121117]/80 to-transparent px-4 pb-5 pt-24 sm:pb-8">
        <AvatarChat
          slug={avatar.slug}
          name={persona.name}
          language={persona.language}
          player={player}
          dark
          className="mx-auto max-w-xl"
        />
        <p className="mx-auto mt-3 max-w-xl text-center text-[11px] text-white/40">
          You&apos;re talking to an AI version of {persona.name}. It can make mistakes. <span className="whitespace-nowrap">Made with iident</span>
        </p>
      </div>
    </main>
  );
}
