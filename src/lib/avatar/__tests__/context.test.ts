import { describe, expect, it } from "vitest";
import { contextSchema, itemProblem, itemSchema, toPublicItem, videoSource } from "../context";

describe("context items", () => {
  it("accepts each kind with its required link and drops blank optional fields", () => {
    const link = itemSchema.parse({ id: "a", kind: "link", title: " My site ", url: "https://example.com", image: "", price: " " });
    expect(link).toEqual({ id: "a", kind: "link", title: "My site", url: "https://example.com" });
    expect(itemSchema.safeParse({ id: "b", kind: "image", title: "Poster", image: "https://example.com/p.jpg" }).success).toBe(true);
    expect(itemProblem({ id: "c", kind: "product", title: "Tee" })).toBe("Add a link.");
    expect(itemProblem({ id: "d", kind: "image", title: "Poster", url: "https://example.com" })).toBe("Add the image's link.");
  });

  it("rejects links that are not http(s) and malformed ids", () => {
    expect(itemProblem({ id: "a", kind: "link", title: "x", url: "javascript:alert(1)" })).toMatch(/https/);
    expect(itemProblem({ id: "a b", kind: "link", title: "x", url: "https://example.com" })).toMatch(/ids/);
  });

  it("rejects duplicate ids and fills defaults", () => {
    expect(contextSchema.parse({})).toEqual({ knowledge: "", items: [] });
    const dup = contextSchema.safeParse({
      items: [
        { id: "a", kind: "link", title: "x", url: "https://example.com" },
        { id: "a", kind: "link", title: "y", url: "https://example.org" },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it("keeps avatar-only notes out of what browsers receive", () => {
    const item = itemSchema.parse({ id: "a", kind: "link", title: "x", url: "https://example.com", notes: "upsell", data: { block: 3 } });
    expect(toPublicItem(item)).toEqual({ id: "a", kind: "link", title: "x", url: "https://example.com", data: { block: 3 } });
  });
});

describe("video sources", () => {
  it("embeds YouTube links privacy-enhanced, with start times", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s",
      "https://youtu.be/dQw4w9WgXcQ?t=65",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ?start=65",
    ]) {
      expect(videoSource(url)).toEqual({
        type: "embed",
        provider: "youtube",
        src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0&start=65",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      });
    }
  });

  it("embeds Vimeo, including unlisted hashes", () => {
    expect(videoSource("https://vimeo.com/76979871")).toMatchObject({ src: "https://player.vimeo.com/video/76979871?autoplay=1" });
    expect(videoSource("https://vimeo.com/76979871/abcdef1234")).toMatchObject({
      src: "https://player.vimeo.com/video/76979871?autoplay=1&h=abcdef1234",
    });
  });

  it("plays video files directly and leaves other pages as links", () => {
    expect(videoSource("https://cdn.example.com/clip.mp4")).toEqual({ type: "file", src: "https://cdn.example.com/clip.mp4" });
    expect(videoSource("https://www.tiktok.com/@me/video/1")).toBeNull();
    expect(videoSource("not a url")).toBeNull();
    expect(videoSource("javascript:alert(1)//clip.mp4")).toBeNull();
  });
});
