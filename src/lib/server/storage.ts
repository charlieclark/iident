import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/**
 * Stored files (selfies, character images, 3D models, voice recordings),
 * addressed as <avatarId>/<name> and served by /api/files/[...key], which
 * decides who may read what.
 *
 * On Vercel they live in a private Vercel Blob store: nothing in it can be
 * fetched without going through the app. Without a Blob store configured
 * (local development) they are files under DATA_DIR/files.
 */

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

/** Throws unless `key` is exactly <avatarId>/<name> made of safe characters. */
function checkKey(key: string): string {
  const parts = key.split("/");
  if (parts.length !== 2 || !parts.every((p) => SAFE_NAME.test(p))) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return key;
}

export type StoredFile = { body: ReadableStream<Uint8Array> | Uint8Array; size: number | null };

type Driver = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  open(key: string): Promise<StoredFile | null>;
  /** Removes every file stored under one avatar. */
  removeAll(avatarId: string): Promise<void>;
};

const localPath = (key: string) => path.join(config.dataDir, "files", ...key.split("/"));

const local: Driver = {
  async put(key, data) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  async open(key) {
    try {
      const data = await readFile(localPath(key));
      return { body: new Uint8Array(data), size: data.length };
    } catch {
      return null;
    }
  },
  async removeAll(avatarId) {
    await rm(path.join(config.dataDir, "files", avatarId), { recursive: true, force: true });
  },
};

/** Files are never changed once written, so the store may cache them for as long as it likes. */
const ONE_YEAR = 365 * 24 * 60 * 60;
const blobPath = (key: string) => `files/${key}`;

const blob: Driver = {
  async put(key, data, contentType) {
    const { put } = await import("@vercel/blob");
    await put(blobPath(key), Buffer.from(data), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: ONE_YEAR });
  },
  async open(key) {
    const { get } = await import("@vercel/blob");
    const found = await get(blobPath(key), { access: "private" });
    if (!found || found.statusCode !== 200 || !found.stream) return null;
    return { body: found.stream, size: found.blob.size };
  },
  async removeAll(avatarId) {
    const { list, del } = await import("@vercel/blob");
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${blobPath(avatarId)}/`, cursor });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  },
};

/** A Blob store is connected when Vercel provides its id (signed in through OIDC) or a read-write token. */
const blobConfigured = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

function driver(): Driver {
  if (blobConfigured()) return blob;
  if (process.env.VERCEL) throw new Error("No file storage: connect a private Vercel Blob store to the project (see docs/deploying.md).");
  return local;
}

export async function putFile(avatarId: string, name: string, data: Uint8Array | Buffer) {
  const key = checkKey(`${avatarId}/${name}`);
  await driver().put(key, data, contentTypeFor(key));
  return key;
}

/** Removes everything stored for an avatar: selfie, portrait, character images, voice recording, model. */
export async function deleteFiles(avatarId: string): Promise<void> {
  if (!SAFE_NAME.test(avatarId)) throw new Error(`Invalid avatar id: ${avatarId}`);
  await driver().removeAll(avatarId);
}

/** Opens a stored file for sending on, without holding all of it in memory where the store can stream. */
export async function openFile(key: string): Promise<StoredFile | null> {
  try {
    checkKey(key);
  } catch {
    return null;
  }
  return driver().open(key);
}

/** A stored file's whole contents. */
export async function getFile(key: string): Promise<{ data: Buffer; size: number } | null> {
  const file = await openFile(key);
  if (!file) return null;
  const data = file.body instanceof Uint8Array ? Buffer.from(file.body) : Buffer.from(await new Response(file.body).arrayBuffer());
  return { data, size: data.length };
}

export const fileUrl = (key: string) => `/api/files/${key}`;

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

export const contentTypeFor = (key: string) =>
  TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";

export async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
