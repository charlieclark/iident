import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

// fal's file store: uploads get a new link each time, and files can be deleted by link.
const uploadToFal = vi.fn(async (_data: Uint8Array, _type: string, name: string) => `https://fal.example/upload-${uploadToFal.mock.calls.length}/${name}`);
const deleteAtFal = vi.fn<(url: string) => Promise<void>>(async () => {});
const KEEPS = 24 * 60 * 60 * 1000;
vi.mock("../fal", () => ({
  FAL_KEEPS_MS: 24 * 60 * 60 * 1000,
  uploadToFal: (data: Uint8Array, type: string, name: string) => uploadToFal(data, type, name),
  deleteAtFal: (url: string) => deleteAtFal(url),
}));
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag: async () => {} }));

describe("the image service's copies of our files", () => {
  let links: typeof import("../falLinks");
  let db: typeof import("../db");
  let storage: typeof import("../storage");
  let removal: typeof import("../removal");

  beforeAll(async () => {
    await freshDatabase("fal-links");
    links = await import("../falLinks");
    db = await import("../db");
    storage = await import("../storage");
    removal = await import("../removal");
  });
  beforeEach(() => {
    uploadToFal.mockClear();
    deleteAtFal.mockClear();
  });

  const HOUR = 60 * 60 * 1000;
  const now = Date.UTC(2030, 0, 1);
  /** An avatar with a stored selfie whose copy at fal was made at `now`. */
  async function withSelfie() {
    const { record } = await db.createAvatar();
    const file = await storage.putFile(record.id, "selfie-1.jpg", Buffer.from("face"));
    await links.rememberFalLink(file, "https://fal.example/first/selfie.jpg", now);
    return { id: record.id, file };
  }

  it("uses the copy fal has while it lasts", async () => {
    const { file } = await withSelfie();
    expect(await links.falLink(file, undefined, now + HOUR)).toBe("https://fal.example/first/selfie.jpg");
    expect(await links.falLink(file, undefined, now + 20 * HOUR)).toBe("https://fal.example/first/selfie.jpg");
    expect(uploadToFal).not.toHaveBeenCalled();
  });

  it("uploads the file again once fal's copy has expired, or is about to", async () => {
    const { file } = await withSelfie();
    // Someone comes back to their character the next week.
    const later = now + 7 * 24 * HOUR;
    const fresh = await links.falLink(file, "https://fal.example/first/selfie.jpg", later);
    expect(fresh).toBe("https://fal.example/upload-1/selfie-1.jpg");
    expect(uploadToFal).toHaveBeenCalledTimes(1);
    expect(Buffer.from(uploadToFal.mock.calls[0][0]).toString()).toBe("face");
    expect(uploadToFal.mock.calls[0][1]).toBe("image/jpeg");
    // The new copy is remembered, for as long as it lasts.
    expect(await links.falLink(file, undefined, later + HOUR)).toBe(fresh);
    expect(uploadToFal).toHaveBeenCalledTimes(1);
    // A link in its last minutes is not handed to a model that still has to fetch the file.
    expect(await links.falLink(file, undefined, later + KEEPS - 5 * 60 * 1000)).toBe("https://fal.example/upload-2/selfie-1.jpg");
  });

  it("falls back to the link kept with the record when the file itself is gone", async () => {
    expect(await links.falLink("nobody/selfie-9.jpg", "https://fal.example/held.jpg", now)).toBe("https://fal.example/held.jpg");
    await expect(links.falLink("nobody/selfie-9.jpg", undefined, now)).rejects.toThrow(/not in storage/);
  });

  it("deletes fal's copies when the avatar is deleted, without waiting for them to expire", async () => {
    const a = await withSelfie();
    const b = await withSelfie();
    await links.rememberFalLink(`${a.id}/concept-1.png`, "https://fal.example/first/concept.png", now);
    await db.updateAvatar(a.id, (r) => {
      r.model = { status: "failed", conceptId: "c", heightMeters: 1.7, startedAt: 1, updatedAt: 2, sources: { mesh: "https://fal.example/mesh.glb" } };
    });
    await removal.deleteAvatar(a.id);
    expect(deleteAtFal.mock.calls.map((c) => c[0]).sort()).toEqual(["https://fal.example/first/concept.png", "https://fal.example/first/selfie.jpg", "https://fal.example/mesh.glb"]);
    // Its links are forgotten; the other avatar's are untouched.
    await expect(links.falLink(a.file, undefined, now + HOUR)).rejects.toThrow(/not in storage/);
    expect(await links.falLink(b.file, undefined, now + HOUR)).toBe("https://fal.example/first/selfie.jpg");
  });

  it("still deletes the avatar when fal can't be reached", async () => {
    const a = await withSelfie();
    deleteAtFal.mockRejectedValue(new Error("fal is down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await removal.deleteAvatar(a.id)).toBe(true);
    expect(await db.getAvatar(a.id)).toBeNull();
    warn.mockRestore();
  });
});
