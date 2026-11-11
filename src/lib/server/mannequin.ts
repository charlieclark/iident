import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildMannequinPrompt, mannequinLook, type Appearance } from "@/lib/avatar/options";
import { config } from "./config";
import { generateMannequinSketch } from "./fal";
import { one, query } from "./pg";
import { download, putFile } from "./storage";

/**
 * Trying a look on a mannequin.
 *
 * Until someone has a character of their own, the look step shows their
 * choices on a neutral mannequin. Drawing the person first took half a
 * minute before anything could be tried; the mannequin needs no drawing of
 * them at all.
 *
 * It is the same mannequin for everyone, so a look only ever has to be drawn
 * once: the picture is kept under a key made from the look and shared by
 * every account. The first person to pick a combination waits about three
 * seconds; everyone after them gets it at once.
 */

/** Change this when the mannequin picture or the prompt changes, so old pictures are no longer used. */
const VERSION = 1;
/** Shared pictures are filed under one folder, beside the avatars' own. */
const FOLDER = "shared";

/** The key a look's picture is kept under: what is drawn, and what draws it. */
export function mannequinKey(appearance: Appearance): string {
  return createHash("sha256")
    .update(JSON.stringify([VERSION, config.models.preview, mannequinLook(appearance)]))
    .digest("hex")
    .slice(0, 32);
}

let picture: Promise<string> | undefined;
/** The mannequin itself, as a data URI the image model can read wherever the app runs. */
function mannequinPicture(): Promise<string> {
  picture ??= readFile(path.join(process.cwd(), "src/assets/mannequin.jpg")).then((data) => `data:image/jpeg;base64,${data.toString("base64")}`);
  picture.catch(() => (picture = undefined));
  return picture;
}

// Looks being drawn by this server instance right now, so a double tap doesn't draw twice.
const drawing = new Map<string, Promise<{ file: string; image: Buffer }>>();

/**
 * The mannequin wearing a look: the stored picture's key and, when it had to
 * be drawn just now, the picture itself (so it can be shown without a second
 * request).
 */
export async function mannequinSketch(appearance: Appearance): Promise<{ file: string; image?: Buffer }> {
  const key = mannequinKey(appearance);
  const known = await one<{ file: string }>("SELECT file FROM mannequin_sketches WHERE key = $1", [key]);
  if (known) return { file: known.file };

  let job = drawing.get(key);
  if (!job) {
    job = (async () => {
      const url = await generateMannequinSketch(await mannequinPicture(), buildMannequinPrompt(appearance));
      const image = await download(url);
      const file = await putFile(FOLDER, `mannequin-${key}.jpg`, image);
      // Two instances can draw the same new look at the same moment; either picture will do.
      await query("INSERT INTO mannequin_sketches (key, file, created_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING", [key, file, Date.now()]);
      return { file, image };
    })().finally(() => drawing.delete(key));
    drawing.set(key, job);
  }
  return job;
}
