import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

const blob = {
  put: vi.fn(async (pathname: string, body: Buffer, options: Record<string, unknown>) => ({ pathname, body, options })),
  get: vi.fn<(pathname: string, options: Record<string, unknown>) => Promise<unknown>>(),
};
vi.mock("@vercel/blob", () => blob);

describe("file storage", () => {
  let storage: typeof import("../storage");
  beforeAll(async () => {
    await freshDatabase("storage");
    storage = await import("../storage");
  });
  afterEach(() => {
    delete process.env.BLOB_STORE_ID;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    vi.clearAllMocks();
  });

  it("keeps files on disk when no Blob store is connected", async () => {
    const key = await storage.putFile("abc123", "selfie-1.jpg", Buffer.from("jpeg bytes"));
    expect(key).toBe("abc123/selfie-1.jpg");
    expect((await storage.getFile(key))?.data.toString()).toBe("jpeg bytes");
    expect(await storage.openFile(key)).toMatchObject({ size: 10 });
    expect(await storage.getFile("abc123/missing.jpg")).toBeNull();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("only accepts keys of the form avatar/name", async () => {
    await expect(storage.putFile("..", "x.jpg", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(storage.putFile("abc", "../../etc/passwd", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    expect(await storage.getFile("abc/../../etc/passwd")).toBeNull();
    expect(await storage.getFile("-abc/x.jpg")).toBeNull();
  });

  it("writes to a private Blob store when one is connected, and streams from it", async () => {
    process.env.BLOB_STORE_ID = "store_test";
    const key = await storage.putFile("abc123", "model-1.glb", Buffer.from("glb"));
    expect(key).toBe("abc123/model-1.glb");
    expect(blob.put).toHaveBeenCalledWith("files/abc123/model-1.glb", expect.any(Buffer), expect.objectContaining({ access: "private", contentType: "model/gltf-binary", addRandomSuffix: false }));

    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response("glb from blob").body, blob: { size: 13 } });
    const file = await storage.openFile(key);
    expect(blob.get).toHaveBeenCalledWith("files/abc123/model-1.glb", { access: "private" });
    expect(file?.size).toBe(13);
    expect(file?.body).toBeInstanceOf(ReadableStream);

    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response("glb from blob").body, blob: { size: 13 } });
    expect((await storage.getFile(key))?.data.toString()).toBe("glb from blob");
    blob.get.mockResolvedValueOnce(null);
    expect(await storage.getFile(key)).toBeNull();
  });

  it("refuses to fall back to the disk on Vercel, where it doesn't persist", async () => {
    process.env.VERCEL = "1";
    await expect(storage.putFile("abc123", "selfie-2.jpg", Buffer.from("x"))).rejects.toThrow(/Blob store/);
  });
});
