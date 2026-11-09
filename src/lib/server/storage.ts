import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/**
 * Local file storage under DATA_DIR/files/<avatarId>/<name>, served by
 * /api/files/[...path]. Replace with S3/R2/Blob in production by keeping the
 * same three functions.
 */

const root = () => path.join(config.dataDir, "files");

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

function resolveKey(key: string): string {
  const parts = key.split("/");
  if (parts.length !== 2 || !parts.every((p) => SAFE_NAME.test(p))) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return path.join(root(), ...parts);
}

export async function putFile(avatarId: string, name: string, data: Uint8Array | Buffer) {
  const key = `${avatarId}/${name}`;
  const file = resolveKey(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return key;
}

export async function getFile(key: string): Promise<{ data: Buffer; size: number; mtime: Date } | null> {
  let file: string;
  try {
    file = resolveKey(key);
  } catch {
    return null;
  }
  try {
    const [data, info] = await Promise.all([readFile(file), stat(file)]);
    return { data, size: info.size, mtime: info.mtime };
  } catch {
    return null;
  }
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
