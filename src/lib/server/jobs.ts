import "server-only";
import { randomBytes } from "node:crypto";
import type { AvatarRecord, ModelJob } from "@/lib/avatar/types";
import { config, HttpError } from "./config";
import { userById } from "./auth";
import { avatarOwner, getAvatar, updateAvatar } from "./db";
import { sendAvatarReadyEmail, sendBuildFailedEmail } from "./email";
import { meshResult, rigResult, submitMesh, submitRig } from "./fal";
import { mergeCharacter } from "./glb";
import { logError, track } from "./insights";
import { download } from "./storage";
import { saveFile } from "./avatarFiles";

/**
 * The 3D pipeline for one avatar:
 *   character sheet --(image-to-3D, A-pose)--> textured mesh      "sculpting"
 *   mesh --(auto-rig + animation presets)--> rigged GLB + clips   "rigging"
 *   rigged + clips --(merge, compress)--> model.glb in storage    "finishing"
 *
 * A build takes 4 to 13 minutes, longer than a serverless function may run,
 * and no server process outlives a request. So nothing waits: the two slow
 * steps run in fal's queue, the record keeps their request ids, and
 * `advanceModelJob` moves the build on by one step whenever it is called:
 * by the creator's page polling for progress, and by fal's webhook when a
 * step completes (so the build finishes even if the page is closed).
 *
 * Any instance can call it at any time. A short lease on the record makes
 * sure a step is only ever submitted once.
 */

/** Time allowed for submitting a step to the queue. */
const STEP_LEASE_MS = 60_000;
/** Time allowed for downloading, merging and storing the finished model. */
const FINISH_LEASE_MS = 4 * 60_000;
/** A stage that has not moved in this long has failed. */
const STAGE_TIMEOUT_MS = 25 * 60_000;
const MAX_FINISH_ATTEMPTS = 3;

/** Whether a build is under way (neither finished nor failed). */
export const isBuilding = (m: ModelJob | undefined): boolean => !!m && m.status !== "ready" && m.status !== "failed";

type Advance = {
  record: AvatarRecord;
  /** The final merge, when this call is the one to do it. Run it after responding (`after(finish)`). */
  finish?: () => Promise<void>;
};

/** Where fal reports a finished step. Only a public address can be called. */
function webhookUrl(avatarId: string, hookKey: string | undefined): string | undefined {
  if (!hookKey || !config.appUrl.startsWith("https://")) return undefined;
  return `${config.appUrl}/api/fal/webhook?avatar=${encodeURIComponent(avatarId)}&key=${hookKey}`;
}

/** Starts a build of the chosen character image, or throws if one is already under way. */
export async function startModelJob(avatarId: string, conceptId: string, heightMeters: number): Promise<Advance> {
  let problem: HttpError | null = null;
  const record = await updateAvatar(avatarId, (r) => {
    if (!r.concepts.some((c) => c.id === conceptId)) {
      problem = new HttpError(404, "Concept not found.");
      return false;
    }
    if (isBuilding(r.model)) {
      problem = new HttpError(409, "Your character is already being built.");
      return false;
    }
    // A retry of the same concept after a late-stage failure reuses the mesh
    // instead of re-sculpting (the slowest step).
    const prev = r.model;
    const reuseMesh =
      prev?.status === "failed" && prev.conceptId === conceptId && prev.heightMeters === heightMeters && !prev.meshReused
        ? prev.sources?.mesh
        : undefined;
    const now = Date.now();
    r.selectedConceptId = conceptId;
    r.faceRig = undefined;
    r.model = {
      status: "queued",
      conceptId,
      heightMeters,
      startedAt: now,
      updatedAt: now,
      stageAt: now,
      hookKey: randomBytes(18).toString("base64url"),
      ...(reuseMesh ? { sources: { mesh: reuseMesh }, meshReused: true } : {}),
    };
  });
  if (problem) throw problem;
  return advanceModelJob(record);
}

/** Takes the lease for a step, if the build is still at `stage` and nobody else holds it. */
async function claim(avatarId: string, stage: ModelJob["status"], ms: number, change?: (m: ModelJob) => void): Promise<{ id: string; record: AvatarRecord } | null> {
  const id = randomBytes(6).toString("hex");
  let taken = false;
  const record = await updateAvatar(avatarId, (r) => {
    const m = r.model;
    const now = Date.now();
    if (!m || m.status !== stage || (m.lease && m.lease.until > now)) return false;
    m.lease = { id, until: now + ms };
    change?.(m);
    taken = true;
  });
  return taken ? { id, record } : null;
}

/** Saves a step's outcome and gives the lease back. Dropped if the lease has passed to someone else. */
function settle(avatarId: string, leaseId: string, patch: Partial<ModelJob>): Promise<AvatarRecord> {
  return updateAvatar(avatarId, (r) => {
    if (r.model?.lease?.id !== leaseId) return false;
    const now = Date.now();
    r.model = { ...r.model, ...patch, updatedAt: now, ...(patch.status && patch.status !== r.model.status ? { stageAt: now } : {}) };
    delete r.model.lease;
  });
}

/**
 * A build takes minutes and carries on with the page closed, so its owner is
 * told by email how it ended. Also counted, for the numbers on /admin.
 */
async function ended(record: AvatarRecord, outcome: "ready" | "failed"): Promise<void> {
  try {
    const ownerId = await avatarOwner(record.id);
    await track(outcome === "ready" ? "build_ready" : "build_failed", { userId: ownerId, avatarId: record.id });
    if (outcome === "failed") await logError("build", record.model?.error ?? "3D build failed", { route: record.id });
    const owner = ownerId ? await userById(ownerId) : null;
    if (!owner) return;
    const link = `${config.appUrl}/create?id=${record.id}`;
    await (outcome === "ready" ? sendAvatarReadyEmail : sendBuildFailedEmail)(owner.email, record.persona.name, link);
  } catch (err) {
    console.warn(`[model job ${record.id}] could not report the outcome:`, err);
  }
}

