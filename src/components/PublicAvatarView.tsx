"use client";

import Link from "next/link";
import { useState } from "react";
import type { AvatarPlayer } from "@/lib/avatar/player";
import type { PublicAvatar } from "@/lib/avatar/types";
import { AvatarChat } from "@/components/AvatarChat";
import { Backdrop } from "@/components/Backdrop";
import { cx } from "@/components/ui";
import { AvatarStage } from "@/components/AvatarStage";

/** The shareable page: a full-screen stage with the avatar and a chat dock. */
export function PublicAvatarView({ avatar }: { avatar: PublicAvatar }) {
  const [player, setPlayer] = useState<AvatarPlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const { persona } = avatar;
  // Text and chat switch between light and dark to suit the backdrop.
  const dark = avatar.backdrop.tone === "dark";
  return (
    <main className={cx("relative h-dvh overflow-hidden", dark ? "bg-[#121117] text-white" : "bg-paper text-ink-900")}>
      <Backdrop backdrop={avatar.backdrop} />
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
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide backdrop-blur",
                dark ? "border-white/25 bg-white/10 text-white/80" : "border-ink-900/15 bg-white/50 text-ink-700",
              )}
            >
              AI avatar
            </span>
          </div>
          {persona.tagline && <p className={cx("mt-1 text-sm", dark ? "text-white/70" : "text-ink-700")}>{persona.tagline}</p>}
        </div>
        <Link
          href="/"
          className={cx(
            "pointer-events-auto shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs backdrop-blur transition",
            dark ? "bg-white/10 text-white/80 hover:bg-white/20" : "bg-white/60 text-ink-700 hover:bg-white/80",
          )}
        >
          Make your own
        </Link>
      </header>

      {failed && (
        <div className={cx("absolute inset-0 grid place-items-center p-6 text-center", dark ? "text-white/80" : "text-ink-700")}>
          This avatar couldn&apos;t load. Try refreshing the page.
        </div>
      )}

      <div
        className={cx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t to-transparent px-4 pb-5 pt-24 sm:pb-8",
          dark ? "from-[#121117] via-[#121117]/80" : "from-white/95 via-white/60",
        )}
      >
        <AvatarChat
          slug={avatar.slug}
          name={persona.name}
          language={persona.language}
          player={player}
          dark={dark}
          className="mx-auto max-w-xl"
        />
        <p className={cx("mx-auto mt-3 max-w-xl text-center text-[11px]", dark ? "text-white/40" : "text-ink-500")}>
          You&apos;re talking to an AI version of {persona.name}. It can make mistakes. <span className="whitespace-nowrap">Made with iident</span>
        </p>
      </div>
    </main>
  );
}
