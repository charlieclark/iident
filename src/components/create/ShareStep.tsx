"use client";

import { useCallback, useRef, useState } from "react";
import type { AvatarPlayer } from "@/lib/avatar/player";
import { api, ownerUrl, type Avatar } from "@/lib/client/api";
import { useClientValue } from "@/lib/client/useClientValue";
import { AvatarChat } from "@/components/AvatarChat";
import { AvatarStage } from "@/components/AvatarStage";
import { Button, Card, Field, inputClass, Notice, Segmented, Spinner } from "@/components/ui";
import { BuildCard } from "./BuildStatus";
import type { StepProps } from "./CreateFlow";

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

export function ShareStep({ avatar, token, onChange, goTo }: StepProps) {
  const ready = avatar.model?.status === "ready" && avatar.model.url;
  return (
    <div>
      <p className="text-sm font-medium text-accent-600">Step 5</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        {ready ? "Meet your avatar" : "Almost there"}
      </h1>
      {!ready ? (
        <Waiting avatar={avatar} token={token} goTo={goTo} />
      ) : (
        <Ready avatar={avatar} token={token} onChange={onChange} goTo={goTo} />
      )}
    </div>
  );
}

function Waiting({ avatar, token, goTo }: { avatar: Avatar; token: string; goTo: StepProps["goTo"] }) {
  const concept = avatar.concepts.find((c) => c.id === avatar.model?.conceptId);
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      {concept && (
        <Card className="overflow-hidden p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ownerUrl(concept.imageUrl, token)} alt="Your character" className="aspect-[9/16] w-full rounded-2xl bg-white object-contain" />
        </Card>
      )}
      <div className="space-y-4">
        <p className="max-w-lg text-ink-600">
          We&apos;re still building your 3D character. This page updates on its own, and it&apos;s safe to leave: your
          draft is saved in this browser.
        </p>
        <BuildCard avatar={avatar} />
        {avatar.model?.status === "failed" && (
          <Button onClick={() => goTo("look")}>Back to your looks</Button>
        )}
        {!avatar.model && <Button onClick={() => goTo("look")}>Pick a look first</Button>}
      </div>
    </div>
  );
}

function Ready({ avatar, token, onChange, goTo }: StepProps) {
  const [player, setPlayer] = useState<AvatarPlayer | null>(null);
  const [rigging, setRigging] = useState(false);
  const [framing, setFraming] = useState<"portrait" | "full">("portrait");
  const rigStarted = useRef(false);
  const glasses = avatar.appearance.accessories.some((a) => a.includes("glasses"));

  const onReady = useCallback(
    async (p: AvatarPlayer) => {
      if (avatar.faceRig) {
        setPlayer(p);
        return;
      }
      if (rigStarted.current) return;
      rigStarted.current = true;
      setRigging(true);
      try {
        const { computeFaceRig } = await import("@/lib/avatar/faceRigger");
        const { rig } = await computeFaceRig(p.character!, p.withRestPose);
        p.applyFaceRig(rig);
        p.setMood("idle", true);
        // Give the idle pose a moment to settle before the share thumbnail.
        await new Promise((r) => setTimeout(r, 600));
        const thumb = p.snapshot(600, 800);
        const { avatar: next } = await api.saveFaceRig(avatar.id, token, rig, thumb);
        onChange({ ...next, faceRig: rig });
      } catch (e) {
        console.error(e);
      } finally {
        setRigging(false);
        setPlayer(p);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [avatar.id, token],
  );

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="relative overflow-hidden">
        <AvatarStage
          modelUrl={avatar.model!.url!}
          faceRig={avatar.faceRig}
          framing={framing}
          blinks={!glasses}
          className="stage-bg h-[68vh] min-h-[460px]"
          onReady={onReady}
        />
        {rigging && (
          <div className="absolute inset-x-0 top-4 flex justify-center">
            <span className="flex items-center gap-2 rounded-full bg-ink-900/80 px-3 py-1.5 text-xs text-white backdrop-blur">
              <Spinner className="size-3" /> Setting up facial animation…
            </span>
          </div>
        )}
        <div className="absolute right-4 top-4">
          <Segmented
            value={framing}
            options={[
              { id: "portrait", label: "Close-up" },
              { id: "full", label: "Full body" },
            ]}
            onChange={setFraming}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-paper via-paper/70 to-transparent p-4 pt-16">
          <AvatarChat
            slug={avatar.slug ?? avatar.id}
            previewId={avatar.id}
            token={token}
            name={avatar.persona.name}
            language={avatar.persona.language}
            player={rigging ? null : player}
            className="mx-auto max-w-xl"
          />
        </div>
      </Card>

      <aside className="space-y-4">
        <PublishCard avatar={avatar} token={token} onChange={onChange} />
        <Card className="space-y-2 p-4 text-sm">
          <p className="font-medium">Make changes</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => goTo("look")}>
              Look
            </Button>
            <Button size="sm" variant="secondary" onClick={() => goTo("voice")}>
              Voice
            </Button>
            <Button size="sm" variant="secondary" onClick={() => goTo("persona")}>
              Persona
            </Button>
          </div>
          <p className="text-xs text-ink-500">Changes to the voice and persona go live right away.</p>
        </Card>
      </aside>
    </div>
  );
}

function PublishCard({ avatar, token, onChange }: { avatar: Avatar; token: string; onChange: (a: Avatar) => void }) {
  const [slug, setSlug] = useState(avatar.slug ?? toSlug(avatar.persona.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = useClientValue(() => window.location.origin, "");
  const url = avatar.slug ? `${origin}/a/${avatar.slug}` : "";

  async function publish(published = true) {
    setBusy(true);
    setError(null);
    try {
      const { avatar: next } = await api.publish(avatar.id, token, slug, published);
      onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (avatar.published && avatar.slug) {
    return (
      <Card className="space-y-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <span className="size-2 rounded-full bg-emerald-500" /> Live
        </p>
        <div className="flex items-center gap-2 rounded-2xl bg-ink-50 p-2 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-sm">{url}</span>
          <Button
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="flex-1">
            <Button variant="secondary" className="w-full">
              Open page
            </Button>
          </a>
          <Button variant="ghost" loading={busy} onClick={() => publish(false)}>
            Unpublish
          </Button>
        </div>
        <p className="text-xs text-ink-500">
          Keep this browser to edit later: your private edit access is stored here, not in the share link.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold">Get your link</p>
      <Field label="Your link">
        <div className="flex items-center rounded-2xl border border-ink-200 bg-card pl-3 focus-within:border-accent-400 focus-within:ring-4 focus-within:ring-accent-100">
          <span className="text-sm text-ink-400">/a/</span>
          <input
            className={`${inputClass} border-0 pl-1 focus:ring-0`}
            value={slug}
            maxLength={32}
            onChange={(e) => setSlug(toSlug(e.target.value) || e.target.value.toLowerCase())}
            placeholder="your-name"
          />
        </div>
      </Field>
      {!avatar.persona.name && <Notice tone="warn">Add a name in the Persona step first.</Notice>}
      {!avatar.voice && <Notice tone="warn">No voice yet: visitors will hear a stock voice.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <Button className="w-full" size="lg" loading={busy} disabled={slug.length < 3 || !avatar.persona.name} onClick={() => publish(true)}>
        Publish
      </Button>
    </Card>
  );
}