/** Marks the build failed, whatever stage it is at, unless it has already ended. */
async function fail(avatarId: string, message: string): Promise<AvatarRecord> {
  let changed = false;
  const record = await updateAvatar(avatarId, (r) => {
    if (!r.model || !isBuilding(r.model)) return false;
    const now = Date.now();
    r.model = { ...r.model, status: "failed", error: message, updatedAt: now, finishedAt: now };
    delete r.model.lease;
    changed = true;
  });
  if (changed) await ended(record, "failed");
  return record;
}

/**
 * Moves an avatar's build on if there is something to do, and returns the
 * record as it then stands. Cheap when nothing changed: one status request
 * to fal and no writes.
 */
export async function advanceModelJob(record: AvatarRecord): Promise<Advance> {
  const m = record.model;
  if (!m || !isBuilding(m)) return { record };
  const now = Date.now();
  // Another call is in the middle of a step.
  if (m.lease && m.lease.until > now) return { record };
  const id = record.id;
  if (now - (m.stageAt ?? m.updatedAt) > STAGE_TIMEOUT_MS) {
    return { record: await fail(id, "Generation took too long. Please try again.") };
  }
  const hook = webhookUrl(id, m.hookKey);

  try {
    if (m.status === "queued") {
      const lease = await claim(id, "queued", STEP_LEASE_MS);
      if (!lease) return { record: (await getAvatar(id)) ?? record };
      const mesh = m.sources?.mesh;
      if (mesh) {
        const rig = await submitRig({ glbUrl: mesh, heightMeters: m.heightMeters }, hook);
        return { record: await settle(id, lease.id, { status: "rigging", requests: { rig } }) };
      }
      const concept = record.concepts.find((c) => c.id === m.conceptId);
      if (!concept) return { record: await fail(id, "The character image for this build is gone. Create it again.") };
      const request = await submitMesh(concept.url, hook);
      return { record: await settle(id, lease.id, { status: "sculpting", requests: { mesh: request } }) };
    }

    if (m.status === "sculpting") {
      const request = m.requests?.mesh;
      if (!request) return { record: await fail(id, "Generation was interrupted. Please try again.") };
      const mesh = await meshResult(request);
      if (!mesh) return { record };
      const lease = await claim(id, "sculpting", STEP_LEASE_MS);
      if (!lease) return { record: (await getAvatar(id)) ?? record };
      const rig = await submitRig({ glbUrl: mesh.glbUrl, heightMeters: m.heightMeters }, hook);
      return { record: await settle(id, lease.id, { status: "rigging", sources: { mesh: mesh.glbUrl }, requests: { ...m.requests, rig } }) };
    }

    if (m.status === "rigging") {
      const request = m.requests?.rig;
      if (!request) return { record: await fail(id, "Generation was interrupted. Please try again.") };
      const rig = await rigResult(request);
      if (!rig) return { record };
      const lease = await claim(id, "rigging", STEP_LEASE_MS);
      if (!lease) return { record: (await getAvatar(id)) ?? record };
      await settle(id, lease.id, {
        status: "finishing",
        sources: { ...m.sources, rigged: rig.riggedGlbUrl },
        clipSources: rig.clips.map((c) => ({ name: c.name, url: c.glbUrl })),
      });
    }

    // "finishing": merge the pieces and store the model. A merge that was cut
    // short (its lease ran out) is started again, a limited number of times.
    const lease = await claim(id, "finishing", FINISH_LEASE_MS, (job) => {
      job.finishAttempts = (job.finishAttempts ?? 0) + 1;
    });
    if (!lease) return { record: (await getAvatar(id)) ?? record };
    if ((lease.record.model?.finishAttempts ?? 0) > MAX_FINISH_ATTEMPTS) {
      return { record: await fail(id, "We couldn't put your character together. Please try again.") };
    }
    return { record: lease.record, finish: () => finishModel(id, lease.id) };
  } catch (err) {
    console.error(`[model job ${id}]`, err);
    // An answer from the 3D service is final. Anything else (a dropped
    // connection, a database hiccup) is left for the next call to retry.
    if (typeof (err as { status?: unknown })?.status === "number") return { record: await fail(id, friendlyError(err)) };
    return { record: (await getAvatar(id).catch(() => null)) ?? record };
  }
}

async function finishModel(avatarId: string, leaseId: string): Promise<void> {
  try {
    const m = (await getAvatar(avatarId))?.model;
    const rigged = m?.sources?.rigged;
    if (!m || m.lease?.id !== leaseId || !rigged) return;
    const clips = m.clipSources ?? [];
    const [riggedData, ...clipData] = await Promise.all([download(rigged), ...clips.map((c) => download(c.url))]);
    const merged = await mergeCharacter({ rigged: riggedData, clips: clips.map((c, i) => ({ name: c.name, data: clipData[i] })) });
    const file = await saveFile(avatarId, `model-${Date.now().toString(36)}.glb`, merged.glb);
    const record = await settle(avatarId, leaseId, { status: "ready", file, clips: merged.clips, finishedAt: Date.now() });
    if (record.model?.status === "ready" && record.model.file === file) await ended(record, "ready");
  } catch (err) {
    console.error(`[model job ${avatarId}] finishing`, err);
    // Give the lease back so the next call tries again.
    await updateAvatar(avatarId, (r) => {
      if (r.model?.lease?.id !== leaseId) return false;
      delete r.model.lease;
    }).catch(() => {});
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
