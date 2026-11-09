import "server-only";
import type { ModelJob, ModelStage } from "@/lib/avatar/types";
import { getAvatar, updateAvatar } from "./db";
import { generateMesh, rigAndAnimate } from "./fal";
import { mergeCharacter } from "./glb";
import { download, putFile } from "./storage";

/**
 * The 3D pipeline for one avatar:
 *   character sheet --(image-to-3D, A-pose)--> textured mesh
 *   mesh --(auto-rig + animation presets)--> rigged GLB + clip GLBs
 *   rigged + clips --(merge, compress)--> model.glb stored locally
 * Progress is persisted on the avatar record so any client can poll it.
 */

const running = new Map<string, Promise<void>>();

function setJob(avatarId: string, patch: Partial<ModelJob> & { status?: ModelStage }) {
  return updateAvatar(avatarId, (r) => {
    if (!r.model) return;
    r.model = { ...r.model, ...patch, updatedAt: Date.now() };
  });
}

export function isJobRunning(avatarId: string) {
  return running.has(avatarId);
}

export function startModelJob(avatarId: string, conceptId: string, heightMeters: number) {
  if (running.has(avatarId)) return;
  const record = getAvatar(avatarId);
  const concept = record?.concepts.find((c) => c.id === conceptId);
  if (!record || !concept) throw new Error("Concept not found");

  const now = Date.now();
  updateAvatar(avatarId, (r) => {
    r.selectedConceptId = conceptId;
    r.faceRig = undefined;
    r.model = { status: "queued", conceptId, heightMeters, startedAt: now, updatedAt: now };
  });

  const job = runModelJob(avatarId, concept.url, heightMeters).finally(() => running.delete(avatarId));
  running.set(avatarId, job);
  return job;
}

async function runModelJob(avatarId: string, conceptUrl: string, heightMeters: number) {
  try {
    setJob(avatarId, { status: "sculpting" });
    const mesh = await generateMesh(conceptUrl, (id) =>
      setJob(avatarId, { requests: { mesh: id } }),
    );
    setJob(avatarId, { status: "rigging", sources: { mesh: mesh.glbUrl } });

    const rig = await rigAndAnimate({
      glbUrl: mesh.glbUrl,
      heightMeters,
      onEnqueue: (id) => setJob(avatarId, { requests: { rig: id } }),
    });
    setJob(avatarId, { status: "finishing", sources: { mesh: mesh.glbUrl, rigged: rig.riggedGlbUrl } });

    const [rigged, ...clipData] = await Promise.all([
      download(rig.riggedGlbUrl),
      ...rig.clips.map((c) => download(c.glbUrl)),
    ]);
    const merged = await mergeCharacter({
      rigged,
      clips: rig.clips.map((c, i) => ({ name: c.name, data: clipData[i] })),
    });
    const file = await putFile(avatarId, `model-${Date.now().toString(36)}.glb`, merged.glb);
    setJob(avatarId, { status: "ready", file, clips: merged.clips, finishedAt: Date.now() });
  } catch (err) {
    console.error(`[model job ${avatarId}]`, err);
    setJob(avatarId, {
      status: "failed",
      error: friendlyError(err),
      finishedAt: Date.now(),
    });
  }
}

function friendlyError(err: unknown): string {
  const e = err as { status?: number; body?: { detail?: unknown }; message?: string };
  const detail = e?.body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  if (e?.status === 422) return "The 3D service could not process this image. Try another concept.";
  return e?.message?.slice(0, 300) || "3D generation failed";
}

/**
 * A job marked in-progress that this process is not running was interrupted
 * (server restart or crash). Surface it so the user can retry.
 */
export function reconcileJob(avatarId: string) {
  const record = getAvatar(avatarId);
  const m = record?.model;
  if (!m) return record;
  const active = m.status !== "ready" && m.status !== "failed";
  if (active && !running.has(avatarId)) {
    return setJob(avatarId, {
      status: "failed",
      error: "Generation was interrupted. Please try again.",
      finishedAt: Date.now(),
    });
  }
  return record;
}
